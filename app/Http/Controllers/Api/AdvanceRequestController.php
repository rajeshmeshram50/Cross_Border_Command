<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvanceRequest;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission; 
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

        // Requested date is when the advance is needed — today up to one year
        // ahead (mirrors the client bound). Past dates and anything beyond a
        // year from today are rejected.
        $maxRequested = now()->addYear()->toDateString();

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
            'requested_date'      => ['required', 'date', 'after_or_equal:today', 'before_or_equal:' . $maxRequested],
            'recovery_start'      => ['required', 'date', 'after_or_equal:requested_date'],
            'recovery_mode'       => ['required', 'string', 'in:' . implode(',', self::RECOVERY_MODES)],
            // Months + monthly EMI only required when mode='emi'. The
            // validator below promotes them to required-when conditionally.
            'recovery_months'     => ['nullable', 'integer', 'min:1', 'max:120'],
            'monthly_emi'         => ['nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            'reason'              => ['required', 'string', 'max:2000'],
            // Supporting documents are optional for advances, but when present
            // must be PDF/JPG/PNG up to 5 MB each (mirrors the client picker).
            'files'               => ['nullable', 'array'],
            'files.*'             => ['file', 'max:5120', 'mimes:pdf,jpg,jpeg,png'],
        ], [
            'requested_date.after_or_equal'  => 'Requested date cannot be in the past.',
            'requested_date.before_or_equal' => 'Requested date cannot be more than one year from today.',
        ]);

        if ($data['recovery_mode'] === 'emi' && empty($data['recovery_months'])) {
            abort(422, 'Number of months is required when recovery mode is EMI.');
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

        $row = DB::transaction(function () use ($employee, $data, $attachments, $managerStatus, $managerActedAt, $managerComment, $user) {
            return AdvanceRequest::create([
                'client_id'         => $employee->client_id,
                'branch_id'         => $employee->branch_id,
                'advance_no'        => $this->nextAdvanceNo($employee->client_id, $employee->branch_id),
                'employee_id'       => $employee->id,
                'manager_id'        => $employee->reporting_manager_id,
                'advance_type'      => $data['advance_type'],
                'advance_type_other'=> $data['advance_type'] === 'Other' ? ($data['advance_type_other'] ?? null) : null,
                'amount'            => $data['amount'],
                'requested_date'    => $data['requested_date'],
                'recovery_start'    => $data['recovery_start'],
                'recovery_mode'     => $data['recovery_mode'],
                'recovery_months'   => $data['recovery_mode'] === 'emi' ? ($data['recovery_months'] ?? null) : null,
                'monthly_emi'       => $data['recovery_mode'] === 'emi' ? ($data['monthly_emi']     ?? null) : null,
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

        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $row->hr_status   = $verdict;
        $row->hr_user_id  = $user->id;
        $row->hr_acted_at = now();
        $row->hr_comment  = $data['comment'] ?? null;
        $row->status      = $verdict;
        $row->save();

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
            'requested_date'     => optional($row->requested_date)->format('Y-m-d'),
            'recovery_start'     => optional($row->recovery_start)->format('Y-m-d'),
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
        ];
    }
    
}
