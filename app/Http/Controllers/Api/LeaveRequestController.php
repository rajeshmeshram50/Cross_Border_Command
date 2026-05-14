<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LeaveRequest;
use Carbon\CarbonPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class LeaveRequestController extends Controller
{
    // ─────────────────────────────────────────────────────────────────────
    // List — employee's own requests (Pending + History)
    // ─────────────────────────────────────────────────────────────────────
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // The Employee Profile page can be opened for any employee by an
        // admin, so accept an explicit employee_id query param. Falls back
        // to the user's linked employee record (employees.user_id = users.id).
        $employeeId = $request->integer('employee_id') ?: null;
        if (!$employeeId) {
            $own = Employee::where('user_id', $user->id)->first();
            if (!$own) {
                return response()->json(['data' => []]);
            }
            $employeeId = $own->id;
        }

        $status = $request->input('status'); // 'Pending' | 'Approved' | 'Rejected' | null
        $q = LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->with([
                'leaveType:id,name,short_code,type',
                'leavePlan:id,plan_name',
                'coverPerson:id,first_name,last_name,display_name',
                'approver:id,name',
            ])
            ->orderByDesc('from_date');
        if ($status) $q->where('status', $status);

        return response()->json(['data' => $q->get()]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Store — employee submits a new leave application
    // ─────────────────────────────────────────────────────────────────────
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'employee_id' => ['nullable', 'integer', 'exists:employees,id'],
            'leave_type_id' => ['required', 'integer', 'exists:master_leave_types,id'],
            'from_date' => ['required', 'date'],
            'to_date' => ['required', 'date', 'after_or_equal:from_date'],
            'day_type' => ['nullable', Rule::in(['full', 'first_half', 'second_half'])],
            'reason' => ['nullable', 'string'],
            'attachment_path' => ['nullable', 'string', 'max:1024'],
            'notify' => ['nullable', 'array'],
            'handover_required' => ['nullable', 'boolean'],
            'cover_person_id' => ['nullable', 'integer', 'exists:employees,id'],
            'handover_notes' => ['nullable', 'string'],
            'critical_tasks' => ['nullable', 'string'],
            'avail_on_call' => ['nullable', 'boolean'],
            'emergency_number' => ['nullable', 'string', 'max:50'],
            'avail_note' => ['nullable', 'string'],
        ]);

        // Resolve target employee — explicit id (admin filing on behalf) or
        // the signed-in user's own employee row.
        $employee = null;
        if (!empty($data['employee_id'])) {
            $employee = Employee::find($data['employee_id']);
        }
        if (!$employee) {
            $employee = Employee::where('user_id', $user->id)->first();
        }
        if (!$employee) {
            abort(422, 'Could not resolve target employee for this leave request.');
        }

        // Compute days. Half-day requests collapse to 0.5; otherwise count
        // the calendar span inclusive. Weekend exclusion is a future task —
        // for now we count straight calendar days so the math is predictable.
        $from = Carbon::parse($data['from_date']);
        $to = Carbon::parse($data['to_date']);
        $dayType = $data['day_type'] ?? 'full';
        if ($dayType !== 'full' && $from->isSameDay($to)) {
            $days = 0.5;
        } else {
            $days = CarbonPeriod::create($from, $to)->count();
        }

        // Find the employee's current leave plan (if any) for stamping.
        $planId = DB::table('leave_plan_employees')
            ->where('employee_id', $employee->id)
            ->value('leave_plan_id');

        $row = LeaveRequest::create([
            'client_id' => $employee->client_id,
            'branch_id' => $employee->branch_id,
            'employee_id' => $employee->id,
            'leave_type_id' => $data['leave_type_id'],
            'leave_plan_id' => $planId,
            'from_date' => $from->toDateString(),
            'to_date' => $to->toDateString(),
            'days' => $days,
            'day_type' => $dayType,
            'reason' => $data['reason'] ?? null,
            'attachment_path' => $data['attachment_path'] ?? null,
            'notify' => $data['notify'] ?? null,
            'handover_required' => !empty($data['handover_required']),
            'cover_person_id' => $data['cover_person_id'] ?? null,
            'handover_notes' => $data['handover_notes'] ?? null,
            'critical_tasks' => $data['critical_tasks'] ?? null,
            'avail_on_call' => !empty($data['avail_on_call']),
            'emergency_number' => $data['emergency_number'] ?? null,
            'avail_note' => $data['avail_note'] ?? null,
            'status' => 'Pending',
            'created_by' => $user->id,
        ]);

        return response()->json(['data' => $row->load(['leaveType:id,name,short_code', 'leavePlan:id,plan_name'])], 201);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approve / Reject — reporting manager or HR acts on a request
    // ─────────────────────────────────────────────────────────────────────
    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Rejected');
    }

    public function cancel(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = LeaveRequest::findOrFail($id);
        // Only the requester (or HR) can cancel their own pending request.
        $isOwner = Employee::where('id', $row->employee_id)->where('user_id', $user->id)->exists();
        if (!$isOwner && !in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'You can only cancel your own leave requests.');
        }
        if ($row->status !== 'Pending') {
            abort(422, 'Only Pending requests can be cancelled.');
        }
        $row->status = 'Cancelled';
        $row->save();
        return response()->json(['data' => $row]);
    }

    private function setStatus(Request $request, int $id, string $next)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = LeaveRequest::findOrFail($id);
        if ($row->status !== 'Pending') {
            abort(422, "Leave request is already {$row->status}.");
        }
        $data = $request->validate([
            'comment' => ['nullable', 'string'],
        ]);
        $row->status = $next;
        $row->approved_by = $user->id;
        $row->approved_at = now();
        $row->approver_comment = $data['comment'] ?? null;
        $row->save();
        return response()->json(['data' => $row->fresh(['leaveType:id,name,short_code'])]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approvers list — surfaces the "View Approvers" popover on a request
    // ─────────────────────────────────────────────────────────────────────
    public function approvers(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = LeaveRequest::findOrFail($id);
        $employee = Employee::find($row->employee_id);
        $approvers = [];

        if ($employee && $employee->reporting_manager_id) {
            $rm = Employee::with('user:id,name,email')->find($employee->reporting_manager_id);
            if ($rm) {
                $name = trim($rm->display_name ?: trim(($rm->first_name ?? '') . ' ' . ($rm->last_name ?? '')));
                $approvers[] = [
                    'role' => 'Reporting Manager',
                    'employee_id' => $rm->id,
                    'name' => $name,
                    'email' => $rm->email,
                ];
            }
        }

        return response()->json(['data' => $approvers]);
    }
}
