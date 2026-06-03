<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvanceRequest;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\HrDocumentSignature;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;


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

        // Expense claims pending the user's action. Two paths feed in here:
        //   - manager stage: rows whose assigned reporting manager is the
        //     current user (manager_status = pending)
        //   - HR stage: rows that have cleared manager and now need HR /
        //     Finance approval (manager_status = approved, hr_status = pending)
        //     — visible to users with hr.expense can_approve (or the admin
        //     tiers branch_user / client_admin / client_user / super_admin
        //     when the module row isn't seeded yet, matching the fallback in
        //     ExpenseClaimController::guardHrPermission).
        foreach ($this->pendingExpenseClaims($user) as $entry) {
            $items[] = $entry;
        }

        return response()->json([
            'scope'      => $this->describeScope($user),
            'approvals'  => $items,
            'counts'     => [
                'total'              => count($items),
                'document_signature' => count(array_filter($items, fn ($i) => $i['module'] === 'document_signature')),
                'expense'            => count(array_filter($items, fn ($i) => $i['module'] === 'expense')),
                'leave'              => 0,  // placeholder
            ],
        ]);
    }

    /**
     * Resolve pending expense claim approvals for the current user.
     * Returns rows shaped the same way the document-signature items are so
     * the unified approvals endpoint can stream both modules through the
     * same SPA table without per-module branching on the read side.
     *
     * Two visibility paths combine here:
     *   1. The user is the assigned reporting manager (manager_id matches
     *      their linked Employee.id) and the claim is still at manager-stage.
     *   2. The user can HR-approve and the claim has cleared the manager
     *      stage (manager_status = approved, hr_status = pending).
     */
    private function pendingExpenseClaims($user): array
    {
        $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
        $canHrApprove = $this->userCanHrApproveExpense($user);
        if (!$myEmployeeId && !$canHrApprove) return [];

        $q = ExpenseClaim::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id',
                'employee.department:id,name',
                'category:id,name',
                'manager:id,display_name,first_name,last_name,emp_code',
                'creator:id,name',
            ])
            ->where('status', 'pending')
            ->where(function ($w) use ($myEmployeeId, $canHrApprove) {
                if ($myEmployeeId) {
                    $w->orWhere(function ($wm) use ($myEmployeeId) {
                        $wm->where('manager_id', $myEmployeeId)
                           ->where('manager_status', 'pending');
                    });
                }
                if ($canHrApprove) {
                    $w->orWhere(function ($wh) {
                        $wh->where('manager_status', 'approved')
                           ->where('hr_status', 'pending');
                    });
                }
            });

        $this->applyExpenseTenantScope($q, $user, $myEmployeeId);

        $out = [];
        foreach ($q->orderByDesc('id')->get() as $row) {
            $stage = null;
            if ($myEmployeeId
                && (int) $row->manager_id === (int) $myEmployeeId
                && $row->manager_status === 'pending') {
                $stage = 'manager';
            } elseif ($canHrApprove
                && $row->manager_status === 'approved'
                && $row->hr_status === 'pending') {
                $stage = 'hr';
            }
            if (!$stage) continue;

            $emp = $row->employee;
            $employeeName = $emp
                ? ($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
                : '—';

            $out[] = [
                'module'        => 'expense',
                'id'            => $row->id,
                'code'          => $row->claim_no,
                'title'         => $row->title ?: 'Expense Claim',
                'subject_name'  => $employeeName ?: '—',
                'subject_dept'  => $emp?->department?->name ?? '—',
                'action'        => 'Approve',
                'status'        => $row->status,
                'days_left'     => null,
                'created_at'    => $row->created_at,
                'raw'           => [
                    'stage'          => $stage,
                    'amount'         => (float) $row->amount,
                    'currency'       => $row->currency,
                    'expense_date'   => optional($row->expense_date)->format('Y-m-d'),
                    'category_name'  => $row->category?->name ?? $row->category_name,
                    'vendor'         => $row->vendor,
                    'project'        => $row->project,
                    'payment_method' => $row->payment_method,
                    'purpose'        => $row->purpose,
                    'manager_status' => $row->manager_status,
                    'hr_status'      => $row->hr_status,
                    'manager_name'   => $row->manager
                        ? ($row->manager->display_name
                            ?: trim(($row->manager->first_name ?? '') . ' ' . ($row->manager->last_name ?? '')))
                        : null,
                    'employee_name'  => $employeeName,
                    'employee_code'  => $emp?->emp_code,
                    'department_name'=> $emp?->department?->name,
                    'creator_name'   => $row->creator?->name,
                ],
            ];
        }
        return $out;
    }

    /**
     * "My Updates" — FYI notifications about the user's OWN expense
     * claims and advance requests that have been actioned (approved or
     * rejected at either manager or HR stage). Read-only, so each item
     * is shaped with `action: 'View'` and no stage/approve-reject
     * payload; the inbox just shows the line and a "View" deep-link.
     *
     * The endpoint returns at most 30 days of history so the list stays
     * manageable; the inbox can paginate locally.
     */
    public function myUpdates(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
        if (!$myEmployeeId) {
            return response()->json(['updates' => []]);
        }

        $since = now()->subDays(30);
        $out = [];

        // Expense claims: include rows where either the manager or the HR
        // stage has acted (status changed away from "pending"). Pure
        // "still pending" rows are filtered out — those belong on the
        // submitter's My/Team list in the profile, not the inbox.
        $claims = ExpenseClaim::query()
            ->with([
                'category:id,name',
                'manager:id,display_name,first_name,last_name',
                'hrUser:id,name',
            ])
            ->where('employee_id', $myEmployeeId)
            ->where(function ($w) {
                $w->whereIn('manager_status', ['approved', 'rejected'])
                  ->orWhereIn('hr_status', ['approved', 'rejected']);
            })
            ->where(function ($w) use ($since) {
                $w->where('manager_acted_at', '>=', $since)
                  ->orWhere('hr_acted_at', '>=', $since);
            })
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        foreach ($claims as $row) {
            // Pick the most recent stage action so the inbox card surfaces
            // the freshest decision (HR overrides manager when both have
            // acted on the same row).
            $stage = null;
            $actedAt = null;
            $actorName = null;
            $verdict = null;
            $comment = null;
            if ($row->hr_status !== 'pending' && $row->hr_acted_at) {
                $stage = 'hr';
                $actedAt = $row->hr_acted_at;
                $actorName = $row->hrUser?->name;
                $verdict = $row->hr_status;
                $comment = $row->hr_comment;
            } elseif ($row->manager_status !== 'pending' && $row->manager_acted_at) {
                $stage = 'manager';
                $actedAt = $row->manager_acted_at;
                $mgr = $row->manager;
                $actorName = $mgr
                    ? ($mgr->display_name ?: trim(($mgr->first_name ?? '') . ' ' . ($mgr->last_name ?? '')))
                    : null;
                $verdict = $row->manager_status;
                $comment = $row->manager_comment;
            }
            if (!$stage) continue;

            $out[] = [
                'module'      => 'expense',
                'id'          => $row->id,
                'code'        => $row->claim_no,
                'title'       => $row->title ?: 'Expense Claim',
                'amount'      => (float) $row->amount,
                'currency'    => $row->currency,
                'category'    => $row->category?->name ?? $row->category_name,
                'stage'       => $stage,                 // 'manager' | 'hr'
                'verdict'     => $verdict,               // 'approved' | 'rejected'
                'actor_name'  => $actorName,
                'comment'     => $comment,
                'acted_at'    => $actedAt,
                'final'       => $row->status !== 'pending',
            ];
        }

        // Advance requests: same shape, mirrors the expense pattern.
        $advances = AdvanceRequest::query()
            ->with([
                'manager:id,display_name,first_name,last_name',
                'hrUser:id,name',
            ])
            ->where('employee_id', $myEmployeeId)
            ->where(function ($w) {
                $w->whereIn('manager_status', ['approved', 'rejected'])
                  ->orWhereIn('hr_status', ['approved', 'rejected']);
            })
            ->where(function ($w) use ($since) {
                $w->where('manager_acted_at', '>=', $since)
                  ->orWhere('hr_acted_at', '>=', $since);
            })
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        foreach ($advances as $row) {
            $stage = null; $actedAt = null; $actorName = null; $verdict = null; $comment = null;
            if ($row->hr_status !== 'pending' && $row->hr_acted_at) {
                $stage = 'hr';
                $actedAt = $row->hr_acted_at;
                $actorName = $row->hrUser?->name;
                $verdict = $row->hr_status;
                $comment = $row->hr_comment;
            } elseif ($row->manager_status !== 'pending' && $row->manager_acted_at) {
                $stage = 'manager';
                $actedAt = $row->manager_acted_at;
                $mgr = $row->manager;
                $actorName = $mgr
                    ? ($mgr->display_name ?: trim(($mgr->first_name ?? '') . ' ' . ($mgr->last_name ?? '')))
                    : null;
                $verdict = $row->manager_status;
                $comment = $row->manager_comment;
            }
            if (!$stage) continue;

            $out[] = [
                'module'      => 'advance',
                'id'          => $row->id,
                'code'        => $row->advance_no,
                'title'       => $row->advance_type
                    ? ('Advance · ' . $row->advance_type . ($row->advance_type_other ? ' · ' . $row->advance_type_other : ''))
                    : 'Advance Request',
                'amount'      => (float) $row->amount,
                'currency'    => 'INR',
                'category'    => $row->advance_type,
                'stage'       => $stage,
                'verdict'     => $verdict,
                'actor_name'  => $actorName,
                'comment'     => $comment,
                'acted_at'    => $actedAt,
                'final'       => $row->status !== 'pending',
            ];
        }

        // Sort by acted_at desc so the freshest decision shows on top.
        usort($out, fn ($a, $b) => strcmp((string) $b['acted_at'], (string) $a['acted_at']));

        return response()->json(['updates' => $out]);
    }

    /**
     * Tenant scope for the expense-claims query — mirrors
     * ExpenseClaimController::applyTenantScope so the My Team queue can't
     * surface a row the user wouldn't be allowed to act on directly.
     */
    private function applyExpenseTenantScope($q, $user, ?int $myEmployeeId): void
    {
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
                                 $wb->orWhere('manager_id', $myEmployeeId);
                             }
                         });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    /**
     * Whether the user has HR / Finance approval rights for expense claims.
     * Falls back to admin-tier user_type when the hr.expense module row
     * hasn't been seeded — same shape as ExpenseClaimController guards.
     */
    private function userCanHrApproveExpense($user): bool
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
            // Resolve via Employee.user_id — `users.employee_id` is the
            // back-pointer we don't always populate during onboarding, so
            // relying on it dropped the My Team list to empty even when
            // the employee genuinely has direct reports. The dashboard's
            // `team_peers` query uses this same lookup, which is why the
            // dashboard rendered the team correctly while this surface
            // didn't.
            $myEmpId = Employee::where('user_id', $user->id)->value('id');
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
