<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendancePunch;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * One-off backfill endpoint — inserts ~4 months of attendance for a fixed set
 * of employees (client_id=10 / branch_id=27). Idempotent: re-hitting it will
 * NOT duplicate (attendances keyed on employee_id+date via firstOrNew;
 * punches guarded by direction existence).
 *
 * Guarded by a static key in the query/body so it can't be triggered casually.
 * This is a temporary data-seeding tool — remove the route once the backfill is
 * done.
 */
class AttendanceBackfillController extends Controller
{
    /** Change this before deploying; required on every call as ?key=... */
    private const SECRET = 'CBC-ATT-BACKFILL-2026';

    private const DISPLAY_TZ = 'Asia/Kolkata';

    /** employee_id => EMP code (code only for readability). */
    private const EMPLOYEES = [
        109, 108, 107, 104, 100, 99, 98, 97, 96, 94, 93, 92, 91, 90, 89, 88,
        87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 71,
        70, 69, 68,
    ];

    public function run(Request $request)
    {
        if ((string) $request->input('key') !== self::SECRET) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $clientId = (int) $request->input('client_id', 10);
        $branchId = (int) $request->input('branch_id', 27);
        $start    = Carbon::parse($request->input('from', '2026-02-25'), self::DISPLAY_TZ)->startOfDay();
        $end      = Carbon::parse($request->input('to',   '2026-06-24'), self::DISPLAY_TZ)->startOfDay();
        $employees = $request->input('employees', self::EMPLOYEES);
        if (is_string($employees)) {
            $employees = array_filter(array_map('intval', explode(',', $employees)));
        }

        @set_time_limit(0); // belt-and-suspenders; bulk insert is fast anyway

        $tz  = self::DISPLAY_TZ;
        $nowUtc = Carbon::now('UTC')->format('Y-m-d H:i:s');
        $employees = array_values(array_map('intval', (array) $employees));

        // ---- Build all attendance rows in memory (no per-row queries) ----
        $rows   = [];
        $dayIdx = 0;
        for ($day = $start->copy(); $day->lte($end); $day->addDay()) {
            if ($day->isWeekend()) {
                continue; // Mon-Fri only
            }
            $dayIdx++;
            $date = $day->toDateString();

            foreach ($employees as $eid) {
                $seed = $eid * 7 + $dayIdx;

                $absent = (($eid + $dayIdx) % 23 === 0);
                $leave  = (($eid + $dayIdx) % 37 === 0);
                $late   = ($seed % 11 === 0);
                $status = 'Present';
                if ($absent)    $status = 'Absent';
                elseif ($leave) $status = 'Leave';
                elseif ($late)  $status = 'Late';

                $inUtc = $outUtc = null;
                if ($status !== 'Absent' && $status !== 'Leave') {
                    $inMin  = $late ? (40 + $seed % 25) : (25 + $seed % 20);
                    $inH    = 9 + intdiv($inMin, 60);
                    $inM    = $inMin % 60;
                    $outMin = 20 + ($seed % 30);
                    $inUtc  = Carbon::parse(sprintf('%s %02d:%02d:00', $date, $inH, $inM), $tz)->utc()->format('Y-m-d H:i:s');
                    $outUtc = Carbon::parse(sprintf('%s 18:%02d:00', $date, $outMin), $tz)->utc()->format('Y-m-d H:i:s');
                }

                $rows[] = [
                    'client_id'        => $clientId,
                    'branch_id'        => $branchId,
                    'employee_id'      => $eid,
                    'attendance_date'  => $date,
                    'check_in_at'      => $inUtc,
                    'check_out_at'     => $outUtc,
                    'check_in_method'  => $inUtc ? 'manual' : null,
                    'check_out_method' => $outUtc ? 'manual' : null,
                    'status'           => $status,
                    'notes'            => null,
                    'created_at'       => $nowUtc,
                    'updated_at'       => $nowUtc,
                ];
            }
        }

        $startStr = $start->toDateString();
        $endStr   = $end->toDateString();
        $idList   = implode(',', $employees);

        $before = DB::table('attendances')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereIn('employee_id', $employees)
            ->whereBetween('attendance_date', [$startStr, $endStr])
            ->count();

        DB::transaction(function () use ($rows) {
            // insertOrIgnore -> Postgres ON CONFLICT DO NOTHING, so the
            // UNIQUE(employee_id, attendance_date) makes re-runs non-destructive.
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('attendances')->insertOrIgnore($chunk);
            }

            // Derive Check In / Check Out punches straight from the rows we just
            // inserted — two statements total, guarded so they never duplicate.
            DB::statement("
                INSERT INTO attendance_punches
                    (attendance_id, employee_id, punched_at, direction, label, method, created_at, updated_at)
                SELECT a.id, a.employee_id, a.check_in_at, 'in', 'Check In', 'manual', NOW(), NOW()
                FROM attendances a
                WHERE a.client_id = ? AND a.branch_id = ?
                  AND a.employee_id IN ($idList)
                  AND a.attendance_date BETWEEN ? AND ?
                  AND a.check_in_at IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM attendance_punches p WHERE p.attendance_id = a.id AND p.direction = 'in')
            ", [$clientId, $branchId, $startStr, $endStr]);

            DB::statement("
                INSERT INTO attendance_punches
                    (attendance_id, employee_id, punched_at, direction, label, method, created_at, updated_at)
                SELECT a.id, a.employee_id, a.check_out_at, 'out', 'Check Out', 'manual', NOW(), NOW()
                FROM attendances a
                WHERE a.client_id = ? AND a.branch_id = ?
                  AND a.employee_id IN ($idList)
                  AND a.attendance_date BETWEEN ? AND ?
                  AND a.check_out_at IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM attendance_punches p WHERE p.attendance_id = a.id AND p.direction = 'out')
            ", [$clientId, $branchId, $startStr, $endStr]);
        });

        $after = DB::table('attendances')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereIn('employee_id', $employees)
            ->whereBetween('attendance_date', [$startStr, $endStr])
            ->count();

        $totalPunches = DB::table('attendance_punches')
            ->whereIn('employee_id', $employees)
            ->whereBetween('punched_at', [$startStr . ' 00:00:00', $endStr . ' 23:59:59'])
            ->count();

        return response()->json([
            'message'              => 'Attendance backfill complete.',
            'window'               => [$startStr, $endStr],
            'client_id'            => $clientId,
            'branch_id'            => $branchId,
            'employees'            => count($employees),
            'attendances_created'  => $after - $before,
            'attendances_skipped'  => count($rows) - ($after - $before),
            'attendances_total'    => $after,
            'punches_total'        => $totalPunches,
        ]);
    }
}
