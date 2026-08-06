<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvanceRequest;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Support\OnboardingGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;



class AdvanceRequestController extends Controller
{
    private const STATUSES         = ['pending', 'approved', 'rejected'];
    private const ADVANCE_TYPES    = ['Travel Advance', 'Salary Advance', 'Medical Advance', 'Other'];
    private const RECOVERY_MODES   = ['emi', 'lumpsum', 'bimonthly'];



    public function index(Request $request)
    {
        $user  = $request->user();
        $scope = $request->query('scope', 'mine');
        if (!in_array($scope, ['mine', 'team', 'all'], true)) {
            $scope = 'mine';
        }

        $employeeIdFilter = $this->resolveEmployeeId(
            $request->query('employee_id'),
            $request->query('employee_code'),
            $user
        );

        $q = AdvanceRequest::query()
            ->with([
                // withTrashed so a disabled (soft-deleted) employee's name still
                // resolves instead of the row collapsing to "#<id>".
                'employee' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'reporting_manager_id', 'department_id'),
                'employee.department:id,name',
                'manager' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code'),
                'creator:id,name,user_type',
                'hrUser:id,name,user_type',
            ])
            ->orderByDesc('id');

        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        if ($scope === 'mine') {
            $targetEmployeeId = $employeeIdFilter ?: $this->currentEmployeeId($user);
            $q->where('employee_id', $targetEmployeeId ?? -1);
        } elseif ($scope === 'team') {
            // Team scope rules (mirrors ExpenseClaimController):
            //   - super_admin / client_admin / branch_user → no extra
            //     employee filter; the tenant scope already restricts what
            //     they can see and they should be able to view the whole
            //     team workload from the My Team surface.
            //   - employee / client_user acting as a manager → all rows
            //     filed by their transitive downstream (direct + indirect
            //     reports), not just the first hop.
            if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
                // no-op — tenant scope is the only filter.
            } else {
                $myEmployeeId = $this->currentEmployeeId($user);
                $teamIds = $this->downstreamEmployeeIds($myEmployeeId);
                $q->whereIn('employee_id', $teamIds ?: [-1]);
            }
        } else {
            $this->guardHrPermission($user, 'can_view');
            if ($employeeIdFilter) {
                $q->where('employee_id', $employeeIdFilter);
            }
        }

        if ($status = $request->query('status')) {
            if (in_array($status, self::STATUSES, true)) {
                $q->where('status', $status);
            }
        }

        return response()->json($q->get()->map(fn ($r) => $this->serialize($r)));
    }

   

    public function store(Request $request)
    {
        $user = $request->user();
        $employeeId = $this->resolveEmployeeId(
            $request->input('employee_id'),
            $request->input('employee_code'),
            $user
        ) ?: $this->currentEmployeeId($user);

        if (!$employeeId) {
            abort(422, 'No linked Employee record found for the current user.');
        }
        $employee = Employee::find($employeeId);
        if (!$employee) {
            abort(404, 'Employee not found.');
        }
        // Anyone but super_admin can only file under their own Employee record.
        if ($user->user_type !== 'super_admin'
            && $employee->user_id !== $user->id) {
            abort(403, 'You can only file advance requests for your own employee record.');
        }

        // Onboarding gate (CBC #85) — no advances until HR has finished
        // onboarding the employee. Same reachability gap as the expense claim
        // above: /profile stays open mid-onboarding and carries the form.
        OnboardingGuard::assertComplete(
            $employee,
            'raise an advance request',
            (int) ($employee->user_id ?? 0) === (int) $user->id,
        );

        // A future-joining employee is not yet on the roster — they cannot raise
        // an advance request before their joining date (CBC #32).
        if ($employee->date_of_joining
            && $employee->date_of_joining->toDateString() > now()->toDateString()) {
            return response()->json([
                'message' => 'You cannot raise an advance request before your joining date ('
                    . $employee->date_of_joining->format('d M Y') . ').',
                'errors'  => ['employee_id' => ['Joining date is in the future.']],
            ], 422);
        }

        $data = $request->validate([
            'advance_type'        => ['required', 'string', 'in:' . implode(',', self::ADVANCE_TYPES)],
            // Only meaningful when advance_type='Other'. The frontend already
            // gates the input but the backend accepts any string up to 255
            // chars when present.
            'advance_type_other'  => ['nullable', 'string', 'max:255'],
            // Cap at 9,999,999,999,999.99 to fit inside the decimal(18,2)
            // column — matches the expense-claim guard so the SPA's input
            // sanitiser (12 whole digits + 2 fraction) can't overflow it.
            'amount'              => ['required', 'numeric', 'min:0', 'max:9999999999999.99'],
            // Who the advance is for. 'self' = the existing recoverable-from-salary
            // flow; 'company' = spent on the company's behalf, NOT recovered.
            'used_for'            => ['required', 'string', 'in:self,company'],
            // Requested date IS the request creation date — it must be today.
            // No future-dating (the request is being created now) and no past.
            'requested_date'      => ['required', 'date', 'after_or_equal:today', 'before_or_equal:today'],
            // Recovery start / mode only apply to a SELF advance (salary recovery).
            // A COMPANY advance has NO recovery and NO date at all.
            'recovery_start'      => ['required_if:used_for,self', 'nullable', 'date', 'after_or_equal:requested_date'],
            'recovery_mode'       => ['required_if:used_for,self', 'nullable', 'string', 'in:' . implode(',', self::RECOVERY_MODES)],
            // Months + monthly EMI only required when mode='emi'. The
            // validator below promotes them to required-when conditionally.
            'recovery_months'     => ['nullable', 'integer', 'min:1', 'max:120'],
            'monthly_emi'         => ['nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            // Capped at 500 chars so a long reason can't break the table layout.
            'reason'              => ['required', 'string', 'max:500'],
            // Supporting documents are optional for advances, but when present
            // must be PDF/JPG/PNG up to 5 MB each (mirrors the client picker).
            'files'               => ['nullable', 'array'],
            'files.*'             => ['file', 'max:5120', 'mimes:pdf,jpg,jpeg,png'],
        ], [
            'requested_date.after_or_equal'  => 'Requested date must be today (the request creation date).',
            'requested_date.before_or_equal' => 'Requested date cannot be in the future — it is the request creation date.',
            'reason.max'                     => 'Reason is too long — please keep it under 500 characters.',
        ]);

        $isCompany = ($data['used_for'] ?? 'self') === 'company';
        if (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true) && empty($data['recovery_months'])) {
            abort(422, 'Number of instalments is required for EMI / Bi-Monthly recovery.');
        }
        if ($data['advance_type'] === 'Other' && empty($data['advance_type_other'])) {
            abort(422, 'Please specify the advance type when "Other" is selected.');
        }

        // File attachments — same pattern as expense_claims, stored on the
        // public disk under advance_requests/{employeeId}.
        $attachments = [];
        if ($request->hasFile('files')) {
            $files = $request->file('files');
            $files = is_array($files) ? $files : [$files];
            foreach ($files as $f) {
                if (!$f) continue;
                $name = $f->getClientOriginalName();
                $size = $f->getSize();
                $path = $f->store('advance_requests/' . $employeeId, 'public');
                $attachments[] = [
                    'name' => $name,
                    'size' => $size,
                    'path' => $path,
                ];
            }
        }

        // Auto-clear the manager stage when no reporting manager is assigned
        // — same behaviour as expense-claim so the audit log surfaces an
        // explicit "no manager" note instead of looking like a phantom
        // approval.
        $hasManager      = !empty($employee->reporting_manager_id);
        $managerStatus   = $hasManager ? 'pending'  : 'approved';
        $managerActedAt  = $hasManager ? null       : now();
        $managerComment  = $hasManager ? null       : 'Auto-approved · no reporting manager assigned';

        $row = DB::transaction(function () use ($employee, $data, $attachments, $managerStatus, $managerActedAt, $managerComment, $user, $isCompany) {
            return AdvanceRequest::create([
                'client_id'         => $employee->client_id,
                'branch_id'         => $employee->branch_id,
                'advance_no'        => $this->nextAdvanceNo($employee->client_id, $employee->branch_id),
                'employee_id'       => $employee->id,
                'manager_id'        => $employee->reporting_manager_id,
                'advance_type'      => $data['advance_type'],
                'advance_type_other'=> $data['advance_type'] === 'Other' ? ($data['advance_type_other'] ?? null) : null,
                'amount'            => $data['amount'],
                'used_for'          => $data['used_for'],
                'requested_date'    => $data['requested_date'],
                // Self → salary recovery (recovery_start + mode). Company → no
                // recovery and no date at all.
                'recovery_start'    => $isCompany ? null : ($data['recovery_start'] ?? null),
                'expected_use_date' => null,
                'recovery_mode'     => $isCompany ? null : ($data['recovery_mode'] ?? null),
                'recovery_months'   => (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)) ? ($data['recovery_months'] ?? null) : null,
                'monthly_emi'       => (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)) ? ($data['monthly_emi'] ?? null) : null,
                'reason'            => $data['reason'],
                'attachments'       => $attachments ?: null,
                'status'            => 'pending',
                'manager_status'    => $managerStatus,
                'manager_acted_at'  => $managerActedAt,
                'manager_comment'   => $managerComment,
                'hr_status'         => 'pending',
                'created_by'        => $user->id,
            ]);
        });

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json($this->serialize($row), 201);
    }

 

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $row = AdvanceRequest::with([
                // withTrashed so a disabled employee's name still resolves (see index()).
                'employee' => fn ($r) => $r->withTrashed(),
                'manager' => fn ($r) => $r->withTrashed(),
                'creator', 'hrUser',
            ])
            ->findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        return response()->json($this->serialize($row));
    }

   
    public function downloadAttachment(Request $request, $id, $index)
    {
        $this->authenticateFromQueryToken($request);

        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $request->user());

        $idx = (int) $index;
        $atts = $row->attachments ?? [];
        if (!isset($atts[$idx]) || empty($atts[$idx]['path'])) {
            abort(404, 'Attachment not found.');
        }
        $path = $atts[$idx]['path'];
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($path)) {
            abort(404, 'Attachment file is missing on the server.');
        }
        $filename = $atts[$idx]['name'] ?? basename($path);
        return $disk->response($path, $filename);
    }

    private function authenticateFromQueryToken(Request $request): void
    {
        if (!$request->user() && $request->query('token')) {
            $token = \Laravel\Sanctum\PersonalAccessToken::findToken($request->query('token'));
            if ($token) {
                $request->setUserResolver(fn () => $token->tokenable);
            } else {
                abort(401, 'Invalid token');
            }
        }
        if (!$request->user()) {
            abort(401, 'Unauthorized');
        }
    }

 
    public function managerApprove(Request $request, $id)
    {
        return $this->managerAct($request, $id, 'approved');
    }

    public function managerReject(Request $request, $id)
    {
        return $this->managerAct($request, $id, 'rejected');
    }

    private function managerAct(Request $request, $id, string $verdict)
    {
        $user = $request->user();
        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->manager_id !== $myEmployeeId) {
            abort(403, 'You are not the assigned reporting manager for this advance request.');
        }
        if ($row->manager_status !== 'pending') {
            abort(409, 'This advance request has already been actioned by the manager.');
        }

        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $row->manager_status   = $verdict;
        $row->manager_acted_at = now();
        $row->manager_comment  = $data['comment'] ?? null;
        if ($verdict === 'rejected') {
            $row->status = 'rejected';
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    

    public function hrApprove(Request $request, $id)
    {
        return $this->hrAct($request, $id, 'approved');
    }

    public function hrReject(Request $request, $id)
    {
        return $this->hrAct($request, $id, 'rejected');
    }

    private function hrAct(Request $request, $id, string $verdict)
    {
        $user = $request->user();
        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($verdict === 'approved' && $row->manager_status !== 'approved') {
            abort(409, 'Manager must approve this advance request before HR / Finance can approve it.');
        }
        if ($row->hr_status !== 'pending') {
            abort(409, 'This advance request has already been actioned by HR / Finance.');
        }

        // On APPROVAL, HR also locks the one-time settlement adjustments here
        // (additions / deductions) — after this the advance is payment-only.
        $data = $request->validate([
            'comment'             => [$verdict === 'rejected' ? 'required' : 'nullable', 'string', 'max:1000'],
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
        ], [
            'comment.required' => 'A reason is required to reject this advance request.',
        ]);

        $applyAdjust   = $verdict === 'approved';
        $deductionRows = []; $deduction = 0.0;
        $additionRows  = []; $addition  = 0.0;
        $sanctioned    = null;
        if ($applyAdjust) {
            [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
            if ($dedErr) return $dedErr;
            [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
            if ($addErr) return $addErr;
            $sanctioned = round((float) $row->amount - $deduction + $addition, 2);
            if ($sanctioned <= 0.005) {
                return response()->json([
                    'status'  => false,
                    'message' => 'Deductions cannot exceed the requested amount plus additions — net payable must be greater than zero.',
                    'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
                ], 422);
            }
        }

        DB::transaction(function () use ($row, $user, $verdict, $data, $applyAdjust, $sanctioned, $deduction, $deductionRows, $addition, $additionRows) {
            $row->hr_status   = $verdict;
            $row->hr_user_id  = $user->id;
            $row->hr_acted_at = now();
            $row->hr_comment  = $data['comment'] ?? null;
            $row->status      = $verdict;
            if ($applyAdjust) {
                $row->sanctioned_amount = $sanctioned;
                $row->deduction_amount  = max(0, $deduction);
                $row->deductions        = $deductionRows;
                $row->addition_amount   = max(0, $addition);
                $row->additions         = $additionRows;
                $row->deduction_reason  = $deductionRows
                    ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
                    : null;
            }
            $row->save();
        });

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

  

    private function currentEmployeeId($user): ?int
    {
        if (!$user) return null;
        return Employee::where('user_id', $user->id)->value('id');
    }

  
    private function downstreamEmployeeIds(?int $rootEmployeeId): array
    {
        if (!$rootEmployeeId) return [];
        $all = [];
        $frontier = [$rootEmployeeId];
        while (!empty($frontier)) {
            $children = Employee::whereIn('reporting_manager_id', $frontier)
                ->pluck('id')->all();
            $children = array_map('intval', $children);
            $new = array_values(array_diff($children, $all, [$rootEmployeeId]));
            if (empty($new)) break;
            $all = array_merge($all, $new);
            $frontier = $new;
        }
        return $all;
    }

    private function resolveEmployeeId($idInput, $codeInput, $user = null): ?int
    {
        if ($idInput !== null && $idInput !== '') {
            if (is_numeric($idInput)) {
                return (int) $idInput;
            }
            $codeInput = $codeInput ?: $idInput;
        }
        if ($codeInput) {
            // emp_code is unique PER CLIENT only, so scope the lookup to the
            // caller's client — otherwise a serial code (EMP-001) shared by
            // another tenant resolves the wrong employee and trips the
            // "your own record" ownership guard with a 403.
            $q = Employee::where('emp_code', $codeInput);
            if ($user && $user->user_type !== 'super_admin' && $user->client_id) {
                $q->where('client_id', $user->client_id);
            }
            $found = $q->value('id');
            if ($found) return (int) $found;
        }
        return null;
    }

  
    private function guardHrPermission($user, string $perm): void
    {
        if (!$user) abort(401, 'Authentication required');
        if ($user->user_type === 'super_admin') return;

        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true)) {
                return;
            }
            abort(403, 'HR module not registered.');
        }
        $hasPerm = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$hasPerm) {
            abort(403, "You do not have permission to perform this action ({$perm}).");
        }
    }

    private function ensureTenantAccess(AdvanceRequest $row, $user): void
    {
        if (!$user) abort(401);
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            // Every branch is an isolated peer — a branch row is accessible only
            // when it belongs to the caller's own branch, or the caller is the
            // requesting employee / assigned manager.
            if ($row->branch_id !== null) {
                $allowed = $row->branch_id === $user->branch_id;
                $myEmployeeId = $this->currentEmployeeId($user);
                if (!$allowed
                    && $row->employee_id !== $myEmployeeId
                    && $row->manager_id !== $myEmployeeId) {
                    abort(403, 'Out of tenant scope.');
                }
            }
        }
    }

    private function applyTenantScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $myEmployeeId = $this->currentEmployeeId($user);

            // Every branch is an isolated peer — globals + client-level rows + own branch only,
            // plus rows where the caller is the requesting employee or assigned manager.
            $q->where(function ($w) use ($clientId, $branchId, $myEmployeeId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $myEmployeeId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $myEmployeeId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($myEmployeeId) {
                                 $wb->orWhere('employee_id', $myEmployeeId)
                                    ->orWhere('manager_id', $myEmployeeId);
                             }
                         });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function nextAdvanceNo(?int $clientId, ?int $branchId): string
    {
        $q = AdvanceRequest::query()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $codes = $q->pluck('advance_no');
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^ADV-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'ADV-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }
    

   
    private function serialize(AdvanceRequest $row): array
    {
        $employee = $row->employee;
        $manager  = $row->manager;
        $employeeName = $employee
            ? ($employee->display_name
                ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : null;
        $managerName = $manager
            ? ($manager->display_name
                ?: trim(($manager->first_name ?? '') . ' ' . ($manager->last_name ?? '')))
            : null;
        return [
            'id'                 => $row->id,
            'advance_no'         => $row->advance_no,
            'employee_id'        => $row->employee_id,
            'employee_name'      => $employeeName,
            'employee_code'      => $employee?->emp_code,
            'department_id'      => $employee?->department_id,
            'department_name'    => $employee?->department?->name,
            'manager_id'         => $row->manager_id,
            'manager_name'       => $managerName,
            'advance_type'       => $row->advance_type,
            'advance_type_other' => $row->advance_type_other,
            'amount'             => (float) $row->amount,
            'used_for'           => $row->used_for ?: 'self',
            'requested_date'     => optional($row->requested_date)->format('Y-m-d'),
            'recovery_start'     => optional($row->recovery_start)->format('Y-m-d'),
            'expected_use_date'  => optional($row->expected_use_date)->format('Y-m-d'),
            'recovery_mode'      => $row->recovery_mode,
            'recovery_months'    => $row->recovery_months,
            'monthly_emi'        => $row->monthly_emi !== null ? (float) $row->monthly_emi : null,
            'reason'             => $row->reason,
            'attachments'        => collect($row->attachments ?? [])->values()->map(function ($a, $i) use ($row) {
                return [
                    'name' => $a['name'] ?? null,
                    'size' => $a['size'] ?? null,
                    'url'  => url("/api/advance-requests/{$row->id}/attachments/{$i}"),
                ];
            })->all(),
            'status'             => $row->status,
            'manager_status'     => $row->manager_status,
            'manager_acted_at'   => optional($row->manager_acted_at)->toIso8601String(),
            'manager_comment'    => $row->manager_comment,
            'hr_status'          => $row->hr_status,
            'hr_user_id'         => $row->hr_user_id,
            'hr_user_name'       => $row->hrUser?->name,
            'hr_acted_at'        => optional($row->hr_acted_at)->toIso8601String(),
            'hr_comment'         => $row->hr_comment,
            'created_by'         => $row->created_by,
            'creator_name'       => $row->creator?->name,
            'created_at'         => optional($row->created_at)->toIso8601String(),
            // ── Settlement (post-approval payout) — mirrors ExpenseClaim ──
            'sanctioned_amount'  => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'   => (float) $row->deduction_amount,
            'deduction_reason'   => $row->deduction_reason,
            'total_paid'         => (float) $row->total_paid,
            'settlement_status'  => $row->settlement_status ?: 'unpaid',
            'settled_at'         => optional($row->settled_at)->toIso8601String(),
            'remaining_amount'   => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
            // Employee "Settle Payment" — the employee reconciles a fully-paid
            // COMPANY advance against the ACTUAL amount spent.
            'employee_settled_at'  => optional($row->employee_settled_at)->toIso8601String(),
            'employee_settle_note' => $row->employee_settle_note,
            'settle_actual_amount' => $row->settle_actual_amount !== null ? (float) $row->settle_actual_amount : null,
            'settle_type'          => $row->settle_type,          // equal | return | reimburse
            'settle_balance'       => (float) $row->settle_balance,
            'settle_declared_type' => $row->settle_declared_type, // equal | minimum | maximum
            'settle_target_amount' => $row->settle_target_amount !== null ? (float) $row->settle_target_amount : null,
            // Follow-through status so the list can show the right action button.
            'settle_returned_at'         => optional($row->settle_returned_at)->toIso8601String(),
            'settle_return_scheduled_at' => optional($row->settle_return_scheduled_at)->toIso8601String(),
            'settle_reimbursed'          => (bool) $row->settle_reimbursement_claim_id,
            'settle_return_remaining'    => (function () use ($row) {
                $bal  = round((float) $row->settle_balance, 2);
                $paid = round(array_sum(array_map(fn ($p) => (float) ($p['amount'] ?? 0), $row->settle_return_payments ?? [])), 2);
                return max(0, round($bal - $paid, 2));
            })(),
            'settle_items'         => collect($row->settle_items ?? [])->values()->map(fn ($it, $i) => [
                'amount'    => (float) ($it['amount'] ?? 0),
                'reason'    => (string) ($it['reason'] ?? ''),
                'method'    => (string) ($it['method'] ?? ''),
                'proof_name'=> $it['proof_name'] ?? null,
                'proof_url' => !empty($it['proof_path']) ? url("/api/advance-requests/{$row->id}/settle-proof/{$i}") : null,
            ])->all(),
        ];
    }

    /**
     * POST /advance-requests/{id}/employee-settle
     * The employee who took a fully-paid COMPANY advance marks it as settled
     * (a status — they've accounted for the company-paid amount). Only the owner
     * employee may do this; only on a Company, approved, fully-paid advance.
     */
    public function employeeSettle(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        // Only the employee who raised it may settle (super_admin may act too).
        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->employee_id !== $myEmployeeId) {
            abort(403, 'Only the employee who took this advance can settle it.');
        }
        if (($row->used_for ?: 'self') !== 'company') {
            abort(409, 'Only a company-used advance needs to be settled.');
        }
        if ($row->status !== 'approved' || ($row->settlement_status ?? 'unpaid') !== 'paid') {
            abort(409, 'The advance must be fully paid before it can be settled.');
        }
        // Settlement is INCREMENTAL: bills can be added over several saves; the
        // advance only locks when the employee explicitly finalises it. Once
        // finalised, no further bills may be added and old ones can't be removed.
        if ($row->employee_settled_at) {
            abort(409, 'This advance is already finalised and locked.');
        }

        // New usage rows — one row per bill: amount + reason + proof (all required).
        // Files arrive as proofs[] aligned by index to items[]. On a pure finalise
        // (locking previously-saved bills) items/proofs may be empty.
        $data = $request->validate([
            'items'          => ['nullable', 'array'],
            'items.*.amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            'items.*.reason' => ['required', 'string', 'max:500'],
            'items.*.method' => ['required', 'string', 'max:40'],
            'proofs'         => ['nullable', 'array'],
            'proofs.*'       => ['required', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
            'note'           => ['nullable', 'string', 'max:500'],
            'finalize'       => ['nullable', 'boolean'],
            'declared_type'  => ['nullable', 'in:equal,minimum,maximum'],
            'target_amount'  => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
        ]);

        $finalize   = filter_var($request->input('finalize', false), FILTER_VALIDATE_BOOLEAN);
        $sanctioned = (float) ($row->sanctioned_amount ?? $row->amount);

        // Declared target — captured up front on the first save, then LOCKED.
        //   equal   → target == advance
        //   minimum → 0 < target < advance (employee returns the balance)
        //   maximum → target > advance (company reimburses the extra)
        if ($row->settle_declared_type === null) {
            $declaredType = $data['declared_type'] ?? 'equal';
            $target = $declaredType === 'equal'
                ? $sanctioned
                : round((float) ($data['target_amount'] ?? 0), 2);
            $bad =
                ($declaredType === 'equal'   && abs($target - $sanctioned) > 0.005) ||
                ($declaredType === 'minimum' && !($target > 0 && $target < $sanctioned - 0.005)) ||
                ($declaredType === 'maximum' && !($target > $sanctioned + 0.005));
            if ($bad) {
                return response()->json([
                    'status'  => false,
                    'message' => 'The declared amount used does not match the chosen type.',
                    'errors'  => ['target_amount' => ['Invalid amount for the chosen settlement type.']],
                ], 422);
            }
            $row->settle_declared_type = $declaredType;
            $row->settle_target_amount = $target;
        }
        $declaredType = $row->settle_declared_type;
        $target       = (float) $row->settle_target_amount;

        $items  = array_values($data['items'] ?? []);
        $proofs   = $request->file('proofs') ?? [];
        if (count($proofs) !== count($items)) {
            return response()->json([
                'status'  => false,
                'message' => 'Each usage row must have exactly one proof.',
                'errors'  => ['proofs' => ['A proof is required for every usage row.']],
            ], 422);
        }

        // Append the new rows to the existing (locked) ledger.
        $settleItems = array_values($row->settle_items ?? []);
        foreach ($items as $i => $it) {
            $amt  = round((float) $it['amount'], 2);
            $f    = $proofs[$i] ?? null;
            $path = $f ? $f->store('advance_settlements/' . $row->id, 'public') : null;
            $settleItems[] = [
                'amount'     => $amt,
                'reason'     => trim((string) $it['reason']),
                'method'     => trim((string) ($it['method'] ?? '')),
                'proof_path' => $path,
                'proof_name' => $f ? $f->getClientOriginalName() : null,
            ];
        }

        if (empty($settleItems)) {
            return response()->json([
                'status'  => false,
                'message' => 'Add at least one bill before saving.',
                'errors'  => ['items' => ['Add at least one usage row.']],
            ], 422);
        }
        if ($finalize && empty($items) && empty($row->settle_items)) {
            return response()->json([
                'status'  => false,
                'message' => 'Add at least one bill before finalising.',
                'errors'  => ['items' => ['Add at least one usage row.']],
            ], 422);
        }

        // Cumulative usage vs the sanctioned (paid) amount:
        //   equal     → 0 balance
        //   return    → total < sanctioned → employee returns the unused part
        //   reimburse → total > sanctioned → company reimburses the extra
        $total      = round(array_sum(array_map(fn ($it) => (float) $it['amount'], $settleItems)), 2);
        $diff       = round($total - $sanctioned, 2);
        $settleType = $diff === 0.0 ? 'equal' : ($diff < 0 ? 'return' : 'reimburse');
        $balance    = abs($diff);

        // The bills may never exceed the declared "amount used"; finalising
        // requires them to total it exactly.
        if ($total > $target + 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Total used ₹' . number_format($total, 2) . ' exceeds the declared amount used ₹' . number_format($target, 2) . '.',
                'errors'  => ['items' => ['Total exceeds the declared amount used.']],
            ], 422);
        }
        if ($finalize && abs($total - $target) > 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'To finalise, the itemised bills must total the declared amount used ₹' . number_format($target, 2) . ' (currently ₹' . number_format($total, 2) . ').',
                'errors'  => ['items' => ['Bills must total the declared amount used before finalising.']],
            ], 422);
        }

        if ($request->filled('note')) {
            $row->employee_settle_note = $data['note'];
        }
        $row->settle_items         = $settleItems;
        $row->settle_actual_amount = $total;
        $row->settle_type          = $settleType;
        $row->settle_balance       = $balance;
        if ($finalize) {
            $row->employee_settled_at = now();
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        if (!$finalize) {
            $msg = 'Bills saved — ₹' . number_format($total, 2) . ' itemised so far. Add more or finalise when done.';
        } else {
            $msg = $settleType === 'equal'
                ? 'Advance settled — usage matched the advance.'
                : ($settleType === 'return'
                    ? 'Advance settled — ₹' . number_format($balance, 2) . ' to be returned to the company.'
                    : 'Advance settled — ₹' . number_format($balance, 2) . ' to be reimbursed to the employee.');
        }
        return response()->json([
            'status'  => true,
            'message' => $msg,
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Stream a settlement usage-row proof (bill) by its index. Token-authed.
     */
    public function settleProof(Request $request, $id, $index)
    {
        $this->authenticateFromQueryToken($request);
        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $request->user());
        $item = ($row->settle_items ?? [])[(int) $index] ?? null;
        if (!$item || empty($item['proof_path'])) {
            abort(404, 'No settlement proof was attached for this row.');
        }
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($item['proof_path'])) {
            abort(404, 'Settlement proof file is missing on the server.');
        }
        return $disk->response($item['proof_path'], $item['proof_name'] ?: basename($item['proof_path']));
    }

    /**
     * POST /advance-requests/{id}/raise-reimbursement
     * A finalised COMPANY advance that settled as "reimburse" (used more than the
     * advance) owes the employee the extra. This raises a reimbursement Expense
     * Claim for that balance so it flows through the normal expense payout, and
     * links it back so the button can't be pressed twice.
     */
    public function raiseReimbursement(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        // Owner employee, super_admin, or HR/Finance (approve rights) may raise it —
        // HR often actions this from the management view after the employee settles.
        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->employee_id !== $myEmployeeId) {
            $this->guardHrPermission($user, 'can_approve');
        }
        if (!$row->employee_settled_at || $row->settle_type !== 'reimburse') {
            abort(409, 'A reimbursement can only be raised for a finalised, over-spent (reimburse) advance.');
        }
        $balance = round((float) $row->settle_balance, 2);
        if ($balance <= 0) {
            abort(409, 'There is nothing to reimburse.');
        }
        if ($row->settle_reimbursement_claim_id) {
            abort(409, 'A reimbursement expense has already been raised for this advance.');
        }

        $employee = Employee::find($row->employee_id);
        if (!$employee) {
            abort(404, 'Employee not found.');
        }

        // Carry the settlement bills over as the claim's supporting documents.
        $attachments = [];
        foreach (($row->settle_items ?? []) as $it) {
            if (!empty($it['proof_path'])) {
                $attachments[] = [
                    'name' => $it['proof_name'] ?? basename($it['proof_path']),
                    'size' => null,
                    'path' => $it['proof_path'],
                ];
            }
        }

        $hasManager     = !empty($employee->reporting_manager_id);
        $managerStatus  = $hasManager ? 'pending' : 'approved';
        $managerActedAt = $hasManager ? null : now();
        $managerComment = $hasManager ? null : 'Auto-approved · no reporting manager assigned';

        $claim = DB::transaction(function () use ($row, $employee, $balance, $attachments, $managerStatus, $managerActedAt, $managerComment, $user) {
            $newClaim = \App\Models\ExpenseClaim::create([
                'client_id'        => $employee->client_id,
                'branch_id'        => $employee->branch_id,
                'claim_no'         => $this->nextExpenseClaimNo($employee->client_id, $employee->branch_id),
                'employee_id'      => $employee->id,
                'employee_name'    => $employee->display_name
                    ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: null,
                'manager_id'       => $employee->reporting_manager_id,
                'currency'         => 'INR',
                'title'            => 'Advance reimbursement — ' . ($row->advance_no ?: ('ADV-' . $row->id)),
                'amount'           => $balance,
                'expense_date'     => now()->toDateString(),
                'purpose'          => 'Reimbursement of the amount spent over the company advance '
                    . ($row->advance_no ?: ('ADV-' . $row->id)) . ' (used ₹' . number_format((float) $row->settle_actual_amount, 2)
                    . ' against ₹' . number_format((float) ($row->sanctioned_amount ?? $row->amount), 2) . ').',
                'attachments'      => $attachments ?: null,
                'status'           => 'pending',
                'manager_status'   => $managerStatus,
                'manager_acted_at' => $managerActedAt,
                'manager_comment'  => $managerComment,
                'hr_status'        => 'pending',
                'created_by'       => $user->id,
            ]);

            $row->settle_reimbursement_claim_id = $newClaim->id;
            $row->settle_reimbursed_at = now();
            $row->save();

            return $newClaim;
        });

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => 'Reimbursement ' . $claim->claim_no . ' raised for ₹' . number_format($balance, 2) . '.',
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Next EXP-#### sequence for a tenant (mirrors ExpenseClaimController).
     */
    private function nextExpenseClaimNo(?int $clientId, ?int $branchId): string
    {
        $q = \App\Models\ExpenseClaim::query()->lockForUpdate();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        $max = 0;
        foreach ($q->pluck('claim_no') as $c) {
            if (preg_match('/^EXP-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'EXP-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }

    /**
     * POST /advance-requests/{id}/record-return
     * A finalised COMPANY advance that settled as "return" (used less than the
     * advance) owes the company the unused balance. This records that the
     * employee has returned it (method + optional proof), closing the advance.
     */
    public function recordReturn(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->employee_id !== $myEmployeeId) {
            $this->guardHrPermission($user, 'can_approve');
        }
        if (!$row->employee_settled_at || $row->settle_type !== 'return') {
            abort(409, 'A return can only be recorded for a finalised, under-spent (return) advance.');
        }
        $balance = round((float) $row->settle_balance, 2);
        if ($balance <= 0) {
            abort(409, 'There is nothing to return.');
        }
        if ($row->settle_returned_at) {
            abort(409, 'The return has already been fully recorded.');
        }

        // Return can be paid directly (in one or more instalments) or cut from
        // payroll (single, closes the whole remaining at once).
        $data = $request->validate([
            'mode'   => ['required', 'in:direct,payroll'],
            'amount' => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            'method' => ['nullable', 'string', 'max:40'],
            'proof'  => ['nullable', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
            'note'   => ['nullable', 'string', 'max:500'],
        ]);

        $ledger    = array_values($row->settle_return_payments ?? []);
        $paidSoFar = round(array_sum(array_map(fn ($p) => (float) ($p['amount'] ?? 0), $ledger)), 2);
        $remaining = round($balance - $paidSoFar, 2);
        if ($remaining <= 0) {
            abort(409, 'The return has already been fully recorded.');
        }
        // Once payroll recovery is scheduled it covers the whole remaining, so
        // no further payment of ANY kind can be added.
        if ($row->settle_return_scheduled_at) {
            abort(409, 'Payroll recovery is already scheduled — no further payments can be added.');
        }

        if ($data['mode'] === 'payroll') {
            // Payroll deduction — capture the recovery SCHEDULE (start / type /
            // monthly / months). Recorded on our side now; the payroll engine
            // will consume these fields later. Clears the whole remaining.
            $nextMonth = now()->addMonthNoOverflow()->startOfMonth()->toDateString();
            $rec = $request->validate([
                'recovery_start' => ['required', 'date', 'after_or_equal:' . $nextMonth],
                'recovery_type'  => ['required', 'in:emi,lumpsum,bimonthly'],
                'monthly'        => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            ], [
                'recovery_start.after_or_equal' => 'Recovery must start next month or later (this month’s payroll may be done).',
            ]);
            $recType = $rec['recovery_type'];
            if ($recType === 'lumpsum') {
                $monthly = $remaining;
                $months  = 1;
            } else {
                $monthly = round((float) ($rec['monthly'] ?? 0), 2);
                if ($monthly <= 0) {
                    return response()->json(['message' => 'Enter a monthly deduction amount.', 'errors' => ['monthly' => ['A monthly amount is required.']]], 422);
                }
                $months = (int) max(1, ceil($remaining / $monthly));
            }
            $row->settle_return_recovery_start  = $rec['recovery_start'];
            $row->settle_return_recovery_mode   = $recType;
            $row->settle_return_recovery_months = $months;
            $row->settle_return_monthly         = $monthly;
            $row->settle_return_scheduled_at    = now();

            $amount = $remaining;
            $method = 'Payroll deduction (' . ($recType === 'emi' ? 'EMI' : ($recType === 'bimonthly' ? 'Bi-monthly' : 'Single lump')) . ')';
            $path = $name = null;
        } else {
            if (empty($data['method'])) {
                return response()->json(['message' => 'Select a payment method.', 'errors' => ['method' => ['A payment method is required.']]], 422);
            }
            $amount = $data['amount'] !== null ? round((float) $data['amount'], 2) : $remaining;
            if ($amount > $remaining + 0.005) {
                return response()->json([
                    'message' => 'Amount ₹' . number_format($amount, 2) . ' exceeds the remaining ₹' . number_format($remaining, 2) . '.',
                    'errors'  => ['amount' => ['Cannot exceed the remaining ₹' . number_format($remaining, 2) . '.']],
                ], 422);
            }
            $method = $data['method'];
            $path = $name = null;
            if ($request->hasFile('proof')) {
                $f = $request->file('proof');
                $path = $f->store('advance_settlements/' . $row->id, 'public');
                $name = $f->getClientOriginalName();
            }
        }

        $ledger[] = [
            'amount'     => $amount,
            'method'     => $method,
            'mode'       => $data['mode'],
            'note'       => $data['note'] ?? null,
            'proof_path' => $path,
            'proof_name' => $name,
            'paid_at'    => now()->toIso8601String(),
        ];
        $row->settle_return_payments = $ledger;
        $newPaid = round($paidSoFar + $amount, 2);
        if ($newPaid >= $balance - 0.005) {
            $row->settle_returned_at = now();
        }
        if ($request->filled('note')) {
            $row->employee_settle_note = trim(($row->employee_settle_note ? $row->employee_settle_note . "\n" : '') . $data['note']);
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        $left = round($balance - $newPaid, 2);
        if ($data['mode'] === 'payroll') {
            $msg = 'Payroll recovery scheduled for ₹' . number_format($amount, 2) . '.';
        } else {
            $msg = $left <= 0.005
                ? 'Return complete — ₹' . number_format($balance, 2) . ' returned.'
                : 'Return of ₹' . number_format($amount, 2) . ' recorded · ₹' . number_format($left, 2) . ' remaining.';
        }
        return response()->json([
            'status'  => true,
            'message' => $msg,
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Stream a return-payment proof (by ledger index). Token-authed.
     */
    public function returnProof(Request $request, $id, $index)
    {
        $this->authenticateFromQueryToken($request);
        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $request->user());
        $entry = ($row->settle_return_payments ?? [])[(int) $index] ?? null;
        if (!$entry || empty($entry['proof_path'])) {
            abort(404, 'No return proof was attached for this payment.');
        }
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($entry['proof_path'])) {
            abort(404, 'Return proof file is missing on the server.');
        }
        return $disk->response($entry['proof_path'], $entry['proof_name'] ?: basename($entry['proof_path']));
    }

    /* ============================================================ */
    /*  SETTLEMENT — post-approval payout (partial payments)         */
    /*  Mirrors ExpenseClaimController; no category / expense-type /  */
    /*  Zoho — an advance payout only carries amount + method + note. */
    /* ============================================================ */

    /**
     * GET /advance-requests/{id}/settlement
     * State for the Record-Payment form: requested/sanctioned amounts, running
     * total, adjustments and the list of installment payments made so far.
     */
    public function settlement(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::with(['payments.payer', 'employee', 'manager'])->findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $employee     = $row->employee;
        $employeeName = ($employee
            ? ($employee->display_name ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : null);

        return response()->json([
            'id'                => $row->id,
            'claim_no'          => $row->advance_no ?: ('#' . $row->id),
            'title'             => $row->advance_type === 'Other' && $row->advance_type_other
                ? $row->advance_type_other
                : $row->advance_type,
            'employee_name'     => $employeeName,
            'expense_date'      => optional($row->requested_date)->format('Y-m-d'),
            'currency'          => 'INR',
            'claimed_amount'    => (float) $row->amount,
            'purpose'           => $row->reason,
            'vendor'            => null,
            'project'           => null,
            'category_id'       => null,
            'category_name'     => $row->advance_type,
            // Salary-recovery schedule (self advance) — shown in the review modal.
            'recovery_start'    => optional($row->recovery_start)->format('Y-m-d'),
            'recovery_mode'     => $row->recovery_mode,
            'recovery_months'   => $row->recovery_months,
            'monthly_emi'       => $row->monthly_emi !== null ? (float) $row->monthly_emi : null,
            'sanctioned_amount' => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'  => (float) $row->deduction_amount,
            'deduction_reason'  => $row->deduction_reason,
            'deductions'        => collect($row->deductions ?? [])->map(fn ($d) => [
                'amount' => (float) ($d['amount'] ?? 0),
                'reason' => (string) ($d['reason'] ?? ''),
            ])->values()->all(),
            'addition_amount'   => (float) $row->addition_amount,
            'additions'         => collect($row->additions ?? [])->map(fn ($d) => [
                'amount' => (float) ($d['amount'] ?? 0),
                'reason' => (string) ($d['reason'] ?? ''),
            ])->values()->all(),
            'total_paid'        => (float) $row->total_paid,
            'remaining_amount'  => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
            'settlement_status' => $row->settlement_status ?: 'unpaid',
            'status'            => $row->status,
            'manager_status'    => $row->manager_status,
            'hr_status'         => $row->hr_status,
            'attachments'       => collect($row->attachments ?? [])->values()->map(fn ($a, $i) => [
                'name' => $a['name'] ?? ('Attachment ' . ($i + 1)),
                'size' => $a['size'] ?? null,
                'url'  => url("/api/advance-requests/{$row->id}/attachments/{$i}"),
            ])->all(),
            'payments'          => $row->payments->map(fn ($p) => [
                'id'           => $p->id,
                'amount'       => (float) $p->amount,
                'category_name'=> null,
                'payment_type' => $p->payment_type,
                'expense_type' => null,
                'note'         => $p->note,
                'proof_name'   => $p->proof_name,
                'proof_url'    => $p->proof_path ? url("/api/advance-requests/payments/{$p->id}/proof") : null,
                'zoho_status'  => null,
                'zoho_synced_at' => null,
                'zoho_expense_url' => null,
                'paid_by_name' => $p->payer?->name,
                'paid_at'      => optional($p->paid_at)->toIso8601String(),
            ])->all(),
            // Advance-specific settle context so the modal can render the
            // employee "Settlement" section (company advances only).
            'employee_id'          => $row->employee_id,
            'used_for'             => $row->used_for ?: 'self',
            'employee_settled_at'  => optional($row->employee_settled_at)->toIso8601String(),
            'employee_settle_note' => $row->employee_settle_note,
            'settle_actual_amount' => $row->settle_actual_amount !== null ? (float) $row->settle_actual_amount : null,
            'settle_type'          => $row->settle_type,
            'settle_balance'       => (float) $row->settle_balance,
            'settle_declared_type' => $row->settle_declared_type,
            'settle_target_amount' => $row->settle_target_amount !== null ? (float) $row->settle_target_amount : null,
            'settle_items'         => collect($row->settle_items ?? [])->values()->map(fn ($it, $i) => [
                'amount'    => (float) ($it['amount'] ?? 0),
                'reason'    => (string) ($it['reason'] ?? ''),
                'method'    => (string) ($it['method'] ?? ''),
                'proof_name'=> $it['proof_name'] ?? null,
                'proof_url' => !empty($it['proof_path']) ? url("/api/advance-requests/{$row->id}/settle-proof/{$i}") : null,
            ])->all(),
            'settle_reimbursed_at' => optional($row->settle_reimbursed_at)->toIso8601String(),
            'settle_reimbursement' => $row->settle_reimbursement_claim_id
                ? (function () use ($row) {
                    $c = \App\Models\ExpenseClaim::with('category')->find($row->settle_reimbursement_claim_id);
                    if (!$c) return null;
                    $att = collect($c->attachments ?? [])->first();
                    return [
                        'id'         => $c->id,
                        'claim_no'   => $c->claim_no,
                        'status'     => $c->status,
                        'amount'     => (float) $c->amount,
                        'category'   => $c->category?->name ?? $c->category_name ?? null,
                        'currency'   => $c->currency ?: 'INR',
                        'proof_name' => $att['name'] ?? null,
                        'proof_url'  => $att ? url("/api/expense-claims/{$c->id}/attachments/0") : null,
                    ];
                })()
                : null,
            'settle_returned_at'   => optional($row->settle_returned_at)->toIso8601String(),
            'settle_return_payments' => collect($row->settle_return_payments ?? [])->values()->map(fn ($p, $i) => [
                'amount'    => (float) ($p['amount'] ?? 0),
                'method'    => (string) ($p['method'] ?? ''),
                'mode'      => (string) ($p['mode'] ?? 'direct'),
                'note'      => $p['note'] ?? null,
                'paid_at'   => $p['paid_at'] ?? null,
                'proof_name'=> $p['proof_name'] ?? null,
                'proof_url' => !empty($p['proof_path']) ? url("/api/advance-requests/{$row->id}/return-proof/{$i}") : null,
            ])->all(),
            'settle_return_remaining' => (function () use ($row) {
                $bal  = round((float) $row->settle_balance, 2);
                $paid = round(array_sum(array_map(fn ($p) => (float) ($p['amount'] ?? 0), $row->settle_return_payments ?? [])), 2);
                return max(0, round($bal - $paid, 2));
            })(),
            // Payroll-recovery plan (when the return is cut from payroll).
            'settle_return_scheduled_at'    => optional($row->settle_return_scheduled_at)->toIso8601String(),
            'settle_return_recovery_start'  => optional($row->settle_return_recovery_start)->format('Y-m-d'),
            'settle_return_recovery_mode'   => $row->settle_return_recovery_mode,
            'settle_return_recovery_months' => $row->settle_return_recovery_months,
            'settle_return_monthly'         => $row->settle_return_monthly !== null ? (float) $row->settle_return_monthly : null,
            // Employee monthly salary — used to gate the "Single Lump" payroll
            // option (net take-home when a payslip exists, else structure gross,
            // else annual/12). Read-only; no payroll-engine change.
            'employee_monthly_salary'       => $this->employeeMonthlySalary($row->employee_id),
            // Total-EMI headroom (70% of salary − ongoing EMIs, excluding this row).
            'emi_ongoing'   => $this->ongoingEmiTotal($row->employee_id, $row->id),
            'emi_available' => (function () use ($row) {
                $net = $this->employeeMonthlySalary($row->employee_id);
                if ($net === null) return null;
                return max(0, round($net * self::EMI_HEADROOM_PCT - $this->ongoingEmiTotal($row->employee_id, $row->id), 2));
            })(),
        ]);
    }

    /**
     * Best-available monthly take-home for an employee: latest payslip net_pay,
     * else active salary-structure monthly_gross, else annual_salary / 12.
     * Returns null when nothing is on file (single-lump check then allowed).
     */
    private function employeeMonthlySalary($employeeId): ?float
    {
        if (!$employeeId) return null;
        $net = \Illuminate\Support\Facades\DB::table('payslips')
            ->where('employee_id', $employeeId)
            ->orderByDesc('id')
            ->value('net_pay');
        if ($net !== null && (float) $net > 0) return (float) $net;
        $gross = \Illuminate\Support\Facades\DB::table('salary_structures')
            ->where('employee_id', $employeeId)
            ->where('status', 'Active')
            ->orderByDesc('id')
            ->value('monthly_gross');
        if ($gross !== null && (float) $gross > 0) return (float) $gross;
        $annual = \App\Models\Employee::whereKey($employeeId)->value('annual_salary');
        return $annual !== null && (float) $annual > 0 ? round((float) $annual / 12, 2) : null;
    }

    /** Percentage of salary that total advance EMIs may occupy (FOI ceiling). */
    private const EMI_HEADROOM_PCT = 0.70;

    /**
     * Sum of an employee's ONGOING advance EMIs (per-month), across both
     * self-advance salary recovery and company-advance return-via-payroll
     * schedules. "Ongoing" = a recurring EMI/bi-monthly plan whose last cycle
     * hasn't passed. Optionally excludes one advance (the one being edited).
     */
    private function ongoingEmiTotal($employeeId, $excludeId = null): float
    {
        if (!$employeeId) return 0.0;
        $nowMonth = now()->startOfMonth();
        $total = 0.0;

        $endMonth = function (?string $start, string $mode, $months): ?\Illuminate\Support\Carbon {
            if (!$start) return null;
            $step = $mode === 'bimonthly' ? 2 : 1;
            $n = (int) ($months ?: 1);
            return \Illuminate\Support\Carbon::parse($start)->addMonthsNoOverflow(($n - 1) * $step)->startOfMonth();
        };

        // Self advances still recovering from salary.
        $self = AdvanceRequest::where('employee_id', $employeeId)
            ->where('status', 'approved')
            ->whereIn('recovery_mode', ['emi', 'bimonthly'])
            ->whereNotNull('monthly_emi')
            ->when($excludeId, fn ($q) => $q->where('id', '!=', $excludeId))
            ->get(['id', 'recovery_start', 'recovery_mode', 'recovery_months', 'monthly_emi']);
        foreach ($self as $a) {
            $end = $endMonth($a->recovery_start ? \Illuminate\Support\Carbon::parse($a->recovery_start)->toDateString() : null, $a->recovery_mode, $a->recovery_months);
            if (!$end || $end->gte($nowMonth)) $total += (float) $a->monthly_emi;
        }

        // Company advances returned via payroll, still recovering.
        $ret = AdvanceRequest::where('employee_id', $employeeId)
            ->whereIn('settle_return_recovery_mode', ['emi', 'bimonthly'])
            ->whereNotNull('settle_return_monthly')
            ->when($excludeId, fn ($q) => $q->where('id', '!=', $excludeId))
            ->get(['id', 'settle_return_recovery_start', 'settle_return_recovery_mode', 'settle_return_recovery_months', 'settle_return_monthly']);
        foreach ($ret as $a) {
            $end = $endMonth($a->settle_return_recovery_start ? \Illuminate\Support\Carbon::parse($a->settle_return_recovery_start)->toDateString() : null, $a->settle_return_recovery_mode, $a->settle_return_recovery_months);
            if (!$end || $end->gte($nowMonth)) $total += (float) $a->settle_return_monthly;
        }

        return round($total, 2);
    }

    /**
     * GET /advance-requests/emi-info
     * EMI headroom for an employee: net salary, ongoing EMIs, 70% cap and the
     * amount still available for a new advance's per-cycle EMI.
     */
    public function emiInfo(Request $request)
    {
        $user = $request->user();
        $employeeId = $this->resolveEmployeeId(
            $request->query('employee_id'),
            $request->query('employee_code'),
            $user
        ) ?: $this->currentEmployeeId($user);
        $net = $this->employeeMonthlySalary($employeeId);
        $ongoing = $this->ongoingEmiTotal($employeeId, $request->integer('exclude_id') ?: null);
        $cap = $net !== null ? round($net * self::EMI_HEADROOM_PCT, 2) : null;
        $available = $cap !== null ? max(0, round($cap - $ongoing, 2)) : null;
        return response()->json([
            'net_salary'  => $net,
            'ongoing_emi' => $ongoing,
            'cap'         => $cap,
            'available'   => $available,
            'pct'         => (int) round(self::EMI_HEADROOM_PCT * 100),
        ]);
    }

    /**
     * POST /advance-requests/{id}/set-deductions
     * Lock the one-time deductions / additions WITHOUT recording a payment —
     * fixes the net payable before the first payout. Mirrors ExpenseClaim.
     */
    public function setDeductions(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($row->status !== 'approved') {
            abort(409, 'Only an approved advance can be settled. Approve it first.');
        }
        if ($row->sanctioned_amount !== null) {
            abort(409, 'The adjustments are already locked for this advance.');
        }

        $data = $request->validate([
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
        ]);

        [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
        if ($dedErr) return $dedErr;
        [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
        if ($addErr) return $addErr;

        $sanctioned = round((float) $row->amount - $deduction + $addition, 2);
        if ($sanctioned <= 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Deductions cannot exceed the requested amount plus additions — net payable must be greater than zero.',
                'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
            ], 422);
        }

        $row->sanctioned_amount = $sanctioned;
        $row->deduction_amount  = max(0, $deduction);
        $row->deductions        = $deductionRows;
        $row->addition_amount   = max(0, $addition);
        $row->additions         = $additionRows;
        $row->deduction_reason  = $deductionRows
            ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
            : null;
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => 'Locked — net payable ₹' . number_format($sanctioned, 2) . '. Add a payment to disburse.',
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * POST /advance-requests/{id}/settle
     * Record ONE payout installment. The FIRST call also locks the sanctioned
     * amount (requested − Σ deductions + Σ additions). Partial payments allowed
     * until the sanctioned amount is met.
     */
    public function settle(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($row->status !== 'approved') {
            abort(409, 'Only an approved advance can be paid. Approve it first.');
        }
        if (($row->settlement_status ?? 'unpaid') === 'paid') {
            abort(409, 'This advance is already fully paid.');
        }

        $firstPayment = $row->sanctioned_amount === null;

        $data = $request->validate([
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
            'amount'              => ['required', 'numeric', 'min:0.01'],
            'payment_type'        => ['required', 'string', 'in:Cheque,UPI,PhonePe,Bank Transfer'],
            'note'                => ['required', 'string', 'max:500'],
            'proof'               => ['required', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
        ]);

        $deductionRows = []; $deduction = 0.0;
        $additionRows  = []; $addition  = 0.0;
        if ($firstPayment) {
            [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
            if ($dedErr) return $dedErr;
            [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
            if ($addErr) return $addErr;
            if (round((float) $row->amount - $deduction + $addition, 2) <= 0.005) {
                return response()->json([
                    'status'  => false,
                    'message' => 'Deductions cannot exceed the requested amount plus additions — net payable must be greater than zero.',
                    'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
                ], 422);
            }
        }

        $sanctioned = $firstPayment ? round((float) $row->amount - $deduction + $addition, 2) : (float) $row->sanctioned_amount;

        $pay       = round((float) $data['amount'], 2);
        $remaining = round($sanctioned - (float) $row->total_paid, 2);
        if ($pay > $remaining + 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Payment (' . number_format($pay, 2) . ') exceeds the remaining amount (' . number_format($remaining, 2) . ').',
                'errors'  => ['amount' => ['Cannot pay more than the remaining amount.']],
            ], 422);
        }

        $proofPath = null;
        $proofName = null;
        if ($request->hasFile('proof')) {
            $f = $request->file('proof');
            $proofName = $f->getClientOriginalName();
            $proofPath = $f->store('advance_request_payments/' . $row->id, 'public');
        }

        DB::transaction(function () use ($row, $user, $firstPayment, $sanctioned, $deduction, $deductionRows, $addition, $additionRows, $pay, $data, $proofPath, $proofName) {
            if ($firstPayment) {
                $row->sanctioned_amount = $sanctioned;
                $row->deduction_amount  = max(0, $deduction);
                $row->deductions        = $deductionRows;
                $row->addition_amount   = max(0, $addition);
                $row->additions         = $additionRows;
                $row->deduction_reason  = $deductionRows
                    ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
                    : null;
            }

            \App\Models\AdvanceRequestPayment::create([
                'client_id'          => $row->client_id,
                'branch_id'          => $row->branch_id,
                'advance_request_id' => $row->id,
                'amount'             => $pay,
                'payment_type'       => $data['payment_type'],
                'note'               => $data['note'] ?? null,
                'proof_path'         => $proofPath,
                'proof_name'         => $proofName,
                'paid_by'            => $user->id,
                'paid_at'            => now(),
            ]);

            $row->total_paid = round((float) $row->total_paid + $pay, 2);
            $paidUp = $row->total_paid + 0.005 >= (float) $row->sanctioned_amount;
            $row->settlement_status = $paidUp ? 'paid' : 'partial';
            $row->settled_at = $paidUp ? now() : null;
            $row->save();
        });

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => $row->settlement_status === 'paid'
                ? 'Payment recorded — advance fully paid.'
                : 'Payment recorded — ₹' . number_format((float) $row->total_paid, 2) . ' of ₹' . number_format((float) $row->sanctioned_amount, 2) . ' paid.',
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Stream the proof-of-payment file attached to one settlement installment.
     * Auth via query token so a plain browser link works (mirrors attachments).
     */
    public function paymentProof(Request $request, $paymentId)
    {
        $this->authenticateFromQueryToken($request);
        $payment = \App\Models\AdvanceRequestPayment::findOrFail($paymentId);
        $row = AdvanceRequest::findOrFail($payment->advance_request_id);
        $this->ensureTenantAccess($row, $request->user());

        if (empty($payment->proof_path)) {
            abort(404, 'No proof of payment was attached to this settlement.');
        }
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($payment->proof_path)) {
            abort(404, 'Proof file is missing on the server.');
        }
        return $disk->response($payment->proof_path, $payment->proof_name ?: basename($payment->proof_path));
    }

    /**
     * Normalise an itemised adjustments array (deductions / additions): keep only
     * rows with amount > 0, require a reason for each, return [rows, total, err].
     */
    private function normaliseAdjustments(array $items, string $kind): array
    {
        $rows  = [];
        $total = 0.0;
        $field = $kind === 'addition' ? 'additions' : 'deductions';
        foreach ($items as $d) {
            $amt = round((float) ($d['amount'] ?? 0), 2);
            if ($amt <= 0.005) continue;
            if (empty(trim((string) ($d['reason'] ?? '')))) {
                return [[], 0.0, response()->json([
                    'status'  => false,
                    'message' => 'Each ' . $kind . ' needs a reason.',
                    'errors'  => [$field => ['Every ' . $kind . ' must have a reason.']],
                ], 422)];
            }
            $rows[] = ['amount' => $amt, 'reason' => trim((string) $d['reason'])];
            $total += $amt;
        }
        return [$rows, round($total, 2), null];
    }

}
