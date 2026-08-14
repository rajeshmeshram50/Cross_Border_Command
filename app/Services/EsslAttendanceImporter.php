<?php

namespace App\Services;

use App\Models\AttendancePunch;
use App\Models\DeviceTerminal;
use App\Models\Employee;
use App\Models\PayrollPeriod;
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
    public function __construct(
        private AttendancePunchService $punches,
        private PayrollService $payroll,
    ) {
    }

    /**
     * Payroll periods already LOCKED (fully disbursed), keyed "clientId|branchId|Y-m".
     * A locked cycle's payslips are immutable, so accepting a punch into it would
     * silently change the basis of money that is already paid — the numbers on the
     * payslip and the numbers in attendance would disagree forever, with nothing
     * to reconcile them. Those rows are rejected and reported instead. (PAY-50)
     */
    private array $lockedPeriodCache = [];

    private function periodIsLocked(Employee $emp, ?int $branchId, string $localDate): bool
    {
        $when = Carbon::parse($localDate);
        $bId  = $emp->branch_id ?: $branchId;
        $key  = ($emp->client_id ?: 0) . '|' . ($bId ?: 0) . '|' . $when->format('Y-m');

        return $this->lockedPeriodCache[$key] ??= PayrollPeriod::query()
            ->where('client_id', $emp->client_id)
            // A client-wide cycle (branch_id NULL) pays this employee too, so a
            // locked one must block the punch just as their own branch's would.
            // A branch-less employee is covered ONLY by that client-wide cycle —
            // don't let another branch's closed payroll block their punches.
            ->where(fn ($w) => $bId
                ? $w->where('branch_id', $bId)->orWhereNull('branch_id')
                : $w->whereNull('branch_id'))
            ->where('month', (int) $when->month)
            ->where('year', (int) $when->year)
            ->where('status', 'locked')
            ->exists();
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
     * @return array{imported:int,skipped_duplicates:int,unmatched_user_ids:array,errors:array,employees_affected:int,date_range:array,payslips_recomputed:int,affected_employee_ids:array}
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

        /* Leading zeros: devices pad the user id ("001") while the employee
         * record holds "1", or the reverse. A plain string match silently
         * dropped every one of those punches into unmatched_user_ids, which
         * reads like an unenrolled employee rather than a formatting
         * mismatch. Query on both spellings and key the lookup on a normalised
         * form so either side can be padded.
         *
         * Only NUMERIC ids are normalised — an alphanumeric badge id is taken
         * literally, since stripping characters there could collide two real
         * employees. */
        $uidVariants = $uids;
        foreach ($uids as $u) {
            if (ctype_digit($u)) {
                $uidVariants[] = ltrim($u, '0') ?: '0';
            }
        }
        $uidVariants = array_values(array_unique($uidVariants));

        $normalise = static fn ($v) => ctype_digit((string) $v)
            ? (ltrim((string) $v, '0') ?: '0')
            : (string) $v;

        $employees = Employee::query()
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->whereIn('attendance_number', $uidVariants)
            ->get()
            ->keyBy(fn ($e) => $normalise($e->attendance_number));

        // Bucket punches by (employee, local date).
        $buckets = [];
        foreach ($clean as $c) {
            $emp = $employees->get($normalise($c['user_id']));
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

            /* STRICT parse. Carbon::parse() is lenient and rolls impossible
             * clock times over instead of refusing them: a corrupted row
             * reading "25:00:00" became 01:00 the NEXT day, landing a punch on
             * the wrong date with nothing logged. The device format is fixed,
             * so demand it exactly and treat anything else as the bad data it
             * is. The seconds-less variant is accepted because some firmware
             * omits them. */
            $local = null;
            foreach (['Y-m-d H:i:s', 'Y-m-d H:i'] as $fmt) {
                try {
                    $candidate = Carbon::createFromFormat($fmt, $c['ts'], $tz);
                    // createFromFormat still tolerates overflow (25:00 → +1 day)
                    // unless the round-trip is checked, so compare it back.
                    if ($candidate && $candidate->format($fmt) === $c['ts']) {
                        $local = $candidate;
                        break;
                    }
                } catch (\Throwable $e) {
                    // try the next format
                }
            }
            if (!$local) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'unparseable timestamp'];
                continue;
            }

            $localDate = $local->toDateString();

            if ($emp->date_of_joining
                && $localDate < Carbon::parse($emp->date_of_joining)->toDateString()) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'before date_of_joining'];
                continue;
            }

            // Reject punches landing in a fully-paid (locked) payroll cycle —
            // the payslip can no longer be regenerated, so the correction must
            // go to the next cycle as an adjustment. (PAY-50)
            if ($this->periodIsLocked($emp, $branchId, $localDate)) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'payroll for this month is locked (paid) — post an adjustment in the next cycle'];
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

        /* PAY-50 — a correction must show up in the money, not just the
         * attendance grid.
         *
         * Every employee whose punches changed has their payslips in DRAFT /
         * GENERATED runs recomputed IN PLACE (same row, recomputed columns), so
         * the payroll table reflects the corrected attendance without anyone
         * having to remember to re-run, and without a second payslip appearing.
         * recomputeEmployeePayslips() skips approved/paid runs and locked
         * periods by design, so a settled cycle is never rewritten. */
        $recomputed = 0;
        foreach (array_keys($affected) as $employeeId) {
            $recomputed += $this->payroll->recomputeEmployeePayslips((int) $employeeId);
        }

        return $this->summary($imported, $dupes, array_keys($unmatched), $errors, count($affected), [$minDate, $maxDate])
            + ['payslips_recomputed' => $recomputed, 'affected_employee_ids' => array_map('intval', array_keys($affected))];
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
