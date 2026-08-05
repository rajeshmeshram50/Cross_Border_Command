import api from '../../api';

export type RegularizationStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type RegularizationMode = 'adjust' | 'exempt';

export interface ApiRegPunch {
  in: string | null;
  out: string | null;
}

export interface ApiRegularization {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  employee_id: number;
  attendance_id: number | null;
  regularization_date: string;
  mode: RegularizationMode;
  type: string | null;
  work_locations: string[] | null;
  punches: ApiRegPunch[] | null;
  reason: string | null;
  status: RegularizationStatus;
  current_approval_level?: number | null;
  approved_by: number | null;
  approved_at: string | null;
  approver_comment: string | null;
  // Whether the logged-in user may Approve/Reject this row right now. Server-computed.
  can_act_now?: boolean;
  /** The day BEFORE this correction, as "09:26 – 18:40". Server-built: the
   *  frozen pre-approval snapshot once acted on, or a live read of the day's
   *  punches while still pending. */
  original_display?: string | null;
  original_punches?: { time: string; direction: string; label?: string | null; method?: string | null }[] | null;
  original_summary?: string | null;
  // Only present on the create() response — the ACTUAL approver the request was
  // routed to (or auto_approved when there's no one to act). Used for a truthful
  // success toast instead of guessing from the org chart (bug #29).
  auto_approved?: boolean;
  pending_approver_label?: { name: string | null; role: string } | null;
  created_at: string;
  updated_at: string;
  approver?: { id: number; name: string } | null;
  employee?: {
    id: number;
    emp_code: string;
    first_name: string;
    last_name: string | null;
    display_name: string | null;
    department?: { id: number; name: string } | null;
    reporting_manager?: { id: number; first_name: string; last_name: string | null; display_name: string | null } | null;
    reporting_manager_user?: { id: number; name?: string | null } | null;
  };
}

export interface ApiRegularizationPayload {
  employee_id?: number;
  regularization_date: string;          // YYYY-MM-DD
  mode: RegularizationMode;
  type?: string;
  work_locations?: string[];
  punches?: ApiRegPunch[];
  reason: string;
}

export interface ApiRegularizationApprover {
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

export const regularizationApi = {
  list: (params: { employee_id?: number; status?: RegularizationStatus } = {}) =>
    api.get<{ data: ApiRegularization[] }>('/regularizations', { params }).then(r => r.data.data),

  show: (id: number) =>
    api.get<{ data: ApiRegularization }>(`/regularizations/${id}`).then(r => r.data.data),

  create: (payload: ApiRegularizationPayload) =>
    api.post<{ data: ApiRegularization }>('/regularizations', payload).then(r => r.data.data),

  approvers: (id: number) =>
    api.get<{ data: ApiRegularizationApprover[] }>(`/regularizations/${id}/approvers`).then(r => r.data.data),

  approve: (id: number, comment?: string) =>
    api.post<{ data: ApiRegularization }>(`/regularizations/${id}/approve`, { comment }).then(r => r.data.data),

  reject: (id: number, comment?: string) =>
    api.post<{ data: ApiRegularization }>(`/regularizations/${id}/reject`, { comment }).then(r => r.data.data),

  cancel: (id: number) =>
    api.post<{ data: ApiRegularization }>(`/regularizations/${id}/cancel`).then(r => r.data.data),

  approvals: (params: { status?: string; search?: string; branch_id?: number } = {}) =>
    api.get<{ data: ApiRegularization[] }>('/regularizations/approvals', { params })
      // Always resolve to an array — a missing/differently-shaped `data.data`
      // (e.g. an empty or error body) must not leave `rows` undefined and crash
      // the list render (`rows.length`).
      .then(r => (Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? (r.data as unknown as ApiRegularization[]) : []))),
};
