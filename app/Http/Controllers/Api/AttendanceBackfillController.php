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

        $createdAtt = 0;
        $skippedAtt = 0;
        $createdPunch = 0;

        DB::transaction(function () use (
            $clientId, $branchId, $start, $end, $employees,
            &$createdAtt, &$skippedAtt, &$createdPunch
        ) {
            $tz = self::DISPLAY_TZ;
            $dayIdx = 0;

            for ($day = $start->copy(); $day->lte($end); $day->addDay()) {
                if ($day->isWeekend()) {
                    continue; // Mon-Fri only
                }
                $dayIdx++;
                $date = $day->toDateString();

                foreach ($employees as $eid) {
                    $eid  = (int) $eid;
                    $seed = $eid * 7 + $dayIdx;

                    // Status mix — mostly Present, deterministic sprinkle.
                    $absent = (($eid + $dayIdx) % 23 === 0);
                    $leave  = (($eid + $dayIdx) % 37 === 0);
                    $late   = ($seed % 11 === 0);
                    $status = 'Present';
                    if ($absent)    $status = 'Absent';
                    elseif ($leave) $status = 'Leave';
                    elseif ($late)  $status = 'Late';

                    // Skip if a row already exists (idempotent / non-destructive).
                    $existing = Attendance::where('employee_id', $eid)
                        ->whereDate('attendance_date', $date)
                        ->first();
                    if ($existing) {
                        $skippedAtt++;
                        continue;
                    }

                    $inUtc = $outUtc = null;
                    if ($status !== 'Absent' && $status !== 'Leave') {
                        $inMin  = $late ? (40 + $seed % 25) : (25 + $seed % 20);
                        $inH    = 9 + intdiv($inMin, 60);
                        $inM    = $inMin % 60;
                        $outMin = 20 + ($seed % 30);

                        $inUtc  = Carbon::parse(sprintf('%s %02d:%02d:00', $date, $inH, $inM), $tz)->utc();
                        $outUtc = Carbon::parse(sprintf('%s 18:%02d:00', $date, $outMin), $tz)->utc();
                    }

                    $att = Attendance::create([
                        'client_id'        => $clientId,
                        'branch_id'        => $branchId,
                        'employee_id'      => $eid,
                        'attendance_date'  => $date,
                        'check_in_at'      => $inUtc,
                        'check_out_at'     => $outUtc,
                        'check_in_method'  => $inUtc ? 'manual' : null,
                        'check_out_method' => $outUtc ? 'manual' : null,
                        'status'           => $status,
                    ]);
                    $createdAtt++;

                    if ($inUtc) {
                        AttendancePunch::create([
                            'attendance_id' => $att->id,
                            'employee_id'   => $eid,
                            'punched_at'    => $inUtc,
                            'direction'     => 'in',
                            'label'         => 'Check In',
                            'method'        => 'manual',
                        ]);
                        AttendancePunch::create([
                            'attendance_id' => $att->id,
                            'employee_id'   => $eid,
                            'punched_at'    => $outUtc,
                            'direction'     => 'out',
                            'label'         => 'Check Out',
                            'method'        => 'manual',
                        ]);
                        $createdPunch += 2;
                    }
                }
            }
        });

        return response()->json([
            'message'              => 'Attendance backfill complete.',
            'window'               => [$start->toDateString(), $end->toDateString()],
            'client_id'            => $clientId,
            'branch_id'            => $branchId,
            'employees'            => count($employees),
            'attendances_created'  => $createdAtt,
            'attendances_skipped'  => $skippedAtt,
            'punches_created'      => $createdPunch,
        ]);
    }
}
