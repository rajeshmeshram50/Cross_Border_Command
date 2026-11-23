<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\GuardsDevTooling;
use App\Http\Controllers\Controller;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EmployeeJoiningTestController extends Controller
{
    use GuardsDevTooling;

    private const DEFAULT_DOJ = '2026-07-20';

    public function backdate(Request $request)
    {
        $user = $request->user();
        $this->guardDevToolAccess($user, 'backdate joining dates');

        $data = $request->validate([
            'client_id'        => ['required', 'integer'],
            'branch_id'        => ['required', 'integer'],
            'employee_codes'   => ['nullable', 'array'],
            'employee_codes.*' => ['string', 'max:40'],
            'date_of_joining'  => ['nullable', 'date', 'before_or_equal:today'],
        ], [
            'date_of_joining.before_or_equal' => 'Joining date must be today or in the past — future dates are not allowed.',
        ]);

        $clientId = (int) $data['client_id'];
        $branchId = (int) $data['branch_id'];
        $doj      = Carbon::parse($data['date_of_joining'] ?? self::DEFAULT_DOJ)->toDateString();

        $this->guardDevToolScope($user, $clientId, $branchId);

        $q = DB::table('employees')
            ->where('client_id', $clientId)
            ->where('branch_id', $branchId)
            ->whereNull('deleted_at');

        $codes = array_filter($data['employee_codes'] ?? [], fn ($c) => trim((string) $c) !== '');
        if (!empty($codes)) {
            $q->whereIn('emp_code', $codes);
        }

        $emps = (clone $q)->get(['id', 'emp_code', 'date_of_joining']);
        if ($emps->isEmpty()) {
            return response()->json([
                'status'  => false,
                'message' => !empty($codes)
                    ? 'No matching employees for those codes in this client/branch.'
                    : 'No employees found in this client/branch.',
            ], 422);
        }

        $hasProbationEnd = DB::getSchemaBuilder()->hasColumn('employees', 'probation_end_date');
        $hasProbationMonths = DB::getSchemaBuilder()->hasColumn('employees', 'probation_months');

        $affected = 0;
        DB::transaction(function () use ($q, $doj, $hasProbationEnd, $hasProbationMonths, $emps, &$affected) {
            $update = ['date_of_joining' => $doj, 'updated_at' => now()];
            $affected = (clone $q)->update($update);

            if ($hasProbationEnd && $hasProbationMonths) {
                foreach ($emps as $e) {
                    $months = (int) DB::table('employees')->where('id', $e->id)->value('probation_months');
                    $end = $months > 0 ? Carbon::parse($doj)->addMonthsNoOverflow($months)->toDateString() : null;
                    DB::table('employees')->where('id', $e->id)->update([
                        'probation_end_date' => $end,
                        'updated_at'         => now(),
                    ]);
                }
            }
        });

        return response()->json([
            'status'  => true,
            'message' => "Backdated date_of_joining to {$doj} for {$affected} employee(s) in client {$clientId} / branch {$branchId}"
                . (!empty($codes) ? ' (filtered by ' . count($codes) . ' code(s)).' : ' (all employees in branch).'),
            'date_of_joining' => $doj,
            'count'   => $affected,
            'employees' => $emps->map(fn ($e) => [
                'emp_code'     => $e->emp_code,
                'old_doj'      => $e->date_of_joining,
                'new_doj'      => $doj,
            ]),
        ]);
    }
}
