<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Two-stage approval workflow controller for employee expense claims.
 *
 * Endpoints (registered in routes/api.php under auth:sanctum):
 *   GET    /api/expense-claims?scope=mine|team|all  — list (role-scoped)
 *   POST   /api/expense-claims                      — create (employee submits)
 *   GET    /api/expense-claims/{id}                 — show (with audit fields)
 *   POST   /api/expense-claims/{id}/manager-approve — manager approves
 *   POST   /api/expense-claims/{id}/manager-reject  — manager rejects
 *   POST   /api/expense-claims/{id}/hr-approve      — HR/Finance approves
 *   POST   /api/expense-claims/{id}/hr-reject       — HR/Finance rejects
 *
 * Scoping rules per scope:
 *   mine — claims where employee_id = current user's Employee.id
 *   team — claims where manager_id   = current user's Employee.id
 *   all  — every claim under tenant scope (admin / HR view)
 *
 * The overall `status` is rolled up from the two stage statuses so list
 * filters stay simple (pending / approved / rejected).
 */
class ExpenseClaimController extends Controller
{
    private const STATUSES = ['pending', 'approved', 'rejected'];

    /* ============================================================ */
    /*  LIST                                                        */
    /* ============================================================ */

    public function index(Request $request)
    {
        $user = $request->user();
        $scope = $request->query('scope', 'mine');
        if (!in_array($scope, ['mine', 'team', 'all'], true)) {
            $scope = 'mine';
        }

        // Frontend sometimes sends the EMP- code in the employee_id query
        // (because that's what's in the URL). Resolve to a numeric id up
        // front so downstream filters work uniformly.
        $employeeIdFilter = $this->resolveEmployeeId(
            $request->query('employee_id'),
            $request->query('employee_code')
        );

        $q = ExpenseClaim::query()
            ->with([
                'employee:id,first_name,middle_name,last_name,display_name,emp_code,reporting_manager_id',
                'manager:id,first_name,middle_name,last_name,display_name,emp_code',
                'category:id,name,code',
                'creator:id,name,user_type',
                'hrUser:id,name,user_type',
            ])
            ->orderByDesc('id');

        // Tenant gate (mirrors MasterController::applyScope rules).
        $this->applyTenantScope($q, $user);

        if ($scope === 'mine') {
            // EmployeeProfile passes the profile owner's id explicitly so HR /
            // super-admin viewing someone else's profile sees that employee's
            // claims. When no override is supplied, fall back to the current
            // user's own Employee.id.
            $targetEmployeeId = $employeeIdFilter ?: $this->currentEmployeeId($user);
            $q->where('employee_id', $targetEmployeeId ?? -1);
        } elseif ($scope === 'team') {
            $myEmployeeId = $this->currentEmployeeId($user);
            $q->where('manager_id', $myEmployeeId ?? -1);
        } else {
            // scope=all — for HR/admin views. No additional filter beyond
            // tenant scope. Frontend gates the menu by permission.
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

    /* ============================================================ */
    /*  STORE                                                       */
    /* ============================================================ */

    public function store(Request $request)
    {
        $user = $request->user();
        // Resolve the target employee from one of three inputs (in order):
        //   1. numeric `employee_id` from the request
        //   2. string `employee_code` (EMP-001 style — what the SPA URL carries)
        //   3. the current user's linked Employee row
        $employeeId = $this->resolveEmployeeId(
            $request->input('employee_id'),
            $request->input('employee_code')
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
            abort(403, 'You can only file claims for your own employee record.');
        }

        $data = $request->validate([
            'category_id'    => ['nullable', 'integer'],
            'currency'       => ['nullable', 'string', 'max:8'],
            'project'        => ['nullable', 'string', 'max:64'],
            'payment_method' => ['nullable', 'string', 'max:64'],
            'title'          => ['required', 'string', 'max:255'],
            'amount'         => ['required', 'numeric', 'min:0'],
            'expense_date'   => ['required', 'date'],
            'vendor'         => ['nullable', 'string', 'max:255'],
            'purpose'        => ['nullable', 'string'],
        ]);

        // File attachments — accepted as multipart `files[]`. Each file is
        // stored on the public disk; the saved row carries an array of
        // {name, size, path, url} entries so the frontend can list them.
        // Files are stored with name/size/path only — the public URL is
        // built per-request at serialize() time so it always points at the
        // Laravel route (which streams the file with query-token auth).
        $attachments = [];
        if ($request->hasFile('files')) {
            $files = $request->file('files');
            $files = is_array($files) ? $files : [$files];
            foreach ($files as $f) {
                if (!$f) continue;
                $name = $f->getClientOriginalName();
                $size = $f->getSize();
                $path = $f->store('expense_claims/' . $employeeId, 'public');
                $attachments[] = [
                    'name' => $name,
                    'size' => $size,
                    'path' => $path,
                ];
            }
        }

        $categoryName = null;
        if (!empty($data['category_id'])) {
            $cat = \App\Models\Masters\ExpenseCategories::find($data['category_id']);
            $categoryName = $cat?->name;
        }

        $row = ExpenseClaim::create([
            'client_id'      => $employee->client_id,
            'branch_id'      => $employee->branch_id,
            'claim_no'       => $this->nextClaimNo($employee->client_id, $employee->branch_id),
            'employee_id'    => $employee->id,
            'manager_id'     => $employee->reporting_manager_id,
            'category_id'    => $data['category_id'] ?? null,
            'category_name'  => $categoryName,
            'currency'       => $data['currency'] ?? 'INR',
            'project'        => $data['project'] ?? null,
            'payment_method' => $data['payment_method'] ?? null,
            'title'          => $data['title'],
            'amount'         => $data['amount'],
            'expense_date'   => $data['expense_date'],
            'vendor'         => $data['vendor'] ?? null,
            'purpose'        => $data['purpose'] ?? null,
            'attachments'    => $attachments ?: null,
            'status'         => 'pending',
            'manager_status' => 'pending',
            'hr_status'      => 'pending',
            'created_by'     => $user->id,
        ]);

        $row->load(['employee', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row), 201);
    }

    /* ============================================================ */
    /*  SHOW                                                        */
    /* ============================================================ */

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $row = ExpenseClaim::with(['employee', 'manager', 'category', 'creator', 'hrUser'])
            ->findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        return response()->json($this->serialize($row));
    }

    /**
     * Stream one attachment for the given claim by its index in the
     * attachments array. Auth via query token (?token=<sanctum>) so plain
     * <a target="_blank"> clicks work — same pattern as CandidateController::downloadCv,
     * which sidesteps the storage symlink + Apache DocumentRoot mismatch
     * that causes /storage/... to 404 in some local setups.
     */
    public function downloadAttachment(Request $request, $id, $index)
    {
        $this->authenticateFromQueryToken($request);

        $row = ExpenseClaim::findOrFail($id);
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

    /**
     * Resolve the request user from `?token=<sanctum>` so direct browser
     * link-clicks work without sending an Authorization header. Mirrors
     * CandidateController::authenticateFromQueryToken.
     */
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

    /* ============================================================ */
    /*  MANAGER ACTIONS                                             */
    /* ============================================================ */

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
        $row = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        // Only the assigned manager (or super_admin) may act.
        if ($user->user_type !== 'super_admin' && $row->manager_id !== $myEmployeeId) {
            abort(403, 'You are not the assigned reporting manager for this claim.');
        }
        if ($row->manager_status !== 'pending') {
            abort(409, 'This claim has already been actioned by the manager.');
        }

        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $row->manager_status   = $verdict;
        $row->manager_acted_at = now();
        $row->manager_comment  = $data['comment'] ?? null;
        // Rejection at the manager stage closes the claim.
        if ($verdict === 'rejected') {
            $row->status = 'rejected';
        }
        $row->save();

        $row->load(['employee', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    /* ============================================================ */
    /*  HR / FINANCE ACTIONS                                        */
    /* ============================================================ */

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
        $row = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($verdict === 'approved' && $row->manager_status !== 'approved') {
            abort(409, 'Manager must approve this claim before HR / Finance can approve it.');
        }
        if ($row->hr_status !== 'pending') {
            abort(409, 'This claim has already been actioned by HR / Finance.');
        }

        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $row->hr_status   = $verdict;
        $row->hr_user_id  = $user->id;
        $row->hr_acted_at = now();
        $row->hr_comment  = $data['comment'] ?? null;
        $row->status      = $verdict; // hr stage is the final word
        $row->save();

        $row->load(['employee', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    /* ============================================================ */
    /*  HELPERS                                                     */
    /* ============================================================ */

    /**
     * Map the authenticated User to their Employee row via Employee.user_id.
     * Returns null when the user isn't linked to an employee record (e.g.
     * super_admin, client_admin without a personal Employee profile).
     */
    private function currentEmployeeId($user): ?int
    {
        if (!$user) return null;
        return Employee::where('user_id', $user->id)->value('id');
    }

    /**
     * Accept either a numeric Employee.id, a string EMP- code, or both, and
     * return the resolved numeric id (or null when neither resolves). The
     * frontend often only knows the EMP- code from the URL slug, so the
     * controller takes responsibility for the lookup.
     */
    private function resolveEmployeeId($idInput, $codeInput): ?int
    {
        // Numeric path — accept ints and all-digit strings.
        if ($idInput !== null && $idInput !== '') {
            if (is_numeric($idInput)) {
                return (int) $idInput;
            }
            // Some callers send the EMP- code in employee_id by mistake;
            // accept it transparently rather than error out.
            $codeInput = $codeInput ?: $idInput;
        }
        if ($codeInput) {
            $found = Employee::where('emp_code', $codeInput)->value('id');
            if ($found) return (int) $found;
        }
        return null;
    }

    /**
     * Walk up the parent_id chain on `modules` looking for `master.expense_category`.
     * Used as a sanity check; the actual gate is the per-user permissions row.
     */
    private function guardHrPermission($user, string $perm): void
    {
        if (!$user) abort(401, 'Authentication required');
        if ($user->user_type === 'super_admin') return;

        // Use the existing hr.expense module slug if present; otherwise allow
        // any client-admin / branch-user (they're already past tenant scope).
        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            // Fall back to "is this an admin-tier user?" — keeps the feature
            // usable on installs where the hr.expense module hasn't been
            // seeded into the modules table yet.
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

    private function ensureTenantAccess(ExpenseClaim $row, $user): void
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
            // Same rules as MasterController::applyScope — branch users see
            // their own branch + main-branch shared rows; main-branch users
            // see all branches under the client.
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            $isMain = $user->branch?->is_main ?? false;
            if (!$isMain && $row->branch_id !== null) {
                $mainBranchId = Branch::where('client_id', $user->client_id)
                    ->where('is_main', true)
                    ->value('id');
                $allowed = $row->branch_id === $user->branch_id
                    || ($mainBranchId && $row->branch_id === $mainBranchId);
                // Owner / assigned manager always have access regardless of
                // branch (e.g. claims created by the user themselves).
                $myEmployeeId = $this->currentEmployeeId($user);
                if (!$allowed
                    && $row->employee_id !== $myEmployeeId
                    && $row->manager_id !== $myEmployeeId) {
                    abort(403, 'Out of tenant scope.');
                }
            }
        }
    }

    private function applyTenantScope($q, $user): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                return;
            }

            $mainBranchId = Branch::where('client_id', $clientId)
                ->where('is_main', true)
                ->value('id');
            $myEmployeeId = $this->currentEmployeeId($user);

            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId, $myEmployeeId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId, $myEmployeeId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $mainBranchId, $myEmployeeId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($mainBranchId) {
                                 $wb->orWhere('branch_id', $mainBranchId);
                             }
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

    /**
     * Generate the next EXP-### sequence per (client_id, branch_id) tuple so
     * each tenant gets its own numbering independently.
     */
    private function nextClaimNo(?int $clientId, ?int $branchId): string
    {
        $q = ExpenseClaim::query();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $codes = $q->pluck('claim_no');
        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^EXP-(\d+)$/i', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        return 'EXP-' . str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }

    /**
     * Shape a row for the API response. Flattens employee/manager/category
     * names so the frontend can render the table without nested dereferences.
     */
    private function serialize(ExpenseClaim $row): array
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
            'id'              => $row->id,
            'claim_no'        => $row->claim_no,
            'employee_id'     => $row->employee_id,
            'employee_name'   => $employeeName,
            'employee_code'   => $employee?->emp_code,
            'manager_id'      => $row->manager_id,
            'manager_name'    => $managerName,
            'category_id'     => $row->category_id,
            'category_name'   => $row->category?->name ?? $row->category_name,
            'currency'        => $row->currency,
            'project'         => $row->project,
            'payment_method'  => $row->payment_method,
            'title'           => $row->title,
            'amount'          => (float) $row->amount,
            'expense_date'    => optional($row->expense_date)->format('Y-m-d'),
            'vendor'          => $row->vendor,
            'purpose'         => $row->purpose,
            'attachments'     => collect($row->attachments ?? [])->values()->map(function ($a, $i) use ($row) {
                // The download URL points at the Laravel route which streams
                // the file via query-token auth. The browser-side anchor
                // appends `?token=<sanctum>` before opening, identical to
                // the candidate CV pattern.
                return [
                    'name' => $a['name'] ?? null,
                    'size' => $a['size'] ?? null,
                    'url'  => url("/api/expense-claims/{$row->id}/attachments/{$i}"),
                ];
            })->all(),
            'status'          => $row->status,
            'manager_status'  => $row->manager_status,
            'manager_acted_at'=> optional($row->manager_acted_at)->toIso8601String(),
            'manager_comment' => $row->manager_comment,
            'hr_status'       => $row->hr_status,
            'hr_user_id'      => $row->hr_user_id,
            'hr_user_name'    => $row->hrUser?->name,
            'hr_acted_at'     => optional($row->hr_acted_at)->toIso8601String(),
            'hr_comment'      => $row->hr_comment,
            'created_by'      => $row->created_by,
            'creator_name'    => $row->creator?->name,
            'created_at'      => optional($row->created_at)->toIso8601String(),
        ];
    }
}
