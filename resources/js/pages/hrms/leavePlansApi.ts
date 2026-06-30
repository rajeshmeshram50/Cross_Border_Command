import api from '../../api';

export interface ApiLeaveType {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  name: string;
  description: string | null;
  type: 'Regular' | 'Incident Based Leave' | 'Unpaid Leave' | 'Compoff' | null;
  short_code: string;
  is_sick_medical: boolean;
  paid_unpaid: 'Paid' | 'Unpaid' | null;
  gender_restriction: 'None' | 'Male' | 'Female';
  status: 'Active' | 'Inactive';
  pivot?: {
    id: number;
    leave_plan_id: number;
    leave_type_id: number;
    config_json: Record<string, any> | null;
    quota_summary: string | null;
    eoy_summary: string | null;
    is_setup: boolean;
  };
}

export interface ApiLeavePlan {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  plan_name: string;
  description: string | null;
  calendar_year: string | null;
  from_month_type: 'Calendar' | 'If Joining' | null;
  from_month: string | null;
  is_default: boolean;
  policy_explanation_mode: 'System' | 'Custom';
  policy_doc_path: string | null;
  status: 'Active' | 'Inactive';
  employees_count?: number;
  leave_types_count?: number;
  /** True only when the plan has ≥1 leave type AND every assigned type has its
   *  quota setup saved. The employee-form dropdowns hide plans where this is
   *  false (server-computed in LeavePlanController::index). */
  setup_complete?: boolean;
  client?: { id: number; org_name: string };
  branch?: { id: number; name: string };
  leave_types?: ApiLeaveType[];
  employees?: ApiPlanEmployee[];
}

export interface ApiPlanEmployee {
  id: number;
  emp_code: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  location: string | null;
  department?: { id: number; name: string } | null;
  designation?: { id: number; name: string } | null;
  reporting_manager?: {
    id: number;
    first_name: string;
    last_name: string;
    display_name: string | null;
  } | null;
  reporting_manager_user?: { id: number; name?: string | null; user_type?: string | null } | null;
}

export const leavePlansApi = {
  list: () =>
    api.get<{ data: ApiLeavePlan[] }>('/leave-plans').then(r => r.data.data),

  show: (id: number) =>
    api.get<{ data: ApiLeavePlan }>(`/leave-plans/${id}`).then(r => r.data.data),

  create: (payload: Partial<ApiLeavePlan>) =>
    api.post<{ data: ApiLeavePlan }>('/leave-plans', payload).then(r => r.data.data),

  update: (id: number, payload: Partial<ApiLeavePlan>) =>
    api.put<{ data: ApiLeavePlan }>(`/leave-plans/${id}`, payload).then(r => r.data.data),

  remove: (id: number) =>
    api.delete(`/leave-plans/${id}`),

  clone: (id: number, plan_name?: string) =>
    api.post<{ data: ApiLeavePlan }>(`/leave-plans/${id}/clone`, { plan_name }).then(r => r.data.data),

  makeDefault: (id: number) =>
    api.post<{ data: ApiLeavePlan }>(`/leave-plans/${id}/make-default`).then(r => r.data.data),

  assignTypes: (id: number, leave_type_ids: number[], mode: 'replace' | 'append' = 'replace') =>
    api.post<{ data: ApiLeavePlan }>(`/leave-plans/${id}/types`, { leave_type_ids, mode }).then(r => r.data.data),

  removeType: (id: number, typeId: number) =>
    api.delete(`/leave-plans/${id}/types/${typeId}`),

  saveTypeConfig: (id: number, typeId: number, config: Record<string, any>, quota_summary?: string, eoy_summary?: string) =>
    api.put(`/leave-plans/${id}/types/${typeId}/config`, { config, quota_summary, eoy_summary }),

  assignEmployees: (id: number, employee_ids: number[]) =>
    api.post(`/leave-plans/${id}/employees`, { employee_ids }),

  removeEmployee: (id: number, employeeId: number) =>
    api.delete(`/leave-plans/${id}/employees/${employeeId}`),
};

export interface ApiLeaveBalanceColumn {
  leave_type_id: number;
  name: string;
  short_code: string;
  category: string | null;
  paid_unpaid: 'Paid' | 'Unpaid' | null;
}

export interface ApiLeaveBalanceCell {
  leave_type_id: number;
  applies: boolean;
  unlimited: boolean;
  quota: number;
  used: number;
  available: number | null;
}

export interface ApiLeaveBalanceRow {
  id: number;
  emp_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  location: string | null;
  plan_id: number;
  plan_name: string | null;
  balances: ApiLeaveBalanceCell[];
}

export interface ApiLeaveBalancesResponse {
  columns: ApiLeaveBalanceColumn[];
  employees: ApiLeaveBalanceRow[];
  filters: { departments: string[]; locations: string[] };
}

export const leaveBalancesApi = {
  fetch: (params: { department_id?: number; location?: string; search?: string } = {}) =>
    api.get<{ data: ApiLeaveBalancesResponse }>('/leave-balances', { params }).then(r => r.data.data),
};

export const leaveTypesApi = {
  list: () =>
    api.get<{ data?: ApiLeaveType[] } | ApiLeaveType[]>('/master/leave_type').then(r => {
      const body: any = r.data;
      if (Array.isArray(body)) return body as ApiLeaveType[];
      if (Array.isArray(body?.data)) return body.data as ApiLeaveType[];
      return [] as ApiLeaveType[];
    }),

  create: (payload: Partial<ApiLeaveType>) =>
    api.post<{ data: ApiLeaveType }>('/master/leave_type', payload).then(r => r.data.data ?? (r.data as any)),

  update: (id: number, payload: Partial<ApiLeaveType>) =>
    api.put<{ data: ApiLeaveType }>(`/master/leave_type/${id}`, payload).then(r => r.data.data ?? (r.data as any)),

  remove: (id: number) =>
    api.delete(`/master/leave_type/${id}`),
};

