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
    private const ADVANCE_TYPES    = ['Travel Advance', 'Salary Advance', 'Medical Advance', 'Loan', 'Other'];
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
                'employee' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'reporting_manager_id', 'reporting_manager_user_id', 'department_id'),
                'employee.department:id,name',
                'employee.reportingManagerUser:id,name',
                'manager' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code'),
                'creator:id,name,user_type',
                'hrUser:id,name,user_type',
                'managerActor:id,name',
                'payments' => fn ($r) => $r->with('payer:id,name'),
            ])
            ->orderByDesc('id');

        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        if ($scope === 'mine') {
            $myEmployeeId = $this->currentEmployeeId($user);
            $targetEmployeeId = $myEmployeeId;
            if ($employeeIdFilter && $employeeIdFilter !== $myEmployeeId) {
                $targetEmployeeId = $this->mayReadEmployeeAdvances($user, $employeeIdFilter, $myEmployeeId)
                    ? $employeeIdFilter
                    : -1;
            }
            $q->where('employee_id', $targetEmployeeId ?? -1);
        } elseif ($scope === 'team') {
            if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
                $myEmployeeId = $this->currentEmployeeId($user);
                if ($myEmployeeId) {
                    $q->where('employee_id', '!=', $myEmployeeId);
                }
            } else {
                $myEmployeeId = $this->currentEmployeeId($user);
                $teamIds = $this->downstreamEmployeeIds($myEmployeeId);
                $managedOthers = $myEmployeeId && AdvanceRequest::where('manager_id', $myEmployeeId)
                    ->where('employee_id', '!=', $myEmployeeId)
                    ->exists();
                if (!$teamIds && !$managedOthers) {
                    return response()->json([]);
                }
                $teamIds = array_values(array_unique($teamIds)) ?: [-1];
                $q->where(function ($w) use ($teamIds, $myEmployeeId) {
                    $w->whereIn('employee_id', $teamIds);
                    if ($myEmployeeId) {
                        $w->orWhere('manager_id', $myEmployeeId);
                    }
                });
                if ($myEmployeeId) {
                    $q->where('employee_id', '!=', $myEmployeeId);
                }
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

        $rows = $q->get();
        $this->primeLedger($rows->pluck('id')->all());
        return response()->json($rows->map(fn ($r) => $this->serialize($r)));
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if ($user && $user->user_type === 'super_admin') {
            $employeeId = $this->resolveEmployeeId(
                $request->input('employee_id'),
                $request->input('employee_code'),
                $user
            ) ?: $this->currentEmployeeId($user);
        } else {
            $employeeId = $this->currentEmployeeId($user)
                ?: $this->resolveEmployeeId(
                    $request->input('employee_id'),
                    $request->input('employee_code'),
                    $user
                );
        }

        if (!$employeeId) {
            abort(422, 'No linked Employee record found for the current user.');
        }
        $employee = Employee::find($employeeId);
        if (!$employee) {
            abort(404, 'Employee not found.');
        }
        if ($user->user_type !== 'super_admin'
            && $employee->user_id !== $user->id) {
            abort(403, 'You can only file advance requests for your own employee record.');
        }

        OnboardingGuard::assertComplete(
            $employee,
            'raise an advance request',
            (int) ($employee->user_id ?? 0) === (int) $user->id,
        );

        if ($employee->date_of_joining
            && $employee->date_of_joining->toDateString() > now()->toDateString()) {
            return response()->json([
                'message' => 'You cannot raise an advance request before your joining date ('
                    . $employee->date_of_joining->format('d M Y') . ').',
                'errors'  => ['employee_id' => ['Joining date is in the future.']],
            ], 422);
        }

        $minRecoveryStart = now()->addMonthNoOverflow()->startOfMonth()->toDateString();
        $maxRecoveryStart = now()->addYear()->endOfMonth()->toDateString();

        if ($request->has('reason')) {
            $request->merge(['reason' => str_replace("\r\n", "\n", (string) $request->input('reason'))]);
        }

        $data = $request->validate([
            'advance_type'        => ['required', 'string', 'in:' . implode(',', self::ADVANCE_TYPES)],
            'advance_type_other'  => ['nullable', 'string', 'max:255'],
            'amount'              => ['required', 'numeric', 'min:100', 'max:9999999999999.99'],
            'used_for'            => ['required', 'string', 'in:self,company'],
            'requested_date'      => ['required', 'date', 'after_or_equal:today', 'before_or_equal:today'],
            'recovery_start'      => ['required_if:used_for,self', 'nullable', 'date', 'after_or_equal:' . $minRecoveryStart, 'before_or_equal:' . $maxRecoveryStart],
            'recovery_mode'       => ['required_if:used_for,self', 'nullable', 'string', 'in:' . implode(',', self::RECOVERY_MODES)],
            'recovery_months'     => ['nullable', 'integer', 'min:1', 'max:120'],
            'monthly_emi'         => ['nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            'reason'              => ['required', 'string', 'max:500'],
            'files'               => ['required', 'array', 'min:1'],
            'files.*'             => ['file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ], [
            'files.required'                 => 'An attachment / proof is required to submit an advance request.',
            'files.min'                      => 'An attachment / proof is required to submit an advance request.',
            'files.*.max'                    => 'Each file must be 2 MB or smaller.',
            'files.*.mimes'                  => 'Files must be PDF, JPG or PNG.',
            'requested_date.after_or_equal'  => 'Requested date must be today (the request creation date).',
            'requested_date.before_or_equal' => 'Requested date cannot be in the future — it is the request creation date.',
            'recovery_start.after_or_equal'  => 'Recovery must start in the month after the requested date (this month’s payroll may already be done).',
            'recovery_start.before_or_equal' => 'Recovery must start within a year of the requested date.',
            'reason.max'                     => 'Reason is too long — please keep it under 500 characters.',
            'amount.min'                     => 'Minimum advance amount is ₹100.',
        ]);

        $isCompany = ($data['used_for'] ?? 'self') === 'company';
        if (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)) {
            $months   = (int) ($data['recovery_months'] ?? 0);
            $perCycle = (float) ($data['monthly_emi'] ?? 0) > 0
                ? (float) $data['monthly_emi']
                : ($months > 0 ? (float) $data['amount'] / $months : 0.0);
            $minCycle = min(500.0, (float) $data['amount']);
            if ($perCycle > 0 && $perCycle < $minCycle - 0.005) {
                return response()->json([
                    'status'  => false,
                    'message' => (float) $data['amount'] >= 500
                        ? 'Each recovery instalment must be at least ₹500 — reduce the number of cycles or increase the amount.'
                        : 'An advance below ₹500 must be recovered in a single instalment of ₹' . number_format((float) $data['amount'], 2) . '.',
                    'errors'  => ['recovery_months' => ['Minimum instalment is ₹' . number_format($minCycle, 2) . '.']],
                ], 422);
            }
        }
        if (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true) && empty($data['recovery_months'])) {
            abort(422, 'Number of instalments is required for EMI / Bi-Monthly recovery.');
        }
        if (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)
            && (float) ($data['monthly_emi'] ?? 0) > (float) $data['amount'] + 0.005) {
            return response()->json([
                'message' => 'The monthly instalment ₹' . number_format((float) $data['monthly_emi'], 2)
                    . ' cannot exceed the advance amount ₹' . number_format((float) $data['amount'], 2) . '.',
                'errors'  => ['monthly_emi' => ['Instalment can be equal to the advance amount, but not more.']],
            ], 422);
        }
        if ($data['advance_type'] === 'Other' && empty($data['advance_type_other'])) {
            abort(422, 'Please specify the advance type when "Other" is selected.');
        }

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

        $requestItems = null;
        $rawItems = $request->input('request_items');
        if ($isCompany && $rawItems) {
            $decoded = is_string($rawItems) ? json_decode($rawItems, true) : $rawItems;
            if (is_array($decoded) && count($decoded)) {
                $sum = 0.0;
                $requestItems = [];
                foreach ($decoded as $it) {
                    $amt = round((float) ($it['amount'] ?? 0), 2);
                    $sum += $amt;
                    $pi = isset($it['proof_index']) ? (int) $it['proof_index'] : null;
                    $proof = ($pi !== null && isset($attachments[$pi])) ? $attachments[$pi] : null;
                    $requestItems[] = [
                        'amount'       => $amt,
                        'purpose'      => (string) ($it['purpose'] ?? ''),
                        'payment_type' => (string) ($it['payment_type'] ?? ''),
                        'proof_name'   => $proof['name'] ?? null,
                        'proof_path'   => $proof['path'] ?? null,
                    ];
                }
                if (round($sum, 2) !== round((float) $data['amount'], 2)) {
                    return response()->json([
                        'status'  => false,
                        'message' => 'Distribution rows must total the advance amount ₹' . number_format((float) $data['amount'], 2) . ' — got ₹' . number_format($sum, 2) . '.',
                        'errors'  => ['request_items' => ['Rows must add up to the advance amount.']],
                    ], 422);
                }
            }
        }

        $managerStatus   = 'pending';
        $managerActedAt  = null;
        $managerComment  = null;

        $row = DB::transaction(function () use ($employee, $data, $attachments, $requestItems, $managerStatus, $managerActedAt, $managerComment, $user, $isCompany) {
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
                'recovery_start'    => $isCompany ? null : ($data['recovery_start'] ?? null),
                'expected_use_date' => null,
                'recovery_mode'     => $isCompany ? null : ($data['recovery_mode'] ?? null),
                'recovery_months'   => (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)) ? ($data['recovery_months'] ?? null) : null,
                'monthly_emi'       => (!$isCompany && in_array($data['recovery_mode'] ?? null, ['emi', 'bimonthly'], true)) ? ($data['monthly_emi'] ?? null) : null,
                'reason'            => $data['reason'],
                'attachments'       => $attachments ?: null,
                'request_items'     => $requestItems,
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
        return $this->streamJsonAttachment(
            $request, $id,
            'attachments', $index,
            'path', 'name',
            'Attachment not found.',
            'Attachment file is missing on the server.',
        );
    }

    private function streamStoredFile(string $path, ?string $name, string $goneMessage)
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($path)) {
            abort(404, $goneMessage);
        }
        return $disk->response($path, $name ?: basename($path));
    }

    private function streamJsonAttachment(
        Request $request,
        $id,
        string $column,
        $index,
        string $pathKey,
        string $nameKey,
        string $missingMessage,
        string $goneMessage,
    ) {
        $this->authenticateFromQueryToken($request);
        $row = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $request->user());

        $entry = ($row->{$column} ?? [])[(int) $index] ?? null;
        if (!$entry || empty($entry[$pathKey])) {
            abort(404, $missingMessage);
        }

        return $this->streamStoredFile($entry[$pathKey], $entry[$nameKey] ?? null, $goneMessage);
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
        if ($user->user_type !== 'super_admin' && $myEmployeeId !== null && (int) $row->employee_id === (int) $myEmployeeId) {
            abort(403, 'You cannot approve your own advance request — your reporting manager (branch user) will approve it.');
        }
        $isAssignedManager = $myEmployeeId !== null && (int) $row->manager_id === (int) $myEmployeeId;
        if ($user->user_type !== 'super_admin' && !$isAssignedManager) {
            if ($row->manager_id === null) {
                $this->guardHrPermission($user, 'can_approve');
            } else {
                abort(403, 'You are not the assigned reporting manager for this advance request.');
            }
        }
        if ($row->manager_status !== 'pending') {
            abort(409, 'This advance request has already been actioned by the manager.');
        }

        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $row->manager_status   = $verdict;
        $row->manager_acted_at = now();
        $row->manager_acted_by = $user->id;
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
        $myEmp = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $myEmp !== null && (int) $row->employee_id === (int) $myEmp) {
            abort(403, 'You cannot approve your own advance request — your reporting manager (branch user) will approve it.');
        }

        if ($verdict === 'approved' && $row->manager_status !== 'approved') {
            abort(409, 'Manager must approve this advance request before HR / Finance can approve it.');
        }
        if ($row->hr_status !== 'pending') {
            abort(409, 'This advance request has already been actioned by HR / Finance.');
        }

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
                if (in_array($row->recovery_mode, ['emi', 'bimonthly'], true) && (int) $row->recovery_months > 0) {
                    $row->monthly_emi = round($sanctioned / (int) $row->recovery_months, 2);
                }
            }
            $row->save();
        });

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    private array $hrExpenseView = [];

    private function hasHrExpenseView($user): bool
    {
        if (!$user) return false;
        $uid = (int) $user->id;
        if (array_key_exists($uid, $this->hrExpenseView)) return $this->hrExpenseView[$uid];

        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            return $this->hrExpenseView[$uid] = false;
        }

        return $this->hrExpenseView[$uid] = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_view', true)
            ->exists();
    }

    private function mayReadEmployeeAdvances($user, int $targetEmployeeId, ?int $myEmployeeId): bool
    {
        if (!$user) return false;
        if ($user->user_type === 'super_admin') return true;

        $target = Employee::withTrashed()
            ->select('id', 'client_id', 'branch_id')
            ->find($targetEmployeeId);
        if (!$target) return false;
        if ($target->client_id !== null && (int) $target->client_id !== (int) $user->client_id) {
            return false;
        }
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return true;
        }
        if ($user->user_type === 'branch_user') {
            return $target->branch_id === null
                || (int) $target->branch_id === (int) $user->branch_id;
        }
        if (in_array($targetEmployeeId, $this->downstreamEmployeeIds($myEmployeeId), true)) {
            return true;
        }
        if ($this->hasHrExpenseView($user)) {
            return $target->branch_id === null
                || $user->branch_id === null
                || (int) $target->branch_id === (int) $user->branch_id;
        }
        return false;
    }

    private function currentEmployeeId($user): ?int
    {
        if (!$user) return null;
        return $user->employee_id;
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

    private function isHrApprover($user): bool
    {
        if (!$user) return false;
        if ($user->user_type === 'super_admin') return true;
        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            return in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true);
        }
        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_approve', true)
            ->exists();
    }

    private function recomputeReturnComplete(AdvanceRequest $row): void
    {
        $balance  = round((float) $row->settle_balance, 2);
        $approved = round(array_sum(array_map(
            fn ($p) => (($p['status'] ?? 'approved') === 'approved') ? (float) ($p['amount'] ?? 0) : 0.0,
            $row->settle_return_payments ?? []
        )), 2);
        $row->settle_returned_at = ($balance > 0 && $approved >= $balance - 0.005)
            ? ($row->settle_returned_at ?: now())
            : null;
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
        return \App\Support\DocumentNumber::next(
            \App\Models\AdvanceRequest::class,
            'advance_no',
            'ADV',
            $clientId,
            $branchId,
        );
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
        if (!$managerName && $employee && $employee->reporting_manager_user_id) {
            $managerName = $employee->relationLoaded('reportingManagerUser')
                ? $employee->reportingManagerUser?->name
                : \App\Models\User::whereKey($employee->reporting_manager_user_id)->value('name');
        }
        if ($row->manager_status !== 'pending' && $row->manager_acted_by) {
            $actorName = $row->relationLoaded('managerActor')
                ? $row->managerActor?->name
                : \App\Models\User::whereKey($row->manager_acted_by)->value('name');
            if ($actorName) $managerName = $actorName;
        }
        $selfRecovered   = $this->selfRecoveredTotal($row);
        $returnRecovered = $this->recoveryLedgerTotal($row->id, 'return');
        $selfTarget      = (float) ($row->sanctioned_amount ?? $row->amount);
        $selfComplete    = $row->recovery_mode && $row->hr_status === 'approved'
            && $selfTarget > 0 && $selfRecovered + 0.005 >= $selfTarget;
        return [
            'id'                 => $row->id,
            'advance_no'         => $row->advance_no,
            'employee_id'        => $row->employee_id,
            'employee_name'      => $employeeName,
            'employee_code'      => $employee?->emp_code,
            'department_id'      => $employee?->department_id,
            'department_name'    => $employee?->department?->name,
            'manager_id'         => $row->manager_id,
            'reporting_manager_user_id' => $employee?->reporting_manager_user_id,
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
            'recovery_recovered' => $selfRecovered,
            'recovery_complete'  => $selfComplete,
            'settle_return_recovered' => $returnRecovered,
            'reason'             => $row->reason,
            'request_items'      => $row->request_items,
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
            'sanctioned_amount'  => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'   => (float) $row->deduction_amount,
            'deduction_reason'   => $row->deduction_reason,
            'total_paid'         => (float) $row->total_paid,
            'settlement_status'  => $row->settlement_status ?: 'unpaid',
            'settled_at'         => optional($row->settled_at)->toIso8601String(),
            'zoho_sync'          => (function () use ($row) {
                $payments = $row->relationLoaded('payments') ? $row->payments : $row->payments()->get();
                if ($payments->isEmpty()) return 'na';
                $synced = $payments->filter(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced')->count();
                if ($synced === 0) return 'pending';
                return $synced === $payments->count() ? 'completed' : 'partial';
            })(),
            'remaining_amount'   => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
            'employee_settled_at'  => optional($row->employee_settled_at)->toIso8601String(),
            'employee_settle_note' => $row->employee_settle_note,
            'settle_actual_amount' => $row->settle_actual_amount !== null ? (float) $row->settle_actual_amount : null,
            'settle_type'          => $row->settle_type,
            'settle_balance'       => (float) $row->settle_balance,
            'settle_declared_type' => $row->settle_declared_type,
            'settle_target_amount' => $row->settle_target_amount !== null ? (float) $row->settle_target_amount : null,
            'settle_approval_status'  => $row->settle_approval_status,
            'settle_approval_comment' => $row->settle_approval_comment,
            'settle_approved_at'      => optional($row->settle_approved_at)->toIso8601String(),
            'settle_returned_at'         => optional($row->settle_returned_at)->toIso8601String(),
            'settle_return_scheduled_at' => optional($row->settle_return_scheduled_at)->toIso8601String(),
            'settle_reimbursed'          => (bool) $row->settle_reimbursement_claim_id,
            'settle_return_remaining'    => (function () use ($row) {
                $bal  = round((float) $row->settle_balance, 2);
                $paid = round(array_sum(array_map(
                    fn ($p) => (($p['status'] ?? 'approved') !== 'rejected') ? (float) ($p['amount'] ?? 0) : 0.0,
                    $row->settle_return_payments ?? []
                )), 2);
                return max(0, round($bal - $paid, 2));
            })(),
            'settle_return_pending'      => round(array_sum(array_map(
                fn ($p) => (($p['status'] ?? 'approved') === 'pending') ? (float) ($p['amount'] ?? 0) : 0.0,
                $row->settle_return_payments ?? []
            )), 2),
            'settle_items'         => collect($row->settle_items ?? [])->values()->map(fn ($it, $i) => [
                'amount'    => (float) ($it['amount'] ?? 0),
                'reason'    => (string) ($it['reason'] ?? ''),
                'method'    => (string) ($it['method'] ?? ''),
                'proof_name'=> $it['proof_name'] ?? null,
                'proof_url' => !empty($it['proof_path']) ? url("/api/advance-requests/{$row->id}/settle-proof/{$i}") : null,
            ])->all(),
            'payments'             => (function () use ($row) {
                $ps = $row->relationLoaded('payments') ? $row->payments : $row->payments()->with('payer')->get();
                return $ps->map(fn ($p) => [
                    'amount'       => (float) $p->amount,
                    'method'       => $p->method ?? null,
                    'paid_by_name' => $p->payer?->name,
                    'paid_by_role' => $p->payer?->user_type,
                    'paid_at'      => optional($p->paid_at ?? $p->created_at)->toIso8601String(),
                ])->values()->all();
            })(),
        ];
    }

    public function employeeSettle(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

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
        if ($row->employee_settled_at) {
            abort(409, 'This advance is already finalised and locked.');
        }

        $data = $request->validate([
            'items'          => ['nullable', 'array'],
            'items.*.amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            'items.*.reason' => ['required', 'string', 'max:500'],
            'items.*.method' => ['required', 'string', 'max:40'],
            'proofs'         => ['nullable', 'array'],
            'proofs.*'       => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
            'note'           => ['nullable', 'string', 'max:500'],
            'finalize'       => ['nullable', 'boolean'],
            'declared_type'  => ['nullable', 'in:equal,minimum,maximum'],
            'target_amount'  => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
        ]);

        $finalize   = filter_var($request->input('finalize', false), FILTER_VALIDATE_BOOLEAN);
        $sanctioned = (float) ($row->sanctioned_amount ?? $row->amount);

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

        $hasBills = !empty($settleItems);

        if (!$hasBills && !$finalize) {
            return response()->json([
                'status'  => false,
                'message' => 'Add at least one bill before saving.',
                'errors'  => ['items' => ['Add at least one usage row.']],
            ], 422);
        }

        $total      = $hasBills
            ? round(array_sum(array_map(fn ($it) => (float) $it['amount'], $settleItems)), 2)
            : round($target, 2);
        $diff       = round($total - $sanctioned, 2);
        $settleType = abs($diff) < 0.005 ? 'equal' : ($diff < 0 ? 'return' : 'reimburse');
        $balance    = round(abs($diff), 2);

        if ($hasBills && $total > $target + 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Total used ₹' . number_format($total, 2) . ' exceeds the declared amount used ₹' . number_format($target, 2) . '.',
                'errors'  => ['items' => ['Total exceeds the declared amount used.']],
            ], 422);
        }
        if ($finalize && $hasBills && abs($total - $target) > 0.005) {
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
            $row->employee_settled_at     = now();
            $row->settle_approval_status  = 'approved';
            $row->settle_approved_by      = $user->id;
            $row->settle_approved_at      = now();
            $row->settle_approval_comment = null;
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        if (!$finalize) {
            $msg = 'Bills saved — ₹' . number_format($total, 2) . ' itemised so far. Add more or finalise when done.';
        } else {
            $msg = ($settleType === 'equal'
                ? 'Settlement completed — usage matched the advance.'
                : ($settleType === 'return'
                    ? 'Settlement completed — ₹' . number_format($balance, 2) . ' to return.'
                    : 'Settlement completed — raise the expense for the extra ₹' . number_format($balance, 2) . '.'));
        }
        return response()->json([
            'status'  => true,
            'message' => $msg,
            'data'    => $this->serialize($row),
        ]);
    }

    public function settleApprove(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if (!$row->employee_settled_at || ($row->settle_approval_status ?? null) !== 'pending') {
            abort(409, 'This settlement is not awaiting approval.');
        }
        $row->settle_approval_status  = 'approved';
        $row->settle_approved_by      = $user->id;
        $row->settle_approved_at      = now();
        $row->settle_approval_comment = trim((string) $request->input('comment')) ?: null;
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => 'Settlement approved — the employee can now settle the balance.',
            'data'    => $this->serialize($row),
        ]);
    }

    public function settleReject(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if (!$row->employee_settled_at || ($row->settle_approval_status ?? null) !== 'pending') {
            abort(409, 'This settlement is not awaiting approval.');
        }
        $data = $request->validate([
            'comment' => ['required', 'string', 'max:500'],
        ], ['comment.required' => 'Add a short reason so the employee can fix the settlement.']);

        $row->settle_approval_status  = 'rejected';
        $row->settle_approval_comment = trim($data['comment']);
        $row->settle_approved_by      = $user->id;
        $row->settle_approved_at      = now();
        $row->employee_settled_at     = null;
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => 'Settlement rejected — reopened for the employee to re-settle.',
            'data'    => $this->serialize($row),
        ]);
    }

    public function settleProof(Request $request, $id, $index)
    {
        return $this->streamJsonAttachment(
            $request, $id,
            'settle_items', $index,
            'proof_path', 'proof_name',
            'No settlement proof was attached for this row.',
            'Settlement proof file is missing on the server.',
        );
    }

    public function raiseReimbursement(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->employee_id !== $myEmployeeId) {
            $this->guardHrPermission($user, 'can_approve');
        }
        if (!$row->employee_settled_at || $row->settle_type !== 'reimburse') {
            abort(409, 'A reimbursement can only be raised for a finalised, over-spent (reimburse) advance.');
        }
        if (($row->settle_approval_status ?? null) !== 'approved') {
            abort(409, 'The settlement must be approved by a branch admin / HR before a reimbursement can be raised.');
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

        $managerStatus  = 'pending';
        $managerActedAt = null;
        $managerComment = null;

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

    private function nextExpenseClaimNo(?int $clientId, ?int $branchId): string
    {
        return \App\Support\DocumentNumber::next(
            \App\Models\ExpenseClaim::class,
            'claim_no',
            'EXP',
            $clientId,
            $branchId,
        );
    }

    public function recordReturn(Request $request, $id)
    {
        $user = $request->user();

        $data = $request->validate([
            'mode'   => ['required', 'in:direct,payroll'],
            'amount' => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            'method' => ['nullable', 'string', 'max:40'],
            'proof'  => ['nullable', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
            'note'   => ['nullable', 'string', 'max:500'],
        ]);
        $rec = null;
        if ($data['mode'] === 'payroll') {
            $nextMonth = now()->addMonthNoOverflow()->startOfMonth()->toDateString();
            $rec = $request->validate([
                'recovery_start' => ['required', 'date', 'after_or_equal:' . $nextMonth],
                'recovery_type'  => ['required', 'in:emi,lumpsum,bimonthly'],
                'monthly'        => ['nullable', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            ], [
                'recovery_start.after_or_equal' => 'Recovery must start next month or later (this month’s payroll may be done).',
            ]);
        }

        return DB::transaction(function () use ($request, $id, $user, $data, $rec) {
        $row = AdvanceRequest::whereKey($id)->lockForUpdate()->firstOrFail();
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $row->employee_id !== $myEmployeeId) {
            $this->guardHrPermission($user, 'can_approve');
        }
        if (!$row->employee_settled_at || $row->settle_type !== 'return') {
            abort(409, 'A return can only be recorded for a finalised, under-spent (return) advance.');
        }
        if (($row->settle_approval_status ?? null) !== 'approved') {
            abort(409, 'The settlement must be approved by a branch admin / HR before the balance can be returned.');
        }
        $balance = round((float) $row->settle_balance, 2);
        if ($balance <= 0) {
            abort(409, 'There is nothing to return.');
        }
        if ($row->settle_returned_at) {
            abort(409, 'The return has already been fully recorded.');
        }

        $ledger    = array_values($row->settle_return_payments ?? []);
        $paidSoFar = round(array_sum(array_map(
            fn ($p) => (($p['status'] ?? 'approved') !== 'rejected') ? (float) ($p['amount'] ?? 0) : 0.0,
            $ledger
        )), 2);
        $remaining = round($balance - $paidSoFar, 2);
        if ($remaining <= 0) {
            abort(409, 'The return has already been fully recorded.');
        }
        if ($row->settle_return_scheduled_at) {
            abort(409, 'Payroll recovery is already scheduled — no further payments can be added.');
        }

        if ($data['mode'] === 'payroll') {
            $recType = $rec['recovery_type'];
            if ($recType === 'lumpsum') {
                $monthly = $remaining;
                $months  = 1;
            } else {
                $monthly = round((float) ($rec['monthly'] ?? 0), 2);
                if ($monthly <= 0) {
                    return response()->json(['message' => 'Enter a monthly deduction amount.', 'errors' => ['monthly' => ['A monthly amount is required.']]], 422);
                }
                if ($monthly > $remaining + 0.005) {
                    return response()->json([
                        'message' => 'The monthly deduction ₹' . number_format($monthly, 2)
                            . ' cannot exceed the balance ₹' . number_format($remaining, 2) . '.',
                        'errors'  => ['monthly' => ['It can equal the balance, but not more.']],
                    ], 422);
                }
                $months = (int) max(1, ceil($remaining / $monthly));
                if ($months > 120) {
                    $unit = $recType === 'bimonthly' ? 'cycles' : 'months';
                    $minMonthly = ceil($remaining / 120);
                    return response()->json([
                        'message' => 'This return would take ' . $months . ' ' . $unit . ' — over the 120 limit. Increase the monthly amount (at least ₹' . number_format($minMonthly, 2) . ') or return it directly.',
                        'errors'  => ['monthly' => ['Increase the monthly amount — recovery can’t exceed 120 ' . $unit . ' (min ₹' . number_format($minMonthly, 2) . ').']],
                    ], 422);
                }
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

        $autoOk = ($data['mode'] === 'payroll') || $this->isHrApprover($user);
        $ledger[] = [
            'amount'      => $amount,
            'method'      => $method,
            'mode'        => $data['mode'],
            'note'        => $data['note'] ?? null,
            'proof_path'  => $path,
            'proof_name'  => $name,
            'paid_at'     => now()->toIso8601String(),
            'status'      => $autoOk ? 'approved' : 'pending',
            'recorded_by' => $user?->id,
            'approved_at' => $autoOk ? now()->toIso8601String() : null,
            'approved_by' => $autoOk ? $user?->id : null,
        ];
        $row->settle_return_payments = $ledger;
        $newPaid = round($paidSoFar + $amount, 2);
        $this->recomputeReturnComplete($row);
        if ($request->filled('note')) {
            $row->employee_settle_note = trim(($row->employee_settle_note ? $row->employee_settle_note . "\n" : '') . $data['note']);
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        $left = round($balance - $newPaid, 2);
        if ($data['mode'] === 'payroll') {
            $msg = 'Payroll recovery scheduled for ₹' . number_format($amount, 2) . '.';
        } elseif (!$autoOk) {
            $msg = 'Return of ₹' . number_format($amount, 2) . ' recorded — pending branch admin / HR approval.';
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
        });
    }

    public function approveReturnPayment(Request $request, $id, $index)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');

        return DB::transaction(function () use ($request, $id, $index, $user) {
            $row = AdvanceRequest::whereKey($id)->lockForUpdate()->firstOrFail();
            $this->ensureTenantAccess($row, $user);

            $ledger = array_values($row->settle_return_payments ?? []);
            $i = (int) $index;
            if (!isset($ledger[$i])) abort(404, 'Return payment not found.');
            if (($ledger[$i]['mode'] ?? 'direct') === 'payroll') {
                abort(422, 'Payroll deductions are confirmed automatically — nothing to approve.');
            }
            if (($ledger[$i]['status'] ?? null) === 'approved') {
                abort(409, 'This payment has already been approved.');
            }
            $ledger[$i]['status']      = 'approved';
            $ledger[$i]['approved_at'] = now()->toIso8601String();
            $ledger[$i]['approved_by'] = $user?->id;
            unset($ledger[$i]['rejected_at'], $ledger[$i]['rejected_by'], $ledger[$i]['rejected_reason']);
            $row->settle_return_payments = $ledger;
            $this->recomputeReturnComplete($row);
            $row->save();

            $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
            return response()->json([
                'status'  => true,
                'message' => $row->settle_returned_at
                    ? 'Payment approved — return now complete.'
                    : 'Payment approved.',
                'data'    => $this->serialize($row),
            ]);
        });
    }

    public function rejectReturnPayment(Request $request, $id, $index)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return DB::transaction(function () use ($id, $index, $user, $data) {
            $row = AdvanceRequest::whereKey($id)->lockForUpdate()->firstOrFail();
            $this->ensureTenantAccess($row, $user);

            $ledger = array_values($row->settle_return_payments ?? []);
            $i = (int) $index;
            if (!isset($ledger[$i])) abort(404, 'Return payment not found.');
            if (($ledger[$i]['mode'] ?? 'direct') === 'payroll') {
                abort(422, 'Payroll deductions cannot be rejected here.');
            }
            if (($ledger[$i]['status'] ?? null) === 'rejected') {
                abort(409, 'This payment has already been rejected.');
            }
            $ledger[$i]['status']          = 'rejected';
            $ledger[$i]['rejected_at']     = now()->toIso8601String();
            $ledger[$i]['rejected_by']     = $user?->id;
            $ledger[$i]['rejected_reason'] = $data['reason'] ?? null;
            unset($ledger[$i]['approved_at'], $ledger[$i]['approved_by']);
            $row->settle_return_payments = $ledger;
            $this->recomputeReturnComplete($row);
            $row->save();

            $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
            return response()->json([
                'status'  => true,
                'message' => 'Payment rejected — the employee can record it again.',
                'data'    => $this->serialize($row),
            ]);
        });
    }

    public function returnProof(Request $request, $id, $index)
    {
        return $this->streamJsonAttachment(
            $request, $id,
            'settle_return_payments', $index,
            'proof_path', 'proof_name',
            'No return proof was attached for this payment.',
            'Return proof file is missing on the server.',
        );
    }

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
            'recovery_start'    => optional($row->recovery_start)->format('Y-m-d'),
            'recovery_mode'     => $row->recovery_mode,
            'recovery_months'   => $row->recovery_months,
            'monthly_emi'       => $row->monthly_emi !== null ? (float) $row->monthly_emi : null,
            'recovery_ledger'   => $this->recoveryLedgerRows($row->id, 'self'),
            'recovery_recovered'=> $this->selfRecoveredTotal($row),
            'recovery_direct_payments' => collect($row->recovery_direct_payments ?? [])->values()->map(fn ($p, $i) => [
                'amount'    => (float) ($p['amount'] ?? 0),
                'method'    => (string) ($p['method'] ?? ''),
                'reference' => $p['reference'] ?? null,
                'note'      => $p['note'] ?? null,
                'proof_name'=> $p['proof_name'] ?? null,
                'proof_url' => !empty($p['proof_path']) ? url("/api/advance-requests/{$row->id}/recovery-payment-proof/{$i}") : null,
                'paid_by_name' => null,
                'paid_at'   => $p['paid_at'] ?? null,
            ])->all(),
            'recovery_remaining' => $row->recovery_mode && (float) $row->amount > 0
                ? round(max(0, (float) ($row->sanctioned_amount ?? $row->amount) - $this->selfRecoveredTotal($row)), 2)
                : 0.0,
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
            'request_items'     => collect($row->request_items ?? [])->values()->map(function ($it, $i) use ($row) {
                return [
                    'amount'       => (float) ($it['amount'] ?? 0),
                    'purpose'      => $it['purpose'] ?? '',
                    'payment_type' => $it['payment_type'] ?? '',
                    'proof_name'   => $it['proof_name'] ?? null,
                    'proof_url'    => ($it['proof_path'] ?? null)
                        ? url("/api/advance-requests/{$row->id}/attachments/{$i}")
                        : null,
                ];
            })->all(),
            'payments'          => $row->payments->map(fn ($p) => [
                'id'           => $p->id,
                'amount'       => (float) $p->amount,
                'category_name'=> null,
                'payment_type' => $p->payment_type,
                'reference_number' => $p->reference_number,
                'expense_type' => null,
                'note'         => $p->note,
                'proof_name'   => $p->proof_name,
                'proof_url'    => $p->proof_path ? url("/api/advance-requests/payments/{$p->id}/proof") : null,
                'zoho_status'  => $p->zoho_status ?: 'not_synced',
                'zoho_synced_at' => optional($p->zoho_synced_at)->toIso8601String(),
                'zoho_expense_url' => $p->zoho_expense_id ? $this->zohoExpenseUrl((string) $p->zoho_expense_id) : null,
                'paid_by_name' => $p->payer?->name,
                'paid_by_role' => $p->payer?->user_type,
                'paid_at'      => optional($p->paid_at)->toIso8601String(),
            ])->all(),
            'employee_id'          => $row->employee_id,
            'used_for'             => $row->used_for ?: 'self',
            'employee_settled_at'  => optional($row->employee_settled_at)->toIso8601String(),
            'employee_settle_note' => $row->employee_settle_note,
            'settle_approval_status'  => $row->settle_approval_status,
            'settle_approval_comment' => $row->settle_approval_comment,
            'settle_approved_at'      => optional($row->settle_approved_at)->toIso8601String(),
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
                'index'     => $i,
                'amount'    => (float) ($p['amount'] ?? 0),
                'method'    => (string) ($p['method'] ?? ''),
                'mode'      => (string) ($p['mode'] ?? 'direct'),
                'note'      => $p['note'] ?? null,
                'paid_at'   => $p['paid_at'] ?? null,
                'status'    => (string) ($p['status'] ?? 'approved'),
                'rejected_reason' => $p['rejected_reason'] ?? null,
                'proof_name'=> $p['proof_name'] ?? null,
                'proof_url' => !empty($p['proof_path']) ? url("/api/advance-requests/{$row->id}/return-proof/{$i}") : null,
            ])->all(),
            'settle_return_remaining' => (function () use ($row) {
                $bal  = round((float) $row->settle_balance, 2);
                $paid = round(array_sum(array_map(
                    fn ($p) => (($p['status'] ?? 'approved') !== 'rejected') ? (float) ($p['amount'] ?? 0) : 0.0,
                    $row->settle_return_payments ?? []
                )), 2);
                return max(0, round($bal - $paid, 2));
            })(),
            'settle_return_approved' => round(array_sum(array_map(
                fn ($p) => (($p['status'] ?? 'approved') === 'approved') ? (float) ($p['amount'] ?? 0) : 0.0,
                $row->settle_return_payments ?? []
            )), 2),
            'settle_return_pending' => round(array_sum(array_map(
                fn ($p) => (($p['status'] ?? 'approved') === 'pending') ? (float) ($p['amount'] ?? 0) : 0.0,
                $row->settle_return_payments ?? []
            )), 2),
            'settle_return_scheduled_at'    => optional($row->settle_return_scheduled_at)->toIso8601String(),
            'settle_return_recovery_start'  => optional($row->settle_return_recovery_start)->format('Y-m-d'),
            'settle_return_recovery_mode'   => $row->settle_return_recovery_mode,
            'settle_return_recovery_months' => $row->settle_return_recovery_months,
            'settle_return_monthly'         => $row->settle_return_monthly !== null ? (float) $row->settle_return_monthly : null,
            'settle_return_ledger'          => $this->recoveryLedgerRows($row->id, 'return'),
            'settle_return_recovered'       => $this->recoveryLedgerTotal($row->id, 'return'),
            'employee_monthly_salary'       => $this->employeeMonthlySalary($row->employee_id),
            'emi_ongoing'   => $this->ongoingEmiTotal($row->employee_id, $row->id),
            'emi_available' => (function () use ($row) {
                $net = $this->employeeMonthlySalary($row->employee_id);
                if ($net === null) return null;
                return max(0, round($net * self::EMI_HEADROOM_PCT - $this->ongoingEmiTotal($row->employee_id, $row->id), 2));
            })(),
        ]);
    }

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

    private const EMI_HEADROOM_PCT = 0.70;

    private array $ledgerCache = [];
    private array $ledgerLoaded = [];
    private ?bool $ledgerTableExists = null;

    private function ledgerTableExists(): bool
    {
        if ($this->ledgerTableExists === null) {
            $this->ledgerTableExists = \Illuminate\Support\Facades\Schema::hasTable('advance_recovery_ledger');
        }
        return $this->ledgerTableExists;
    }

    private function primeLedger(array $advanceIds): void
    {
        $ids = array_values(array_diff(
            array_unique(array_filter(array_map('intval', $advanceIds))),
            array_keys($this->ledgerLoaded)
        ));
        if (!$ids) return;
        foreach ($ids as $id) $this->ledgerLoaded[$id] = true;
        if (!$this->ledgerTableExists()) return;

        foreach (
            DB::table('advance_recovery_ledger')
                ->whereIn('advance_request_id', $ids)
                ->orderBy('year')->orderBy('month')
                ->get(['advance_request_id', 'stream', 'year', 'month', 'amount', 'carried'])
            as $r
        ) {
            $this->ledgerCache[$r->advance_request_id . '|' . $r->stream][] = [
                'year'    => (int) $r->year,
                'month'   => (int) $r->month,
                'amount'  => (float) $r->amount,
                'carried' => (float) $r->carried,
            ];
        }
    }

    private function recoveryLedgerRows($advanceId, string $stream): array
    {
        $id = (int) $advanceId;
        if (!isset($this->ledgerLoaded[$id])) $this->primeLedger([$id]);
        return $this->ledgerCache[$id . '|' . $stream] ?? [];
    }

    private function recoveryLedgerTotal($advanceId, string $stream): float
    {
        return round(array_sum(array_column(
            $this->recoveryLedgerRows($advanceId, $stream), 'amount'
        )), 2);
    }

    private function selfDirectRepaid(AdvanceRequest $row): float
    {
        return round(array_sum(array_map(
            fn ($p) => (float) ($p['amount'] ?? 0),
            $row->recovery_direct_payments ?? []
        )), 2);
    }

    private function selfRecoveredTotal(AdvanceRequest $row): float
    {
        return round($this->recoveryLedgerTotal($row->id, 'self') + $this->selfDirectRepaid($row), 2);
    }

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

    public function settle(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');
        $myEmp = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $myEmp !== null && (int) $row->employee_id === (int) $myEmp) {
            abort(403, 'You cannot record a payout for your own advance — your reporting manager (branch user) will do it.');
        }

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
            'reference_number'    => ['nullable', 'string', 'max:64'],
            'note'                => ['required', 'string', 'max:500'],
            'proof'               => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
        ], [
            'proof.max'      => 'The proof must be 2 MB or smaller.',
            'proof.uploaded' => 'The proof must be 2 MB or smaller.',
            'proof.mimes'    => 'Proof must be a PDF, image or document file.',
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
                'reference_number'   => $data['reference_number'] ?? null,
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

    public function paymentProof(Request $request, $paymentId)
    {
        $this->authenticateFromQueryToken($request);
        $payment = \App\Models\AdvanceRequestPayment::findOrFail($paymentId);
        $row     = AdvanceRequest::findOrFail($payment->advance_request_id);
        $this->ensureTenantAccess($row, $request->user());

        if (empty($payment->proof_path)) {
            abort(404, 'No proof of payment was attached to this settlement.');
        }
        return $this->streamStoredFile(
            $payment->proof_path,
            $payment->proof_name,
            'Proof file is missing on the server.',
        );
    }

    public function recoverOnetime(Request $request, $id)
    {
        $user = $request->user();
        $row  = AdvanceRequest::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && (int) $row->employee_id !== (int) $myEmployeeId) {
            $this->guardHrPermission($user, 'can_approve');
        }

        if (($row->used_for ?: 'self') === 'company') {
            abort(409, 'One-time recovery applies to self advances only — a company advance is reconciled through its settlement.');
        }
        if ($row->status !== 'approved' || ($row->settlement_status ?? 'unpaid') !== 'paid') {
            abort(409, 'Recovery can only be settled once the advance has been fully paid out.');
        }
        if (!$row->recovery_mode) {
            abort(409, 'This advance has no salary recovery to settle.');
        }

        $target    = round((float) ($row->sanctioned_amount ?? $row->amount), 2);
        $remaining = round(max(0, $target - $this->selfRecoveredTotal($row)), 2);
        if ($remaining <= 0.005) {
            abort(409, 'This advance is already fully recovered.');
        }

        $data = $request->validate([
            'amount'    => ['required', 'numeric', 'min:0.01', 'max:9999999999999.99'],
            'method'    => ['required', 'string', 'max:40'],
            'reference' => ['nullable', 'string', 'max:64'],
            'note'      => ['nullable', 'string', 'max:500'],
            'proof'     => ['nullable', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx'],
        ], [
            'proof.max'   => 'The proof must be 2 MB or smaller.',
            'proof.mimes' => 'Proof must be a PDF, image or document file.',
        ]);

        $amount = round((float) $data['amount'], 2);
        if ($amount > $remaining + 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Amount ₹' . number_format($amount, 2) . ' exceeds the remaining ₹' . number_format($remaining, 2) . '.',
                'errors'  => ['amount' => ['Cannot exceed the remaining ₹' . number_format($remaining, 2) . '.']],
            ], 422);
        }

        $path = $name = null;
        if ($request->hasFile('proof')) {
            $f    = $request->file('proof');
            $path = $f->store('advance_recovery_direct/' . $row->id, 'public');
            $name = $f->getClientOriginalName();
        }

        $ledger   = array_values($row->recovery_direct_payments ?? []);
        $ledger[] = [
            'amount'     => $amount,
            'method'     => $data['method'],
            'reference'  => $data['reference'] ?? null,
            'note'       => $data['note'] ?? null,
            'proof_path' => $path,
            'proof_name' => $name,
            'paid_by'    => $user->id,
            'paid_at'    => now()->toIso8601String(),
        ];
        $row->recovery_direct_payments = $ledger;
        $row->save();

        $row->load(['employee.department', 'manager', 'creator', 'hrUser']);
        $left = round(max(0, $target - $this->selfRecoveredTotal($row)), 2);
        return response()->json([
            'status'  => true,
            'message' => $left <= 0.005
                ? 'Recovery settled — ₹' . number_format($amount, 2) . ' paid; the advance is fully recovered.'
                : 'Recovery payment recorded — ₹' . number_format($amount, 2) . ' paid, ₹' . number_format($left, 2) . ' remaining.',
            'data'    => $this->serialize($row),
        ]);
    }

    public function recoveryPaymentProof(Request $request, $id, $index)
    {
        return $this->streamJsonAttachment(
            $request, $id,
            'recovery_direct_payments', $index,
            'proof_path', 'proof_name',
            'No proof was attached to this recovery payment.',
            'Proof file is missing on the server.',
        );
    }

    private function zohoExpenseUrl(string $expenseId): string
    {
        $cfg    = config('services.zoho_books');
        $org    = (string) ($cfg['organization_id'] ?? '');
        $region = 'in';
        if (preg_match('#zohoapis\.([a-z.]+)#i', (string) ($cfg['base_url'] ?? ''), $m)) {
            $region = $m[1];
        }
        return "https://books.zoho.{$region}/app/{$org}#/expenses/" . rawurlencode($expenseId);
    }

    public function syncPaymentToZoho(Request $request, $paymentId)
    {
        $user    = $request->user();
        $payment = \App\Models\AdvanceRequestPayment::findOrFail($paymentId);
        $row     = AdvanceRequest::findOrFail($payment->advance_request_id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if (($payment->zoho_status ?? 'not_synced') === 'synced' || !empty($payment->zoho_expense_id)) {
            return response()->json([
                'status'   => true,
                'message'  => 'This payout is already synced to Zoho Books.',
                'zoho_url' => $payment->zoho_expense_id ? $this->zohoExpenseUrl((string) $payment->zoho_expense_id) : null,
            ]);
        }

        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not configured on the server.'], 503);
        }

        $advanceType = $row->advance_type === 'Other' && $row->advance_type_other
            ? $row->advance_type_other
            : ($row->advance_type ?: 'Employee Advance');
        $title = ($row->advance_no ?: ('ADV-' . $row->id)) . ' - ' . $advanceType;

        $expenseId = null;
        try {
            $payload = [
                'account_id'              => $zoho->resolveExpenseAccountId($advanceType),
                'paid_through_account_id' => $zoho->findOrCreatePaidThroughAccountId($payment->payment_type ?: 'Bank'),
                'date'                    => optional($payment->paid_at)->format('Y-m-d') ?: now()->format('Y-m-d'),
                'amount'                  => (float) $payment->amount,
                'reference_number'        => $title,
                'description'             => (string) ($payment->note ?? ''),
                'product_type'            => 'goods',
            ];
            $state = $zoho->orgStateCode();
            if ($state) {
                $payload['source_of_supply']      = $state;
                $payload['destination_of_supply'] = $state;
            }

            $expense   = $zoho->createExpense($payload);
            $expenseId = (string) ($expense['expense_id'] ?? '');

            if ($expenseId !== '') {
                $disk = \Illuminate\Support\Facades\Storage::disk('public');

                $receiptFiles = [];
                if (!empty($payment->proof_path)) {
                    $receiptFiles[] = ['path' => $payment->proof_path, 'name' => $payment->proof_name ?: basename($payment->proof_path)];
                }
                foreach (($row->request_items ?? []) as $it) {
                    if (empty($it['proof_path'])) continue;
                    $receiptFiles[] = ['path' => $it['proof_path'], 'name' => ($it['proof_name'] ?? null) ?: basename($it['proof_path'])];
                }
                foreach (($row->attachments ?? []) as $att) {
                    $p = is_array($att) ? ($att['path'] ?? null) : null;
                    if (empty($p)) continue;
                    $receiptFiles[] = ['path' => $p, 'name' => (is_array($att) ? ($att['name'] ?? null) : null) ?: basename($p)];
                }
                $seen = [];
                $receiptFiles = array_values(array_filter($receiptFiles, function ($f) use (&$seen) {
                    if (isset($seen[$f['path']])) return false;
                    $seen[$f['path']] = true;
                    return true;
                }));

                foreach (array_slice($receiptFiles, 0, 5) as $rf) {
                    if (!$disk->exists($rf['path'])) continue;
                    try {
                        $zoho->attachExpenseReceipt($expenseId, $disk->get($rf['path']), $rf['name']);
                    } catch (\Throwable $e) {
                        \Illuminate\Support\Facades\Log::warning('Zoho advance receipt attach failed', [
                            'payment' => $payment->id,
                            'file'    => $rf['path'],
                            'error'   => $e->getMessage(),
                        ]);
                    }
                }
            }
        } catch (\Throwable $e) {
            if ($expenseId) { try { $zoho->deleteExpense($expenseId); } catch (\Throwable $ignore) {} }
            return response()->json(['status' => false, 'message' => 'Zoho Books sync failed: ' . $e->getMessage()], 422);
        }

        $payment->zoho_status     = 'synced';
        $payment->zoho_synced_at  = now();
        $payment->zoho_expense_id = $expenseId;
        $payment->save();

        return response()->json([
            'status'   => true,
            'message'  => 'Advance payout synced to Zoho Books.',
            'zoho_url' => $expenseId ? $this->zohoExpenseUrl($expenseId) : null,
        ]);
    }

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
