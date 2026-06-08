import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Popover, PopoverBody } from 'reactstrap';
import { MasterFormStyles, MasterDatePicker } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { Turtle } from 'lucide-react';
import api from '../../api';
import '../../../css/recruitment.css';

// "Today" anchor — dynamic, locked at module load so a single render pass
// stays consistent. Date picker / refetch uses this as the default `viewDate`.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_LABELS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const parseISO  = (iso: string) => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toISO     = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays   = (iso: string, n: number) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtLong   = (iso: string) => { const d = parseISO(iso); return `${WEEK_LABELS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
const monthKey  = (iso: string) => `${iso.slice(0,7)}`;                      // "2026-04"
const monthOf   = (iso: string) => MONTHS_SHORT[parseISO(iso).getMonth()];   // "Apr"
const yearOf    = (iso: string) => parseISO(iso).getFullYear();

// ─────────────────────────────────────────────────────────────────────────────
// Types — these match the live Employee model fields. When the backend
// endpoints land we map directly: `attendance_tracking`, `shift`, `weekly_off`,
// `attendance_number`, `reporting_manager` are all already on Employee.
// ─────────────────────────────────────────────────────────────────────────────
type DayStatus =
  | 'Present'
  | 'Late'
  | 'Half Day'
  | 'Missing In'
  | 'Missing Out'
  | 'Weekly Off'
  | 'Holiday'
  | 'On Duty'
  | 'Work From Home'
  | 'Absent'
  | 'Leave'
  | 'Corrected';

// Two regularization modes — mirrors the Keka pattern. "adjust" = the employee
// (or HR on behalf) is editing the actual punch list for the day. "exempt" =
// no time edits, just request the day be excluded from late/absent penalty.
type RegMode = 'adjust' | 'exempt';

type CorrStatus = 'Pending' | 'Approved' | 'Rejected';
type ApprovalState = 'Pending' | 'Approved' | 'Rejected' | 'NA';

// One row inside the multi-punch editor on the regularization form. Mirrors
// the editable in/out pair shown in the Keka screenshot.
interface PunchEdit {
  // What kind of change this row represents.
  //   add    — new punch pair added by the requester
  //   edit   — existing punch's time being changed
  //   keep   — original row, no change (renders read-only in the editor)
  //   delete — existing punch being removed
  action: 'add' | 'edit' | 'keep' | 'delete';
  // Original times (for keep/edit/delete — null for add)
  oldIn?: string;
  oldOut?: string;
  // Requested times (for add/edit — empty string for delete)
  newIn: string;
  newOut: string;
}

// A request that goes through the Employee → Manager → HR workflow. New
// shape used by the Approval Queue. Old `CorrectionRequest` (defined further
// below alongside the original modal) stays during the transition.
interface ApprovalRequest {
  id: string;                    // CR-1042
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  managerId: number;
  managerName: string;
  date: string;                  // "21 Apr 2026" — day being corrected
  raisedAt: string;              // when the request was submitted
  raisedBy: 'employee' | 'hr';   // 'hr' = raised on behalf
  mode: RegMode;
  punchEdits: PunchEdit[];       // for mode === 'adjust'
  workLocations: string[];       // multi-select
  reason: string;
  // Workflow state — manager decides first, then HR may override on dispute
  managerStatus: ApprovalState;
  managerActionAt?: string;
  managerComment?: string;
  hrStatus: ApprovalState;       // 'NA' until escalated to HR
  hrActionAt?: string;
  hrComment?: string;
  // Final derived state (cached)
  status: ApprovalState;
}

// Preset work locations for the regularization form. When the backend lands,
// this'll come from a `master_work_locations` table per client/branch.
const WORK_LOCATIONS = ['Baner Office', 'Wakad Office', 'WFH', 'Client Site', 'Field Visit'];

interface AttendanceEmployee {
  id: number;
  empCode: string;            // emp_code
  name: string;               // display_name
  initials: string;
  accent: string;
  department: string;
  designation: string;
  managerName: string;        // for the approval routing line
  shift: string;              // e.g. "General (09:00 – 18:00)"
  shiftStart: string;         // "09:00"
  shiftEnd: string;           // "18:00"
  weeklyOff: string;          // "Sun" | "Sat, Sun" | "Alt Sat, Sun"
  attendanceNumber: string;   // biometric punch ID
  // Today
  status: DayStatus;
  firstIn?: string;
  lastOut?: string | null;    // null → still in (In Progress)
  workedMinutes: number;
  expectedMinutes: number;
  lateByMinutes: number;
  punches: PunchEvent[];
  // Open correction (the badge on the left list, and the action card on the right)
  correction?: CorrectionRequest;
  // Month-to-date
  presentDays: number;
  lateMarks: number;
  missingPunch: number;
  compliancePct: number;
  // History (last N rows of daily_attendance for this employee)
  logs: AttendanceLog[];
}

interface PunchEvent {
  time: string;
  type: 'in' | 'out' | 'missing';
  source: 'BIOMETRIC' | 'MANUAL' | 'WEB' | 'MOBILE';
  /** Human label for the timeline (Check In / Step Out / Lunch Out / etc.).
   *  Falls back to "Check In" / "Check Out" by type when omitted. */
  label?: string;
  worked?: string;
  breakAfter?: string;
  note?: string;
  /** Geo-fix recorded at punch time. Sent by the SPA on
   *  /attendance/face/clock-in & clock-out. Optional — missing punches and
   *  legacy records won't have it. `place` is reverse-geocoded server-side
   *  (or by the mobile app) for human-readable display. */
  lat?: number | null;
  lng?: number | null;
  place?: string | null;
}

interface CorrectionRequest {
  id: string;
  date: string;            // "21 Apr 2026"
  type: string;
  requestedIn?: string;    // "09:32"
  requestedOut?: string;
  reason: string;
  status: CorrStatus;
  raisedAt: string;        // "21 Apr 2026 14:12"
  managerActionAt?: string;
  hrActionAt?: string;
}

