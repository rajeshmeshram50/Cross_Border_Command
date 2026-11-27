<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\SalaryStructure;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SalaryStructureController extends Controller
{
    private const SALARY_ROUNDING_SLACK = 12;

    private const ONBOARDING_STAGES = 6;

    private ?bool $payrollGrant = null;

    private function rosterBranchFilter(Request $request, $user): ?int
    {
        if (! $user) return null;

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return $user->branch_id ?: null;
        }

        $requested = $request->integer('branch_id') ?: null;
        if (! $requested) return null;

        if ($user->user_type === 'super_admin') return $requested;

        $belongs = \App\Models\Branch::where('id', $requested)
            ->where('client_id', $user->client_id)
            ->exists();

        return $belongs ? $requested : null;
    }

    public function employees(Request $request)
    {
        if ($deny = $this->denyUnlessManager($request, 'view')) return $deny;
        $user = $request->user();
        $branch = $this->rosterBranchFilter($request, $user);

        $eq = Employee::query()
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            ->where('onboarding_stage_completed', '>=', 6)
            ->orderBy('first_name');
        if ($user && $user->client_id) $eq->where('client_id', $user->client_id);
        if ($branch) $eq->where('branch_id', $branch);

        $month = (int) $request->query('month', 0);
        $year  = (int) $request->query('year', 0);
        if ($month >= 1 && $month <= 12 && $year >= 2000 && $year <= 2100) {
            $cycleEnd = \Carbon\Carbon::create($year, $month, 1)->endOfMonth()->toDateString();
            $eq->where(fn ($q) => $q
                ->whereNull('date_of_joining')
                ->orWhereDate('date_of_joining', '<=', $cycleEnd));
        }

        $employees = $eq->get();
        $ids = $employees->pluck('id')->all();

        $exiting = \App\Support\ExitInProgress::employeeIds(null, $ids);
        if (!empty($exiting)) {
            $employees = $employees->reject(fn (Employee $e) => in_array((int) $e->id, $exiting, true))->values();
            $ids = $employees->pluck('id')->all();
        }

        $active = SalaryStructure::whereIn('employee_id', $ids)
            ->where('status', 'active')
            ->get()->keyBy('employee_id');

        $deptNames = $this->masterNames('master_departments');
        $desigNames = $this->masterNames('master_designations');

        $rows = $employees->map(function (Employee $e) use ($active, $deptNames, $desigNames) {
            $s = $active->get($e->id);
            return [
                'exit_in_progress'  => false,
                'exit_last_working_day' => null,
                'employee_id'   => $e->id,
                'emp_code'      => $e->emp_code,
                'name'          => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: $e->display_name,
                'department'    => $deptNames[$e->department_id] ?? null,
                'designation'   => $desigNames[$e->designation_id] ?? null,
                'pf_eligible'   => (bool) $e->pf_eligible,
                'enable_payroll' => $e->enable_payroll === null ? true : (bool) $e->enable_payroll,
                'pf_type'       => $e->pf_type,
                'esi_applicable'=> strtolower((string) ($e->esi_applicable ?? '')) === 'yes',
                'annual_salary' => $e->annual_salary !== null ? (float) $e->annual_salary : null,
                'date_of_joining' => $e->date_of_joining
                    ? \Carbon\Carbon::parse($e->date_of_joining)->toDateString()
                    : null,
                'has_structure' => (bool) $s,
                'structure_id'  => $s?->id,
                'monthly_gross' => $s ? (float) $s->monthly_gross : ($e->annual_salary ? round((float) $e->annual_salary / 12, 2) : 0),
                'version'       => $s?->version,
                'effective_from'=> optional($s?->effective_from)->toDateString(),
                'source'        => $s ? 'structure' : ($e->annual_salary ? 'annual_salary' : 'none'),
            ];
        })->values();

        return response()->json(['data' => $rows]);
    }

    private function masterNames(string $table): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable($table) || !\Illuminate\Support\Facades\Schema::hasColumn($table, 'name')) {
            return [];
        }
        return DB::table($table)->pluck('name', 'id')->all();
    }

    public function index(Request $request)
    {
        $user = $request->user();
        $q = SalaryStructure::query()->orderByDesc('id');

        if ($user && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }
        if ($user && !$this->canManage($request)) {
            $q->where('employee_id', (int) ($user->employee_id ?? 0));
        }
        if ($branch = $this->rosterBranchFilter($request, $user)) {
            $q->where('branch_id', $branch);
        }
        if ($employeeId = $request->integer('employee_id')) {
            $q->where('employee_id', $employeeId);
        }
        if ($request->boolean('active_only')) {
            $q->where('status', 'active');
        }

        return response()->json(['data' => $q->get()->map(fn ($s) => $this->serialize($s))]);
    }

    public function show(Request $request, int $id)
    {
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        $user = $request->user();
        if ($user && !$this->canManage($request)
            && (int) $s->employee_id !== (int) ($user->employee_id ?? 0)) {
            abort(403, 'You can only view your own salary structure.');
        }
        return response()->json(['data' => $this->serialize($s)]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id'     => ['required', 'integer'],
            'effective_from'  => ['required', 'date'],
            'earnings'        => ['required', 'array', 'min:1'],
            'earnings.*.code'   => ['required', 'string', 'max:40'],
            'earnings.*.label'  => ['required', 'string', 'max:120'],
            'earnings.*.amount' => ['required', 'numeric', 'min:0', 'max:99999999.99'],
            'deductions'      => ['nullable', 'array'],
            'deductions.*.code'   => ['required_with:deductions', 'string', 'max:40'],
            'deductions.*.label'  => ['required_with:deductions', 'string', 'max:120'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0', 'max:99999999.99'],
            'pf_applicable'   => ['boolean'],
            'pf_type'         => ['nullable', 'in:statutory,standard'],
            'esi_applicable'  => ['boolean'],
            'pt_applicable'   => ['boolean'],
            'revision_note'   => ['nullable', 'string', 'max:500'],
            'annual_ctc'      => ['nullable', 'numeric', 'min:0.01', 'max:999999999999.99'],
        ], [
            'annual_ctc.numeric' => 'Annual CTC must be a valid number.',
            'annual_ctc.min'     => 'Annual CTC must be greater than 0.',
            'annual_ctc.max'     => 'Annual CTC must be ≤ 999,999,999,999.99.',
        ]);

        $user = $request->user();
        $employee = Employee::find($data['employee_id']);
        abort_unless($employee, 422, 'Employee not found.');
        if ($user && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to another tenant.');
        }
        if ($user && in_array($user->user_type, ['branch_user', 'employee'], true)
            && $user->branch_id && (int) $employee->branch_id !== (int) $user->branch_id) {
            abort(403, 'Employee belongs to another branch.');
        }

        $isRevision = SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->exists();
        $inSetup = !$isRevision
            || (int) ($employee->onboarding_stage_completed ?? 0) < self::ONBOARDING_STAGES;

        if (!$inSetup) {
            if (!$this->canAct($request, 'can_edit')) {
                return $this->denyResponse('revise');
            }
        } elseif (!$this->canAct($request, $isRevision ? 'can_edit' : 'can_add')
               && !$this->hasGrant($request->user(), 'hr.employee', ['can_add', 'can_edit'])) {
            return $this->denyResponse($isRevision ? 'revise' : 'create');
        }

        $effective = Carbon::parse($data['effective_from'])->startOfDay();

        if ($employee->date_of_joining) {
            $joined = Carbon::parse($employee->date_of_joining)->startOfDay();
            if ($effective->lt($joined)) {
                throw ValidationException::withMessages(['effective_from' =>
                    'Salary cannot take effect before the joining date ('
                    . $joined->format('j M Y') . ').']);
            }
        }

        $latestExisting = SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->orderByDesc('effective_from')
            ->first();

        if ($latestExisting && $latestExisting->effective_from) {
            $latestIso = Carbon::parse($latestExisting->effective_from)->startOfDay();
            if ($effective->lt($latestIso)) {
                throw ValidationException::withMessages(['effective_from' =>
                    'This employee already has a salary version effective '
                    . $latestIso->format('j M Y')
                    . '. A new revision cannot start before it, or payroll would keep using the older'
                    . ' version — choose ' . $latestIso->format('j M Y') . ' or later.']);
            }
        }

        $horizon = Carbon::now()->startOfDay()->addYear();
        if ($effective->gt($horizon)) {
            throw ValidationException::withMessages(['effective_from' =>
                'Salary cannot take effect more than a year ahead (latest '
                . $horizon->format('j M Y') . '). Check the date.']);
        }

        $monthlyGross = collect($data['earnings'])->sum(fn ($c) => (float) $c['amount']);
        $monthlyDeductions = collect($data['deductions'] ?? [])->sum(fn ($c) => (float) $c['amount']);

        $submittedCtc     = array_key_exists('annual_ctc', $data) && $data['annual_ctc'] !== null
            ? round((float) $data['annual_ctc'], 2)
            : null;
        $configuredAnnual = $submittedCtc ?? (float) ($employee->annual_salary ?? 0);
        if ($configuredAnnual > 0) {
            $annualised = $monthlyGross * 12;
            $diff = $annualised - $configuredAnnual;
            if (abs($diff) > self::SALARY_ROUNDING_SLACK) {
                $over = $diff > 0;
                $gap  = number_format(abs($diff), 2);
                $name = $employee->first_name ?: 'this employee';
                $target = $submittedCtc !== null ? 'the Annual CTC entered' : "{$name}'s configured salary";
                return response()->json([
                    'message' => 'Total earnings come to ₹' . number_format($annualised, 2)
                        . ' a year, which is ₹' . $gap . ($over ? ' more than' : ' short of')
                        . ' ' . $target . ' of ₹' . number_format($configuredAnnual, 2)
                        . '. The breakup has to add up to the CTC — '
                        . ($submittedCtc !== null
                            ? ($over
                                ? 'reduce the components, or raise the Annual CTC.'
                                : 'add the ₹' . $gap . ' back (Basic Salary usually carries the balance), '
                                  . 'or lower the Annual CTC.')
                            : ($over
                                ? 'reduce the components, or raise the salary on the employee record first.'
                                : 'add the ₹' . $gap . ' back (Basic Salary usually carries the balance), '
                                  . 'or lower the salary on the employee record first.')),
                    'errors' => ['earnings' => [
                        'Annual total ₹' . number_format($annualised, 2) . ' does not match ₹'
                        . number_format($configuredAnnual, 2) . '.',
                    ]],
                ], 422);
            }
        }

        $current = SalaryStructure::where('employee_id', $employee->id)
            ->where('status', 'active')
            ->orderByDesc('version')
            ->first();

        if ($current && $this->sameTerms($current, $data, $employee, $monthlyGross)) {
            return response()->json([
                'unchanged' => true,
                'message'   => 'Nothing changed — version ' . $current->version
                    . ' already holds exactly these terms (effective '
                    . Carbon::parse($current->effective_from)->format('j M Y')
                    . '). No new version was created.',
                'data'      => $this->serialize($current),
            ], 200);
        }
        $structure = DB::transaction(function () use ($data, $employee, $user, $monthlyGross, $monthlyDeductions, $submittedCtc) {
            $prev = SalaryStructure::where('employee_id', $employee->id)
                ->where('status', 'active')
                ->orderByDesc('version')
                ->first();
            $version = $prev ? $prev->version + 1 : 1;
            if ($prev) {
                $prev->update(['status' => 'superseded']);
            }

            $created = SalaryStructure::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'employee_id'     => $employee->id,
                'version'         => $version,
                'effective_from'  => $data['effective_from'],
                'status'          => 'active',
                'earnings'        => array_values($data['earnings']),
                'deductions'      => array_values($data['deductions'] ?? []),
                'monthly_gross'   => round($monthlyGross, 2),
                'monthly_ctc'     => round($monthlyGross, 2),
                'pf_applicable'   => $data['pf_applicable'] ?? (bool) $employee->pf_eligible,
                'esi_applicable'  => $data['esi_applicable'] ?? ($monthlyGross <= 21000),
                'pt_applicable'   => $data['pt_applicable'] ?? true,
                'approval_status' => 'approved',
                'approved_by'     => $user?->id,
                'approved_at'     => now(),
                'revision_note'   => $data['revision_note'] ?? null,
                'created_by'      => $user?->id,
            ]);

            $employeeChanges = [
                'pf_eligible'    => (bool) $created->pf_applicable,
                'esi_applicable' => $created->esi_applicable ? 'Yes' : 'No',
                'annual_salary'  => $submittedCtc ?? round($monthlyGross * 12, 2),
            ];

            if (array_key_exists('pf_type', $data) && $created->pf_applicable) {
                $employeeChanges['pf_type'] = $data['pf_type'] ?: 'statutory';
            }

            $employee->update($employeeChanges);

            return $created;
        });

        $recomputed = app(\App\Services\PayrollService::class)
            ->recomputeEmployeePayslips($employee->id, $structure->effective_from);

        $frozen = \App\Models\Payslip::where('employee_id', $employee->id)
            ->whereHas('run', fn ($q) => $q->whereNotIn('status', ['draft', 'generated']))
            ->with('run.period')
            ->get()
            ->map(fn ($s) => $s->run?->period?->label)
            ->filter()
            ->unique()
            ->values();

        return response()->json([
            'message' => 'Salary structure saved (version ' . $structure->version . ').'
                . ($recomputed > 0 ? " {$recomputed} draft payslip(s) updated." : '')
                . ($frozen->isNotEmpty()
                    ? ' Already-approved payroll (' . $frozen->implode(', ') . ') keeps its original figures'
                        . ' — the revision applies from the next run.'
                    : ''),
            'data'    => $this->serialize($structure),
        ], 201);
    }

    public function destroy(Request $request, int $id)
    {
        if (!$this->canAct($request, 'can_delete')) return $this->denyResponse('delete');
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        if ($s->status === 'active') {
            return response()->json(['message' => 'Cannot delete the active structure — revise it instead.'], 422);
        }
        $s->delete();
        return response()->json(['message' => 'Salary structure removed.']);
    }

    private function sameTerms(SalaryStructure $current, array $data, Employee $employee, float $monthlyGross): bool
    {
        if ($this->componentFingerprint($data['earnings'] ?? [])
            !== $this->componentFingerprint($current->earnings ?? [])) {
            return false;
        }
        if ($this->componentFingerprint($data['deductions'] ?? [])
            !== $this->componentFingerprint($current->deductions ?? [])) {
            return false;
        }

        $pf  = (bool) ($data['pf_applicable']  ?? (bool) $employee->pf_eligible);
        $esi = (bool) ($data['esi_applicable'] ?? ($monthlyGross <= 21000));
        $pt  = (bool) ($data['pt_applicable']  ?? true);

        if ($pf  !== (bool) $current->pf_applicable)  return false;
        if ($esi !== (bool) $current->esi_applicable) return false;
        if ($pt  !== (bool) $current->pt_applicable)  return false;

        if ($pf && array_key_exists('pf_type', $data)) {
            $normalise = fn ($v) => strtolower(trim((string) $v)) ?: 'statutory';
            if ($normalise($data['pf_type']) !== $normalise($employee->pf_type)) return false;
        }
        if (array_key_exists('annual_ctc', $data) && $data['annual_ctc'] !== null) {
            if (round((float) $data['annual_ctc'], 2) !== round((float) ($employee->annual_salary ?? 0), 2)) {
                return false;
            }
        }

        $a = $data['effective_from'] ? Carbon::parse($data['effective_from'])->toDateString() : null;
        $b = $current->effective_from ? Carbon::parse($current->effective_from)->toDateString() : null;

        return $a === $b;
    }

    private function componentFingerprint($lines): array
    {
        $out = [];
        foreach ((array) $lines as $l) {
            $l     = (array) $l;
            $code  = trim((string) ($l['code'] ?? ''));
            $label = trim((string) ($l['label'] ?? $l['name'] ?? ''));
            if ($code === '' && $label === '') continue;
            if (strcasecmp($code, 'pf') === 0) continue;            $out[] = mb_strtolower($code !== '' ? $code : $label)
                . '|' . mb_strtolower($label)
                . '|' . number_format((float) ($l['amount'] ?? 0), 2, '.', '');
        }
        sort($out);
        return $out;
    }
    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) return true;
        return $this->hasPayrollGrant($user);
    }

    private function hasPayrollGrant($user): bool
    {
        if ($this->payrollGrant !== null) return $this->payrollGrant;

        $moduleId = Module::where('slug', 'hr.payroll')->value('id');
        if (!$moduleId) return $this->payrollGrant = false;

        return $this->payrollGrant = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where(fn ($q) => $q->where('can_edit', true)->orWhere('can_approve', true))
            ->exists();
    }

    private function canAct(Request $request, string $flag): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        if ($user->user_type === 'employee') return false;

        $moduleId = Module::where('slug', 'hr.payroll')->value('id');
        if (!$moduleId) return false;

        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($flag, true)
            ->exists();
    }

    private function hasGrant($user, string $slug, array $flags): bool
    {
        if (!$user) return false;

        $moduleId = Module::where('slug', $slug)->value('id');
        if (!$moduleId) return false;

        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where(function ($q) use ($flags) {
                foreach ($flags as $f) $q->orWhere($f, true);
            })
            ->exists();
    }

    private function denyResponse(string $verb)
    {
        return response()->json(
            ['message' => "You are not allowed to {$verb} salary structures."],
            403,
        );
    }

    private function denyUnlessManager(Request $request, string $verb)
    {
        return $this->canManage($request)
            ? null
            : response()->json(['message' => "You are not allowed to {$verb} salary structures."], 403);
    }

    private function findScoped(Request $request, int $id): ?SalaryStructure
    {
        $user = $request->user();
        $s = SalaryStructure::find($id);
        if (!$s) return null;
        if ($user && $user->client_id && (int) $s->client_id !== (int) $user->client_id) {
            return null;
        }
        return $s;
    }

    private static function manualTdsAmount($deductions): float
    {
        foreach ((array) $deductions as $d) {
            $amount = (float) ($d['amount'] ?? 0);
            if ($amount <= 0) continue;
            $code = strtolower(trim((string) ($d['code'] ?? '')));
            if ($code === 'tds') return $amount;
        }
        foreach ((array) $deductions as $d) {
            $amount = (float) ($d['amount'] ?? 0);
            if ($amount <= 0) continue;
            $label = strtolower(trim((string) ($d['label'] ?? '')));
            if (preg_match('/^(tds|income\s*tax)\b/', $label)) return $amount;
        }
        return 0;
    }
    private function serialize(SalaryStructure $s): array
    {
        return [
            'id'              => $s->id,
            'employee_id'     => $s->employee_id,
            'version'         => $s->version,
            'effective_from'  => optional($s->effective_from)->toDateString(),
            'status'          => $s->status,
            'earnings'        => $s->earnings ?: [],
            'deductions'      => $s->deductions ?: [],
            'monthly_gross'   => (float) $s->monthly_gross,
            'monthly_ctc'     => (float) $s->monthly_ctc,
            'pf_applicable'   => (bool) $s->pf_applicable,
            'esi_applicable'  => (bool) $s->esi_applicable,
            'pt_applicable'   => (bool) $s->pt_applicable,
            'tds_applicable'  => (bool) $s->tds_applicable,
            'tds_source'      => self::manualTdsAmount($s->deductions ?: []) > 0
                ? 'manual'
                : ($s->tds_applicable ? 'auto' : null),
            'pf_type'         => $s->employee?->pf_type,
            'revision_note'   => $s->revision_note,
            'created_at'      => optional($s->created_at)->toIso8601String(),
        ];
    }
}