export interface ApiLeaveRequest {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  employee_id: number;
  leave_type_id: number;
  leave_plan_id: number | null;
  from_date: string;
  to_date: string;
  days: string | number;
  day_type: 'full' | 'first_half' | 'second_half';
  reason: string | null;
  attachment_path: string | null;
  notify: Record<string, any> | null;
  handover_required: boolean;
  cover_person_id: number | null;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  approved_by: number | null;
  approved_at: string | null;
  approver_comment: string | null;
  /** Set the first time a view-only HR user opens the request — drives the
   *  green "HR reviewed" node in the timeline. */
  hr_viewed_at: string | null;
  hr_viewed_by: number | null;
  current_approval_level?: number | null;
  // Whether the logged-in user may Approve/Reject this row right now (it's
  // pending AND they're the approver for the current level). Server-computed.
  can_act_now?: boolean;
  created_at: string;
  updated_at: string;
  leave_type?: { id: number; name: string; short_code: string; type: string | null; paid_unpaid?: 'Paid' | 'Unpaid' | null };
  leave_plan?: { id: number; plan_name: string };
  cover_person?: { id: number; first_name: string; last_name: string | null; display_name: string | null; emp_code?: string };
  approver?: { id: number; name: string };
  employee?: {
    id: number;
    emp_code: string;
    first_name: string;
    last_name: string | null;
    display_name: string | null;
    email?: string | null;
    department_id?: number | null;
    designation_id?: number | null;
    reporting_manager_id?: number | null;
    department?: { id: number; name: string } | null;
    designation?: { id: number; name: string } | null;
    reporting_manager?: { id: number; first_name: string; last_name: string | null; display_name: string | null; email?: string | null } | null;
  };
}

export interface ApiLeaveRequestPayload {
  employee_id?: number;
  leave_type_id: number;
  from_date: string;
  to_date: string;
  day_type?: 'full' | 'first_half' | 'second_half';
  reason?: string;
  attachment_path?: string;
  notify?: Record<string, any>;
  handover_required?: boolean;
  cover_person_id?: number;
  handover_notes?: string;
  critical_tasks?: string;
  avail_on_call?: boolean;
  emergency_number?: string;
  avail_note?: string;
}

export interface ApiLeaveApprover {
  level: number;
  role: string;
  kind: string;
  employee_id: number | null;
  name: string;
  email: string | null;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Skipped';
  acted_at: string | null;
  comment: string | null;
  is_current: boolean;
}

export const leaveRequestsApi = {
  list: (params: { employee_id?: number; status?: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' } = {}) =>
    api.get<{ data: ApiLeaveRequest[] }>('/leave-requests', { params }).then(r => r.data.data),

  show: (id: number) =>
    api.get<{ data: ApiLeaveRequest }>(`/leave-requests/${id}`).then(r => r.data.data),

  create: (payload: ApiLeaveRequestPayload) =>
    api.post<{ data: ApiLeaveRequest }>('/leave-requests', payload).then(r => r.data.data),

  approvers: (id: number) =>
    api.get<{ data: ApiLeaveApprover[] }>(`/leave-requests/${id}/approvers`).then(r => r.data.data),

  approve: (id: number, comment?: string) =>
    api.post<{ data: ApiLeaveRequest }>(`/leave-requests/${id}/approve`, { comment }).then(r => r.data.data),

  reject: (id: number, comment?: string) =>
    api.post<{ data: ApiLeaveRequest }>(`/leave-requests/${id}/reject`, { comment }).then(r => r.data.data),

  cancel: (id: number) =>
    api.post<{ data: ApiLeaveRequest }>(`/leave-requests/${id}/cancel`).then(r => r.data.data),

  /** Mark the request as viewed by HR (idempotent server-side). */
  hrView: (id: number) =>
    api.post<{ data: ApiLeaveRequest }>(`/leave-requests/${id}/hr-view`).then(r => r.data.data),

  approvals: (params: { status?: string; search?: string; branch_id?: number } = {}) =>
    api.get<{ data: ApiLeaveRequest[] }>('/leave-requests/approvals', { params }).then(r => r.data.data),
};

export interface ApiEmployeeBalanceTransaction {
  date: string;
  change: string;
  balance: number;
  reason: string;
  kind: 'accrual' | 'approved' | 'pending' | 'adjustment';
}

export interface ApiEmployeeBalanceType {
  leave_type_id: number;
  name: string;
  short_code: string;
  category: string | null;
  paid_unpaid: 'Paid' | 'Unpaid' | null;
  quota: number;
  /** Days vested so far this plan year (periodic accrual grows over the year).
   *  `available` is derived from this, not the full `quota`. */
  accrued: number;
  /** Extra/overdraft days the employee may avail beyond the accrued quota
   *  (from the plan's "Extra Leave" setup). 0 when not enabled. Shown as a
   *  breakdown — it is NOT added to `quota` / `available`. */
  extra: number;
  used: number;
  available: number | null;
  unlimited: boolean;
  /** Whether this leave type permits half-day (first/second half) requests. */
  allow_half_day?: boolean;
  transactions: ApiEmployeeBalanceTransaction[];
}

export interface ApiEmployeeBalanceResponse {
  employee: {
    id: number;
    name: string;
    department?: string | null;
    plan_id: number | null;
    plan_name: string | null;
  };
  types: ApiEmployeeBalanceType[];
}

export const employeeBalancesApi = {
  fetch: (employeeId: number) =>
    api.get<{ data: ApiEmployeeBalanceResponse }>(`/employees/${employeeId}/leave-balances`).then(r => r.data.data),
};
