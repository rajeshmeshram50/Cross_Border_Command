<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\WeekOff;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * On-demand SANDWICH-LEAVE test-data generator (not a seeder — run only when
 * you ask, via a curl). For the chosen month/year, client, branch and a list of
 * employee CODES, it:
 *
 *   1. turns ON the branch's sandwich policy,
 *   2. books, per employee (honouring their own weekly-off), ONE continuous
 *      approved leave spanning each weekend (working day before → after), so the
 *      off day(s) sit inside the leave and get "sandwiched",
 *   3. alternates PAID / UNPAID leave types (creating an "Unpaid Leave (LWP)"
 *      type once if the tenant has none),
 *   4. sets attendance (Leave / Weekly Off) to match.
 *
 * Idempotent per employee+month (clears its own leaves first). Admins only.
 */
class SandwichTestController extends Controller
{
    private const REASON = 'Sandwich test leave';

    public function seed(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->user_type === 'employee') {
            abort(403, 'Only an admin / branch user can generate sandwich test data.');
        }

        $data = $request->validate([
            'year'             => ['required', 'integer', 'min:2020', 'max:2100'],
            'month'            => ['required', 'integer', 'min:1', 'max:12'],
            'client_id'        => ['required', 'integer'],
            'branch_id'        => ['required', 'integer'],
            'employee_codes'   => ['required', 'array', 'min:1'],
            'employee_codes.*' => ['string', 'max:40'],
            'leave_mode'       => ['nullable', 'in:both,paid,unpaid'],
        ]);

        $clientId = (int) $data['client_id'];
        $branchId = (int) $data['branch_id'];
        $mode     = $data['leave_mode'] ?? 'both';

        // Tenant guard — a non-super-admin may only target their own scope.
        if ($user->user_type !== 'super_admin') {
            if ($user->client_id && $clientId !== (int) $user->client_id) {
                abort(403, 'Out of your client scope.');
            }
            if ($user->user_type === 'branch_user' && $user->branch_id && $branchId !== (int) $user->branch_id) {
                abort(403, 'Out of your branch scope.');
            }
        }

