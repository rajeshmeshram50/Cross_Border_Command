import api from '../../../api';

/**
 * Thin REST helpers for Sales Matrix → Productivity Tracker
 * (/sales/reminders + /sales/meetings). Mirrors the shape used by
 * leavePlansApi.ts so the page code reads like local CRUD.
 *
 * Backend stores dates as YYYY-MM-DD; this helper converts to the SPA's
 * canonical dd/mm/yyyy display format and back. Times stay HH:mm.
 */

export type ReminderStatus = 'In Progress' | 'Done';
export type MeetingType    = 'virtual' | 'physical';
export type MeetingStatus  = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';

/* Shapes returned by the API — fields mirror the Eloquent column names
 * (snake_case) and are normalised to display-friendly shapes by the
 * caller. */
export interface ApiReminder {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  created_by_user_id: number;
  employee_id: number | null;
  opp_id: string | null;
  opp_date: string | null;             // YYYY-MM-DD
  subject: string;
  set_date: string;                    // YYYY-MM-DD
  tat: string;
  remark: string | null;
  attachment_path: string | null;
  attachment_original_name: string | null;
  attachment_url: string | null;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
  creator?: { id: number; name: string; email: string };
}

export interface ApiMeeting {
  id: number;
  client_id: number | null;
  branch_id: number | null;
  created_by_user_id: number;
  employee_id: number | null;
  code: string;                        // M-001 / P-001
  opp_id: string | null;
  customer: string;
  email: string | null;
  contact: string | null;
  platform: string | null;
  date: string;                        // YYYY-MM-DD
  start_time: string | null;           // HH:mm:ss
  end_time: string | null;             // HH:mm:ss
  link: string | null;
  venue: string | null;
  agenda: string | null;
  status: MeetingStatus;
  type: MeetingType;
  created_at: string;
  updated_at: string;
  creator?: { id: number; name: string; email: string };
}

/* ── REMINDERS ─────────────────────────────────────────────────────── */

export interface ReminderPayload {
  opp_id?: string;
  opp_date?: string | null;            // YYYY-MM-DD
  subject: string;
  set_date: string;                    // YYYY-MM-DD
  tat?: string;
  remark?: string;
  status?: ReminderStatus;
  attachment?: File | null;
}

export const remindersApi = {
  async list(params?: { scope?: 'mine' | 'all'; status?: ReminderStatus; search?: string }): Promise<ApiReminder[]> {
    const r = await api.get('/sales/reminders', { params });
    return (Array.isArray(r.data) ? r.data : r.data?.data) ?? [];
  },

  async create(payload: ReminderPayload): Promise<ApiReminder> {
    const r = await api.post('/sales/reminders', buildReminderForm(payload), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  async update(id: number, payload: ReminderPayload): Promise<ApiReminder> {
    // Laravel can't parse multipart bodies on PUT, so we route through
    // POST with `_method=PUT`. The backend's update endpoint is wired to
    // accept POST at /sales/reminders/{id} for exactly this reason.
    const fd = buildReminderForm(payload);
    fd.append('_method', 'PUT');
    const r = await api.post(`/sales/reminders/${id}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  async setStatus(id: number, status: ReminderStatus): Promise<ApiReminder> {
    const r = await api.patch(`/sales/reminders/${id}/status`, { status });
    return r.data;
  },

  async destroy(id: number): Promise<void> {
    await api.delete(`/sales/reminders/${id}`);
  },
};

function buildReminderForm(p: ReminderPayload): FormData {
  const fd = new FormData();
  if (p.opp_id !== undefined)   fd.append('opp_id', p.opp_id);
  if (p.opp_date !== undefined && p.opp_date !== null) fd.append('opp_date', p.opp_date);
  fd.append('subject',  p.subject);
  fd.append('set_date', p.set_date);
  if (p.tat)               fd.append('tat', p.tat);
  if (p.remark !== undefined) fd.append('remark', p.remark);
  if (p.status)            fd.append('status', p.status);
  if (p.attachment instanceof File) fd.append('attachment', p.attachment);
  return fd;
}

/* ── MEETINGS ──────────────────────────────────────────────────────── */

export interface MeetingPayload {
  type: MeetingType;
  opp_id?: string;
  customer: string;
  email?: string;
  contact?: string;
  platform?: string;
  date: string;                        // YYYY-MM-DD
  start_time?: string;                 // HH:mm
  end_time?: string;                   // HH:mm
  link?: string;
  venue?: string;
  agenda?: string;
  status?: MeetingStatus;
}

export const meetingsApi = {
  async list(params?: { scope?: 'mine' | 'all'; type?: MeetingType; status?: MeetingStatus; search?: string }): Promise<ApiMeeting[]> {
    const r = await api.get('/sales/meetings', { params });
    return (Array.isArray(r.data) ? r.data : r.data?.data) ?? [];
  },

  async nextCode(type: MeetingType): Promise<string> {
    const r = await api.get('/sales/meetings/next-code', { params: { type } });
    return r.data?.code ?? (type === 'physical' ? 'P-001' : 'M-001');
  },

  async create(payload: MeetingPayload): Promise<ApiMeeting> {
    const r = await api.post('/sales/meetings', payload);
    return r.data;
  },

  async update(id: number, payload: MeetingPayload): Promise<ApiMeeting> {
    const r = await api.put(`/sales/meetings/${id}`, payload);
    return r.data;
  },

  async setStatus(id: number, status: MeetingStatus): Promise<ApiMeeting> {
    const r = await api.patch(`/sales/meetings/${id}/status`, { status });
    return r.data;
  },

  async destroy(id: number): Promise<void> {
    await api.delete(`/sales/meetings/${id}`);
  },
};

/* ── Date format helpers — bridge backend YYYY-MM-DD ↔ display dd/mm/yyyy. */
export const isoToDisplay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

export const displayToIso = (display: string | null | undefined): string => {
  if (!display) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(display);
  if (!m) return display;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

export const hmsToHm = (t: string | null | undefined): string => {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
};
