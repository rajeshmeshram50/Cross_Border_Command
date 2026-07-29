<?php

namespace App\Services;

use App\Models\AttendancePunch;
use App\Models\DeviceTerminal;
use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1 — the eSSL punch NORMALISER. Turns raw device records into clean,
 * tenant-scoped attendance punches. Shared by every ingest mode (real-time
 * ADMS push today; CSV upload later) so the rules live in exactly one place:
 *
 *   1. map device User ID → employee via employees.attendance_number (scoped
 *      to the terminal's client);
 *   2. convert the device's LOCAL time → UTC;
 *   3. re-derive STRICT in/out alternation by time (device status codes are
 *      unreliable — operators forget the In/Out keys — so we ignore them for
 *      direction and keep the raw code only for audit);
 *   4. upsert one attendance row per (employee, local date) + its punches,
 *      IDEMPOTENTLY (a re-pushed/re-uploaded record is skipped, not doubled).
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §6 (Phase 1), §8, §13.
 */
class EsslAttendanceImporter
{
    public function __construct(private AttendancePunchService $punches)
    {
    }

    /** Convenience entry for a registered terminal (Mode C). */
    public function importForTerminal(DeviceTerminal $terminal, array $rows): array
    {
        return $this->importRows(
            $rows,
            $terminal->client_id,
            $terminal->branch_id,
            (string) $terminal->serial,
            $terminal->timezone ?: 'Asia/Kolkata',
        );
    }

    /**
     * @param  array  $rows  each: ['user_id' => string, 'punched_at' => 'Y-m-d H:i:s', 'status' => string]
     * @return array{imported:int,skipped_duplicates:int,unmatched_user_ids:array,errors:array,employees_affected:int,date_range:array}
     */
    public function importRows(array $rows, ?int $clientId, ?int $branchId, string $serial, string $tz = 'Asia/Kolkata'): array
    {
        $imported = 0;
        $dupes = 0;
        $unmatched = [];   // user_id => true
        $errors = [];
        $affected = [];    // employee_id => true
        $minDate = null;
        $maxDate = null;

        // Clean + collect distinct device user ids.
        $clean = [];
        foreach ($rows as $r) {
            $uid = trim((string) ($r['user_id'] ?? ''));
            $ts  = trim((string) ($r['punched_at'] ?? ''));
            if ($uid === '' || $ts === '') {
                continue;
            }
            $clean[] = ['user_id' => $uid, 'ts' => $ts, 'status' => trim((string) ($r['status'] ?? ''))];
        }
        if (empty($clean)) {
            return $this->summary(0, 0, [], [], 0, [null, null]);
        }

        // Fail closed: without a resolved client we CANNOT scope the
        // attendance_number lookup, so a punch could be routed to another
        // tenant's employee. Refuse rather than run an unscoped cross-tenant query.
        if ($clientId === null) {
            \Illuminate\Support\Facades\Log::warning('[eSSL] import aborted — no client_id (unscoped lookup refused)', ['serial' => $serial]);
            return $this->summary(0, 0, [], [], 0, [null, null]);
        }

        $uids = array_values(array_unique(array_column($clean, 'user_id')));

        // Resolve employees by tenant + attendance_number (the mapping key).
        $employees = Employee::query()
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->whereIn('attendance_number', $uids)
            ->get()
            ->keyBy(fn ($e) => (string) $e->attendance_number);

        // Bucket punches by (employee, local date).
        $buckets = [];
        foreach ($clean as $c) {
            $emp = $employees->get($c['user_id']);
            if (!$emp) {
                $unmatched[$c['user_id']] = true;
                continue;
            }

            // Don't accrue punches for employees who have left or opted out of
            // attendance tracking (a reused device number would otherwise land
            // on a terminated person).
            if (in_array((string) $emp->status, ['Terminated', 'Resigned'], true)
                || $emp->attendance_tracking === false) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'employee not attendance-eligible'];
                continue;
            }

            try {
                $local = Carbon::parse($c['ts'], $tz);
            } catch (\Throwable $e) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'unparseable timestamp'];
                continue;
            }

            $localDate = $local->toDateString();

            if ($emp->date_of_joining
                && $localDate < Carbon::parse($emp->date_of_joining)->toDateString()) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'before date_of_joining'];
                continue;
            }

            $key = $emp->id . '|' . $localDate;
            $buckets[$key]['emp']  = $emp;
            $buckets[$key]['date'] = $localDate;
            $buckets[$key]['items'][] = [
                'utc'    => $local->copy()->utc(),
                'status' => $c['status'],
                'uid'    => $c['user_id'],
            ];

            $minDate = ($minDate === null || $localDate < $minDate) ? $localDate : $minDate;
            $maxDate = ($maxDate === null || $localDate > $maxDate) ? $localDate : $maxDate;
        }

        foreach ($buckets as $bucket) {
            $emp = $bucket['emp'];
            $items = $bucket['items'];
            usort($items, fn ($a, $b) => $a['utc']->getTimestamp() <=> $b['utc']->getTimestamp());

            DB::transaction(function () use ($emp, $bucket, $items, $serial, &$imported, &$dupes, &$affected) {
                $day = $this->punches->findOrCreateDay($emp, $bucket['date'], true);

                // Seed a first-guess direction; recomputeDay() below re-derives
                // the WHOLE day's directions from time order, so this is only a
                // placeholder (an out-of-order insert can never corrupt the seq).
                $dir = $this->punches->nextDirection($day);

                foreach ($items as $it) {
                    // Idempotency: a punch already stored at this exact instant
                    // for this employee is a re-push — skip it. withTrashed() so a
                    // punch that was deliberately soft-deleted (e.g. a correction)
                    // is NOT resurrected by the device re-pushing its buffer.
                    $exists = AttendancePunch::withTrashed()
                        ->where('employee_id', $emp->id)
                        ->where('punched_at', $it['utc'])
                        ->exists();
                    if ($exists) {
                        $dupes++;
                        continue;
                    }

                    try {
                        AttendancePunch::create([
                            'attendance_id'  => $day->id,
                            'employee_id'    => $emp->id,
                            'punched_at'     => $it['utc'],
                            'direction'      => $dir,
                            'label'          => $dir === 'in' ? 'Check In' : 'Check Out',
                            'method'         => 'device',
                            'device_serial'  => $serial,
                            'device_user_id' => $it['uid'],
                            'raw_status'     => $it['status'] !== '' ? $it['status'] : null,
                        ]);
                    } catch (\Illuminate\Database\QueryException $e) {
                        // Lost the idempotency race (unique index) — treat as dupe.
                        $dupes++;
                        continue;
                    }

                    $imported++;
                    $affected[$emp->id] = true;
                    $dir = $dir === 'in' ? 'out' : 'in';
                }

                // Re-derive the whole day's directions/labels in time order +
                // refresh the summary (fixes any out-of-order alternation).
                $this->punches->recomputeDay($day);
            });
        }

        return $this->summary($imported, $dupes, array_keys($unmatched), $errors, count($affected), [$minDate, $maxDate]);
    }

    private function summary(int $imported, int $dupes, array $unmatched, array $errors, int $affected, array $range): array
    {
        return [
            'imported'            => $imported,
            'skipped_duplicates'  => $dupes,
            'unmatched_user_ids'  => array_values($unmatched),
            'errors'              => $errors,
            'employees_affected'  => $affected,
            'date_range'          => $range,
        ];
    }
}