        $emps = DB::table('employees')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereIn('emp_code', $data['employee_codes'])
            ->whereNull('deleted_at')
            ->get(['id', 'emp_code', 'user_id', 'weekly_off']);
        if ($emps->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'No matching employees for those codes in this client/branch.'], 422);
        }

        // Turn the policy ON for the branch (else the rule no-ops).
        DB::table('branches')->where('id', $branchId)->update(['sandwich_policy' => true]);

        // Resolve a PAID + UNPAID leave type (create the unpaid one once).
        $paidTypeId = DB::table('master_leave_types')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereRaw('LOWER(paid_unpaid) = ?', ['paid'])->orderBy('id')->value('id');
        $unpaidTypeId = DB::table('master_leave_types')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereRaw('LOWER(paid_unpaid) IN (?,?,?,?)', ['unpaid', 'lwp', 'loss of pay', 'loss_of_pay'])
            ->value('id');
        if ($mode !== 'paid' && !$unpaidTypeId) {
            $unpaidTypeId = DB::table('master_leave_types')->insertGetId([
                'client_id' => $clientId, 'branch_id' => $branchId,
                'name' => 'Unpaid Leave (LWP)', 'type' => 'Regular', 'short_code' => 'LWP',
                'status' => 'Active', 'paid_unpaid' => 'Unpaid', 'gender_restriction' => 'None',
                'created_by' => $user->id, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $paidTypeId = $paidTypeId ?: $unpaidTypeId;
        if (!$paidTypeId && !$unpaidTypeId) {
            return response()->json(['status' => false, 'message' => 'No leave type available for this tenant.'], 422);
        }

        $monthStart = Carbon::create($data['year'], $data['month'], 1)->startOfDay();
        $monthEnd   = $monthStart->copy()->endOfMonth();

        $out = [];
        $totalLeaves = 0;
        foreach ($emps as $e) {
            $label = $e->weekly_off;
            // Clear this tool's own leaves for the employee in the target month.
            DB::table('leave_requests')
                ->where('employee_id', $e->id)->where('reason', self::REASON)
                ->whereBetween('from_date', [$monthStart->toDateString(), $monthEnd->toDateString()])
                ->delete();

            $rows = [];
            $wk = 0;
            $d = $monthStart->copy();
            while ($d->lte($monthEnd)) {
                if (!WeekOff::isOff($label, $d)) { $d->addDay(); continue; }

                $runStart = $d->copy();
                while (WeekOff::isOff($label, $runStart->copy()->subDay())) $runStart->subDay();
                $runEnd = $d->copy();
                while (WeekOff::isOff($label, $runEnd->copy()->addDay())) $runEnd->addDay();

                $before = $runStart->copy()->subDay();
                $after  = $runEnd->copy()->addDay();

                if ($before->betweenIncluded($monthStart, $monthEnd) && $after->betweenIncluded($monthStart, $monthEnd)) {
                    $isPaid = $mode === 'paid' ? true : ($mode === 'unpaid' ? false : ($wk % 2 === 0));
                    $typeId = $isPaid ? $paidTypeId : $unpaidTypeId;
                    $working = 0;
                    for ($x = $before->copy(); $x->lte($after); $x->addDay()) {
                        if (!WeekOff::isOff($label, $x)) $working++;
                    }
                    DB::table('leave_requests')->insert([
                        'client_id' => $clientId, 'branch_id' => $branchId,
                        'employee_id' => $e->id, 'leave_type_id' => $typeId,
                        'from_date' => $before->toDateString(), 'to_date' => $after->toDateString(),
                        'days' => $working, 'day_type' => 'full',
                        'reason' => self::REASON, 'status' => 'Approved',
                        'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                    ]);
                    for ($x = $before->copy(); $x->lte($after); $x->addDay()) {
                        $this->setAttendance($clientId, $branchId, $e, $x->toDateString(), WeekOff::isOff($label, $x) ? 'Weekly Off' : 'Leave');
                    }
                    $rows[] = [
                        'span'    => $before->format('d M') . ' – ' . $after->format('d M'),
                        'type'    => $isPaid ? 'Paid' : 'Unpaid',
                        'off_days'=> $runStart->diffInDays($runEnd) + 1,
                    ];
                    $totalLeaves++; $wk++;
                }
                $d = $runEnd->copy()->addDay();
            }
            $out[] = ['emp_code' => $e->emp_code, 'weekly_off' => $label, 'weekends' => $rows];
        }

        return response()->json([
            'status'   => true,
            'message'  => "Sandwich test data created for {$emps->count()} employee(s) — {$totalLeaves} leave(s) in "
                . $monthStart->format('M Y') . " (branch policy ON). Run that month's payroll to see the LOP.",
            'period'   => $monthStart->format('M Y'),
            'branch_id'=> $branchId,
            'leave_mode' => $mode,
            'employees'=> $out,
        ]);
    }

    /** Upsert one attendance row (no punches for Leave / Weekly Off). */
    private function setAttendance(int $clientId, int $branchId, object $e, string $date, string $status): void
    {
        DB::table('attendances')->updateOrInsert(
            ['employee_id' => $e->id, 'attendance_date' => $date],
            [
                'client_id' => $clientId, 'branch_id' => $branchId,
                'user_id' => $e->user_id, 'status' => $status,
                'check_in_at' => null, 'check_out_at' => null,
                'check_in_method' => null, 'check_out_method' => null,
                'updated_at' => now(), 'created_at' => now(),
            ]
        );
        $attId = DB::table('attendances')->where('employee_id', $e->id)->where('attendance_date', $date)->value('id');
        if ($attId) {
            DB::table('attendance_punches')->where('attendance_id', $attId)->delete();
        }
    }
}
