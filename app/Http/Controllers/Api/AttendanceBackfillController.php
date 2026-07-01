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
 * of employees (client_id=10 / branch_id=27). Re-runnable: a day that already
 * has a row is OVERWRITTEN with the freshly generated values (attendances
 * upserted on employee_id+date; punches deleted + regenerated per run) — so
 * re-hitting it refreshes existing data instead of skipping it.
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

    /** employee_id list for client_id=10 / branch_id=27 (matches run()'s
     *  defaults). Full branch roster EMP-001..EMP-040 (41 ids — a couple of
     *  code gaps are duplicate/deleted records, kept because the backfill was
     *  asked to cover every id). Pass ?employees=<comma-list> to override. */
    private const EMPLOYEES = [
        56,  // EMP-001-D56
        69,  // EMP-002-D69
        70,  // EMP-003
        71,  // EMP-004
        72,  // EMP-005
        73,  // EMP-006
        74,  // EMP-007
        75,  // EMP-008
        76,  // EMP-009
        77,  // EMP-010
        78,  // EMP-011
        79,  // EMP-012
        80,  // EMP-012-D80
        81,  // EMP-013
        82,  // EMP-014
        83,  // EMP-015
        84,  // EMP-016
        85,  // EMP-017
        86,  // EMP-018
        87,  // EMP-019
        88,  // EMP-020
        89,  // EMP-021
        90,  // EMP-022
        91,  // EMP-023
        92,  // EMP-024
        93,  // EMP-025
        94,  // EMP-026
        96,  // EMP-027
        97,  // EMP-028
        98,  // EMP-029
        99,  // EMP-030
        105, // EMP-031
        106, // EMP-032
        107, // EMP-033
        108, // EMP-034
        109, // EMP-035
        234, // EMP-036
        236, // EMP-037
        241, // EMP-038
        244, // EMP-039
        275, // EMP-040
    ];

    public function run(Request $request)
    {
        if ((string) $request->input('key') !== self::SECRET) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $clientId = (int) $request->input('client_id', 10);
        $branchId = (int) $request->input('branch_id', 27);
        $start    = Carbon::parse($request->input('from', '2025-01-25'), self::DISPLAY_TZ)->startOfDay();
        $end      = Carbon::parse($request->input('to',   '2026-06-30'), self::DISPLAY_TZ)->startOfDay();
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
            if ($day->dayOfWeek === Carbon::SUNDAY) {
                continue; // Mon-Sat working week (only Sunday off)
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

        DB::transaction(function () use ($rows, $idList, $clientId, $branchId, $startStr, $endStr) {
            // upsert -> Postgres INSERT ... ON CONFLICT (employee_id,
            // attendance_date) DO UPDATE, so a day that already has a row is
            // OVERWRITTEN with the freshly generated values (not skipped).
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('attendances')->upsert(
                    $chunk,
                    ['employee_id', 'attendance_date'],
                    ['check_in_at', 'check_out_at', 'check_in_method', 'check_out_method', 'status', 'notes', 'updated_at']
                );
            }

            // Regenerate the punches from the (now-refreshed) attendance rows.
            // Delete the backfill-managed taps for this window first so their
            // times track the updated check_in_at/check_out_at (and so a day
            // that flipped to Absent/Leave loses its old taps), then re-insert.
            DB::statement("
                DELETE FROM attendance_punches
                WHERE label IN ('Check In', 'Lunch Out', 'Lunch In', 'Check Out')
                  AND attendance_id IN (
                    SELECT a.id FROM attendances a
                    WHERE a.client_id = ? AND a.branch_id = ?
                      AND a.employee_id IN ($idList)
                      AND a.attendance_date BETWEEN ? AND ?
                  )
            ", [$clientId, $branchId, $startStr, $endStr]);

            // Derive the full 4-tap punch sequence straight from the attendance
            // rows: Check In → Lunch Out → Lunch In → Check Out. The two lunch
            // taps are computed as fixed offsets from check_in_at (in UTC, so no
            // timezone math), keeping the strict in/out/in/out alternation the
            // attendance model enforces. The NOT EXISTS guard is now redundant
            // (we just deleted these labels) but kept as a belt-and-suspenders.
            $punches = [
                // [label, direction, punched_at expression, source-column NOT NULL]
                ['Check In',  'in',  'a.check_in_at',                                     'a.check_in_at'],
                ['Lunch Out', 'out', "a.check_in_at + interval '3 hours 35 minutes'",     'a.check_in_at'],
                ['Lunch In',  'in',  "a.check_in_at + interval '4 hours 20 minutes'",     'a.check_in_at'],
                ['Check Out', 'out', 'a.check_out_at',                                    'a.check_out_at'],
            ];
            foreach ($punches as [$label, $dir, $atExpr, $notNullCol]) {
                DB::statement("
                    INSERT INTO attendance_punches
                        (attendance_id, employee_id, punched_at, direction, label, method, created_at, updated_at)
                    SELECT a.id, a.employee_id, {$atExpr}, '{$dir}', '{$label}', 'manual', NOW(), NOW()
                    FROM attendances a
                    WHERE a.client_id = ? AND a.branch_id = ?
                      AND a.employee_id IN ($idList)
                      AND a.attendance_date BETWEEN ? AND ?
                      AND {$notNullCol} IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM attendance_punches p WHERE p.attendance_id = a.id AND p.label = '{$label}')
                ", [$clientId, $branchId, $startStr, $endStr]);
            }
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
            'attendances_updated'  => count($rows) - ($after - $before),
            'attendances_total'    => $after,
            'punches_total'        => $totalPunches,
        ]);
    }
}
