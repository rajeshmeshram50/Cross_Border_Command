<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvanceRequest;
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
        'reporting_manager_id', 'reporting_manager_user_id', 'date_of_joining', 'status',
        'client_id', 'branch_id',
    ];

    private const EMP_WITH = [
        'department:id,name',
        'designation:id,name,level',
        'reportingManager:id,display_name,first_name,last_name,emp_code',
        'reportingManagerUser:id,name',
        'branch:id,name',
        'photoDocument:id,employee_id,document_key,file_path',
    ];

    private function reportsToName($emp): ?string
    {
        if (!$emp) return null;
        $name = null;
        if ($emp->reportingManager) {
            $m = $emp->reportingManager;
            $name = $m->display_name ?: trim(($m->first_name ?? '') . ' ' . ($m->last_name ?? ''));
        }
        if (!$name && $emp->reportingManagerUser) {
            $name = $emp->reportingManagerUser->name;
        }
        return $name ?: null;
    }

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

        $employees = $q->orderBy('display_name')->limit(500)->get()->map(function ($e) {
            $name = null;
            if ($e->reportingManager) {
                $m = $e->reportingManager;
                $name = $m->display_name ?: trim(($m->first_name ?? '') . ' ' . ($m->last_name ?? ''));
            }
            if (!$name && $e->reportingManagerUser) {
                $name = $e->reportingManagerUser->name;
            }
            $arr = $e->toArray();
            $arr['reports_to'] = $name ?: null;
            return $arr;
        });

        return response()->json([
            'scope'      => $this->describeScope($user),
            'employees'  => $employees,
        ]);
    }

    private function subjectName($emp): string
    {
        if (!$emp) return '—';
        $name = trim((string) ($emp->display_name ?? ''));
        if ($name !== '') return $name;
        $name = trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''));
        if ($name !== '') return $name;
        return (string) ($emp->emp_code ?: '—');
    }
    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $items = [];

        $q = HrDocumentSignature::query()
            ->with([
                'template:id,code,name,doc_type',
                'employee' => fn ($r) => $r->withTrashed()->select(
                    'id', 'display_name', 'first_name', 'last_name', 'emp_code',
                    'department_id', 'reporting_manager_id', 'reporting_manager_user_id',
                ),
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
            ])
            ->whereIn('status', ['Pending', 'In Progress']);

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
                'subject_name'  => $this->subjectName($row->employee),
                'subject_code'  => $row->employee?->emp_code ?: null,
                'subject_dept'  => $row->employee?->department?->name ?: '—',
                'subject_manager' => $this->reportsToName($row->employee) ?? '—',
                'action'        => $current['action'] ?? 'Sign',
                'status'        => $row->status,
                'days_left'     => isset($current['days']) ? (int) $current['days'] : null,
                'created_at'    => $row->created_at,
                'raw'           => $row,
            ];
        }

        if ($request->boolean('history')) {
            $history = array_merge($this->actedExpenseClaims($user), $this->actedAdvanceRequests($user));
            usort($history, fn ($a, $b) => strcmp((string) ($b['acted_at'] ?? ''), (string) ($a['acted_at'] ?? '')));
            return response()->json([
                'scope'     => $this->describeScope($user),
                'approvals' => $history,
            ]);
        }

        foreach ($this->pendingExpenseClaims($user) as $entry) {
            $items[] = $entry;
        }

        foreach ($this->pendingAdvanceRequests($user) as $entry) {
            $items[] = $entry;
        }

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

    private function pendingLeaveRequests($user): array
    {
        $myEmployeeId = $user->employee_id;

        $q = LeaveRequest::query()
            ->with([
                'employee:id,emp_code,display_name,first_name,last_name,department_id,reporting_manager_id,reporting_manager_user_id',
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
                'leaveType:id,name,short_code',
            ])
            ->where('status', 'Pending')
            ->orderByDesc('created_at');

        if ($user->user_type === 'super_admin') return [];
        if ($user->client_id) {
            $q->where('client_id', $user->client_id);
        }

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

        $leaveCtrl = app(LeaveRequestController::class);
        $items = [];
        foreach ($q->get() as $row) {
            $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
            $idx   = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
            if (!$leaveCtrl->canActOnLevel($user, $chain, $idx, $row)) continue;
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
                'subject_manager' => $this->reportsToName($emp) ?? '—',
                'action'       => 'Approve',
                'status'       => $row->status,
                'days_left'    => null,
                'created_at'   => $row->created_at,
                'raw'          => $row,
            ];
        }
        return $items;
    }

    private function pendingExpenseClaims($user): array
    {
        $myEmployeeId = $user->employee_id;
        $canHrApprove = $this->userCanHrApproveExpense($user);
        if (!$myEmployeeId && !$canHrApprove) return [];

        $q = ExpenseClaim::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id,reporting_manager_id,reporting_manager_user_id',
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
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
                    $w->orWhere(function ($wm) {
                        $wm->whereNull('manager_id')
                           ->where('manager_status', 'pending');
                    });
                    $w->orWhere(function ($wh) {
                        $wh->where('manager_status', 'approved')
                           ->where('hr_status', 'pending');
                    });
                }
            });

        if ($myEmployeeId !== null) {
            $q->where('employee_id', '!=', $myEmployeeId);
        }

        $this->applyExpenseTenantScope($q, $user, $myEmployeeId);

        $out = [];
        foreach ($q->orderByDesc('id')->get() as $row) {
            $stage = null;
            if ($myEmployeeId
                && (int) $row->manager_id === (int) $myEmployeeId
                && $row->manager_status === 'pending') {
                $stage = 'manager';
            } elseif ($canHrApprove
                && $row->manager_id === null
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
                'subject_manager' => $this->reportsToName($emp) ?? '—',
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
                    'manager_name'   => $this->reportsToName($emp)
                        ?: ($row->manager
                            ? ($row->manager->display_name
                                ?: trim(($row->manager->first_name ?? '') . ' ' . ($row->manager->last_name ?? '')))
                            : null),
                    'employee_name'  => $employeeName,
                    'employee_code'  => $emp?->emp_code,
                    'department_name'=> $emp?->department?->name,
                    'creator_name'   => $row->creator?->name,
                ],
            ];
        }
        return $out;
    }

    private function actedExpenseClaims($user): array
    {
        $myEmployeeId = $user->employee_id;
        $uid = (int) $user->id;

        $q = ExpenseClaim::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id,reporting_manager_id,reporting_manager_user_id',
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
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
                'subject_manager' => $this->reportsToName($emp) ?? '—',
                'verdict'      => $verdict,
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

    private function pendingAdvanceRequests($user): array
    {
        $myEmployeeId = $user->employee_id;
        $canHrApprove = $this->userCanHrApproveExpense($user);
        if (!$myEmployeeId && !$canHrApprove) return [];

        $q = AdvanceRequest::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id,reporting_manager_id,reporting_manager_user_id',
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
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
                    $w->orWhere(function ($wm) {
                        $wm->whereNull('manager_id')
                           ->where('manager_status', 'pending');
                    });
                    $w->orWhere(function ($wh) {
                        $wh->where('manager_status', 'approved')
                           ->where('hr_status', 'pending');
                    });
                }
            });

        if ($myEmployeeId !== null) {
            $q->where('employee_id', '!=', $myEmployeeId);
        }

        $this->applyExpenseTenantScope($q, $user, $myEmployeeId);

        $out = [];
        foreach ($q->orderByDesc('id')->get() as $row) {
            $stage = null;
            if ($myEmployeeId
                && (int) $row->manager_id === (int) $myEmployeeId
                && $row->manager_status === 'pending') {
                $stage = 'manager';
            } elseif ($canHrApprove
                && $row->manager_id === null
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
                'subject_manager' => $this->reportsToName($emp) ?? '—',
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
                    'manager_name'   => $this->reportsToName($emp)
                        ?: ($row->manager
                            ? ($row->manager->display_name
                                ?: trim(($row->manager->first_name ?? '') . ' ' . ($row->manager->last_name ?? '')))
                            : null),
                    'employee_name'  => $employeeName,
                    'employee_code'  => $emp?->emp_code,
                    'department_name'=> $emp?->department?->name,
                    'creator_name'   => $row->creator?->name,
                ],
            ];
        }
        return $out;
    }

    private function actedAdvanceRequests($user): array
    {
        $myEmployeeId = $user->employee_id;
        $uid = (int) $user->id;

        $q = AdvanceRequest::query()
            ->with([
                'employee:id,display_name,first_name,last_name,emp_code,department_id,branch_id,client_id,reporting_manager_id,reporting_manager_user_id',
                'employee.department:id,name',
                'employee.reportingManager:id,display_name,first_name,last_name',
                'employee.reportingManagerUser:id,name',
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
                'subject_manager' => $this->reportsToName($emp) ?? '—',
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

    public function myUpdates(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $myEmployeeId = $user->employee_id;
        if (!$myEmployeeId) {
            return response()->json(['updates' => []]);
        }

        $since = now()->subDays(30);
        $out = [];

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
                'stage'       => $stage,
                'verdict'     => $verdict,
                'actor_name'  => $actorName,
                'comment'     => $comment,
                'acted_at'    => $actedAt,
                'final'       => $row->status !== 'pending',
            ];
        }

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

        usort($out, fn ($a, $b) => strcmp((string) $b['acted_at'], (string) $a['acted_at']));

        return response()->json(['updates' => $out]);
    }

    private function applyExpenseTenantScope($q, $user, ?int $myEmployeeId): void
    {
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
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

    private function userCanHrApproveExpense($user): bool
    {
        if (!$user) return false;

        if (in_array($user->user_type, ['super_admin', 'client_admin', 'client_user'], true)) {
            return false;
        }

        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            return $user->user_type === 'branch_user';
        }
        return Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_approve', true)
            ->exists();
    }

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
            return ['kind' => 'branch', 'label' => 'Employees in your branch'];
        }
        if ($user->user_type === 'employee') {
            return ['kind' => 'reports', 'label' => 'Employees reporting to you'];
        }
        return ['kind' => 'none', 'label' => 'No team'];
    }
}
