<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\HrDocumentSignature;
use Illuminate\Http\Request;

/**
 * "My Team" view — accessible from the profile dropdown for anyone who manages
 * people (reporting managers + branch users + client users). Two endpoints:
 *
 *   GET /api/my-team/employees   scope-aware list of direct/branch/client reports
 *   GET /api/my-team/approvals   unified queue of pending approvals (currently
 *                                document signatures; expense / leave plug in
 *                                here later)
 */
class MyTeamController extends Controller
{
    private const EMP_COLUMNS = [
        'id', 'emp_code', 'display_name', 'first_name', 'last_name',
        'email', 'mobile', 'department_id', 'designation_id',
        'reporting_manager_id', 'date_of_joining', 'status',
        'client_id', 'branch_id',
    ];

    private const EMP_WITH = [
        'department:id,name',
        'designation:id,name,level',
        'reportingManager:id,display_name,first_name,last_name,emp_code',
        'branch:id,name,is_main',
        'photoDocument:id,employee_id,document_key,file_path',
    ];

    public function employees(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Employee::query()
            ->select(self::EMP_COLUMNS)
            ->with(self::EMP_WITH);

        $this->scopeForUser($q, $user);

        if ($search = $request->query('search')) {
            $q->where(function ($w) use ($search) {
                $w->where('display_name', 'ilike', "%{$search}%")
                  ->orWhere('emp_code',     'ilike', "%{$search}%")
                  ->orWhere('email',        'ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) $q->where('status', $status);

        return response()->json([
            'scope'      => $this->describeScope($user),
            'employees'  => $q->orderBy('display_name')->limit(500)->get(),
        ]);
    }

    /**
     * Unified pending approvals queue. For now this is just the document
     * signature inbox; future modules (expense, leave) slot in by appending
     * to the returned list with a stable `module` discriminator the SPA can
     * branch on.
     */
    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $items = [];

        // Document signatures where the current user is the next signer.
        $q = HrDocumentSignature::query()
            ->with([
                'template:id,code,name,doc_type',
                'employee:id,display_name,first_name,last_name,emp_code,department_id',
                'employee.department:id,name',
            ])
            ->whereIn('status', ['Pending', 'In Progress']);

        // Reuse the same tenant scoping the signature controller applies.
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
        } elseif (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $q->where(function ($w) use ($user) {
                $w->where('client_id', $user->client_id)
                  ->orWhere('employee_id', $user->employee_id);
            });
        }

        foreach ($q->orderByDesc('id')->get() as $row) {
            $signers = is_array($row->signers) ? $row->signers : [];
            $current = $signers[(int) $row->current_index] ?? null;
            if (!$current) continue;
            if ((int) ($current['user_id'] ?? 0) !== (int) $user->id) continue;
            if (($current['status'] ?? '') === 'Done') continue;

            $items[] = [
                'module'        => 'document_signature',
                'id'            => $row->id,
                'code'          => $row->code,
                'title'         => $row->template?->name ?? '(template removed)',
                'subject_name'  => $row->employee?->display_name ?? '—',
                'subject_dept'  => $row->employee?->department?->name ?? '—',
                'action'        => $current['action'] ?? 'Sign',
                'status'        => $row->status,
                'days_left'     => isset($current['days']) ? (int) $current['days'] : null,
                'created_at'    => $row->created_at,
                'raw'           => $row,
            ];
        }

        return response()->json([
            'scope'      => $this->describeScope($user),
            'approvals'  => $items,
            'counts'     => [
                'total'              => count($items),
                'document_signature' => count(array_filter($items, fn ($i) => $i['module'] === 'document_signature')),
                'expense'            => 0,  // placeholder
                'leave'              => 0,  // placeholder
            ],
        ]);
    }

    /* ───── scope helpers ───── */

    /**
     * Resolves the visibility window:
     *   super_admin → all employees
     *   client_admin / client_user → everyone in the client
     *   branch_user (main) → everyone in the client (main branch sees siblings)
     *   branch_user (sub)  → only their branch
     *   employee (manager) → only direct reports (employees whose
     *                        reporting_manager_id points to this user's
     *                        linked employee row)
     */
    private function scopeForUser($q, $user): void
    {
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where('client_id', $user->client_id);
            return;
        }

        if ($user->user_type === 'branch_user') {
            $isMain = $user->branch?->is_main ?? false;
            if ($isMain) {
                $q->where('client_id', $user->client_id);
            } else {
                $q->where('client_id', $user->client_id)
                  ->where('branch_id', $user->branch_id);
            }
            return;
        }

        if ($user->user_type === 'employee') {
            $myEmpId = $user->employee_id;
            if (!$myEmpId) { $q->whereRaw('1=0'); return; }
            $q->where('reporting_manager_id', $myEmpId);
            return;
        }

        $q->whereRaw('1=0');
    }

    private function describeScope($user): array
    {
        if ($user->user_type === 'super_admin') {
            return ['kind' => 'all', 'label' => 'All employees across tenants'];
        }
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return ['kind' => 'client', 'label' => 'All branches in your organisation'];
        }
        if ($user->user_type === 'branch_user') {
            $isMain = $user->branch?->is_main ?? false;
            return ['kind' => $isMain ? 'client' : 'branch',
                'label' => $isMain ? 'All branches in your organisation' : 'Employees in your branch'];
        }
        if ($user->user_type === 'employee') {
            return ['kind' => 'reports', 'label' => 'Employees reporting to you'];
        }
        return ['kind' => 'none', 'label' => 'No team'];
    }
}
