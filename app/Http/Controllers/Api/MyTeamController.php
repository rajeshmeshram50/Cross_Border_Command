<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvanceRequest;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\HrDocumentSignature;
use App\Models\LeaveRequest;
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
        'branch:id,name',
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

        // history=1 → the inbox "Updated (History)" tab: claims this user has
        // already decided on (approved / rejected at their stage), instead of
        // the pending queue. Documents have their own history endpoint, so the
        // history response carries acted expense claims only.
        if ($request->boolean('history')) {
            // Both modules share the inbox history tab. Merge acted expense
            // claims + acted advance requests and surface the freshest
            // decision first across both.
            $history = array_merge($this->actedExpenseClaims($user), $this->actedAdvanceRequests($user));
            usort($history, fn ($a, $b) => strcmp((string) ($b['acted_at'] ?? ''), (string) ($a['acted_at'] ?? '')));
            return response()->json([
                'scope'     => $this->describeScope($user),
                'approvals' => $history,
            ]);
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

        // Advance requests pending the user's action — same two-stage flow
        // (manager → HR/Finance) as expense claims, streamed through the same
        // queue with module = 'advance'. Without this, advances were only
        // reachable via Expense Management → Team Advance Requests and never
        // surfaced in the inbox for HR/manager action.
        foreach ($this->pendingAdvanceRequests($user) as $entry) {
            $items[] = $entry;
        }

        // Leave requests pending the user's approval. Previously hard-coded to
        // 0, so a manager's My Team → Approval List never surfaced any leave
        // requests from their reports even when they were the assigned approver.
        foreach ($this->pendingLeaveRequests($user) as $entry) {
            $items[] = $entry;
        }

        return response()->json([
            'scope'      => $this->describeScope($user),
            'approvals'  => $items,
            'counts'     => [
                'total'              => count($items),
                'document_signature' => count(array_filter($items, fn ($i) => $i['module'] === 'document_signature')),
                'expense'            => count(array_filter($items, fn ($i) => $i['module'] === 'expense')),
                'advance'            => count(array_filter($items, fn ($i) => $i['module'] === 'advance')),
                'leave'              => count(array_filter($items, fn ($i) => $i['module'] === 'leave')),
            ],
        ]);
    }

    /**
     * Resolve pending leave-request approvals for the current user, shaped the
     * same way the other modules are so the unified inbox can stream them.
     *
     * Scoping mirrors LeaveRequestController::approvals:
     *   - Admin tiers (super_admin / client_admin / branch_user) see every
     *     pending request in their tenant (HR can act on anyone's behalf).
     *   - Everyone else only sees requests where they can act on the CURRENT
     *     approval level — resolved with the controller's own canActOnLevel so
     *     the manager/HR/role gating stays in lockstep (no logic drift).
     */
    private function pendingLeaveRequests($user): array
    {
        $myEmployeeId = $user->employee_id ?: Employee::where('user_id', $user->id)->value('id');

        $q = LeaveRequest::query()
            ->with([
                'employee:id,emp_code,display_name,first_name,last_name,department_id,reporting_manager_id',
                'employee.department:id,name',
                'leaveType:id,name,short_code',
            ])
            ->where('status', 'Pending')
            ->orderByDesc('created_at');

        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        // Leave is reporting-manager-only: HR is view-only on the dedicated
        // Leave Approvals page and must NOT receive leave in their personal My
        // Team / Inbox action queue. So — unlike expense/advance — there is NO
        // admin blanket here. A request surfaces only to whoever can act on its
        // current chain level: the reporting manager (an Employee RM, or a
        // login-User RM such as a Client/Branch admin who is set as the RM), or
        // anyone explicitly named on the chain. super_admin keeps its global
        // override below.
        if ($user->user_type !== 'super_admin') {
            $uid = (int) $user->id;
            $eid = (int) ($myEmployeeId ?: 0);
            $q->where(function ($w) use ($myEmployeeId, $uid, $eid) {
                $w->orWhere('approval_chain', 'ilike', '%"approver_user_id":' . $uid . '%')
                  ->orWhere('approval_chain', 'ilike', '%"approver_employee_id":' . $eid . '%');
                if ($myEmployeeId) {
                    $w->orWhereIn('employee_id', function ($sub) use ($myEmployeeId) {
                        $sub->select('id')->from('employees')->where('reporting_manager_id', $myEmployeeId);
                    });
                }
            });
        }

        $leaveCtrl = app(LeaveRequestController::class);
        $items = [];
        foreach ($q->get() as $row) {
            // Per-level precision for everyone except super_admin — only the
            // current-level approver (the reporting manager) sees it.
            if ($user->user_type !== 'super_admin') {
                $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
                $idx   = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
                if (!$leaveCtrl->canActOnLevel($user, $chain, $idx, $row)) continue;
            }
            $emp  = $row->employee;
            $name = $emp?->display_name
                ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''));
            $items[] = [
                'module'       => 'leave',
                'id'           => $row->id,
                'code'         => "LV-{$row->id}",
                'title'        => trim((($row->leaveType?->name ?? 'Leave') . ' · ' .
                                  (string) $row->from_date . ' → ' . (string) $row->to_date)),
                'subject_name' => $name ?: '—',
                'subject_dept' => $emp?->department?->name ?? '—',
                'action'       => 'Approve',
                'status'       => $row->status,
                'days_left'    => null,
                'created_at'   => $row->created_at,
                'raw'          => $row,
            ];
        }
        return $items;
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
     * Acted expense claims for the inbox "Updated (History)" tab — claims the
     * current user has already decided on at their stage: manager-stage rows
     * they approved/rejected as the assigned reporting manager, plus HR-stage
     * rows they cleared when they hold HR/Finance approval rights.
     */
    private function actedExpenseClaims($user): array
    {
        $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
        $uid = (int) $user->id;

        // History = claims THIS user personally acted on — either as the
        // assigned reporting manager, OR as the HR/Finance approver (hr_user_id
        // records who acted). Without the hr_user_id check the queue leaked
        // every HR-acted claim in the tenant to any HR user. (Bug 50)
        $q = ExpenseClaim::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id',
                'employee.department:id,name',
                'category:id,name',
                'manager:id,display_name,first_name,last_name,emp_code',
            ])
            ->where(function ($w) use ($myEmployeeId, $uid) {
                if ($myEmployeeId) {
                    $w->orWhere(function ($wm) use ($myEmployeeId) {
                        $wm->where('manager_id', $myEmployeeId)
                           ->whereIn('manager_status', ['approved', 'rejected']);
                    });
                }
                $w->orWhere(function ($wh) use ($uid) {
                    $wh->where('hr_user_id', $uid)
                       ->whereIn('hr_status', ['approved', 'rejected']);
                });
            });

        $this->applyExpenseTenantScope($q, $user, $myEmployeeId);

        $out = [];
        foreach ($q->orderByDesc('updated_at')->limit(60)->get() as $row) {
            // Which stage did THIS user act at? Prefer the manager stage when
            // they're the assigned manager and acted, else the HR stage they
            // personally recorded.
            $stage = null; $verdict = null;
            if ($myEmployeeId && (int) $row->manager_id === (int) $myEmployeeId
                && in_array($row->manager_status, ['approved', 'rejected'], true)) {
                $stage = 'manager'; $verdict = $row->manager_status;
            } elseif ((int) $row->hr_user_id === $uid
                && in_array($row->hr_status, ['approved', 'rejected'], true)) {
                $stage = 'hr'; $verdict = $row->hr_status;
            }
            if (!$stage) continue;

            $emp = $row->employee;
            $employeeName = $emp ? ($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))) : '—';

            $out[] = [
                'module'       => 'expense',
                'id'           => $row->id,
                'code'         => $row->claim_no,
                'title'        => $row->title ?: 'Expense Claim',
                'subject_name' => $employeeName ?: '—',
                'subject_dept' => $emp?->department?->name ?? '—',
                'verdict'      => $verdict,                 // approved | rejected
                'acted_at'     => optional($row->updated_at)->toIso8601String(),
                'status'       => $row->status,
                'created_at'   => $row->created_at,
                'raw'          => [
                    'stage'         => $stage,
                    'amount'        => (float) $row->amount,
                    'currency'      => $row->currency,
                    'expense_date'  => optional($row->expense_date)->format('Y-m-d'),
                    'category_name' => $row->category?->name ?? $row->category_name,
                    'vendor'        => $row->vendor,
                    'purpose'       => $row->purpose,
                    'employee_name' => $employeeName,
                    'employee_code' => $emp?->emp_code,
                    'department_name' => $emp?->department?->name,
                ],
            ];
        }
        return $out;
    }

    /**
     * Pending advance-request approvals for the current user. Mirrors
     * pendingExpenseClaims one-for-one: advance requests run the same
     * manager → HR/Finance two-stage flow and share the hr.expense approval
     * right (AdvanceRequestController::guardHrPermission also gates on the
     * hr.expense module). Reuses applyExpenseTenantScope since the advance
     * table carries the same client_id / branch_id / manager_id columns.
     */
    private function pendingAdvanceRequests($user): array
    {
        $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
        $canHrApprove = $this->userCanHrApproveExpense($user);
        if (!$myEmployeeId && !$canHrApprove) return [];

        $q = AdvanceRequest::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id',
                'employee.department:id,name',
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
            $typeLabel = $row->advance_type
                ? ('Advance · ' . $row->advance_type . ($row->advance_type_other ? ' · ' . $row->advance_type_other : ''))
                : 'Advance Request';

            $out[] = [
                'module'        => 'advance',
                'id'            => $row->id,
                'code'          => $row->advance_no,
                'title'         => $typeLabel,
                'subject_name'  => $employeeName ?: '—',
                'subject_dept'  => $emp?->department?->name ?? '—',
                'action'        => 'Approve',
                'status'        => $row->status,
                'days_left'     => null,
                'created_at'    => $row->created_at,
                'raw'           => [
                    'stage'          => $stage,
                    'amount'         => (float) $row->amount,
                    'currency'       => 'INR',
                    'advance_type'   => $row->advance_type,
                    'category_name'  => $row->advance_type,
                    'reason'         => $row->reason,
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
     * Acted advance requests for the inbox "Updated (History)" tab — the
     * advance counterpart of actedExpenseClaims (same stage-resolution rules).
     */
    private function actedAdvanceRequests($user): array
    {
        $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
        $uid = (int) $user->id;

        // History = advances THIS user personally acted on (manager stage, or
        // the HR stage they recorded via hr_user_id). (Bug 50)
        $q = AdvanceRequest::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id',
                'employee.department:id,name',
                'manager:id,display_name,first_name,last_name,emp_code',
            ])
            ->where(function ($w) use ($myEmployeeId, $uid) {
                if ($myEmployeeId) {
                    $w->orWhere(function ($wm) use ($myEmployeeId) {
                        $wm->where('manager_id', $myEmployeeId)
                           ->whereIn('manager_status', ['approved', 'rejected']);
                    });
                }
                $w->orWhere(function ($wh) use ($uid) {
                    $wh->where('hr_user_id', $uid)
                       ->whereIn('hr_status', ['approved', 'rejected']);
                });
            });

        $this->applyExpenseTenantScope($q, $user, $myEmployeeId);

        $out = [];
        foreach ($q->orderByDesc('updated_at')->limit(60)->get() as $row) {
            $stage = null; $verdict = null;
            if ($myEmployeeId && (int) $row->manager_id === (int) $myEmployeeId
                && in_array($row->manager_status, ['approved', 'rejected'], true)) {
                $stage = 'manager'; $verdict = $row->manager_status;
            } elseif ((int) $row->hr_user_id === $uid
                && in_array($row->hr_status, ['approved', 'rejected'], true)) {
                $stage = 'hr'; $verdict = $row->hr_status;
            }
            if (!$stage) continue;

            $emp = $row->employee;
            $employeeName = $emp ? ($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))) : '—';

            $out[] = [
                'module'       => 'advance',
                'id'           => $row->id,
                'code'         => $row->advance_no,
                'title'        => $row->advance_type
                    ? ('Advance · ' . $row->advance_type . ($row->advance_type_other ? ' · ' . $row->advance_type_other : ''))
                    : 'Advance Request',
                'subject_name' => $employeeName ?: '—',
                'subject_dept' => $emp?->department?->name ?? '—',
                'verdict'      => $verdict,
                'acted_at'     => optional($row->updated_at)->toIso8601String(),
                'status'       => $row->status,
                'created_at'   => $row->created_at,
                'raw'          => [
                    'stage'         => $stage,
                    'amount'        => (float) $row->amount,
                    'currency'      => 'INR',
                    'category_name' => $row->advance_type,
                    'reason'        => $row->reason,
                    'employee_name' => $employeeName,
                    'employee_code' => $emp?->emp_code,
                    'department_name' => $emp?->department?->name,
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
            // Every branch is an isolated peer — globals + client-level rows
            // + own branch's rows (+ rows the user manages).
            $clientId = $user->client_id;
            $branchId = $user->branch_id;

            $q->where(function ($w) use ($clientId, $branchId, $myEmployeeId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $myEmployeeId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $myEmployeeId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
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
     *   branch_user → only their branch (every branch is an isolated peer)
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
            $q->where('client_id', $user->client_id)
              ->where('branch_id', $user->branch_id);
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
            return ['kind' => 'branch', 'label' => 'Employees in your branch'];
        }
        if ($user->user_type === 'employee') {
            return ['kind' => 'reports', 'label' => 'Employees reporting to you'];
        }
        return ['kind' => 'none', 'label' => 'No team'];
    }
    

}