interface AttendanceLog {
  iso?: string;              // YYYY-MM-DD — backend emits this for Calendar lookup
  date: string;              // human-readable, e.g. "13 May 2026"
  weekday: string;
  status: DayStatus;
  shift: string;
  firstIn: string;
  lastOut: string;
  worked: string;
  deviation: string;
  exception?: string;
  /* Keka-style visual fields. Hours are 0-24 floats so they map cleanly onto
   * the 24-h timeline bar in the table. */
  workSegments?: Array<{ start: number; end: number }>;
  effectiveMinutes?: number;
  grossMinutes?: number;
  expectedMinutes?: number;
  lateMinutes?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status palette — one source of truth
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_TONE: Record<DayStatus, { fg: string; bg: string; dot: string; label: string }> = {
  'Present':         { fg: '#15803d', bg: '#dcfce7', dot: '#22c55e', label: 'Present' },
  'Late':            { fg: '#92400e', bg: '#fef3c7', dot: '#f59e0b', label: 'Late' },
  'Half Day':        { fg: '#92400e', bg: '#fef3c7', dot: '#f59e0b', label: 'Half Day' },
  'Missing In':      { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Missing In' },
  'Missing Out':     { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Missing Out' },
  'Weekly Off':      { fg: '#3b82f6', bg: '#dbeafe', dot: '#60a5fa', label: 'Weekly Off' },
  'Holiday':         { fg: '#3b82f6', bg: '#dbeafe', dot: '#60a5fa', label: 'Holiday' },
  'On Duty':         { fg: '#0d9488', bg: '#ccfbf1', dot: '#14b8a6', label: 'On Duty' },
  'Work From Home':  { fg: '#0d9488', bg: '#ccfbf1', dot: '#14b8a6', label: 'WFH' },
  'Absent':          { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Absent' },
  'Leave':           { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Leave' },
  'Corrected':       { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Corrected' },
};


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e', '#a855f7'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];
const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

// Render a 24-h "HH:MM" time as the big tile value with a small AM/PM suffix.
// Returns "—" for empty/null. Hour 0 displays as 12 AM, 12 displays as 12 PM.
const renderTime = (t?: string | null): ReactNode => {
  if (!t) return '—';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? ' PM' : ' AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return <>{`${String(h12).padStart(2,'0')}:${mm}`}<span className="att-tile-am">{ampm}</span></>;
};

// Deterministic per-(employee, date) status for the calendar grid. When backend
// is wired, replace with `daily_attendance` rows for the month. Keeps weekly-off
// as `Weekly Off`, future dates as `null` so the cell stays blank.
const dayHash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); };
const statusForDate = (empId: number, iso: string): DayStatus | null => {
  if (iso > TODAY_ISO) return null;
  const d = parseISO(iso);
  if (d.getDay() === 0) return 'Weekly Off';
  const h = dayHash(`${empId}-${iso}`) % 100;
  if (h < 4)  return 'Absent';
  if (h < 8)  return 'Leave';
  if (h < 14) return 'Late';
  if (h < 17) return 'Half Day';
  if (h < 20) return 'Work From Home';
  if (h < 22) return 'On Duty';
  if (h < 24) return 'Missing Out';
  return 'Present';
};

// ─────────────────────────────────────────────────────────────────────────────
// Dummy data builder — wire to `GET /api/attendance/daily?date=YYYY-MM-DD` later
// ─────────────────────────────────────────────────────────────────────────────
// Fixed office locations so timeline punches show realistic coordinates.
// Replace with real lat/lng/place from the punches table once geo capture is
// rolled out to every employee.
const OFFICE_BIOMETRIC = { lat: 18.5908, lng: 73.7378, place: 'Hinjewadi Phase 1, Pune' };
const OFFICE_DESK_WEB  = { lat: 18.5912, lng: 73.7388, place: 'Hinjewadi Phase 1, Pune' };
const FIELD_CLIENT     = { lat: 18.5641, lng: 73.7765, place: 'Baner Office, Pune' };
const HOME_WFH         = { lat: 18.5288, lng: 73.8746, place: 'Koregaon Park, Pune' };

const buildPunches = (kind: 'normal' | 'late' | 'missing-out' | 'missing-in' | 'partial'): PunchEvent[] => {
  if (kind === 'late') return [
    { time: '09:32 AM', type: 'in',      label: 'Check In',  source: 'BIOMETRIC', ...OFFICE_BIOMETRIC },
    { time: '01:14 PM', type: 'out',     label: 'Lunch Out', source: 'BIOMETRIC', worked: '3h 42m', ...OFFICE_BIOMETRIC },
    { time: '02:06 PM', type: 'in',      label: 'Lunch In',  source: 'BIOMETRIC', breakAfter: '52m', ...OFFICE_BIOMETRIC },
    { time: '—',         type: 'missing', label: 'Check Out',source: 'BIOMETRIC', note: 'Check Out — Missing punch' },
  ];
  if (kind === 'missing-out') return [
    { time: '09:00 AM', type: 'in',      label: 'Check In', source: 'BIOMETRIC', ...OFFICE_BIOMETRIC },
    { time: '—',         type: 'missing', label: 'Check Out',source: 'BIOMETRIC', note: 'Check Out — Missing punch' },
  ];
  if (kind === 'missing-in') return [
    { time: '—',         type: 'missing', label: 'Check In', source: 'BIOMETRIC', note: 'Check In — Missing punch' },
  ];
  if (kind === 'partial') return [
    { time: '09:05 AM', type: 'in',  label: 'Check In',  source: 'BIOMETRIC', ...OFFICE_BIOMETRIC },
    { time: '12:30 PM', type: 'out', label: 'Check Out', source: 'BIOMETRIC', worked: '3h 25m', ...OFFICE_BIOMETRIC },
  ];
  // "Normal" — a richer mock that exercises the horizontal timeline UI:
  // Check In → Step Out (field visit) → Step In → Lunch → Meeting (off-site)
  return [
    { time: '08:02 AM', type: 'in',  label: 'Check In',  source: 'BIOMETRIC',                            ...OFFICE_BIOMETRIC },
    { time: '10:15 AM', type: 'out', label: 'Step Out',  source: 'WEB',                                  ...FIELD_CLIENT },
    { time: '10:42 AM', type: 'in',  label: 'Step In',   source: 'WEB',       breakAfter: '27m',         ...OFFICE_DESK_WEB },
    { time: '12:30 PM', type: 'out', label: 'Lunch Out', source: 'BIOMETRIC', worked: '3h 48m',          ...OFFICE_BIOMETRIC },
    { time: '01:14 PM', type: 'in',  label: 'Lunch In',  source: 'BIOMETRIC', breakAfter: '44m',         ...OFFICE_BIOMETRIC },
    { time: '02:48 PM', type: 'out', label: 'Meeting',   source: 'MOBILE',                               ...FIELD_CLIENT },
    { time: '04:05 PM', type: 'in',  label: 'Back',      source: 'MOBILE',    breakAfter: '1h 17m',      ...HOME_WFH },
  ];
};

const buildLogs = (): AttendanceLog[] => [
  { date: '21 Apr 2026', weekday: 'Mon', status: 'Late',           shift: 'Early',   firstIn: '07:01', lastOut: '16:02', worked: '9h 01m', deviation: '+0h 01m', exception: 'Late Entry',
    workSegments: [{ start: 7.02, end: 13.02 }, { start: 14, end: 16.03 }], effectiveMinutes: 9 * 60 + 1, grossMinutes: 9 * 60 + 1, expectedMinutes: 9 * 60, lateMinutes: 1 },
  { date: '20 Apr 2026', weekday: 'Sun', status: 'Weekly Off',     shift: '—',       firstIn: '—',     lastOut: '—',     worked: '—',      deviation: '—' },
  { date: '18 Apr 2026', weekday: 'Fri', status: 'Present',        shift: 'General', firstIn: '09:15', lastOut: '18:20', worked: '9h 05m', deviation: '+0h 05m',
    workSegments: [{ start: 9.25, end: 13 }, { start: 14, end: 18.33 }], effectiveMinutes: 9 * 60 + 5, grossMinutes: 9 * 60 + 5, expectedMinutes: 9 * 60, lateMinutes: 15 },
  { date: '17 Apr 2026', weekday: 'Thu', status: 'Late',           shift: 'General', firstIn: '10:02', lastOut: '19:15', worked: '9h 13m', deviation: '+0h 13m', exception: 'Late Entry',
    workSegments: [{ start: 10.03, end: 13.5 }, { start: 14.5, end: 19.25 }], effectiveMinutes: 9 * 60 + 13, grossMinutes: 9 * 60 + 13, expectedMinutes: 9 * 60, lateMinutes: 62 },
  { date: '16 Apr 2026', weekday: 'Wed', status: 'Present',        shift: 'General', firstIn: '09:00', lastOut: '18:00', worked: '9h 00m', deviation: '+0h 00m',
    workSegments: [{ start: 9, end: 13 }, { start: 14, end: 18 }], effectiveMinutes: 9 * 60, grossMinutes: 9 * 60, expectedMinutes: 9 * 60, lateMinutes: 0 },
  { date: '15 Apr 2026', weekday: 'Tue', status: 'Corrected',      shift: 'General', firstIn: '09:00', lastOut: '18:15', worked: '9h 15m', deviation: '+0h 15m', exception: 'Regularized',
    workSegments: [{ start: 9, end: 13.25 }, { start: 14.25, end: 18.25 }], effectiveMinutes: 9 * 60 + 15, grossMinutes: 9 * 60 + 15, expectedMinutes: 9 * 60, lateMinutes: 0 },
  { date: '14 Apr 2026', weekday: 'Mon', status: 'Present',        shift: 'General', firstIn: '09:00', lastOut: '13:30', worked: '4h 30m', deviation: '-4h 30m',
    workSegments: [{ start: 9, end: 13.5 }], effectiveMinutes: 4 * 60 + 30, grossMinutes: 4 * 60 + 30, expectedMinutes: 9 * 60, lateMinutes: 0 },
  { date: '13 Apr 2026', weekday: 'Sun', status: 'Weekly Off',     shift: '—',       firstIn: '—',     lastOut: '—',     worked: '—',      deviation: '—' },
  { date: '12 Apr 2026', weekday: 'Sat', status: 'Work From Home', shift: 'WFH',     firstIn: '09:30', lastOut: '14:00', worked: '4h 30m', deviation: '-4h 30m',
    workSegments: [{ start: 9.5, end: 14 }], effectiveMinutes: 4 * 60 + 30, grossMinutes: 4 * 60 + 30, expectedMinutes: 9 * 60, lateMinutes: 30 },
  { date: '11 Apr 2026', weekday: 'Fri', status: 'Present',        shift: 'General', firstIn: '09:30', lastOut: '15:30', worked: '6h 00m', deviation: '-3h 00m',
    workSegments: [{ start: 9.5, end: 13 }, { start: 14, end: 15.5 }], effectiveMinutes: 6 * 60, grossMinutes: 6 * 60, expectedMinutes: 9 * 60, lateMinutes: 30 },
  { date: '10 Apr 2026', weekday: 'Thu', status: 'Half Day',       shift: 'General', firstIn: '09:05', lastOut: '12:30', worked: '3h 25m', deviation: '-5h 35m', exception: 'Half Day',
    workSegments: [{ start: 9.08, end: 12.5 }], effectiveMinutes: 3 * 60 + 25, grossMinutes: 3 * 60 + 25, expectedMinutes: 9 * 60, lateMinutes: 5 },
  { date: '09 Apr 2026', weekday: 'Wed', status: 'Absent',         shift: '—',       firstIn: '—',     lastOut: '—',     worked: '—',      deviation: '-9h 00m', exception: 'Absent' },
];

const buildEmployees = (): AttendanceEmployee[] => {
  type Seed = Partial<AttendanceEmployee>;
  const seeds: Seed[] = [
    { name: 'Rohan Mehta',   empCode: 'EMP-0042', initials: 'RM',  department: 'Engineering', designation: 'Senior Developer',  managerName: 'Arun Gupta',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1042', status: 'Late',          firstIn: '09:32', lastOut: null,     workedMinutes: 7 * 60 + 14, lateByMinutes: 32, punches: buildPunches('late') },
    { name: 'Priya Sharma',  empCode: 'EMP-0018', initials: 'PS',  department: 'Operations',  designation: 'Ops Manager',       managerName: 'Ritu Khanna',    shift: 'Early (07:00 – 16:00)',     shiftStart: '07:00', shiftEnd: '16:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1018', status: 'Present',       firstIn: '07:01', lastOut: '17:30',  workedMinutes: 9 * 60 + 14, lateByMinutes: 1,   punches: buildPunches('normal') },
    { name: 'Ankit Verma',   empCode: 'EMP-0031', initials: 'AV',  department: 'Sales',       designation: 'Sales Executive',   managerName: 'Priya Iyer',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1031', status: 'Missing In',    workedMinutes: 0,            lateByMinutes: 0,   punches: buildPunches('missing-in') },
    { name: 'Sunita Rao',    empCode: 'EMP-0056', initials: 'SR',  department: 'HR & Admin',  designation: 'HR Lead',           managerName: 'Vishal Rao',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1056', status: 'Missing Out',   firstIn: '09:14',                       workedMinutes: 0,            lateByMinutes: 14,  punches: buildPunches('missing-out') },
    { name: 'Karan Singh',   empCode: 'EMP-0067', initials: 'KS',  department: 'Engineering', designation: 'Software Engineer', managerName: 'Arun Gupta',     shift: 'Night (21:00 – 06:00)',     shiftStart: '21:00', shiftEnd: '06:00', weeklyOff: 'Sat, Sun',  attendanceNumber: 'B-1067', status: 'Present',       firstIn: '21:00', lastOut: '06:00',  workedMinutes: 9 * 60,       lateByMinutes: 0,   punches: buildPunches('normal') },
    { name: 'Deepa Nair',    empCode: 'EMP-0073', initials: 'DN',  department: 'Finance',     designation: 'Finance Analyst',   managerName: 'Nikhil Mehra',   shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1073', status: 'Late',          firstIn: '10:15', lastOut: '19:42',  workedMinutes: 8 * 60 + 12,  lateByMinutes: 75,  punches: buildPunches('late') },
    { name: 'Arjun Patel',   empCode: 'EMP-0089', initials: 'AP',  department: 'Operations',  designation: 'Logistics Lead',    managerName: 'Ritu Khanna',    shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1089', status: 'Weekly Off',    workedMinutes: 0,            lateByMinutes: 0,   punches: [] },
    { name: 'Meera Iyer',    empCode: 'EMP-0094', initials: 'MI',  department: 'Engineering', designation: 'QA Engineer',       managerName: 'Arun Gupta',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1094', status: 'Corrected',     firstIn: '09:00', lastOut: '18:30',  workedMinutes: 8 * 60 + 30,  lateByMinutes: 0,   punches: buildPunches('normal') },
    { name: 'Rahul Gupta',   empCode: 'EMP-0101', initials: 'RG',  department: 'Sales',       designation: 'Account Executive', managerName: 'Priya Iyer',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1101', status: 'Absent',        workedMinutes: 0,            lateByMinutes: 0,   punches: [] },
    { name: 'Kavita Singh',  empCode: 'EMP-0115', initials: 'KSi', department: 'HR & Admin',  designation: 'HR Executive',      managerName: 'Sunita Rao',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1115', status: 'Present',       firstIn: '09:02', lastOut: '18:12',  workedMinutes: 8 * 60 + 30,  lateByMinutes: 2,   punches: buildPunches('normal') },
    { name: 'Vikram Joshi',  empCode: 'EMP-0124', initials: 'VJ',  department: 'Engineering', designation: 'DevOps Engineer',   managerName: 'Arun Gupta',     shift: 'WFH (09:00 – 18:00)',       shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1124', status: 'Work From Home',firstIn: '08:55', lastOut: '18:10',  workedMinutes: 8 * 60 + 45,  lateByMinutes: 0,   punches: buildPunches('normal') },
    { name: 'Neha Kulkarni', empCode: 'EMP-0138', initials: 'NK',  department: 'Design',      designation: 'Product Designer',  managerName: 'Vishal Rao',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1138', status: 'Late',          firstIn: '09:55', lastOut: '19:00',  workedMinutes: 8 * 60 + 5,   lateByMinutes: 55,  punches: buildPunches('late') },
    { name: 'Sandeep Roy',   empCode: 'EMP-0142', initials: 'SR',  department: 'Marketing',   designation: 'Content Lead',      managerName: 'Ritu Khanna',    shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1142', status: 'Present',       firstIn: '09:08', lastOut: '18:20',  workedMinutes: 8 * 60 + 22,  lateByMinutes: 8,   punches: buildPunches('normal') },
    { name: 'Divya Pillai',  empCode: 'EMP-0156', initials: 'DP',  department: 'Finance',     designation: 'Accounts Manager',  managerName: 'Nikhil Mehra',   shift: 'Early (08:00 – 17:00)',     shiftStart: '08:00', shiftEnd: '17:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1156', status: 'Half Day',      firstIn: '09:05', lastOut: '12:30',  workedMinutes: 3 * 60 + 25,  lateByMinutes: 65,  punches: buildPunches('partial') },
    { name: 'Manish Yadav',  empCode: 'EMP-0167', initials: 'MY',  department: 'Engineering', designation: 'Tech Lead',         managerName: 'Arun Gupta',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1167', status: 'On Duty',       firstIn: '09:18', lastOut: '19:30',  workedMinutes: 9 * 60 + 12,  lateByMinutes: 18,  punches: buildPunches('normal') },
    { name: 'Pooja Shetty',  empCode: 'EMP-0173', initials: 'PoS', department: 'Operations',  designation: 'Coordinator',       managerName: 'Ritu Khanna',    shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1173', status: 'Missing In',    workedMinutes: 0,            lateByMinutes: 0,   punches: buildPunches('missing-in') },
    { name: 'Tushar Bhatt',  empCode: 'EMP-0188', initials: 'TB',  department: 'Sales',       designation: 'BD Manager',        managerName: 'Priya Iyer',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1188', status: 'Present',       firstIn: '09:30', lastOut: '18:45',  workedMinutes: 8 * 60 + 45,  lateByMinutes: 30,  punches: buildPunches('normal') },
    { name: 'Anjali Desai',  empCode: 'EMP-0192', initials: 'AD',  department: 'HR & Admin',  designation: 'Recruitment Head',  managerName: 'Vishal Rao',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1192', status: 'Leave',         workedMinutes: 0,            lateByMinutes: 0,   punches: [] },
    { name: 'Harsh Vora',    empCode: 'EMP-0204', initials: 'HV',  department: 'Engineering', designation: 'Backend Engineer',  managerName: 'Arun Gupta',     shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1204', status: 'Late',          firstIn: '09:42', lastOut: '19:10',  workedMinutes: 8 * 60 + 28,  lateByMinutes: 42,  punches: buildPunches('late') },
    { name: 'Ritika Saxena', empCode: 'EMP-0212', initials: 'RS',  department: 'Marketing',   designation: 'Brand Manager',     managerName: 'Ritu Khanna',    shift: 'General (09:00 – 18:00)',    shiftStart: '09:00', shiftEnd: '18:00', weeklyOff: 'Sun',       attendanceNumber: 'B-1212', status: 'Absent',        workedMinutes: 0,            lateByMinutes: 0,   punches: [] },
  ];

  return seeds.map((s, i): AttendanceEmployee => ({
    id: i + 1,
    accent: accent(i),
    expectedMinutes: 9 * 60,
    presentDays: 16 + (i % 4),
    lateMarks: i % 3,
    missingPunch: s.status === 'Missing In' || s.status === 'Missing Out' ? 1 : 0,
    compliancePct: 100 - (i % 3) * 4,
    correction: (i === 0 || i === 3) ? {
      id: `CR-${1000 + i}`,
      date: '21 Apr 2026',
      type: i === 0 ? 'Forgot to Punch' : 'Missing Punch Out',
      requestedIn: i === 0 ? '09:32' : undefined,
      requestedOut: i === 0 ? '18:30' : '18:00',
      reason: i === 0 ? 'Forgot to punch out before leaving for client visit' : 'Biometric was offline at exit time',
      status: 'Pending',
      raisedAt: '21 Apr 2026 14:12',
    } : undefined,
    logs: buildLogs(),
    ...s,
  } as AttendanceEmployee));
};

// ─────────────────────────────────────────────────────────────────────────────
// Approval Queue — dummy requests across employees with mixed states. Replace
// with `GET /api/attendance/approvals?status=&dept=&from=&to=` when wired.
// ─────────────────────────────────────────────────────────────────────────────
const buildApprovalRequests = (employees: AttendanceEmployee[]): ApprovalRequest[] => {
  const pick = (id: number) => employees.find(e => e.id === id)!;
  const baseFor = (e: AttendanceEmployee) => ({
    employeeId: e.id,
    employeeName: e.name,
    employeeCode: e.empCode,
    department: e.department,
    designation: e.designation,
    managerId: e.id * 1000,
    managerName: e.managerName,
  });

  const reqs: ApprovalRequest[] = [
    // Pending at manager
    {
      id: 'CR-1042', ...baseFor(pick(1)),
      date: '21 Apr 2026', raisedAt: '21 Apr 2026 14:12', raisedBy: 'employee',
      mode: 'adjust',
      punchEdits: [
        { action: 'keep', oldIn: '09:32', oldOut: '13:14', newIn: '09:32', newOut: '13:14' },
        { action: 'keep', oldIn: '14:06', oldOut: '14:06', newIn: '14:06', newOut: '14:06' },
        { action: 'add',  newIn: '14:06', newOut: '18:30' },
      ],
      workLocations: ['Baner Office'],
      reason: 'Forgot to punch out before leaving for client visit',
      managerStatus: 'Pending', hrStatus: 'NA', status: 'Pending',
    },
    // Manager approved, awaiting HR sign-off (escalated due to >7 days old)
    {
      id: 'CR-1056', ...baseFor(pick(4)),
      date: '17 Apr 2026', raisedAt: '20 Apr 2026 09:30', raisedBy: 'employee',
      mode: 'adjust',
      punchEdits: [
        { action: 'edit', oldIn: '09:14', oldOut: '—', newIn: '09:14', newOut: '18:30' },
      ],
      workLocations: ['Baner Office'],
      reason: 'Biometric was offline at exit time, security log confirms',
      managerStatus: 'Approved', managerActionAt: '20 Apr 2026 16:45', managerComment: 'Verified with security log.',
      hrStatus: 'Pending', status: 'Pending',
    },
    // Manager rejected — visible to HR for override
    {
      id: 'CR-1073', ...baseFor(pick(6)),
      date: '17 Apr 2026', raisedAt: '17 Apr 2026 19:55', raisedBy: 'employee',
      mode: 'exempt',
      punchEdits: [],
      workLocations: ['Baner Office'],
      reason: 'Stuck in traffic due to road closure',
      managerStatus: 'Rejected', managerActionAt: '18 Apr 2026 10:12', managerComment: 'Late arrivals are tracked monthly; please plan commute accordingly.',
      hrStatus: 'NA', status: 'Rejected',
    },
    // HR raised on behalf
    {
      id: 'CR-1080', ...baseFor(pick(8)),
      date: '14 Apr 2026', raisedAt: '21 Apr 2026 11:00', raisedBy: 'hr',
      mode: 'adjust',
      punchEdits: [
        { action: 'add', newIn: '09:00', newOut: '18:15' },
      ],
      workLocations: ['Wakad Office'],
      reason: 'Field-work day not captured by biometric. Cleared by HR after manager confirmation over email.',
      managerStatus: 'Approved', managerActionAt: '21 Apr 2026 10:30',
      hrStatus: 'Approved', hrActionAt: '21 Apr 2026 11:05', status: 'Approved',
    },
    // Pending at manager — multi-punch edit
    {
      id: 'CR-1091', ...baseFor(pick(11)),
      date: '19 Apr 2026', raisedAt: '21 Apr 2026 09:08', raisedBy: 'employee',
      mode: 'adjust',
      punchEdits: [
        { action: 'edit', oldIn: '09:55', oldOut: '13:00', newIn: '09:30', newOut: '13:00' },
        { action: 'edit', oldIn: '14:00', oldOut: '19:00', newIn: '14:00', newOut: '19:30' },
      ],
      workLocations: ['Baner Office', 'Client Site'],
      reason: 'Came in 25 mins earlier than recorded; system was buffering. Stayed late for client demo.',
      managerStatus: 'Pending', hrStatus: 'NA', status: 'Pending',
    },
    // Approved — historical
    {
      id: 'CR-1099', ...baseFor(pick(13)),
      date: '11 Apr 2026', raisedAt: '12 Apr 2026 11:20', raisedBy: 'employee',
      mode: 'adjust',
      punchEdits: [
        { action: 'add', newIn: '08:50', newOut: '19:00' },
      ],
      workLocations: ['Field Visit'],
      reason: 'On-duty visit to vendor warehouse — no biometric on site',
      managerStatus: 'Approved', managerActionAt: '12 Apr 2026 14:00',
      hrStatus: 'NA', status: 'Approved',
    },
    // Pending at manager — exempt mode
    {
      id: 'CR-1102', ...baseFor(pick(15)),
      date: '21 Apr 2026', raisedAt: '21 Apr 2026 13:00', raisedBy: 'employee',
      mode: 'exempt',
      punchEdits: [],
      workLocations: ['WFH'],
      reason: 'Internet outage in the morning, switched to mobile hotspot',
      managerStatus: 'Pending', hrStatus: 'NA', status: 'Pending',
    },
  ];
  return reqs;
};

// ─────────────────────────────────────────────────────────────────────────────
// HrAttendance — page component
// ─────────────────────────────────────────────────────────────────────────────
export default function HrAttendance() {
  // Real backend data — populated from /api/attendance/daily-view. The mock
  // builders (buildEmployees / buildPunches / buildLogs / buildApprovalRequests)
  // are kept as dev fallbacks ONLY and are no longer used as initial state.
  const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'on_time' | 'late' | 'missing' | 'absent' | 'wfh' | 'leave'>('all');
  const [search, setSearch]       = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logTab, setLogTab]       = useState<'log' | 'calendar'>('log');
  const [regOpen, setRegOpen]     = useState(false);

  // viewDate is the date HR is inspecting. Defaults to TODAY but can be any
  // past day (read-only) — the right pane, KPIs, and Today's Record all
  // re-target to that date. The Calendar tab uses it as the focus month.
  const [viewDate, setViewDate]   = useState<string>(TODAY_ISO);
  const [calMonth, setCalMonth]   = useState<string>(monthKey(TODAY_ISO)); // "YYYY-MM" for the calendar tab navigation
  const isToday = viewDate === TODAY_ISO;
  const isPast  = viewDate < TODAY_ISO;

  // Keep the Logs & Requests month (used by the calendar grid AND the month
  // range pills) in sync with the inspected date — picking 13 Mar in the
  // top-right date picker should snap the calendar/log table to March
  // without the user having to also click the MAR pill.
  useEffect(() => {
    const wantedMonth = monthKey(viewDate);
    setCalMonth((prev) => (prev === wantedMonth ? prev : wantedMonth));
  }, [viewDate]);

  // ── Fetch real attendance for the selected date ──
  // Re-runs every time the viewDate picker changes so the KPI cards, today's
  // record, intraday timeline and 30-day logs all re-target to the chosen
  // day. The colour accent (not returned by the API) is computed locally so
  // each card keeps its consistent stripe colour across renders.
  useEffect(() => {
    let cancelled = false;
    setEmployeesLoading(true);
    setEmployeesError(null);
    api.get('/attendance/daily-view', { params: { date: viewDate } })
      .then((res) => {
        if (cancelled) return;
        const rows: AttendanceEmployee[] = Array.isArray(res.data) ? res.data : [];
        const hydrated = rows.map((e, i) => ({
          ...e,
          accent: e.accent || accent(i),
          // The backend uses default labels when display_name is empty; guard
          // against undefined punches / logs so map() in the renderer is safe.
          punches: Array.isArray(e.punches) ? e.punches : [],
          logs:    Array.isArray(e.logs)    ? e.logs    : [],
        }));
        setEmployees(hydrated);
        // Pick a default selection: keep the previous one if it's still in
        // the list, otherwise fall back to the first row.
        setSelectedId((prev) => {
          if (prev != null && hydrated.some((e) => e.id === prev)) return prev;
          return hydrated[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setEmployeesError(err?.response?.data?.message || 'Failed to load attendance for this date.');
        setEmployees([]);
      })
      .finally(() => { if (!cancelled) setEmployeesLoading(false); });
    return () => { cancelled = true; };
  }, [viewDate]);

  const counts = useMemo(() => ({
    all:     employees.length,
    on_time: employees.filter(e => e.status === 'Present').length,
    late:    employees.filter(e => e.status === 'Late' || e.status === 'Half Day').length,
    missing: employees.filter(e => e.status === 'Missing In' || e.status === 'Missing Out').length,
    absent:  employees.filter(e => e.status === 'Absent').length,
    wfh:     employees.filter(e => e.status === 'Work From Home' || e.status === 'On Duty').length,
    leave:   employees.filter(e => e.status === 'Leave').length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees.filter(e => {
      if (filter === 'on_time' && e.status !== 'Present') return false;
      if (filter === 'late'    && e.status !== 'Late' && e.status !== 'Half Day') return false;
      if (filter === 'missing' && e.status !== 'Missing In' && e.status !== 'Missing Out') return false;
      if (filter === 'absent'  && e.status !== 'Absent') return false;
      if (filter === 'wfh'     && e.status !== 'Work From Home' && e.status !== 'On Duty') return false;
      if (filter === 'leave'   && e.status !== 'Leave') return false;
      if (!needle) return true;
      return [e.name, e.empCode, e.department, e.designation, e.attendanceNumber].some(v => (v || '').toLowerCase().includes(needle));
    });
  }, [employees, filter, search]);

  const selected = useMemo(
    () => employees.find(e => e.id === selectedId) || employees[0],
    [employees, selectedId]
  );


  const onSubmitRegularization = (req: Omit<CorrectionRequest, 'id' | 'status' | 'raisedAt'>) => {
    const newReq: CorrectionRequest = {
      ...req,
      id: `CR-${Date.now().toString().slice(-6)}`,
      status: 'Pending',
      raisedAt: new Date().toLocaleString(),
    };
    if (selected) {
      setEmployees(prev => prev.map(e => e.id === selected.id ? { ...e, correction: newReq } : e));
    }
    setRegOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  // Guard against an empty employee list (still loading / branch has no
  // attendance-tracked employees yet). Without this, every `selected.foo`
  // reference below would crash because `selected` would be undefined.
  if (employeesLoading || !selected) {
    return (
      <>
        <MasterFormStyles />
        <Row>
          <Col xs={12}>
            <Card>
              <CardBody>
                <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--vz-secondary-color)' }}>
                  {employeesLoading ? (
                    <>
                      <i className="ri-loader-4-line" style={{ fontSize: 28, animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 13 }}>Loading attendance for {fmtLong(viewDate)}…</span>
                    </>
                  ) : employeesError ? (
                    <>
                      <i className="ri-error-warning-line" style={{ fontSize: 28, color: '#f06548' }} />
                      <span style={{ fontSize: 13 }}>{employeesError}</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-team-line" style={{ fontSize: 28 }} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-body-color)' }}>No employees tracked for attendance</div>
                      <div style={{ fontSize: 12 }}>Add employees with Attendance Tracking enabled to see their punches here.</div>
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      </>
    );
  }

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          {/* ── Single page surface — same as HR · Employee. Wraps the header,
                tabs, and content so everything sits inside ONE rounded white
                card with a soft shadow (no banner / floating sub-cards). ── */}
          <div
            className="hr-employees-surface"
            style={{
              borderRadius: 18,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 8px 28px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.04)',
              padding: '18px',
              marginBottom: '24px',
            }}
          >

            {/* ── Header row — Employee-style: gradient icon tile + title + meta ── */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
                    boxShadow: '0 4px 10px rgba(13,148,136,0.25)',
                  }}
                >
                  <i className="ri-time-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Attendance</h5>
                    {isPast && <span className="att-head-readonly"><i className="ri-eye-line" />Read-only · past day</span>}
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Track punches, exceptions and regularizations · pick any past day to review
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="att-date-nav">
                  <button type="button" className="att-date-nav-btn" onClick={() => setViewDate(addDays(viewDate, -1))} aria-label="Previous day">
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <div className="att-date-nav-pick">
                    <MasterDatePicker value={viewDate} onChange={v => setViewDate(v || TODAY_ISO)} placeholder="Pick date" />
                  </div>
                  <button type="button" className="att-date-nav-btn" onClick={() => setViewDate(addDays(viewDate, 1))} aria-label="Next day" disabled={isToday}>
                    <i className="ri-arrow-right-s-line" />
                  </button>
                  {!isToday && (
                    <button type="button" className="att-date-nav-today" onClick={() => setViewDate(TODAY_ISO)}>
                      Today
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Daily View is the only mode HR uses today — the Approval
                Queue + Reports tabs were removed because they had no real
                backend behind them. Re-introduce a tab strip if/when those
                features get wired. */}

            {/* ── Two-pane layout (Daily View) ── */}
            <Row className="g-2 align-items-stretch">

              {/* ===================== LEFT PANE ===================== */}
              <Col xl={3} lg={4} md={5} xs={12}>
                <div className="att-emplist">
                  <div className="att-emplist-tabs">
                    {[
                      // "Missing" and "WFH/OD" chips removed per request —
                      // the filter state values still exist server-side
                      // (kept in the union type) so this only hides the
                      // chips, doesn't break stored selections.
                      { k: 'all'     as const, l: 'All',      c: counts.all },
                      { k: 'on_time' as const, l: 'On Time',  c: counts.on_time },
                      { k: 'late'    as const, l: 'Late',     c: counts.late },
                      { k: 'absent'  as const, l: 'Absent',   c: counts.absent },
                      { k: 'leave'   as const, l: 'Leave',    c: counts.leave },
                    ].map(t => (
                      <button key={t.k} type="button" className={`att-emplist-tab ${filter === t.k ? 'is-active' : ''}`} onClick={() => setFilter(t.k)}>
                        {t.l} <span className="att-emplist-tab-count">{t.c}</span>
                      </button>
                    ))}
                  </div>

                  <div className="att-emplist-search">
                    <div className="search-box">
                      <Input type="text" className="form-control form-control-sm" placeholder="Search name, EMP-ID, biometric…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon" />
                    </div>
                  </div>

                  <div className="att-emplist-meta">
                    <span>{filteredEmployees.length} of {employees.length} employees</span>
                    {/* Sort button removed per request — no client-side sort
                        was wired up to it anyway, so this only drops the
                        non-functional control. */}
                  </div>

                  <div className="att-emplist-scroll">
                    {filteredEmployees.map(e => {
                      const tone = STATUS_TONE[e.status];
                      const isSelected = e.id === selectedId;
                      return (
                        <button key={e.id} type="button" onClick={() => setSelectedId(e.id)} className={`att-emp-card ${isSelected ? 'is-selected' : ''}`}>
                          <span className="att-emp-avatar" style={{ background: e.accent }}>{e.initials.slice(0, 2).toUpperCase()}</span>
                          <div className="att-emp-info">
                            <div className="att-emp-name">{e.name}</div>
                            <div className="att-emp-meta">{e.empCode} · {e.department}</div>
                            {e.correction?.status === 'Pending' && (
                              <span className="att-emp-corr-pill"><i className="ri-error-warning-line" />Correction Pending</span>
                            )}
                          </div>
                          <div className="att-emp-right">
                            <span className="att-status-pill" style={{ color: tone.fg, background: tone.bg }}>
                              <span className="att-status-dot" style={{ background: tone.dot }} />{tone.label}
                            </span>
                            {e.firstIn && <div className="att-emp-time">{e.firstIn}</div>}
                          </div>
                        </button>
                      );
                    })}
                    {filteredEmployees.length === 0 && (
                      <div className="att-emplist-empty">
                        <i className="ri-search-line" />
                        <span>No employees match.</span>
                      </div>
                    )}
                  </div>
                </div>
              </Col>

              {/* ===================== RIGHT PANE ===================== */}
              <Col xl={9} lg={8} md={7} xs={12}>

                {/* Selected employee identity bar */}
                <div className="att-emp-bar">
                  <span className="att-emp-bar-avatar" style={{ background: selected.accent }}>{selected.initials.slice(0, 2).toUpperCase()}</span>
                  <div className="att-emp-bar-info">
                    <div className="att-emp-bar-name">{selected.name}</div>
                    <div className="att-emp-bar-meta">
                      {selected.empCode} · {selected.designation} · {selected.department}
                    </div>
                  </div>
                  <div className="att-emp-bar-chips">
                    <span className="att-chip"><i className="ri-time-line" />{selected.shift}</span>
                    <span className="att-chip"><i className="ri-calendar-2-line" />Off: {selected.weeklyOff}</span>
                    <span className="att-chip"><i className="ri-fingerprint-line" />{selected.attendanceNumber}</span>
                    <span className="att-chip"><i className="ri-user-star-line" />Mgr: {selected.managerName}</span>
                  </div>
                </div>

                {/* KPI strip */}
                <Row className="g-2 mb-2 align-items-stretch row-cols-xl-4 row-cols-md-2 row-cols-1">
                  {([
                    { key: 'pres', label: 'Present Days',   sub: 'This month',     value: selected.presentDays,        icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#22c8a9)', deep: '#0ab39c' },
                    { key: 'late', label: 'Late Marks',     sub: 'This month',     value: selected.lateMarks,          icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)', deep: '#92400e' },
                    { key: 'miss', label: 'Missing Punches',sub: 'This month',     value: selected.missingPunch,       icon: 'ri-error-warning-line',   gradient: 'linear-gradient(135deg,#f06548,#f47c5d)', deep: '#b91c1c' },
                    { key: 'comp', label: 'Compliance',     sub: 'Attendance rate',value: `${selected.compliancePct}%`,icon: 'ri-shield-check-line',    gradient: 'linear-gradient(135deg,#0d9488,#14b8a6)', deep: '#0d9488' },
                  ] as const).map(k => (
                    <Col key={k.key}>
                      <div className="rec-kpi-card h-100">
                        <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                        <div className="rec-kpi-text">
                          <span className="rec-kpi-label">{k.label}</span>
                          <span className="rec-kpi-num">{k.value}</span>
                          <span className="att-kpi-sub">{k.sub}</span>
                        </div>
                        <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                          <i className={k.icon} />
                        </span>
                      </div>
                    </Col>
                  ))}
                </Row>

                {/* Today's record + intraday timeline */}
                <div className="att-section-head">
                  <span className="att-section-label">{isToday ? "TODAY'S RECORD" : 'DAY RECORD'}</span>
                  <span className="att-section-date">{fmtLong(viewDate)}</span>
                </div>
                <Row className="g-2 mb-2 align-items-stretch">
                  <Col xl={7} lg={12}>
                    <TodayRecordCard employee={selected} viewDate={viewDate} isPast={isPast} />
                  </Col>
                  <Col xl={5} lg={12}>
                    <PunchTimelineCard employee={selected} />
                  </Col>
                </Row>
              </Col>
            </Row>

            {/* Logs & Requests — Full-width below the two-pane so the left
                employee list doesn't stretch to match a tall right pane. */}
            <div className="mt-2">
              <LogsRequestsCard
                employee={selected}
                tab={logTab} setTab={setLogTab}
                calMonth={calMonth} setCalMonth={setCalMonth}
                onPickDate={(iso) => setViewDate(iso)}
                onRegularize={() => setRegOpen(true)}
              />
            </div>
          </div>
        </Col>
      </Row>

      {/* Regularization modal */}
      <RegularizationModal
        open={regOpen}
        employee={selected}
        onClose={() => setRegOpen(false)}
        onSubmit={onSubmitRegularization}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Today's Record card
// ─────────────────────────────────────────────────────────────────────────────
function TodayRecordCard({
  employee, viewDate, isPast,
}: {
  employee: AttendanceEmployee;
  viewDate: string;
  isPast: boolean;
}) {
  // Backend returns each employee's status FOR THE SELECTED DATE — so
  // `employee.status` is already correct whether viewDate is today or any
  // past day. The dailyView fetcher refires on date change.
  void isPast; // kept on the prop list for future use; no longer toggles status
  const effectiveStatus: DayStatus = employee.status;
  const tone = STATUS_TONE[effectiveStatus];

  const dateLabel = `${WEEK_LABELS[parseISO(viewDate).getDay()].slice(0,3)}, ${parseISO(viewDate).getDate()}-${monthOf(viewDate)}-${yearOf(viewDate)}`;

  return (
    <Card className="att-today-card mb-0">
      <CardBody className="p-0">
        {/* Title bar */}
        <div className="att-today-titlebar">
          <div className="d-flex align-items-center gap-2 min-w-0">
            <span className="att-today-titlebar-icon"><i className="ri-time-line" /></span>
            <div className="att-today-titlebar-text">Today's Updated Record</div>
            <span className="att-today-status-pill" style={{ color: tone.fg, background: tone.bg }}>
              <span className="att-today-status-dot" style={{ background: tone.dot }} />
              {tone.label}
              {!isPast && employee.lateByMinutes > 0 && effectiveStatus !== 'Weekly Off' && effectiveStatus !== 'Holiday' && effectiveStatus !== 'Leave' && effectiveStatus !== 'Absent' && (
                <span className="att-today-status-sub"> · {employee.lateByMinutes}m late</span>
              )}
            </span>
          </div>
          <span className="att-today-date">{dateLabel}</span>
        </div>

        {/* Two prominent inner cards: First In / Last Out */}
        <div className="att-today-times-2">
          <div className="att-tile">
            <div className="att-tile-label"><i className="ri-login-circle-line" />FIRST IN</div>
            <div className="att-tile-value">{renderTime(employee.firstIn)}</div>
            {(() => {
              const firstInPunch = employee.punches.find(p => p.type === 'in' && p.lat != null && p.lng != null);
              if (!firstInPunch || firstInPunch.lat == null || firstInPunch.lng == null) return null;
              return (
                <a
                  href={`https://www.google.com/maps?q=${firstInPunch.lat},${firstInPunch.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="att-tile-geo"
                  title={`${firstInPunch.lat.toFixed(5)}, ${firstInPunch.lng.toFixed(5)} — open on map`}
                >
                  <i className="ri-map-pin-2-line" />
                  <span>{firstInPunch.place || `${firstInPunch.lat.toFixed(3)}, ${firstInPunch.lng.toFixed(3)}`}</span>
                </a>
              );
            })()}
          </div>
          <div className="att-tile">
            <div className="att-tile-label"><i className="ri-logout-circle-r-line" />LAST OUT</div>
            <div className="att-tile-value">
              {employee.lastOut === null ? <span className="att-in-progress">In Progress</span> : renderTime(employee.lastOut)}
            </div>
            {(() => {
              const outPunches = employee.punches.filter(p => p.type === 'out' && p.lat != null && p.lng != null);
              const lastOutPunch = outPunches[outPunches.length - 1];
              if (!lastOutPunch || lastOutPunch.lat == null || lastOutPunch.lng == null) return null;
              return (
                <a
                  href={`https://www.google.com/maps?q=${lastOutPunch.lat},${lastOutPunch.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="att-tile-geo"
                  title={`${lastOutPunch.lat.toFixed(5)}, ${lastOutPunch.lng.toFixed(5)} — open on map`}
                >
                  <i className="ri-map-pin-2-line" />
                  <span>{lastOutPunch.place || `${lastOutPunch.lat.toFixed(3)}, ${lastOutPunch.lng.toFixed(3)}`}</span>
                </a>
              );
            })()}
          </div>
        </div>

        {/* Stats row */}
        <div className="att-today-stats">
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#7c5cfc' }}>{employee.punches.filter(p => p.type !== 'missing').length}</div>
            <div className="att-stat-label">PUNCHES</div>
          </div>
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#0d9488' }}>{fmtMinutes(employee.workedMinutes)}</div>
            <div className="att-stat-label">WORKED</div>
          </div>
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#6b7280' }}>{fmtMinutes(employee.expectedMinutes)}</div>
            <div className="att-stat-label">EXPECTED</div>
          </div>
        </div>

      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Punch Timeline
// ─────────────────────────────────────────────────────────────────────────────
function PunchTimelineCard({ employee }: { employee: AttendanceEmployee }) {
  const punchCount = employee.punches.filter(p => p.type !== 'missing').length;
  const hasMissing = employee.punches.some(p => p.type === 'missing');

  return (
    <Card className="att-timeline-card mb-0 h-100">
      <CardBody>
        <div className="att-timeline-head">
          <div className="d-flex align-items-center gap-2 min-w-0">
            <span className="att-timeline-icon"><i className="ri-pulse-line" /></span>
            <div className="att-timeline-title">Intraday Punch Timeline</div>
          </div>
          <span className="att-timeline-count">{punchCount} punches today</span>
        </div>

        {/* Horizontal scrollable timeline — circles connected by a line, with
            time + label + source-pill stacked under each event. */}
        <div className="att-h-timeline">
          {employee.punches.length === 0 ? (
            <div className="att-timeline-empty">
              <i className="ri-calendar-2-line" />
              <span>No punches recorded for today.</span>
            </div>
          ) : (
            <div className="att-h-timeline-track">
              <div className="att-h-timeline-line" />
              {employee.punches.map((p, i) => {
                const isIn      = p.type === 'in';
                const isOut     = p.type === 'out';
                const isMissing = p.type === 'missing';
                const label = p.label ?? (isIn ? 'Check In' : isOut ? 'Check Out' : 'Missing');
                return (
                  <div key={i} className="att-h-event">
                    <div className={`att-h-circle ${isIn ? 'is-in' : isOut ? 'is-out' : 'is-missing'}`}>
                      <i className={isIn ? 'ri-login-circle-line' : isOut ? 'ri-logout-circle-r-line' : 'ri-question-line'} />
                    </div>
                    <div className="att-h-time">{p.time}</div>
                    <div className={`att-h-label ${isMissing ? 'is-missing' : ''}`}>{label}</div>
                    {!isMissing && <span className={`att-h-source att-h-source--${p.source.toLowerCase()}`}>{p.source}</span>}
                    {isMissing && <span className="att-h-source att-h-source--missing">MISSING</span>}
                    {!isMissing && p.lat != null && p.lng != null && (
                      <a
                        href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="att-h-geo"
                        title={`${p.place || 'Open on map'} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                      >
                        <i className="ri-map-pin-2-line" />
                        <span className="att-h-geo-place">{p.place || `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`}</span>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasMissing && (
          <div className="att-timeline-alert">
            <i className="ri-error-warning-fill" />
            <div>
              <div className="att-timeline-alert-title">Missing punch detected</div>
              <div className="att-timeline-alert-sub">Raise a regularization request to fix the record</div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Keka-style row visuals — 24h timeline bar, effective-hours donut, arrival
// indicator (turtle / on-time tick).
// ─────────────────────────────────────────────────────────────────────────────
function AttendanceVisualBar({ segments }: { segments: Array<{ start: number; end: number }> }) {
  // 24-hour ruler with hour ticks; teal blocks render the worked segments.
  const ticks = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="att-vbar">
      <div className="att-vbar-track">
        {ticks.map(h => <span key={h} className={`att-vbar-tick ${h % 6 === 0 ? 'is-major' : ''}`} />)}
        {segments.map((s, i) => (
          <span
            key={i}
            className="att-vbar-block"
            style={{ left: `${(s.start / 24) * 100}%`, width: `${((s.end - s.start) / 24) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function EffectiveDonut({ effective, expected }: { effective: number; expected: number }) {
  // Keka-style liquid-fill circle. A single span with
  //   background-image: linear-gradient(to top, color X%, transparent 0px)
  // produces the bottom-up fill directly — no inner absolute element. The
  // percentage rounded to 4 decimals (matches Keka's CSS literal).
  const pct = Math.max(0, Math.min(1, effective / Math.max(1, expected)));
  const fill = (pct * 100).toFixed(4);
  return (
    <span
      className="att-fill-circle"
      style={{ backgroundImage: `linear-gradient(to top, #64c3d1 ${fill}%, transparent 0px)` }}
      aria-label={`${Math.round(pct * 100)}% effective`}
    />
  );
}

// Turtle icon — uses lucide-react's professionally-designed Turtle (matches
// Keka's ki-turtle look). Coloured amber/yellow via stroke, sized via prop.
function TurtleIcon({ size = 24 }: { size?: number }) {
  return <Turtle size={size} color="#fbbf24" strokeWidth={1.5} aria-hidden="true" />;
}

function ArrivalIcon({ lateMinutes }: { lateMinutes: number }) {
  // > 0  → turtle + h:mm:ss late (slow walker metaphor, Keka-style)
  // ≤ 0  → green tick + "On Time"
  if (lateMinutes <= 0) {
    return (
      <span className="att-arrival">
        <span className="att-arrival-icon att-arrival-icon--ok"><i className="ri-check-line" /></span>
        <span className="att-arrival-text">On Time</span>
      </span>
    );
  }
  const h = Math.floor(lateMinutes / 60);
  const m = lateMinutes % 60;
  const label = `${h}:${String(m).padStart(2, '0')}:00`;
  return (
    <span className="att-arrival">
      <span className="att-arrival-icon att-arrival-icon--late">
        <TurtleIcon size={20} />
      </span>
      <span className="att-arrival-text att-arrival-text--late">{label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logs & Requests card
// ─────────────────────────────────────────────────────────────────────────────
function LogsRequestsCard({
  employee, tab, setTab, calMonth, setCalMonth, onPickDate, onRegularize,
}: {
  employee: AttendanceEmployee;
  tab: 'log' | 'calendar';
  setTab: (t: 'log' | 'calendar') => void;
  calMonth: string;            // "YYYY-MM" — month being navigated in the calendar
  setCalMonth: (m: string) => void;
  onPickDate: (iso: string) => void;
  onRegularize: () => void;    // opens the parent's regularization modal
}) {
  // Pagination + display settings — default 5 rows so the table stays compact
  // and the rest of the records flow to the next page.
  const [rowsPerPage, setRowsPerPage] = useState<5 | 10>(5);
  const [page, setPage] = useState(1);

  // Logs filtered by the active month range pill / calendar month — this is
  // what makes "30 DAYS / APR / MAR / FEB / JAN / DEC / NOV" actually filter
  // the table rows. Logs without an iso field (legacy / unparsable) drop
  // out so we don't leak undated rows into the wrong month.
  const filteredLogs = useMemo(() => {
    if (!calMonth) return employee.logs;
    return employee.logs.filter((l) => (l.iso || '').startsWith(calMonth));
  }, [employee.logs, calMonth]);

  // Reset to page 1 whenever the active month changes — otherwise picking a
  // month with fewer rows than the previous page index leaves the table
  // showing an empty page that you can't navigate away from cleanly.
  useEffect(() => { setPage(1); }, [calMonth, employee.id]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / rowsPerPage));
  const safePage   = Math.min(page, totalPages);
  const pageStart  = (safePage - 1) * rowsPerPage;
  const pageEnd    = Math.min(pageStart + rowsPerPage, filteredLogs.length);
  const visibleLogs = filteredLogs.slice(pageStart, pageEnd);

  // View toggle (list/calendar) and 24-hour switch — drive future formatting
  const [viewMode, setViewMode] = useState<'list' | 'cal'>('list');
  const [hour24,  setHour24]    = useState<boolean>(true);

  // Range-pill state — months to scroll through (THIS MONTH + last 6)
  const ranges = useMemo(() => {
    const out: { key: string; label: string; mk: string }[] = [];
    const t = parseISO(TODAY_ISO);
    for (let i = 0; i < 7; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.push({ key: mk, label: i === 0 ? '30 DAYS' : MONTHS_SHORT[d.getMonth()].toUpperCase(), mk });
    }
    return out;
  }, []);

  // Per-row info popover state — only one open at a time
  const [popoverIdx, setPopoverIdx] = useState<number | null>(null);

  // 24h↔12h time formatter for the table cells & the row popover
  const fmtClock = (raw: string): string => {
    if (!raw || raw === '—') return raw;
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!m) return raw;
    const h = Number(m[1]);
    const mm = m[2];
    if (hour24) return `${String(h).padStart(2,'0')}:${mm}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2,'0')}:${mm} ${ampm}`;
  };

  return (
    <Card className="att-logs-card mb-0">
      <CardBody>
        {/* ── Big header bar — title + range pills + view toggle + 24h ── */}
        <div className="att-logs-headbar">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span className="att-logs-headbar-icon"><i className="ri-file-list-3-line" /></span>
            <div>
              <div className="att-logs-headbar-title">Logs &amp; Requests</div>
              <div className="att-logs-headbar-sub">Full attendance history for selected employee</div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <div className="att-logs-ranges">
              {ranges.map(r => (
                <button key={r.key} type="button" className={`att-logs-range ${calMonth === r.mk ? 'is-active' : ''}`} onClick={() => setCalMonth(r.mk)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="att-logs-viewtoggle">
              <button type="button" className={`att-logs-vbtn ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => { setViewMode('list'); setTab('log'); }} title="List view">
                <i className="ri-list-check" />
              </button>
              <button type="button" className={`att-logs-vbtn ${viewMode === 'cal' ? 'is-active' : ''}`} onClick={() => { setViewMode('cal'); setTab('calendar'); }} title="Calendar view">
                <i className="ri-calendar-2-line" />
              </button>
            </div>
            <label className="att-logs-h24">
              <span>24 hour format</span>
              <span className={`att-switch ${hour24 ? 'is-on' : ''}`} onClick={() => setHour24(v => !v)} role="switch" aria-checked={hour24}>
                <span className="att-switch-knob" />
              </span>
            </label>
          </div>
        </div>

        {/* Tab strip — Attendance Log + Calendar only. Regularization
            Requests was removed because it had no backend behind it. */}
        <div className="att-logs-tabs">
          <button type="button" className={`att-logs-tab ${tab === 'log' ? 'is-active' : ''}`} onClick={() => setTab('log')}>
            <i className="ri-checkbox-circle-line" />Attendance Log
          </button>
          <button type="button" className={`att-logs-tab ${tab === 'calendar' ? 'is-active' : ''}`} onClick={() => setTab('calendar')}>
            <i className="ri-calendar-line" />Calendar
          </button>
        </div>

        {tab === 'log' && (
          <>
            {/* Same table style used by HR · Employee — Bootstrap responsive
                table-card with table-light header. Custom .att-* classes only
                kick in for the cells that need attendance-specific styling
                (date split, shift pill, status pill, action icons, popover). */}
            {/* Height tracks the ACTUAL rows on the page (header ~46px + visible
                rows × ~52px), capped at the page size — so a short page (e.g. 4
                records with page size 10) doesn't leave a big empty placeholder
                area below the rows (HRMS-BUG-080). */}
            <div
              className="table-responsive table-card border rounded att-logs-table-wrap--fixed"
              style={{ minHeight: `${46 + Math.min(Math.max(visibleLogs.length, 1), rowsPerPage) * 52}px` }}
            >
              <table className="table align-middle table-nowrap mb-0 att-logs-table att-logs-table--v2">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" style={{ minWidth: 280 }}>Attendance Visual</th>
                    <th scope="col">Effective Hours</th>
                    <th scope="col">Gross Hours</th>
                    <th scope="col">Arrival</th>
                    <th scope="col" className="text-center pe-3">Log</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((l, i) => {
                    const dParts = l.date.split(' ');                         // ["21","Apr","2026"]
                    const dateDay   = (dParts[0] || '').padStart(2, '0');     // "21"
                    const dateMonth = dParts[1] || '';                        // "Apr"
                    const dateYear  = dParts[2] || '';                        // "2026"
                    const formattedDate = `${dateDay}-${dateMonth}-${dateYear}`;
                    const popId = `att-log-info-${employee.id}-${pageStart + i}`;
                    const isOpen = popoverIdx === pageStart + i;
                    const isOff   = l.status === 'Weekly Off' || l.status === 'Holiday';
                    const isAbsent = l.status === 'Absent';
                    const tone = STATUS_TONE[l.status];

                    // Weekly-off / Holiday rows collapse the data columns into
                    // a single "Full day Weekly-off" cell — matches Keka.
                    if (isOff) {
                      return (
                        <tr key={pageStart + i} className="att-log-row--off">
                          <td className="att-log-datecell">
                            {formattedDate}
                            <span className="att-log-woff-pill">W-OFF</span>
                          </td>
                          <td colSpan={4} className="text-center att-log-woff-text">Full day Weekly-off</td>
                          <td className="text-center">
                            <button type="button" className="att-log-action-btn" disabled>
                              <i className="ri-more-2-fill" />
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={pageStart + i} className={isOpen ? 'is-open' : ''}>
                        <td className="att-log-datecell">{formattedDate}</td>
                        <td>
                          <AttendanceVisualBar segments={l.workSegments || []} />
                        </td>
                        <td>
                          {isAbsent ? <span className="text-muted">—</span> : (
                            <div className="att-log-eff">
                              <EffectiveDonut effective={l.effectiveMinutes || 0} expected={l.expectedMinutes || 9 * 60} />
                              <span className="att-log-eff-text">{l.worked}{(l.effectiveMinutes || 0) > (l.expectedMinutes || 9 * 60) ? ' +' : ''}</span>
                            </div>
                          )}
                        </td>
                        <td className={isAbsent ? 'text-muted' : ''}>
                          {isAbsent ? '—' : <>{l.worked}{(l.grossMinutes || 0) > (l.expectedMinutes || 9 * 60) ? ' +' : ''}</>}
                        </td>
                        <td>
                          {isAbsent ? <span className="text-muted">—</span> : <ArrivalIcon lateMinutes={l.lateMinutes ?? 0} />}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            id={popId}
                            className={`att-log-status-btn ${l.exception || isAbsent ? 'is-warn' : 'is-ok'}`}
                            onClick={() => setPopoverIdx(isOpen ? null : pageStart + i)}
                            title="Day details"
                          >
                            <i className={l.exception || isAbsent ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
                          </button>
                          <Popover isOpen={isOpen} target={popId} placement="left" toggle={() => setPopoverIdx(isOpen ? null : pageStart + i)} trigger="legacy" className="att-log-pop att-log-pop--keka">
                            <PopoverBody>
                              {/* Dark header band — status text + warning icon */}
                              <div className="att-log-pop-head--v2">
                                <span className="att-log-pop-head-text">
                                  {tone.label}
                                  {l.exception && <> · {l.exception}</>}
                                </span>
                                {(l.exception || isAbsent) && (
                                  <i className="ri-error-warning-fill att-log-pop-warn" />
                                )}
                              </div>

                              {/* Shift info + Regularize action */}
                              {l.shift !== '—' && (
                                <div className="att-log-pop-body">
                                  <div className="att-log-pop-shift--v2">
                                    {(() => {
                                      // Don't double the word "Shift" if the
                                      // stored label already ends with it
                                      // (e.g. "General Shift" → "General Shift",
                                      // not "General Shift Shift").
                                      const raw = l.shift;
                                      if (raw === 'WFH') return 'WFH Shift';
                                      return /shift\s*$/i.test(raw) ? raw : `${raw} Shift`;
                                    })()} ({dateDay} {dateMonth})
                                  </div>
                                  <div className="att-log-pop-shift-time--v2">
                                    {fmtClock(employee.shiftStart)} - {fmtClock(employee.shiftEnd)}
                                  </div>

                                  <button type="button" className="att-log-pop-regularize" onClick={() => { setPopoverIdx(null); onRegularize(); }}>
                                    <i className="ri-pencil-line" />
                                    Regularize
                                  </button>
                                </div>
                              )}

                              {/* Location */}
                              <div className="att-log-pop-body att-log-pop-body--tight">
                                <div className="att-log-pop-location--v2">Baner Office</div>
                              </div>

                              {/* 2-column punch pair grid — green ↗ for IN, red ↗ for OUT.
                                  Pairs are derived from workSegments; if status is
                                  Missing Out the last out cell shows MISSING in red. */}
                              {l.workSegments && l.workSegments.length > 0 && (
                                <div className="att-log-pop-body att-log-pop-body--tight">
                                  <div className="att-log-pop-pairs">
                                    {l.workSegments.map((seg, idx) => {
                                      const isLast = idx === l.workSegments!.length - 1;
                                      const inMissing = false;
                                      const outMissing = isLast && (l.status === 'Missing Out');
                                      const inHrs = Math.floor(seg.start);
                                      const inMin = Math.floor((seg.start - inHrs) * 60);
                                      const inSec = Math.floor((((seg.start - inHrs) * 60) - inMin) * 60);
                                      const outHrs = Math.floor(seg.end);
                                      const outMin = Math.floor((seg.end - outHrs) * 60);
                                      const outSec = Math.floor((((seg.end - outHrs) * 60) - outMin) * 60);
                                      const fmtPair = (h: number, m: number, s: number) => {
                                        if (hour24) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                                        const ampm = h >= 12 ? 'PM' : 'AM';
                                        const h12  = h % 12 === 0 ? 12 : h % 12;
                                        return `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
                                      };
                                      return (
                                        <div key={idx} className="att-log-pop-pair">
                                          <span className="att-log-pop-cell att-log-pop-cell--in">
                                            <i className="ri-arrow-right-up-line" />
                                            {inMissing ? <span className="att-log-pop-missing">MISSING</span> : fmtPair(inHrs, inMin, inSec)}
                                          </span>
                                          <span className="att-log-pop-cell att-log-pop-cell--out">
                                            <i className="ri-arrow-right-up-line" />
                                            {outMissing ? <span className="att-log-pop-missing">MISSING</span> : fmtPair(outHrs, outMin, outSec)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </PopoverBody>
                          </Popover>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer — Rows-per-page select | Showing X-Y of Z | Prev / pages / Next */}
            <div className="att-logs-foot att-logs-foot--v3">
              <div className="att-logs-foot-left">
                <span className="att-logs-foot-rowsel-label">Rows per page:</span>
                <select
                  className="att-logs-foot-rowsel"
                  value={rowsPerPage}
                  onChange={(e) => { setRowsPerPage(Number(e.target.value) as 5 | 10); setPage(1); }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </div>
              <div className="att-logs-foot-center">
                Showing <strong>{filteredLogs.length === 0 ? 0 : pageStart + 1}–{pageEnd}</strong> of <strong>{filteredLogs.length}</strong>
              </div>
              <div className="att-logs-foot-pages">
                <button type="button" className="att-page-btn att-page-btn--text" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                  <i className="ri-arrow-left-s-line" />Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" className={`att-page-btn ${n === safePage ? 'is-active' : ''}`} onClick={() => setPage(n)}>
                    {n}
                  </button>
                ))}
                <button type="button" className="att-page-btn att-page-btn--text" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                  Next<i className="ri-arrow-right-s-line" />
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'calendar' && (
          <CalendarMonthGrid
            employee={employee}
            month={calMonth}
            onPrevMonth={() => {
              const [y,m] = calMonth.split('-').map(Number);
              const d = new Date(y, m - 2, 1);
              setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onNextMonth={() => {
              const [y,m] = calMonth.split('-').map(Number);
              const d = new Date(y, m, 1);
              setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onPickDate={onPickDate}
          />
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Month Grid — month view of one employee, status-coloured cells.
// Click any past day → page's viewDate jumps to that date (drill-in).
// ─────────────────────────────────────────────────────────────────────────────
function CalendarMonthGrid({
  employee, month, onPrevMonth, onNextMonth, onPickDate,
}: {
  employee: AttendanceEmployee;
  month: string;          // "YYYY-MM"
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickDate: (iso: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first  = new Date(y, m - 1, 1);
  const last   = new Date(y, m, 0);
  const startWeekday = first.getDay(); // 0 = Sun
  const daysInMonth  = last.getDate();

  // Real-data lookup map: ISO date → status, derived from the employee's
  // backend-provided 30-day logs array. Cells outside that window stay null
  // (blank) which is the correct UX — we don't have data for those days.
  // Weekly-off detection is preserved as a fallback for blank days inside
  // the window, parsed from the employee's `weeklyOff` string (e.g. "Sun").
  const logByIso = new Map<string, DayStatus>();
  for (const lg of (employee.logs || [])) {
    if (lg.iso) logByIso.set(lg.iso, lg.status);
  }
  const weeklyOffDays = new Set<number>();
  for (const tok of (employee.weeklyOff || '').split(/[\s,]+/)) {
    const key = tok.slice(0, 3).toLowerCase();
    const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (map[key] !== undefined) weeklyOffDays.add(map[key]);
  }
  const statusFor = (iso: string): DayStatus | null => {
    if (iso > TODAY_ISO) return null;
    const fromLog = logByIso.get(iso);
    if (fromLog) return fromLog;
    // Fallback — log map is empty for this day; mark weekend if matching.
    const d = parseISO(iso);
    if (weeklyOffDays.has(d.getDay())) return 'Weekly Off';
    return null;
  };

  // Build a 6×7 grid of cells. Leading/trailing slots (before day 1 / after
  // last day) render as faded "spillover" cells so the grid stays rectangular.
  type Cell = { iso: string; day: number; inMonth: boolean; future: boolean; status: DayStatus | null };
  const cells: Cell[] = [];
  const prevMonthLast = new Date(y, m - 1, 0).getDate();
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(y, m - 2, prevMonthLast - startWeekday + i + 1);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: false, future: iso > TODAY_ISO, status: statusFor(iso) });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(y, m - 1, day);
    const iso = toISO(d);
    cells.push({ iso, day, inMonth: true, future: iso > TODAY_ISO, status: statusFor(iso) });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const idx = cells.length - (startWeekday + daysInMonth) + 1;
    const d = new Date(y, m, idx);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: false, future: iso > TODAY_ISO, status: statusFor(iso) });
    if (cells.length >= 42) break;
  }

  // Month-level summary (counters across only days inside the month and ≤ today)
  const summary = cells.reduce<Record<DayStatus, number>>((acc, c) => {
    if (!c.inMonth || !c.status || c.future) return acc;
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, { Present: 0, Late: 0, 'Half Day': 0, 'Missing In': 0, 'Missing Out': 0, 'Weekly Off': 0, Holiday: 0, 'On Duty': 0, 'Work From Home': 0, Absent: 0, Leave: 0, Corrected: 0 });

  return (
    <div className="att-cal">
      <div className="att-cal-head">
        <button type="button" className="att-cal-nav" onClick={onPrevMonth}><i className="ri-arrow-left-s-line" /></button>
        <div className="att-cal-title">{MONTHS_SHORT[m - 1]} {y}</div>
        <button type="button" className="att-cal-nav" onClick={onNextMonth}><i className="ri-arrow-right-s-line" /></button>
      </div>

      <div className="att-cal-summary">
        {(['Present','Late','Half Day','Work From Home','On Duty','Leave','Absent','Weekly Off'] as DayStatus[]).map(s => {
          const tone = STATUS_TONE[s];
          return (
            <span key={s} className="att-cal-sum">
              <span className="att-cal-sum-dot" style={{ background: tone.dot }} />
              <span className="att-cal-sum-label">{tone.label}</span>
              <span className="att-cal-sum-num">{summary[s] || 0}</span>
            </span>
          );
        })}
      </div>

      <div className="att-cal-week">
        {WEEK_LABELS.map(d => <div key={d} className="att-cal-weekday">{d}</div>)}
      </div>
      <div className="att-cal-grid">
        {cells.map((c, i) => {
          const tone = c.status ? STATUS_TONE[c.status] : null;
          const isToday = c.iso === TODAY_ISO;
          return (
            <button
              key={i}
              type="button"
              className={`att-cal-cell ${c.inMonth ? '' : 'is-out'} ${c.future ? 'is-future' : ''} ${isToday ? 'is-today' : ''}`}
              disabled={c.future || !c.inMonth}
              onClick={() => onPickDate(c.iso)}
              title={tone ? `${c.day} — ${tone.label}` : `${c.day}`}
              style={tone ? { borderColor: tone.dot } : undefined}
            >
              <span className="att-cal-day">{c.day}</span>
              {tone && (
                <span className="att-cal-status" style={{ color: tone.fg, background: tone.bg }}>
                  <span className="att-cal-status-dot" style={{ background: tone.dot }} />
                  {tone.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Regularization Modal — Keka-style multi-punch editor with two modes
// (adjust / exempt), work-location multi-select, approval routing preview,
// and validation. Used both for HR raise-on-behalf and (later) employee
// self-service. Calls onSubmit({...}) with the full ApprovalRequest payload
// when valid.
// ─────────────────────────────────────────────────────────────────────────────
function RegularizationModal({
  open, employee, onClose, onSubmit,
}: {
  open: boolean;
  employee: AttendanceEmployee;
  onClose: () => void;
  onSubmit: (req: Omit<CorrectionRequest, 'id' | 'status' | 'raisedAt'>) => void;
}) {
  const toast = useToast();

  // ── Form state ──────────────────────────────────────────────────────────
  const [date]                    = useState('2 May 2026');
  const [mode, setMode]           = useState<RegMode>('adjust');
  // Each row in the multi-punch editor — seeded from the selected employee's
  // existing punches so the requester can edit-in-place. `keep` rows render
  // read-only until the user clicks the time to start editing.
  const initialEdits = useMemo<PunchEdit[]>(() => {
    const inOuts: { in?: string; out?: string }[] = [];
    let cur: { in?: string; out?: string } = {};
    for (const p of employee.punches) {
      if (p.type === 'in')  { cur = { in: p.time.replace(/\s?(AM|PM)/i, '') }; }
      if (p.type === 'out') { cur.out = p.time.replace(/\s?(AM|PM)/i, ''); inOuts.push(cur); cur = {}; }
    }
    if (cur.in) inOuts.push(cur);
    return inOuts.length === 0
      ? [{ action: 'add' as const, newIn: '', newOut: '' }]
      : inOuts.map(io => ({ action: 'keep' as const, oldIn: io.in, oldOut: io.out, newIn: io.in ?? '', newOut: io.out ?? '' }));
  }, [employee.punches]);
  const [punchEdits, setPunchEdits] = useState<PunchEdit[]>(initialEdits);
  const [workLocations, setWorkLocations] = useState<string[]>(['Baner Office']);
  const [reason, setReason]       = useState('');
  const [errors, setErrors]       = useState<Partial<Record<'reason' | 'punches' | 'locations', string>>>({});

  // Reset editor when the employee changes
  useMemo(() => { setPunchEdits(initialEdits); }, [initialEdits]);

  // ── Punch row helpers ────────────────────────────────────────────────────
  const updateEdit = (idx: number, patch: Partial<PunchEdit>) => {
    setPunchEdits(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const next = { ...e, ...patch };
      // If the user touches a `keep` row, promote it to `edit`
      if (e.action === 'keep' && (next.newIn !== e.oldIn || next.newOut !== e.oldOut)) {
        next.action = 'edit';
      }
      return next;
    }));
  };
  const addEdit = () => setPunchEdits(prev => [...prev, { action: 'add', newIn: '', newOut: '' }]);
  const removeEdit = (idx: number) => {
    setPunchEdits(prev => prev.flatMap((e, i) => {
      if (i !== idx) return [e];
      // For `add` rows, just drop. For original rows, mark as `delete`.
      if (e.action === 'add') return [];
      return [{ ...e, action: 'delete' as const, newIn: '', newOut: '' }];
    }));
  };

  // ── Work-location helpers ────────────────────────────────────────────────
  const addLocation = (loc: string) => {
    if (!loc || workLocations.includes(loc)) return;
    setWorkLocations(prev => [...prev, loc]);
  };
  const removeLocation = (loc: string) => setWorkLocations(prev => prev.filter(l => l !== loc));

  // ── Submit ───────────────────────────────────────────────────────────────
  const submit = () => {
    const errs: typeof errors = {};
    if (!reason.trim()) errs.reason = 'Reason is required';
    if (workLocations.length === 0) errs.locations = 'Pick at least one work location';
    if (mode === 'adjust') {
      const valid = punchEdits.some(e => e.action !== 'delete');
      const allOk = punchEdits.every(e =>
        e.action === 'delete' ||
        (e.newIn && /^\d{2}:\d{2}$/.test(e.newIn) && (!e.newOut || /^\d{2}:\d{2}$/.test(e.newOut)))
      );
      if (!valid) errs.punches = 'Add at least one punch entry';
      else if (!allOk) errs.punches = 'All punch entries need a valid HH:MM time';
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Validation', 'Fix the highlighted fields');
      return;
    }
    setErrors({});
    // Map back into the older CorrectionRequest shape expected by the parent
    // for now — the queue uses ApprovalRequest, but the per-employee daily
    // card still consumes CorrectionRequest. First non-deleted edit wins.
    const firstEdit = punchEdits.find(e => e.action !== 'delete');
    onSubmit({
      date,
      type: mode === 'exempt' ? 'On Duty (OD)' : 'Forgot to Punch',
      requestedIn:  firstEdit?.newIn || undefined,
      requestedOut: firstEdit?.newOut || undefined,
      reason: reason.trim(),
    });
    toast.success('Submitted', `Routed to ${employee.managerName} for approval`);
    setReason(''); setErrors({});
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" className="att-reg-modal-keka">
      <ModalBody className="p-0">
        <div className="att-reg-modal-v3">
          {/* ── Header ── */}
          <div className="att-reg-keka-head">
            <div className="att-reg-keka-title">Request Attendance Regularization</div>
            <button type="button" className="att-reg-keka-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>

          <div className="att-reg-keka-body">
            {/* ── Selected Date (read-only style) ── */}
            <div className="att-reg-keka-field">
              <label className="att-reg-keka-label">Selected Date</label>
              <div className="att-reg-keka-readonly">{date}</div>
            </div>

            {/* ── Mode (single radio) — drives whether the punch editor shows ── */}
            <div className="att-reg-keka-modes">
              <label className={`att-reg-keka-radio ${mode === 'adjust' ? 'is-active' : ''}`}>
                <input type="radio" name="reg-mode" checked={mode === 'adjust'} onChange={() => setMode('adjust')} />
                <span className="att-reg-keka-radio-dot" />
                <span>Add/update time entries to adjust attendance logs.</span>
              </label>
              <label className={`att-reg-keka-radio ${mode === 'exempt' ? 'is-active' : ''}`}>
                <input type="radio" name="reg-mode" checked={mode === 'exempt'} onChange={() => setMode('exempt')} />
                <span className="att-reg-keka-radio-dot" />
                <span>Raise regularization request to exempt this day from penalization policy.</span>
              </label>
              <div className="att-reg-keka-hint">
                {mode === 'adjust'
                  ? 'Click and select time stamp box that you would like to adjust and make changes to the time'
                  : 'No time edits — the day will be exempted from late / absent / penalty policy after manager approval'}
              </div>
            </div>

            {/* ── Punch editor (only in `adjust` mode) ── */}
            {mode === 'adjust' && (
              <>
                <div className="att-reg-keka-section-head">
                  <div className="att-reg-keka-section-title">Attendance Adjustment</div>
                  <button type="button" className="att-reg-keka-addlog" onClick={addEdit}>
                    <i className="ri-add-line" />Add Log
                  </button>
                </div>

                {/* Location selector — same line, replaces the duplicate label
                    + dropdown that used to render before & after the rows. */}
                <div className="att-reg-keka-loc-pick">
                  <i className="ri-map-pin-line" />
                  <select
                    className="att-reg-keka-loc-select"
                    value={workLocations[0] || ''}
                    onChange={e => setWorkLocations([e.target.value])}
                  >
                    {WORK_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                <div className="att-reg-keka-rows">
                  {punchEdits.filter(e => e.action !== 'delete').map((e) => {
                    const realIdx = punchEdits.indexOf(e);
                    const outMissing = !e.newOut;
                    return (
                      <div key={realIdx} className="att-reg-keka-row">
                        <i className="ri-arrow-left-down-line att-reg-keka-arrow att-reg-keka-arrow--in" />
                        <Input
                          type="time"
                          className="att-reg-keka-time"
                          value={e.newIn}
                          onChange={ev => updateEdit(realIdx, { newIn: ev.target.value })}
                        />
                        <i className="ri-arrow-right-up-line att-reg-keka-arrow att-reg-keka-arrow--out" />
                        {outMissing ? (
                          <span className="att-reg-keka-missing" onClick={() => updateEdit(realIdx, { newOut: '12:00' })}>
                            MISSING
                          </span>
                        ) : (
                          <Input
                            type="time"
                            className="att-reg-keka-time"
                            value={e.newOut}
                            onChange={ev => updateEdit(realIdx, { newOut: ev.target.value })}
                          />
                        )}
                        <button type="button" className="att-reg-keka-rm" onClick={() => removeEdit(realIdx)} title="Remove">
                          <i className="ri-subtract-line" />
                        </button>
                      </div>
                    );
                  })}
                  {punchEdits.filter(e => e.action !== 'delete').length === 0 && (
                    <div className="att-reg-keka-empty">Click <strong>Add Log</strong> to add a punch entry.</div>
                  )}
                  {/* Hidden helpers retained for back-compat with the sub-list API */}
                  <button type="button" className="d-none" onClick={() => addLocation('')} aria-hidden></button>
                  <button type="button" className="d-none" onClick={() => removeLocation('')} aria-hidden></button>
                </div>
                {errors.punches && <small className="att-reg-keka-error">{errors.punches}</small>}
              </>
            )}

            {/* ── Note ── */}
            <div className="att-reg-keka-field">
              <label className="att-reg-keka-label">Note</label>
              <textarea
                className="form-control att-reg-keka-note"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Enter note"
              />
              {errors.reason && <small className="att-reg-keka-error">{errors.reason}</small>}
              {errors.locations && <small className="att-reg-keka-error">{errors.locations}</small>}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="att-reg-keka-foot">
            <button type="button" className="att-reg-keka-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="att-reg-keka-submit" onClick={submit}>Request</button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
