<?php

namespace App\Services;

use App\Models\AttendancePunch;
use App\Models\DeviceTerminal;
use App\Models\Employee;
use App\Models\PayrollPeriod;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class EsslAttendanceImporter
{
    public function __construct(
        private AttendancePunchService $punches,
        private PayrollService $payroll,
    ) {
    }

    private array $lockedPeriodCache = [];

    private function periodIsLocked(Employee $emp, ?int $branchId, string $localDate): bool
    {
        $when = Carbon::parse($localDate);
        $bId  = $emp->branch_id ?: $branchId;
        $key  = ($emp->client_id ?: 0) . '|' . ($bId ?: 0) . '|' . $when->format('Y-m');

        return $this->lockedPeriodCache[$key] ??= PayrollPeriod::query()
            ->where('client_id', $emp->client_id)
            ->where(fn ($w) => $bId
                ? $w->where('branch_id', $bId)->orWhereNull('branch_id')
                : $w->whereNull('branch_id'))
            ->where('month', (int) $when->month)
            ->where('year', (int) $when->year)
            ->where('status', 'locked')
            ->exists();
    }

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

    public function importRows(array $rows, ?int $clientId, ?int $branchId, string $serial, string $tz = 'Asia/Kolkata'): array
    {
        $imported = 0;
        $dupes = 0;
        $unmatched = [];
        $errors = [];
        $affected = [];
        $minDate = null;
        $maxDate = null;

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

        if ($clientId === null) {
            \Illuminate\Support\Facades\Log::warning('[eSSL] import aborted — no client_id (unscoped lookup refused)', ['serial' => $serial]);
            return $this->summary(0, 0, [], [], 0, [null, null]);
        }

        $uids = array_values(array_unique(array_column($clean, 'user_id')));

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

        $buckets = [];
        foreach ($clean as $c) {
            $emp = $employees->get($normalise($c['user_id']));
            if (!$emp) {
                $unmatched[$c['user_id']] = true;
                continue;
            }

            if (in_array((string) $emp->status, ['Terminated', 'Resigned'], true)
                || $emp->attendance_tracking === false) {
                $errors[] = ['user_id' => $c['user_id'], 'punched_at' => $c['ts'], 'reason' => 'employee not attendance-eligible'];
                continue;
            }

            $local = null;
            foreach (['Y-m-d H:i:s', 'Y-m-d H:i'] as $fmt) {
                try {
                    $candidate = Carbon::createFromFormat($fmt, $c['ts'], $tz);
                    if ($candidate && $candidate->format($fmt) === $c['ts']) {
                        $local = $candidate;
                        break;
                    }
                } catch (\Throwable $e) {
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

                $dir = $this->punches->nextDirection($day);

                foreach ($items as $it) {
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
                        $dupes++;
                        continue;
                    }

                    $imported++;
                    $affected[$emp->id] = true;
                    $dir = $dir === 'in' ? 'out' : 'in';
                }

                $this->punches->recomputeDay($day);
            });
        }

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
