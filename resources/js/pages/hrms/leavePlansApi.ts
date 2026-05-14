import api from '../../api';

// ─────────────────────────────────────────────────────────────────────────────
// Backend response shapes — mirror the Eloquent models in
// app/Models/Masters/{LeavePlans, LeaveTypes, LeavePlanLeaveType}.php.
// ─────────────────────────────────────────────────────────────────────────────
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
  // Pivot fields appear when fetched through plan.leaveTypes
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
}

// ─────────────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Leave Balances — aggregated employee × leave-type read used by the
// Leave Balances tab. Columns are dynamic (driven by what's actually
// assigned across plans), so callers iterate the response's `columns`
// array to render headers and `employees[].balances` for cells.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Leave Type catalog — uses the existing generic /master/leave_type endpoint
// rather than a dedicated controller. The catalog is what the "Add Leave
// Type" modal manages and what "Assign Leave Types to Plan" picks from.
// ─────────────────────────────────────────────────────────────────────────────
export const leaveTypesApi = {
  list: () =>
    api.get<{ data?: ApiLeaveType[] } | ApiLeaveType[]>('/master/leave_type').then(r => {
      // MasterController returns either {data: [...]} or a paginator wrapper —
      // unwrap to a plain array regardless.
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
