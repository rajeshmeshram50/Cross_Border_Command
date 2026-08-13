import { useEffect, useMemo, useState } from 'react';
import { Col, Row, Progress, Modal, ModalBody } from 'reactstrap';
import ComingSoonShell from '../../components/ComingSoonShell';
import '../../../css/recruitment.css';
import '../../../css/pip.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types — backend will replace with /api/pip endpoints
// ─────────────────────────────────────────────────────────────────────────────
type TopTab = 'dashboard' | 'score' | 'watchlist' | 'status';
type View = 'intelligence' | 'actions';
type Pivot = 'employee' | 'department';
type RiskBand = 'critical' | 'high' | 'medium' | 'low';

interface EmployeeRow {
  id: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  role: string;
  score: number;
  rank: number;
  delta: number;
  band: 'top' | 'ok' | 'risk';
}

interface WorkloadRow {
  id: string;
  name: string;
  department: string;
  load: number;
  status: 'overloaded' | 'balanced' | 'underutilized';
}

interface ManagerRow {
  id: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  reports: number;
  score: number;
  risk: 'High Risk' | 'Medium Risk' | 'Low Risk';
}

interface DiagnosisRow {
  id: string;
  name: string;
  initials: string;
  accent: string;
  score: number;
  reason: string;
  signals: string[];
}

interface DeptCard {
  name: string;
  employees: number;
  lead: string;
  score: number;
  trend: 'declining' | 'improving' | 'stable';
  state: 'PIP Active' | 'At Risk' | 'Healthy';
  bars: number[];
}

interface DeptHead {
  name: string;
  initials: string;
  accent: string;
  department: string;
  score: number;
  state: 'PIP' | 'Risk' | 'OK';
}

// ─────────────────────────────────────────────────────────────────────────────
// Initiate-PIP wizard types — used by the 6-step modal and the active-PIPs
// list rendered in the PIP Actions tab. Backend will replace with /api/pips.
// ─────────────────────────────────────────────────────────────────────────────
type PipTemplate = 'low_productivity' | 'attendance' | 'behavioral' | null;

interface PipDraft {
  // Step 1 — Snapshot & Trigger
  employee: string;
  department: string;
  triggerSource: string;
  severity: string;
  triggerReason: string;
  pipDuration: string;
  startDate: string;
  template: PipTemplate;
  // Step 2 — Issues & Root Cause
  detectedIssues: string[];
  rootCause: string;
  managerNotes: string;
  // Step 3 — SMART Goals
  goals: string[];
  successCriteria: string;
  expectedOutcome: string;
  // Step 4 — Milestones & Manager Action Plan
  milestones: string[];
  actions: string[];
  mentor: string;
  training: string;
  supportNotes: string;
  // Step 5 — History & Outcome
  checkInFreq: string;
  escalationRule: string;
  week1Target: string;
  midPlanTarget: string;
  slaAlert: string;
  outcomeExpectation: string;
  // Step 6 — Approval
  approvalNote: string;
}

interface ActivePip {
  id: string;
  employeeName: string;
  department: string;
  startDate: string;
  durationDays: number;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Active' | 'Escalated' | 'Completed' | 'Pending Review';
  progressPct: number;
}

const SEEDED_PIPS: ActivePip[] = [
  { id: 'PIP-001', employeeName: 'Karan Mehta',     department: 'Engineering',  startDate: '2026-04-01', durationDays: 60, severity: 'High',     status: 'Active',         progressPct: 35 },
  { id: 'PIP-002', employeeName: 'Varun Malhotra',  department: 'AI/ML',         startDate: '2026-03-15', durationDays: 90, severity: 'Critical', status: 'Pending Review', progressPct: 60 },
  { id: 'PIP-003', employeeName: 'Ritika Chauhan',  department: 'UI/UX',         startDate: '2026-04-10', durationDays: 45, severity: 'Medium',   status: 'Active',         progressPct: 12 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Demo data
// ─────────────────────────────────────────────────────────────────────────────
const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

const EMPLOYEE_KPIS = [
  { key: 'performance',  label: 'Performance Score', value: 73,  suffix: '%', delta: -78, deltaUp: false, icon: 'ri-bar-chart-line',     tone: '#dc2626', strip: 'linear-gradient(90deg,#dc2626,#f87171)', iconGrad: 'linear-gradient(135deg,#fee2e2,#fecaca)' },
  { key: 'productivity', label: 'Productivity Score', value: 81, suffix: '%', delta: 79,  deltaUp: true,  icon: 'ri-file-list-3-line',   tone: '#0ea5e9', strip: 'linear-gradient(90deg,#0ea5e9,#7dd3fc)', iconGrad: 'linear-gradient(135deg,#dbeafe,#bfdbfe)' },
  { key: 'attendance',   label: 'Attendance Impact',  value: 91, suffix: '%', delta: -94, deltaUp: false, icon: 'ri-team-line',          tone: '#f59e0b', strip: 'linear-gradient(90deg,#f59e0b,#fcd34d)', iconGrad: 'linear-gradient(135deg,#fef3c7,#fde68a)' },
  { key: 'behavioural',  label: 'Behavioural Score',  value: 86, suffix: '%', delta: 85,  deltaUp: true,  icon: 'ri-shield-check-line',  tone: '#7c5cfc', strip: 'linear-gradient(90deg,#7c5cfc,#a78bfa)', iconGrad: 'linear-gradient(135deg,#ede9fe,#ddd6fe)' },
  { key: 'risk',         label: 'Overall Risk Level', value: 'Medium', suffix: '', delta: 0, deltaUp: true, icon: 'ri-error-warning-line', tone: '#f59e0b', strip: 'linear-gradient(90deg,#f59e0b,#fcd34d)', iconGrad: 'linear-gradient(135deg,#fef3c7,#fde68a)', sub: '4 employees flagged' },
] as const;

const TREND_DATA = [
  { month: 'Nov', score: 92 }, { month: 'Dec', score: 88 }, { month: 'Jan', score: 85 },
  { month: 'Feb', score: 78 }, { month: 'Mar', score: 75 }, { month: 'Apr', score: 73 },
];

const TOP_PERFORMERS: EmployeeRow[] = [
  { id: 'p1', name: 'Simran Gupta', initials: 'SG', accent: accent(3), department: 'Engineering', role: 'Software Dev', score: 91, rank: 1, delta: 3, band: 'top' },
  { id: 'p2', name: 'Rahul Verma',  initials: 'RV', accent: accent(2), department: 'Management',  role: 'Operations',   score: 88, rank: 2, delta: 2, band: 'top' },
  { id: 'p3', name: 'Priya Mehta',  initials: 'PM', accent: accent(1), department: 'HR & Admin',  role: 'HR',           score: 86, rank: 3, delta: 1, band: 'top' },
  { id: 'p4', name: 'Aditya Singh', initials: 'AS', accent: accent(4), department: 'Data Science',role: 'Data Science', score: 84, rank: 4, delta: 4, band: 'ok'  },
  { id: 'p5', name: 'Neha Kapoor',  initials: 'NK', accent: accent(2), department: 'QA / Testing',role: 'QA',           score: 83, rank: 5, delta: 2, band: 'ok'  },
];

const WORKLOAD: WorkloadRow[] = [
  { id: 'w1', name: 'Karan Mehta',    department: 'Engineering',  load: 18, status: 'overloaded' },
  { id: 'w2', name: 'Ritika Chauhan', department: 'UI/UX',        load: 16, status: 'overloaded' },
  { id: 'w3', name: 'Simran Gupta',   department: 'Engineering',  load: 11, status: 'balanced' },
  { id: 'w4', name: 'Tanya More',     department: 'Data Science', load:  9, status: 'balanced' },
  { id: 'w5', name: 'Harsh Thakur',   department: 'Management',   load:  7, status: 'balanced' },
  { id: 'w6', name: 'Kiran Patel',    department: 'HR & Admin',   load:  4, status: 'underutilized' },
];

const MANAGERS: ManagerRow[] = [
  { id: 'm1', name: 'Rahul Verma',   initials: 'RV', accent: accent(3), department: 'Engineering',  reports: 8, score: 69, risk: 'High Risk' },
  { id: 'm2', name: 'Gaurav Jagtap', initials: 'GJ', accent: accent(0), department: 'Data Science', reports: 6, score: 76, risk: 'Medium Risk' },
  { id: 'm3', name: 'Sneha Sharma',  initials: 'SS', accent: accent(2), department: 'QA / Testing',reports: 4, score: 80, risk: 'Medium Risk' },
  { id: 'm4', name: 'Priya Mehta',   initials: 'PM', accent: accent(1), department: 'HR & Admin',  reports: 5, score: 86, risk: 'Low Risk' },
];

const DIAGNOSIS: DiagnosisRow[] = [
  { id: 'd1', name: 'Karan Mehta',     initials: 'KM', accent: accent(0), score: 51, reason: 'Repeated sprint failures + 7 late marks. Delivery 42% below target.', signals: ['Low KPI', 'Attendance', 'Rework Rate'] },
  { id: 'd2', name: 'Vikram Chauhan',  initials: 'VC', accent: accent(4), score: 49, reason: 'Missing punches + Q1 rating 2.1/5. 2nd consecutive cycle below threshold.', signals: ['Absenteeism', 'KPI below 2.5', '2 Warnings'] },
  { id: 'd3', name: 'Varun Malhotra',  initials: 'VM', accent: accent(2), score: 63, reason: 'Model 35% behind schedule. WFH check-ins missed 4 times.', signals: ['ML Delay', 'WFH Misuse'] },
];

const DEPT_CARDS: DeptCard[] = [
  { name: 'Engineering',  employees: 4, lead: 'Vikram Nair',     score: 72, trend: 'declining', state: 'PIP Active', bars: [60, 50, 70, 80, 65, 55, 75] },
  { name: 'Data Science', employees: 3, lead: 'Gaurav Jagtap',   score: 68, trend: 'declining', state: 'At Risk',    bars: [55, 70, 60, 75, 65, 70, 55] },
  { name: 'Finance',      employees: 2, lead: 'Deepa Kulkarni',  score: 59, trend: 'declining', state: 'PIP Active', bars: [70, 60, 50, 60, 75, 60, 55] },
  { name: 'HR & Admin',   employees: 2, lead: 'Priya Mehta',     score: 73, trend: 'stable',    state: 'At Risk',    bars: [60, 65, 70, 65, 70, 65, 70] },
  { name: 'QA / Testing', employees: 2, lead: 'Athary Patekar',  score: 69, trend: 'declining', state: 'At Risk',    bars: [70, 65, 60, 75, 60, 65, 70] },
  { name: 'Management',   employees: 1, lead: 'Harsh Thakur',    score: 72, trend: 'declining', state: 'At Risk',    bars: [60, 70, 65, 70, 60, 70, 65] },
  { name: 'Sales',        employees: 2, lead: 'Arjun Nair',      score: 83, trend: 'improving', state: 'Healthy',    bars: [75, 70, 80, 75, 85, 80, 90] },
  { name: 'Operations',   employees: 2, lead: 'Sneha Joshi',     score: 78, trend: 'stable',    state: 'Healthy',    bars: [70, 75, 70, 80, 75, 80, 78] },
];

const DEPT_HEADS: DeptHead[] = [
  { name: 'Vikram Nair',    initials: 'VN', accent: accent(2), department: 'Engineering',  score: 82, state: 'PIP'  },
  { name: 'Gaurav Jagtap',  initials: 'GJ', accent: accent(0), department: 'Data Science', score: 74, state: 'Risk' },
  { name: 'Deepa Kulkarni', initials: 'DK', accent: accent(7), department: 'Finance',      score: 69, state: 'PIP'  },
  { name: 'Priya Mehta',    initials: 'PM', accent: accent(5), department: 'HR & Admin',   score: 76, state: 'Risk' },
  { name: 'Athary Patekar', initials: 'AP', accent: accent(2), department: 'QA / Testing', score: 70, state: 'Risk' },
  { name: 'Harsh Thakur',   initials: 'HT', accent: accent(2), department: 'Management',   score: 72, state: 'Risk' },
  { name: 'Arjun Nair',     initials: 'AN', accent: accent(7), department: 'Sales',        score: 84, state: 'OK'   },
  { name: 'Sneha Joshi',    initials: 'SJ', accent: accent(2), department: 'Operations',   score: 79, state: 'OK'   },
];

const PIP_KPIS = [
  { key: 'active',          label: 'Active PIPs',     value: 3, sub: '+1 this month',    icon: 'ri-list-check-2',         tone: '#f59e0b', strip: 'linear-gradient(90deg,#f59e0b,#fcd34d)', iconGrad: 'linear-gradient(135deg,#fef3c7,#fde68a)' },
  { key: 'recommendations', label: 'Recommendations', value: 5, sub: 'Needs review',     icon: 'ri-error-warning-line',   tone: '#7c5cfc', strip: 'linear-gradient(90deg,#7c5cfc,#a78bfa)', iconGrad: 'linear-gradient(135deg,#ede9fe,#ddd6fe)' },
  { key: 'watchlist',       label: 'Watchlist',       value: 0, sub: 'Monitor closely',  icon: 'ri-eye-line',             tone: '#0ea5e9', strip: 'linear-gradient(90deg,#0ea5e9,#7dd3fc)', iconGrad: 'linear-gradient(135deg,#dbeafe,#bfdbfe)' },
  { key: 'atRisk',          label: 'At Risk',         value: 3, sub: 'Critical + High',  icon: 'ri-alert-line',           tone: '#dc2626', strip: 'linear-gradient(90deg,#dc2626,#f87171)', iconGrad: 'linear-gradient(135deg,#fee2e2,#fecaca)' },
  { key: 'escalated',       label: 'Escalated',       value: 1, sub: 'Needs escalation', icon: 'ri-shield-flash-line',    tone: '#a855f7', strip: 'linear-gradient(90deg,#a855f7,#c4b5fd)', iconGrad: 'linear-gradient(135deg,#f5f3ff,#ede9fe)' },
  { key: 'completed',       label: 'Completed',       value: 3, sub: 'This quarter',     icon: 'ri-checkbox-circle-line', tone: '#16a34a', strip: 'linear-gradient(90deg,#16a34a,#34d399)', iconGrad: 'linear-gradient(135deg,#d1fae5,#a7f3d0)' },
] as const;

const PIP_TREND = [
  { month: 'Nov', initiated: 2, escalated: 0 }, { month: 'Dec', initiated: 3, escalated: 1 },
  { month: 'Jan', initiated: 4, escalated: 1 }, { month: 'Feb', initiated: 5, escalated: 2 },
  { month: 'Mar', initiated: 6, escalated: 3 }, { month: 'Apr', initiated: 7, escalated: 5 },
];

const RISK_DISTRIBUTION: { band: RiskBand; label: string; count: number; pct: number; bg: string; fg: string }[] = [
  { band: 'critical', label: 'Critical', count: 1, pct: 14, bg: '#fee2e2', fg: '#b91c1c' },
  { band: 'high',     label: 'High',     count: 3, pct: 43, bg: '#fde8c4', fg: '#a4661c' },
  { band: 'medium',   label: 'Medium',   count: 2, pct: 29, bg: '#fef3c7', fg: '#92400e' },
  { band: 'low',      label: 'Low',      count: 1, pct: 14, bg: '#d1fae5', fg: '#065f46' },
];

const DEPT_DISTRIBUTION = [
  { name: 'Software Dev',    count: 2, pct: 29, color: '#7c5cfc' },
  { name: 'Data Science',    count: 1, pct: 14, color: '#a855f7' },
  { name: 'UI/UX',           count: 1, pct: 14, color: '#0ea5e9' },
  { name: 'Mobile Dev',      count: 1, pct: 14, color: '#16a34a' },
  { name: 'AI/ML',           count: 1, pct: 14, color: '#f59e0b' },
  { name: 'Product Design',  count: 1, pct: 14, color: '#dc2626' },
];

const RECENT_ACTIVITY = [
  { id: 'a1', icon: 'ri-edit-line',           tone: '#7c5cfc', title: 'Weekly review updated',     ref: 'PIP-001 · Karan Mehta',           when: 'Today, 14:30',  by: 'Gaurav Jagtap' },
  { id: 'a2', icon: 'ri-shield-line',         tone: '#f59e0b', title: 'MCA Checker approval pending',ref: 'PIP-002 · Varun Malhotra',       when: 'Yesterday',     by: 'Priya Mehta' },
  { id: 'a3', icon: 'ri-robot-line',          tone: '#0ea5e9', title: 'AI recommends PIP',         ref: 'Vikram Chauhan · Score 49',       when: 'Apr 20',        by: 'System' },
  { id: 'a4', icon: 'ri-add-circle-line',     tone: '#7c5cfc', title: 'PIP-003 initiated',         ref: 'PIP-003 · Ritika Chauhan',        when: 'Apr 19',        by: 'HR Team' },
  { id: 'a5', icon: 'ri-checkbox-circle-line',tone: '#16a34a', title: 'Goal completed',            ref: 'PIP-001 · Certification',         when: 'Apr 18',        by: 'Parth Lakare' },
];

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedNumber — count-up reused across modules
// ─────────────────────────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!value) { setDisplay(0); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function HrPIP() {
  const [topTab, setTopTab] = useState<TopTab>('dashboard');
  const [view, setView] = useState<View>('intelligence');
  const [pivot, setPivot] = useState<Pivot>('employee');
  const [showInitiate, setShowInitiate] = useState(false);
  // List of submitted PIPs visible in the PIP Actions tab. Seeded with the
  // three "diagnosed" employees so the list isn't empty on first open.
  const [pips, setPips] = useState<ActivePip[]>(SEEDED_PIPS);

  const onSubmitPip = (draft: PipDraft) => {
    const id = `PIP-${String(pips.length + 1).padStart(3, '0')}`;
    setPips(prev => [
      {
        id,
        employeeName: draft.employee || 'Unnamed Employee',
        department:   draft.department || '—',
        startDate:    draft.startDate || new Date().toISOString().slice(0, 10),
        durationDays: Number(draft.pipDuration || 60),
        severity:     (draft.severity as ActivePip['severity']) || 'Medium',
        status:       'Active',
        progressPct:  0,
      },
      ...prev,
    ]);
    setShowInitiate(false);
  };

  return (
    <ComingSoonShell
      title="Performance Improvement Plan"
      subtitle="Evidence-backed governance · MCA-controlled · Multi-source signal engine"
    >
    <Row>
      <Col xs={12}>
        <div className="rec-page">
          {/* Hero header */}
          <div className="onb-hero-card mb-3 pip-hero">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{
                  width: 48, height: 48,
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  boxShadow: '0 8px 18px rgba(245, 158, 11, 0.32)',
                }}
              >
                <i className="ri-task-line" style={{ color: '#fff', fontSize: 22 }} />
              </span>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <h5 className="fw-bold mb-0">Performance Improvement Plan</h5>
                  <span className="pip-pill pip-pill-live"><span className="dot" />Live Intelligence</span>
                  <span className="pip-pill pip-pill-warn">2 below threshold</span>
                </div>
                <div className="text-muted mt-1 fs-13">
                  Evidence-backed governance · MCA-controlled · Multi-source signal engine
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button type="button" className="rec-btn-ghost">
                <i className="ri-error-warning-line" />Recommendations
                <span className="pip-count-badge">5</span>
              </button>
              <button
                type="button"
                className="pip-btn-initiate"
                onClick={() => setShowInitiate(true)}
              >
                <i className="ri-add-circle-line" />Initiate PIP
              </button>
            </div>
          </div>

          {/* Top tabs */}
          <div className="rec-tab-track mb-3">
            {([
              { key: 'dashboard',  label: 'Dashboard',     icon: 'ri-dashboard-line',       variant: 'in-progress' },
              { key: 'score',      label: 'Score Engine',  icon: 'ri-pulse-line',           variant: 'in-progress', new: true },
              { key: 'watchlist',  label: 'Watchlist',     icon: 'ri-eye-line',             variant: 'completed', count: 5 },
              { key: 'status',     label: "PIP's Status",  icon: 'ri-flag-line',            variant: 'cancelled' },
            ] as const).map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTopTab(t.key)}
                className={`rec-tab ${topTab === t.key ? `is-active ${t.variant}` : ''}`}
              >
                <i className={t.icon} />
                {t.label}
                {('new' in t && t.new) && <span className="pip-tab-new">NEW</span>}
                {('count' in t && t.count) && <span className="badge">{t.count}</span>}
              </button>
            ))}
          </div>

          {topTab === 'dashboard' ? (
            <>
              {/* View toggle (Intelligence / PIP Actions) */}
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                <div className="pip-segment">
                  <button
                    type="button"
                    className={`pip-segment-btn ${view === 'intelligence' ? 'is-active' : ''}`}
                    onClick={() => setView('intelligence')}
                  >
                    <i className="ri-line-chart-line" />Performance Intelligence
                    {view === 'intelligence' && <span className="pip-live-dot">LIVE</span>}
                  </button>
                  <button
                    type="button"
                    className={`pip-segment-btn ${view === 'actions' ? 'is-active' : ''}`}
                    onClick={() => setView('actions')}
                  >
                    <i className="ri-checkbox-circle-line" />PIP Actions
                  </button>
                </div>
                <span className="pip-context-pill">
                  <span className="dot" />
                  {view === 'intelligence'
                    ? 'Organisation-wide analysis · Apr 2026'
                    : 'Active PIP management · Apr 2026'}
                </span>
              </div>

              {view === 'intelligence' ? (
                <>
                  {/* Pivot toggle */}
                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                    <div className="pip-pivot">
                      <button
                        type="button"
                        className={`pip-pivot-btn ${pivot === 'employee' ? 'is-active' : ''}`}
                        onClick={() => setPivot('employee')}
                      >
                        <i className="ri-user-line" />Employee Wise
                      </button>
                      <button
                        type="button"
                        className={`pip-pivot-btn ${pivot === 'department' ? 'is-active' : ''}`}
                        onClick={() => setPivot('department')}
                      >
                        <i className="ri-building-line" />Department Wise
                      </button>
                    </div>
                    <span className="pip-context-pill pip-context-pill-soft">
                      {pivot === 'employee' ? 'Employee Analysis · Apr 2026' : 'Department Analysis · Apr 2026'}
                    </span>
                  </div>

                  {pivot === 'employee' ? <EmployeeWiseView /> : <DepartmentWiseView />}
                </>
              ) : (
                <PipActionsView pips={pips} />
              )}
            </>
          ) : topTab === 'score' ? (
            <ScoreEngineView />
          ) : topTab === 'watchlist' ? (
            <WatchlistView />
          ) : topTab === 'status' ? (
            <PipStatusView />
          ) : (
            <ComingSoonView label={topTab} />
          )}
        </div>
      </Col>

      <InitiatePipModal
        isOpen={showInitiate}
        onClose={() => setShowInitiate(false)}
        onSubmit={onSubmitPip}
      />
    </Row>
    </ComingSoonShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee-Wise view
// ─────────────────────────────────────────────────────────────────────────────
function EmployeeWiseView() {
  return (
    <>
      {/* KPI cards — soft tinted icon block (not flat saturated), bold
          brand-coloured number, inline delta pill below. */}
      <Row className="g-1 mb-3 align-items-stretch rec-page-kpis pip-kpis">
        {EMPLOYEE_KPIS.map(k => (
          <Col key={k.key} xl md={4} sm={6} xs={12}>
            <div className="rec-kpi-card h-100 pip-kpi-card">
              <span className="rec-kpi-strip" style={{ background: k.strip }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">{k.label}</span>
                <span className="rec-kpi-num" style={{ color: k.tone }}>
                  {typeof k.value === 'number' ? <><AnimatedNumber value={k.value} />{k.suffix}</> : k.value}
                </span>
                {('sub' in k && k.sub) ? (
                  <span className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{k.sub}</span>
                ) : (
                  k.delta !== 0 && (
                    <span
                      className="pip-kpi-delta"
                      style={{
                        background: k.deltaUp ? '#d1fae5' : '#fee2e2',
                        color:      k.deltaUp ? '#047857' : '#b91c1c',
                      }}
                    >
                      <i className={k.deltaUp ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                      {Math.abs(k.delta)}% vs last cycle
                    </span>
                  )
                )}
              </div>
              <span className="rec-kpi-icon pip-kpi-icon" style={{ background: k.iconGrad, color: k.tone }}>
                <i className={k.icon} />
              </span>
            </div>
          </Col>
        ))}
      </Row>

      {/* Trend + Productivity row */}
      <Row className="g-3 mb-3">
        <Col lg={7}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-line-chart-line" />Performance Trend</div>
                <div className="pip-card-sub">Org-wide monthly performance — last 6 months</div>
              </div>
              <button type="button" className="rec-btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 11.5 }}>All Departments</button>
            </div>
            <PerformanceTrendChart />
            <div className="d-flex align-items-center gap-3 mt-2 flex-wrap">
              <span className="pip-legend"><span className="pip-legend-dot" style={{ background: '#7c5cfc' }} />Org Score</span>
              <span className="pip-legend"><span className="pip-legend-dot" style={{ background: '#fda4af' }} />Below Target</span>
              <span className="pip-legend"><span className="pip-legend-dot" style={{ background: '#f59e0b' }} />At Risk</span>
              <span className="ms-auto text-muted" style={{ fontSize: 11.5 }}>
                Trend: <strong className="text-danger">↓ declining</strong>
              </span>
            </div>
          </div>
        </Col>
        <Col lg={5}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-computer-line" />Productivity & Output</div>
                <div className="pip-card-sub">Task delivery, TAT &amp; efficiency</div>
              </div>
            </div>
            <Row className="g-2 mb-2">
              <Col xs={4}>
                <div className="pip-stat-tile" style={{ background: '#ece6ff' }}>
                  <div className="pip-stat-num" style={{ color: '#5a3fd1' }}>142</div>
                  <div className="pip-stat-label">Tasks Assigned</div>
                  <div className="pip-stat-sub">This sprint</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="pip-stat-tile" style={{ background: '#d1fae5' }}>
                  <div className="pip-stat-num" style={{ color: '#047857' }}>118</div>
                  <div className="pip-stat-label">Tasks Completed</div>
                  <div className="pip-stat-sub">83% completion</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="pip-stat-tile" style={{ background: '#fee2e2' }}>
                  <div className="pip-stat-num" style={{ color: '#b91c1c' }}>24</div>
                  <div className="pip-stat-label">Overdue Tasks</div>
                  <div className="pip-stat-sub">Needs escalation</div>
                </div>
              </Col>
            </Row>
            <div className="pip-meter">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-semibold fs-13">Avg Task Completion Time</span>
                <span><strong className="text-danger">3.4 days</strong> <span className="text-muted">/ target 2.5d</span></span>
              </div>
              <Progress
                value={85}
                color="danger"
                className="animated-progress custom-progress"
              />
              <div className="text-muted mt-1" style={{ fontSize: 11 }}>TAT is 0.9 days over target — review sprint allocation</div>
            </div>
            <div className="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
              <div>
                <div className="fw-semibold fs-13">Efficiency Score</div>
                <div className="text-muted" style={{ fontSize: 11 }}>Output vs capacity ratio</div>
              </div>
              <div className="fw-bold" style={{ fontSize: 22, color: '#f59e0b' }}>83%</div>
            </div>
          </div>
        </Col>
      </Row>

      {/* Top performers + Workload */}
      <Row className="g-3 mb-3">
        <Col lg={5}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-medal-line" style={{ color: '#f59e0b' }} />Top Performers</div>
                <div className="pip-card-sub">Highest scoring employees this cycle</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft" style={{ background: '#fde8c4', color: '#a4661c', borderColor: 'transparent' }}>This Month</span>
            </div>
            <div className="pip-list">
              {TOP_PERFORMERS.map(p => (
                <div key={p.id} className="pip-list-row">
                  <span className={`pip-medal pip-medal-${p.rank <= 3 ? p.rank : 'na'}`}>
                    {p.rank <= 3 ? <i className="ri-medal-line" /> : p.rank}
                  </span>
                  <span
                    className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                    style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${p.accent}, ${p.accent}cc)` }}
                  >
                    {p.initials}
                  </span>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold fs-13">{p.name}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{p.department} · {p.role}</div>
                  </div>
                  <div className="text-end">
                    <div className="fw-bold" style={{ fontSize: 16, color: '#f59e0b' }}>{p.score}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>+{p.delta}</div>
                  </div>
                  {p.band === 'top' && <span className="pip-band-pill pip-band-top">Top</span>}
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col lg={7}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-pie-chart-line" />Workload Distribution</div>
                <div className="pip-card-sub">Capacity vs actual task load</div>
              </div>
            </div>
            <Row className="g-2 mb-3">
              <Col xs={4}>
                <div className="pip-bucket pip-bucket-over">
                  <div className="pip-bucket-num">2</div>
                  <div className="pip-bucket-label">Overloaded</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="pip-bucket pip-bucket-balanced">
                  <div className="pip-bucket-num">3</div>
                  <div className="pip-bucket-label">Balanced</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="pip-bucket pip-bucket-under">
                  <div className="pip-bucket-num">1</div>
                  <div className="pip-bucket-label">Underutilized</div>
                </div>
              </Col>
            </Row>
            <div className="pip-list">
              {WORKLOAD.map(w => {
                const color = w.status === 'overloaded' ? 'danger'
                  : w.status === 'balanced'   ? 'success'
                  : 'info';
                const pct = Math.min(100, (w.load / 20) * 100);
                return (
                  <div key={w.id} className="pip-workload-row">
                    <div className="pip-workload-meta">
                      <div className="fw-semibold fs-13">{w.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{w.department}</div>
                    </div>
                    <Progress
                      value={pct}
                      color={color}
                      className="animated-progress progress-sm flex-grow-1"
                    />
                    <span className="fw-semibold" style={{ fontSize: 12, minWidth: 28, textAlign: 'right' }}>{w.load}</span>
                    <span
                      className="pip-band-pill"
                      style={{
                        background: w.status === 'overloaded' ? '#fee2e2'
                          : w.status === 'balanced'   ? '#d1fae5'
                          : '#dbeafe',
                        color: w.status === 'overloaded' ? '#b91c1c'
                          : w.status === 'balanced'   ? '#047857'
                          : '#1e40af',
                      }}
                    >
                      {w.status === 'overloaded' ? 'Overloaded'
                        : w.status === 'balanced'   ? 'Balanced'
                        : 'Underutilized'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Col>
      </Row>

      {/* Manager performance + Performance Diagnosis */}
      <Row className="g-3">
        <Col lg={6}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-team-line" />Manager Performance View</div>
                <div className="pip-card-sub">Team scores &amp; accountability layer</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">Q2 2026</span>
            </div>
            <div className="pip-list">
              {MANAGERS.map(m => {
                const color = m.score >= 80 ? 'success' : m.score >= 70 ? 'warning' : 'danger';
                const tone = m.score >= 80 ? '#16a34a' : m.score >= 70 ? '#f59e0b' : '#dc2626';
                return (
                  <div key={m.id} className="pip-manager-card">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex align-items-center gap-2 min-w-0">
                        <span
                          className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                          style={{ width: 36, height: 36, fontSize: 12, background: `linear-gradient(135deg, ${m.accent}, ${m.accent}cc)` }}
                        >
                          {m.initials}
                        </span>
                        <div>
                          <div className="fw-semibold fs-13">{m.name}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{m.department} · {m.reports} reports</div>
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="fw-bold" style={{ fontSize: 18, color: tone }}>{m.score}%</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: tone }}>{m.risk}</div>
                      </div>
                    </div>
                    <Progress
                      value={m.score}
                      color={color}
                      className="animated-progress custom-progress"
                    />
                    <div className="text-success mt-1" style={{ fontSize: 11 }}>
                      <i className="ri-check-line me-1" />Team performing within thresholds
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Col>
        <Col lg={6}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-search-line" />Performance Diagnosis</div>
                <div className="pip-card-sub">Pre-PIP root cause intelligence</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">AI Insights</span>
            </div>
            <div className="pip-info-bar">
              <i className="ri-search-eye-line" />
              Intelligence engine identified <strong>{DIAGNOSIS.length} employees</strong> with multi-signal underperformance. Pre-PIP diagnosis active.
            </div>
            <div className="pip-list">
              {DIAGNOSIS.map(d => (
                <div key={d.id} className="pip-diag-card">
                  <div className="d-flex justify-content-between align-items-start mb-1">
                    <div className="d-flex align-items-center gap-2 min-w-0">
                      <span
                        className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                        style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${d.accent}, ${d.accent}cc)` }}
                      >
                        {d.initials}
                      </span>
                      <div>
                        <div className="fw-semibold fs-13">{d.name}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          Score: <strong className="text-danger">{d.score}</strong> — PIP eligible
                        </div>
                      </div>
                    </div>
                    <button type="button" className="pip-icon-btn" aria-label="Inspect">
                      <i className="ri-search-line" />
                    </button>
                  </div>
                  <div className="text-muted mb-2" style={{ fontSize: 12 }}>{d.reason}</div>
                  <div className="d-flex flex-wrap gap-1">
                    {d.signals.map(s => (
                      <span key={s} className="pip-signal-pill">{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Department-Wise view
// ─────────────────────────────────────────────────────────────────────────────
function DepartmentWiseView() {
  const sorted = useMemo(() => [...DEPT_CARDS].sort((a, b) => b.score - a.score), []);
  const orgBenchmark = 78;

  return (
    <>
      {/* Department cards grid */}
      <Row className="g-3 mb-3">
        {DEPT_CARDS.map(d => {
          const tone = d.state === 'PIP Active' ? '#dc2626'
            : d.state === 'At Risk' ? '#f59e0b'
            : '#16a34a';
          const trendIcon = d.trend === 'declining' ? '↓ declining'
            : d.trend === 'improving' ? '↑ improving'
            : '→ stable';
          const trendColor = d.trend === 'declining' ? '#dc2626'
            : d.trend === 'improving' ? '#16a34a'
            : '#6b7280';
          return (
            <Col key={d.name} xl={3} md={6} xs={12}>
              <div className="pip-dept-card">
                <span className="pip-dept-strip" style={{ background: tone }} />
                <div className="d-flex justify-content-between align-items-start mb-1">
                  <div>
                    <div className="fw-bold" style={{ fontSize: 14 }}>{d.name}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{d.employees} employees · {d.lead}</div>
                  </div>
                  <span
                    className="pip-band-pill"
                    style={{
                      background: tone === '#dc2626' ? '#fee2e2'
                        : tone === '#f59e0b' ? '#fde8c4'
                        : '#d1fae5',
                      color: tone === '#dc2626' ? '#b91c1c'
                        : tone === '#f59e0b' ? '#a4661c'
                        : '#047857',
                    }}
                  >
                    {d.state}
                  </span>
                </div>
                <div className="d-flex justify-content-between align-items-end mt-2">
                  <span className="pip-dept-score" style={{ color: tone }}>{d.score}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: trendColor }}>{trendIcon}</span>
                </div>
                <div className="pip-spark mt-2">
                  {d.bars.map((h, i) => (
                    <span
                      key={i}
                      className="pip-spark-bar"
                      style={{ height: `${h}%`, background: i === d.bars.length - 1 ? tone : `${tone}55` }}
                    />
                  ))}
                </div>
              </div>
            </Col>
          );
        })}
      </Row>

      {/* Ranking + Risk Matrix */}
      <Row className="g-3 mb-3">
        <Col lg={7}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-bar-chart-line" />Department Performance Ranking</div>
                <div className="pip-card-sub">Avg score vs {orgBenchmark}-point org benchmark</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">Apr 2026</span>
            </div>
            <div className="pip-rank-list">
              {sorted.map(d => {
                const color = d.score >= 80 ? 'success' : d.score >= 70 ? 'warning' : 'danger';
                const tone = d.score >= 80 ? '#16a34a' : d.score >= 70 ? '#f59e0b' : '#dc2626';
                return (
                  <div key={d.name} className="pip-rank-row">
                    <span className="pip-rank-name">{d.name}</span>
                    <span className="pip-rank-track-wrap">
                      <Progress
                        value={d.score}
                        color={color}
                        className="animated-progress custom-progress"
                      />
                      <span className="pip-rank-benchmark" style={{ left: `${orgBenchmark}%` }} />
                    </span>
                    <span className="pip-rank-value" style={{ color: tone }}>{d.score}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-muted mt-2" style={{ fontSize: 11.5 }}>
              <span style={{ display: 'inline-block', width: 24, height: 2, background: '#9ca3af', verticalAlign: 'middle', marginRight: 6 }} />
              Org benchmark: {orgBenchmark}
            </div>
          </div>
        </Col>
        <Col lg={5}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-error-warning-line" />Risk Matrix by Department</div>
                <div className="pip-card-sub">At-risk &amp; PIP employees per dept</div>
              </div>
              <span className="pip-pill pip-pill-warn" style={{ background: '#fde8c4', color: '#a4661c' }}>Live</span>
            </div>
            <div className="pip-list">
              {[
                { name: 'Engineering',  pip: 1, risk: 1 },
                { name: 'Data Science', pip: 0, risk: 2 },
                { name: 'Finance',      pip: 1, risk: 1 },
                { name: 'HR & Admin',   pip: 0, risk: 1 },
                { name: 'QA / Testing', pip: 0, risk: 1 },
                { name: 'Management',   pip: 0, risk: 1 },
              ].map(r => (
                <div key={r.name} className="pip-risk-row">
                  <span className="fs-13">{r.name}</span>
                  <div className="d-flex gap-1 ms-auto">
                    {r.pip > 0 && <span className="pip-band-pill" style={{ background: '#fee2e2', color: '#b91c1c' }}>{r.pip} PIP</span>}
                    {r.risk > 0 && <span className="pip-band-pill" style={{ background: '#fde8c4', color: '#a4661c' }}>{r.risk} at risk</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>

      {/* Health / Productivity / Attendance */}
      <Row className="g-3 mb-3">
        <Col lg={4}>
          <DeptBarsCard title="Dept KPI Health" sub="Top role KPIs per department" icon="ri-pulse-line" rows={[
            { name: 'Engineering', pct: 73, multi: true },
            { name: 'Data Science', pct: 70, multi: true },
            { name: 'Finance', pct: 60, multi: true },
            { name: 'HR & Admin', pct: 73, multi: true },
            { name: 'QA / Testing', pct: 70, multi: true },
          ]} />
        </Col>
        <Col lg={4}>
          <DeptBarsCard title="Productivity by Dept" sub="Task delivery rate per department" icon="ri-line-chart-line" rows={[
            { name: 'Engineering', pct: 76 }, { name: 'Data Science', pct: 71 },
            { name: 'Finance', pct: 63 },     { name: 'HR & Admin', pct: 74 },
            { name: 'QA / Testing', pct: 70 },{ name: 'Management', pct: 72 },
            { name: 'Sales', pct: 85, healthy: true }, { name: 'Operations', pct: 79 },
          ]} />
        </Col>
        <Col lg={4}>
          <DeptBarsCard title="Attendance by Dept" sub="Avg attendance rate per department" icon="ri-calendar-check-line" rows={[
            { name: 'Engineering', pct: 88 }, { name: 'Data Science', pct: 84, lowTone: true },
            { name: 'Finance', pct: 79, lowTone: true }, { name: 'HR & Admin', pct: 91 },
            { name: 'QA / Testing', pct: 86 }, { name: 'Management', pct: 85 },
            { name: 'Sales', pct: 93, healthy: true }, { name: 'Operations', pct: 90 },
          ]} />
        </Col>
      </Row>

      {/* Trend comparison + Department Heads */}
      <Row className="g-3">
        <Col lg={7}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-line-chart-line" />Performance Trend Comparison</div>
                <div className="pip-card-sub">6-month score trajectory per department</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">Nov–Apr</span>
            </div>
            <div className="pip-trend-list">
              {[
                { name: 'Engineering',  bars: [55, 58, 60, 62, 68, 72], delta: -5,  tone: '#f59e0b' },
                { name: 'Data Science', bars: [58, 62, 60, 64, 66, 68], delta: -4,  tone: '#f59e0b' },
                { name: 'Finance',      bars: [70, 65, 60, 55, 60, 59], delta: -11, tone: '#dc2626' },
                { name: 'HR & Admin',   bars: [70, 71, 70, 72, 73, 73], delta: 0,   tone: '#f59e0b' },
                { name: 'QA / Testing', bars: [70, 68, 70, 65, 67, 69], delta: -1,  tone: '#f59e0b' },
                { name: 'Management',   bars: [73, 74, 70, 72, 71, 72], delta: -1,  tone: '#f59e0b' },
                { name: 'Sales',        bars: [76, 78, 79, 80, 82, 83], delta: 7,   tone: '#16a34a' },
                { name: 'Operations',   bars: [76, 75, 77, 78, 78, 78], delta: 2,   tone: '#f59e0b' },
              ].map(r => (
                <div key={r.name} className="pip-trend-row">
                  <span className="pip-trend-name">{r.name}</span>
                  <div className="pip-trend-bars">
                    {r.bars.map((h, i) => (
                      <span key={i} className="pip-trend-bar" style={{ height: `${h * 0.8}%`, background: i === r.bars.length - 1 ? r.tone : `${r.tone}33` }} />
                    ))}
                  </div>
                  <span className="pip-trend-delta" style={{ color: r.tone }}>
                    {r.delta < 0 ? '↓' : r.delta > 0 ? '↑' : '→'} {r.bars[r.bars.length - 1]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col lg={5}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-user-star-line" />Department Heads</div>
                <div className="pip-card-sub">Head performance &amp; team risk score</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">Q2 2026</span>
            </div>
            <div className="pip-list">
              {DEPT_HEADS.map(h => {
                const tone = h.score >= 80 ? '#16a34a' : h.score >= 70 ? '#f59e0b' : '#dc2626';
                return (
                  <div key={h.name} className="pip-list-row">
                    <span
                      className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                      style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${h.accent}, ${h.accent}cc)` }}
                    >
                      {h.initials}
                    </span>
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold fs-13">{h.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{h.department}</div>
                    </div>
                    <span
                      className="pip-band-pill"
                      style={{
                        background: h.state === 'PIP'  ? '#fee2e2' : h.state === 'Risk' ? '#fde8c4' : '#d1fae5',
                        color:      h.state === 'PIP'  ? '#b91c1c' : h.state === 'Risk' ? '#a4661c' : '#047857',
                      }}
                    >
                      {h.state}
                    </span>
                    <div className="fw-bold" style={{ fontSize: 16, color: tone, minWidth: 30, textAlign: 'right' }}>{h.score}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Col>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIP Actions view
// ─────────────────────────────────────────────────────────────────────────────
function PipActionsView({ pips }: { pips: ActivePip[] }) {
  const trendMax = Math.max(...PIP_TREND.map(r => Math.max(r.initiated, r.escalated)));

  return (
    <>
      {/* 6 KPIs */}
      <Row className="g-1 mb-3 align-items-stretch rec-page-kpis pip-kpis">
        {PIP_KPIS.map(k => (
          <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
            <div className="rec-kpi-card h-100 pip-kpi-card">
              <span className="rec-kpi-strip" style={{ background: k.strip }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">{k.label}</span>
                <span className="rec-kpi-num" style={{ color: k.tone }}>
                  <AnimatedNumber value={k.value} />
                </span>
                <span className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{k.sub}</span>
              </div>
              <span className="rec-kpi-icon pip-kpi-icon" style={{ background: k.iconGrad, color: k.tone }}>
                <i className={k.icon} />
              </span>
            </div>
          </Col>
        ))}
      </Row>

      {/* Active PIPs list — every PIP launched from the Initiate wizard
          appears here so HR can track them at a glance. Seeded with three
          existing PIPs so the table isn't empty on first open. */}
      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title"><i className="ri-list-check-2" />Active PIPs</div>
            <div className="pip-card-sub">Live list of PIPs in flight · click <strong>Initiate PIP</strong> to add</div>
          </div>
          <span className="pip-context-pill pip-context-pill-soft">{pips.length} total</span>
        </div>
        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>PIP ID</th>
                <th>EMPLOYEE</th>
                <th>DEPARTMENT</th>
                <th>START</th>
                <th>DURATION</th>
                <th>SEVERITY</th>
                <th>STATUS</th>
                <th style={{ minWidth: 180 }}>PROGRESS</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {pips.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-5 text-muted">
                    <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                    No active PIPs. Click <strong>Initiate PIP</strong> in the header to start one.
                  </td>
                </tr>
              ) : pips.map(p => {
                const sevTone =
                  p.severity === 'Critical' ? { bg: '#fee2e2', fg: '#b91c1c' }
                  : p.severity === 'High'   ? { bg: '#fde8c4', fg: '#a4661c' }
                  : p.severity === 'Medium' ? { bg: '#fef3c7', fg: '#92400e' }
                  :                           { bg: '#d1fae5', fg: '#065f46' };
                const statusTone =
                  p.status === 'Active'         ? { bg: '#ece6ff', fg: '#5a3fd1' }
                  : p.status === 'Escalated'    ? { bg: '#fee2e2', fg: '#b91c1c' }
                  : p.status === 'Completed'    ? { bg: '#d1fae5', fg: '#065f46' }
                  :                                { bg: '#fde8c4', fg: '#a4661c' };
                const progColor =
                  p.progressPct >= 80 ? 'success'
                  : p.progressPct >= 50 ? 'info'
                  : 'warning';
                return (
                  <tr key={p.id}>
                    <td><span className="pip-id-pill">{p.id}</span></td>
                    <td className="fw-semibold fs-13">{p.employeeName}</td>
                    <td className="fs-13 text-muted">{p.department}</td>
                    <td className="fs-13">{p.startDate}</td>
                    <td className="fs-13">{p.durationDays} days</td>
                    <td>
                      <span className="rec-pill" style={{ background: sevTone.bg, color: sevTone.fg }}>{p.severity}</span>
                    </td>
                    <td>
                      <span className="rec-pill" style={{ background: statusTone.bg, color: statusTone.fg }}>{p.status}</span>
                    </td>
                    <td>
                      <Progress
                        value={p.progressPct}
                        color={progColor}
                        className="animated-progress custom-progress progress-label"
                      >
                        <div className="label">{p.progressPct}%</div>
                      </Progress>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="d-flex justify-content-end gap-1">
                        <button type="button" className="pip-icon-btn" title="View"><i className="ri-eye-line" /></button>
                        <button type="button" className="pip-icon-btn" title="Edit"><i className="ri-pencil-line" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PIP Trend + Risk Distribution */}
      <Row className="g-3 mb-3">
        <Col lg={7}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-line-chart-line" />PIP Trend</div>
                <div className="pip-card-sub">Initiated vs escalated — last 6 months</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft">
                <i className="ri-line-chart-line" />Apr 2026
              </span>
            </div>
            <div className="pip-bar-chart">
              {PIP_TREND.map(r => (
                <div key={r.month} className="pip-bar-col">
                  <div className="pip-bar-stack">
                    {r.escalated > 0 && (
                      <span
                        className="pip-bar-piece"
                        style={{ height: `${(r.escalated / trendMax) * 100}%`, background: '#fda4af' }}
                        title={`${r.escalated} escalated`}
                      />
                    )}
                    <span
                      className="pip-bar-piece"
                      style={{ height: `${(r.initiated / trendMax) * 100}%`, background: '#a78bfa' }}
                      title={`${r.initiated} initiated`}
                    >
                      {r.month === 'Apr' && <span className="pip-bar-cap">{r.initiated}</span>}
                    </span>
                  </div>
                  <div className="pip-bar-month">{r.month}</div>
                </div>
              ))}
            </div>
            <div className="d-flex align-items-center gap-3 mt-2 flex-wrap">
              <span className="pip-legend"><span className="pip-legend-dot" style={{ background: '#a78bfa' }} />Initiated</span>
              <span className="pip-legend"><span className="pip-legend-dot" style={{ background: '#fda4af' }} />Escalated / Risk</span>
              <span className="ms-auto text-muted" style={{ fontSize: 11.5 }}>Total: 35 PIPs in period</span>
            </div>
          </div>
        </Col>
        <Col lg={5}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-error-warning-line" />Risk Distribution</div>
                <div className="pip-card-sub">All active PIPs by severity</div>
              </div>
            </div>
            <Row className="g-2 mb-2">
              {RISK_DISTRIBUTION.map(r => (
                <Col xs={6} key={r.band}>
                  <div className="pip-risk-tile" style={{ background: r.bg, color: r.fg }}>
                    <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{r.count}</div>
                    <div className="d-flex justify-content-between align-items-baseline">
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{r.pct}%</span>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
            <div className="pip-risk-stack">
              {RISK_DISTRIBUTION.map(r => (
                <span key={r.band} style={{ width: `${r.pct}%`, background: r.fg }} />
              ))}
            </div>
            <div className="d-flex gap-3 mt-2 flex-wrap">
              {RISK_DISTRIBUTION.map(r => (
                <span key={r.band} className="pip-legend">
                  <span className="pip-legend-dot" style={{ background: r.fg }} />{r.label}
                </span>
              ))}
            </div>
          </div>
        </Col>
      </Row>

      {/* Department distribution + Recent activity */}
      <Row className="g-3">
        <Col lg={6}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-grid-line" />Department Distribution</div>
                <div className="pip-card-sub">PIP cases by department</div>
              </div>
            </div>
            <div className="pip-list">
              {DEPT_DISTRIBUTION.map(d => (
                <div key={d.name} className="pip-rank-row">
                  <span className="pip-rank-name" style={{ width: 110 }}>{d.name}</span>
                  <Progress
                    value={d.pct * 2}
                    className="animated-progress custom-progress flex-grow-1"
                    barStyle={{ background: d.color }}
                  />
                  <span className="fw-semibold fs-13" style={{ minWidth: 24, textAlign: 'right' }}>{d.count}</span>
                  <span className="text-muted" style={{ fontSize: 11, minWidth: 32, textAlign: 'right' }}>{d.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col lg={6}>
          <div className="pip-card h-100">
            <div className="pip-card-head">
              <div>
                <div className="pip-card-title"><i className="ri-pulse-line" />Recent Activity</div>
                <div className="pip-card-sub">Latest updates across all PIPs</div>
              </div>
              <span className="pip-context-pill pip-context-pill-soft" style={{ background: '#d1fae5', color: '#047857', borderColor: 'transparent' }}>
                <span className="dot" style={{ background: '#16a34a' }} />Live
              </span>
            </div>
            <div className="pip-activity">
              {RECENT_ACTIVITY.map(a => (
                <div key={a.id} className="pip-activity-row">
                  <span className="pip-activity-icon" style={{ background: `${a.tone}20`, color: a.tone }}>
                    <i className={a.icon} />
                  </span>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold fs-13">{a.title}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{a.ref}</div>
                  </div>
                  <div className="text-end" style={{ flexShrink: 0 }}>
                    <div className="text-muted" style={{ fontSize: 11 }}>{a.when}</div>
                    <div className="fw-semibold" style={{ fontSize: 11, color: '#5a3fd1' }}>{a.by}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper card for the three "Dept *" lists
// ─────────────────────────────────────────────────────────────────────────────
function DeptBarsCard({
  title, sub, icon, rows,
}: {
  title: string;
  sub: string;
  icon: string;
  rows: { name: string; pct: number; healthy?: boolean; lowTone?: boolean; multi?: boolean }[];
}) {
  return (
    <div className="pip-card h-100">
      <div className="pip-card-head">
        <div>
          <div className="pip-card-title"><i className={icon} />{title}</div>
          <div className="pip-card-sub">{sub}</div>
        </div>
      </div>
      <div className="pip-list">
        {rows.map(r => {
          const tone  = r.healthy ? '#16a34a' : r.lowTone ? '#dc2626' : r.pct >= 80 ? '#16a34a' : r.pct >= 70 ? '#f59e0b' : '#dc2626';
          const color = r.healthy ? 'success' : r.lowTone ? 'danger' : r.pct >= 80 ? 'success' : r.pct >= 70 ? 'warning' : 'danger';
          return (
            <div key={r.name} className="pip-rank-row">
              <span className="pip-rank-name" style={{ width: 110 }}>{r.name}</span>
              {r.multi ? (
                <Progress multi className="animated-progress custom-progress flex-grow-1">
                  <Progress bar value={34} barStyle={{ background: '#fda4af' }} />
                  <Progress bar value={33} barStyle={{ background: '#fcd34d' }} />
                  <Progress bar value={Math.max(0, r.pct - 67)} barStyle={{ background: '#f59e0b' }} />
                </Progress>
              ) : (
                <Progress
                  value={r.pct}
                  color={color}
                  className="animated-progress custom-progress flex-grow-1"
                />
              )}
              <span className="fw-semibold fs-13" style={{ minWidth: 36, textAlign: 'right', color: tone }}>{r.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny SVG line chart for the org performance trend
// ─────────────────────────────────────────────────────────────────────────────
function PerformanceTrendChart() {
  const w = 540, h = 180;
  const max = Math.max(...TREND_DATA.map(d => d.score)) + 8;
  const min = Math.min(...TREND_DATA.map(d => d.score)) - 8;
  const points = TREND_DATA.map((d, i) => {
    const x = (i / (TREND_DATA.length - 1)) * (w - 30) + 15;
    const y = h - 30 - ((d.score - min) / (max - min)) * (h - 60);
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const fillD = `${pathD} L ${points[points.length - 1].x},${h - 20} L ${points[0].x},${h - 20} Z`;
  const target = 80;
  const targetY = h - 30 - ((target - min) / (max - min)) * (h - 60);

  return (
    <div className="pip-trend-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 200 }}>
        <line x1={0} y1={20}        x2={w} y2={20}        stroke="#f1f5f9" />
        <line x1={0} y1={(h - 40) / 2 + 20} x2={w} y2={(h - 40) / 2 + 20} stroke="#f1f5f9" />
        <line x1={0} y1={h - 20}    x2={w} y2={h - 20}    stroke="#f1f5f9" />
        <text x={2} y={24} fill="#9ca3af" fontSize="10">100</text>
        <text x={2} y={(h - 40) / 2 + 24} fill="#9ca3af" fontSize="10">80</text>
        <text x={2} y={h - 16} fill="#9ca3af" fontSize="10">60</text>
        <line x1={0} y1={targetY} x2={w} y2={targetY} stroke="#fcd34d" strokeWidth="1" strokeDasharray="4 4" />
        <text x={w - 50} y={targetY - 4} fill="#a4661c" fontSize="9" fontWeight="700">PIP ≤60</text>
        <path d={fillD} fill="rgba(124,92,252,0.10)" />
        <path d={pathD} fill="none" stroke="#7c5cfc" strokeWidth="2.5" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={5} fill={i >= points.length - 2 ? '#f59e0b' : '#7c5cfc'} stroke="#fff" strokeWidth="2" />
            <text x={p.x} y={h - 2} fill="#9ca3af" fontSize="10" textAnchor="middle">{p.month}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Coming-soon placeholder
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Score Engine view — explains how each employee's PIP score is computed
// (Common 40% + Role KPI 60%, deductions, recoveries, zone bands), then
// lists every employee with their current score, trend, zone and top
// deduction so HR can act from one screen.
// ─────────────────────────────────────────────────────────────────────────────
const SCORE_COMMON_PARTS = [
  { weight: 35, name: 'Attendance',  sub: 'Late marks, absences, punches', tone: '#10b981' },
  { weight: 35, name: 'Task Hygiene',sub: 'Overdue tasks, missed deadlines', tone: '#10b981' },
  { weight: 20, name: 'Warnings',    sub: 'Formal warnings issued this cycle', tone: '#f59e0b' },
  { weight: 10, name: 'Manager Flag',sub: 'Escalation or behavioural concern', tone: '#0ea5e9' },
];

const SCORE_ROLE_PARTS = [
  { name: 'Engineering',  metrics: 'Delivery · Code Quality · Rework Rate' },
  { name: 'QA / Testing', metrics: 'Defect Leakage · Coverage · Bug Closure' },
  { name: 'Finance',      metrics: 'Accuracy · SLA Compliance · Audit Ready' },
  { name: 'Data Science', metrics: 'Model Accuracy · Delivery · Collaboration' },
  { name: 'Management',   metrics: 'Delivery Predict. · Escalation · Planning' },
  { name: 'HR & Admin',   metrics: 'Case Resolution · Policy · Response SLA' },
];

const SCORE_STEPS = [
  { n: 1, label: 'Start at 100',         sub: 'Every employee begins each cycle at full score',   badge: '100',    tone: '#5a3fd1' },
  { n: 2, label: 'Apply Deductions',     sub: 'Each event deducts −2 to −15 pts by severity',     badge: '−2…−15', tone: '#dc2626' },
  { n: 3, label: 'Apply Recoveries',     sub: 'Positive signals add +2 to +10 pts back',          badge: '+2…+10', tone: '#16a34a' },
  { n: 4, label: 'Common Weight ×40%',   sub: 'Weighted avg of attendance, tasks, warnings',      badge: '×0.40',  tone: '#7c5cfc' },
  { n: 5, label: 'Role KPI Avg ×60%',    sub: 'Average of 3 role-specific KPIs vs targets',       badge: '×0.60',  tone: '#10b981' },
  { n: 6, label: 'Sum = Final Score',    sub: 'Common×40% + Role KPI×60%',                        badge: '=Final', tone: '#1e1b4b' },
];

const SCORE_DEDUCTIONS = [
  { label: 'Critical Issue',   value: -15, color: '#dc2626', pct: 100 },
  { label: 'High Impact Issue',value: -10, color: '#f97316', pct: 67  },
  { label: 'Medium Impact',    value: -5,  color: '#f59e0b', pct: 34  },
  { label: 'Minor Issue',      value: -2,  color: '#0ea5e9', pct: 14  },
  { label: 'Positive Signal',  value: 5,   color: '#16a34a', pct: 34  },
];

const SCORE_ZONES = [
  { range: '85–100', label: 'Healthy',     copy: 'Normal tracking · Reward signals active',         tone: '#16a34a', bg: '#d1fae5' },
  { range: '75–84',  label: 'Watchlist',   copy: 'Auto-alert sent · Soft coaching recommended',     tone: '#f59e0b', bg: '#fef3c7' },
  { range: '60–74',  label: 'Risk Zone',   copy: 'Weekly monitoring · Pre-PIP intervention active', tone: '#f97316', bg: '#ffedd5' },
  { range: '<60',    label: 'PIP Trigger', copy: '2 cycles below 60 · Manager validation required', tone: '#dc2626', bg: '#fee2e2' },
];

interface ScoreRow {
  id: string;
  name: string;
  initials: string;
  accent: string;
  role: string;
  score: number;
  delta: number;
  zone: 'PIP Trigger' | 'Risk Zone' | 'Watchlist' | 'Healthy';
  topDeduction: { label: string; pts: number; cat: string };
  stability: 'PIP Ready' | '1/2 cycles' | 'Stable';
  trend: number[];
}

const SCORE_ROWS: ScoreRow[] = [
  { id: 'sr1', name: 'Karan Mehta',     initials: 'KM', accent: '#7c5cfc', role: 'Engineering',  score: 51, delta: -7, zone: 'PIP Trigger', topDeduction: { label: 'Sprint velocity 42% below target for 2 cycles', pts: -15, cat: 'KPI' },        stability: 'PIP Ready',  trend: [85, 78, 72, 65, 58, 51] },
  { id: 'sr2', name: 'Varun Malhotra',  initials: 'VM', accent: '#f97316', role: 'Data Science', score: 63, delta: -8, zone: 'Risk Zone',   topDeduction: { label: 'ML model 35% behind schedule',                  pts: -10, cat: 'Manager' },     stability: '1/2 cycles', trend: [82, 80, 76, 72, 68, 63] },
  { id: 'sr3', name: 'Ritika Chauhan',  initials: 'RC', accent: '#dc2626', role: 'QA / Testing', score: 68, delta: -5, zone: 'Risk Zone',   topDeduction: { label: 'Design QA failures up 28%',                     pts: -8,  cat: 'KPI' },        stability: '1/2 cycles', trend: [80, 78, 75, 72, 70, 68] },
  { id: 'sr4', name: 'Harsh Thakur',    initials: 'HT', accent: '#10b981', role: 'Management',   score: 72, delta: -6, zone: 'Risk Zone',   topDeduction: { label: '7 late arrivals in 60 days',                    pts: -5,  cat: 'Attendance' }, stability: '1/2 cycles', trend: [82, 80, 78, 76, 74, 72] },
  { id: 'sr5', name: 'Vikram Chauhan',  initials: 'VC', accent: '#5a3fd1', role: 'Finance',      score: 49, delta: -8, zone: 'PIP Trigger', topDeduction: { label: 'Missing punch 5 days + absent 3',               pts: -15, cat: 'Attendance' }, stability: 'PIP Ready',  trend: [78, 70, 64, 58, 53, 49] },
];

type ScoreFilter = 'all' | 'PIP Trigger' | 'Risk Zone' | 'Watchlist' | 'Healthy';

// Reusable card with the soft-gradient header band + colored top strip +
// rounded icon tile pattern (matches the IGC profile-page reference).
// Each card passes its own `tone`, `headBg`, `iconBg`, icon and title.
function ScoreCard({
  tone, headBg, iconBg, icon, title, subtitle, headRight, children,
}: {
  tone: string;
  headBg: string;
  iconBg: string;
  icon: string;
  title: string;
  subtitle?: string;
  headRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pip-headed-card h-100">
      <span className="pip-headed-card-strip" style={{ background: tone }} />
      <div className="pip-headed-card-head" style={{ background: headBg }}>
        <span className="pip-headed-card-icon" style={{ background: iconBg, color: tone }}>
          <i className={icon} />
        </span>
        <div className="min-w-0 flex-grow-1">
          <div className="pip-headed-card-title">{title}</div>
          {subtitle && <div className="pip-headed-card-sub">{subtitle}</div>}
        </div>
        {headRight && <div className="ms-auto">{headRight}</div>}
      </div>
      <div className="pip-headed-card-body">{children}</div>
    </div>
  );
}

function ScoreEngineView() {
  const [filter, setFilter] = useState<ScoreFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = SCORE_ROWS.filter(r => {
    if (filter !== 'all' && r.zone !== filter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
  });

  return (
    <>
      {/* Hero formula card — navy gradient with the formula on the left
          and a "worked example" callout on the right. */}
      <div className="pip-formula-hero mb-3">
        <div className="pip-formula-content">
          <div className="pip-formula-label">SCORING FORMULA · INTELLIGENCE ENGINE</div>
          <div className="pip-formula-row">
            <span className="pip-formula-final">Final =</span>
            <span className="pip-formula-pill" style={{ color: '#a78bfa' }}>Common</span>
            <span className="pip-formula-x">×</span>
            <span className="pip-formula-pill pip-formula-pill-solid" style={{ background: '#7c5cfc' }}>40%</span>
            <span className="pip-formula-plus">+</span>
            <span className="pip-formula-pill" style={{ color: '#34d399' }}>Role KPI</span>
            <span className="pip-formula-x">×</span>
            <span className="pip-formula-pill pip-formula-pill-solid" style={{ background: '#10b981' }}>60%</span>
          </div>
          <div className="pip-formula-sub">
            Starts at 100 · Deductions per event · Recoveries add back points · Role KPIs carry higher weight
          </div>
        </div>
        <div className="pip-formula-example">
          <div className="pip-formula-example-label">WORKED EXAMPLE — VIKRAM CHAUHAN</div>
          <div className="pip-formula-example-row">
            <span>Common Score</span>
            <span><strong style={{ color: '#a78bfa' }}>49</strong> × 40% = <strong>19.6</strong></span>
          </div>
          <div className="pip-formula-example-row">
            <span>Role KPI Avg</span>
            <span><strong style={{ color: '#34d399' }}>55.7</strong> × 60% = <strong>33.4</strong></span>
          </div>
          <div className="pip-formula-example-divider" />
          <div className="pip-formula-example-row">
            <span>Final Score</span>
            <span style={{ color: '#fcd34d', fontWeight: 800 }}>≈ 53</span>
          </div>
        </div>
      </div>

      {/* Three columns — Common Score / Role KPI Score / Calculation Steps */}
      <Row className="g-3 mb-3 align-items-stretch">
        <Col lg={4}>
          <ScoreCard
            tone="#7c5cfc"
            headBg="linear-gradient(180deg,#f3eeff 0%,#fff 100%)"
            iconBg="#ece6ff"
            icon="ri-checkbox-circle-line"
            title="Common Score"
            subtitle="40% weight · Universal across roles"
          >
            <div className="text-muted mb-3" style={{ fontSize: 12 }}>
              Measures baseline behaviour applicable to every employee, regardless of department or function.
            </div>
            <div className="d-flex flex-column gap-2">
              {SCORE_COMMON_PARTS.map(p => (
                <div key={p.name} className="pip-score-part">
                  <span className="pip-score-weight" style={{ background: `${p.tone}1f`, color: p.tone }}>{p.weight}%</span>
                  <div>
                    <div className="fw-semibold fs-13">{p.name}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{p.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScoreCard>
        </Col>
        <Col lg={4}>
          <ScoreCard
            tone="#10b981"
            headBg="linear-gradient(180deg,#d1fae5 0%,#fff 100%)"
            iconBg="#a7f3d0"
            icon="ri-star-line"
            title="Role KPI Score"
            subtitle="60% weight · Role-specific metrics"
          >
            <div className="text-muted mb-3" style={{ fontSize: 12 }}>
              Avg of top 3 KPIs weighted by each role's performance criteria. Higher weight reflects job-specific impact.
            </div>
            <div className="d-flex flex-column gap-2">
              {SCORE_ROLE_PARTS.map(r => (
                <div key={r.name} className="pip-role-row">
                  <span className="pip-role-dot" style={{ background: '#10b981' }} />
                  <div>
                    <div className="fw-semibold fs-13" style={{ color: '#0a716a' }}>{r.name}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{r.metrics}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScoreCard>
        </Col>
        <Col lg={4}>
          <ScoreCard
            tone="#f59e0b"
            headBg="linear-gradient(180deg,#fef3c7 0%,#fff 100%)"
            iconBg="#fde68a"
            icon="ri-bar-chart-2-line"
            title="Calculation Steps"
            subtitle="How a final score is computed"
          >
            <div className="d-flex flex-column gap-2">
              {SCORE_STEPS.map(s => (
                <div key={s.n} className="pip-calc-step">
                  <span className="pip-calc-num" style={{ background: `${s.tone}1f`, color: s.tone }}>{s.n}</span>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold fs-13">{s.label}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{s.sub}</div>
                  </div>
                  <span className="pip-calc-badge" style={{ color: s.tone }}>{s.badge}</span>
                </div>
              ))}
            </div>
          </ScoreCard>
        </Col>
      </Row>

      {/* Weighted Deduction Model + Score Zone Model */}
      <Row className="g-3 mb-3 align-items-stretch">
        <Col lg={5}>
          <ScoreCard
            tone="#6366f1"
            headBg="linear-gradient(180deg,#e0e7ff 0%,#fff 100%)"
            iconBg="#c7d2fe"
            icon="ri-shield-cross-line"
            title="Weighted Deduction Model"
            subtitle="Points deducted per flagged event"
          >
            <div className="text-muted mb-3" style={{ fontSize: 12 }}>
              Higher severity = larger deduction impact. Positive signals add points back.
            </div>
            <div className="d-flex flex-column gap-2">
              {SCORE_DEDUCTIONS.map(d => (
                <div key={d.label} className="pip-deduction-row">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="fs-13">{d.label}</span>
                    <span className="fw-bold" style={{ color: d.color, fontSize: 13 }}>
                      {d.value > 0 ? `+${d.value}` : d.value}
                    </span>
                  </div>
                  <Progress value={d.pct} className="animated-progress progress-sm" barStyle={{ background: d.color }} />
                </div>
              ))}
            </div>
          </ScoreCard>
        </Col>
        <Col lg={7}>
          <ScoreCard
            tone="#0ea5e9"
            headBg="linear-gradient(180deg,#dbeafe 0%,#fff 100%)"
            iconBg="#bfdbfe"
            icon="ri-pie-chart-line"
            title="Score Zone Model"
            subtitle="What each score range means"
          >
            <div className="text-muted mb-3" style={{ fontSize: 12 }}>
              Each band triggers a different automatic action across the system.
            </div>
            <div className="pip-zone-spectrum mb-3" />
            <div className="d-flex flex-column gap-2">
              {SCORE_ZONES.map(z => (
                <div key={z.label} className="pip-zone-row">
                  <div className="pip-zone-tile" style={{ background: z.bg, color: z.tone }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{z.range}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.85 }}>{z.label}</div>
                  </div>
                  <div className="flex-grow-1">
                    <div className="text-muted" style={{ fontSize: 12 }}>{z.copy}</div>
                    <Progress value={100} className="animated-progress progress-sm mt-1" barStyle={{ background: z.tone }} />
                  </div>
                </div>
              ))}
            </div>
          </ScoreCard>
        </Col>
      </Row>

      {/* All Employee Scores list */}
      <ScoreCard
        tone="#7c5cfc"
        headBg="linear-gradient(180deg,#f3eeff 0%,#fff 100%)"
        iconBg="#ece6ff"
        icon="ri-team-line"
        title="All Employee Scores"
        subtitle={`Cycle Apr 2026 · ${SCORE_ROWS.length} employees`}
        headRight={
          <span className="pip-context-pill pip-context-pill-soft">
            <i className="ri-calendar-2-line" />
            Click <strong>Cycle Dates</strong> to assign calendar periods per employee
          </span>
        }
      >
        <div className="d-flex align-items-center flex-wrap gap-2 mb-3">
          <div className="lp-search-box flex-grow-1" style={{ minWidth: 220 }}>
            <i className="ri-search-line" />
            <input type="text" placeholder="Search employee or role…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {(['all', 'PIP Trigger', 'Risk Zone', 'Watchlist', 'Healthy'] as ScoreFilter[]).map(f => (
            <button
              key={f}
              type="button"
              className={`pip-score-filter ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>SCORE</th>
                <th>TREND</th>
                <th>ZONE</th>
                <th>TOP DEDUCTION</th>
                <th>STABILITY</th>
                <th>CYCLE DATES</th>
                <th style={{ textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-5 text-muted">No employees match this filter</td></tr>
              ) : filtered.map(r => {
                const zoneTone =
                  r.zone === 'PIP Trigger' ? { bg: '#fee2e2', fg: '#b91c1c' }
                  : r.zone === 'Risk Zone'  ? { bg: '#ffedd5', fg: '#c2410c' }
                  : r.zone === 'Watchlist'  ? { bg: '#fef3c7', fg: '#92400e' }
                  :                            { bg: '#d1fae5', fg: '#047857' };
                const scoreColor = r.score < 60 ? '#dc2626' : r.score < 75 ? '#f97316' : r.score < 85 ? '#f59e0b' : '#16a34a';
                const stabTone =
                  r.stability === 'PIP Ready'   ? { bg: '#fee2e2', fg: '#b91c1c' }
                  : r.stability === '1/2 cycles' ? { bg: '#fde8c4', fg: '#a4661c' }
                  :                                 { bg: '#d1fae5', fg: '#047857' };
                const trendMax = Math.max(...r.trend);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                          style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}>
                          {r.initials}
                        </span>
                        <div>
                          <div className="fw-semibold fs-13">{r.name}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{r.role}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span className="pip-score-circle" style={{ borderColor: scoreColor, color: scoreColor }}>
                          {r.score}
                        </span>
                        <div>
                          <div className="text-danger fw-semibold" style={{ fontSize: 11 }}>{r.delta}</div>
                          <div className="text-muted" style={{ fontSize: 10.5 }}>vs prev</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="pip-mini-trend" title="declining">
                        {r.trend.map((v, i) => (
                          <span key={i} className="pip-mini-trend-bar" style={{
                            height: `${(v / trendMax) * 100}%`,
                            background: i === r.trend.length - 1 ? scoreColor : `${scoreColor}55`,
                          }} />
                        ))}
                      </div>
                      <div className="text-danger" style={{ fontSize: 10.5 }}>↓ declining</div>
                    </td>
                    <td>
                      <span className="rec-pill" style={{ background: zoneTone.bg, color: zoneTone.fg }}>● {r.zone}</span>
                    </td>
                    <td>
                      <div className="fs-13" style={{ color: scoreColor, fontWeight: 600 }}>{r.topDeduction.label}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        <strong>{r.topDeduction.pts} pts</strong> · {r.topDeduction.cat}
                      </div>
                    </td>
                    <td>
                      <span className="rec-pill" style={{ background: stabTone.bg, color: stabTone.fg }}>● {r.stability}</span>
                    </td>
                    <td>
                      <button type="button" className="rec-btn-ghost" style={{ padding: '4px 10px', fontSize: 11.5 }}>
                        <i className="ri-calendar-2-line" />Set Dates
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="rec-btn-soft" style={{ padding: '4px 10px', fontSize: 11.5 }}>
                        <i className="ri-search-line" />Analyse
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ScoreCard>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist view — at-a-glance triage of every employee whose score is below
// 85. Top KPIs partition the org by zone, then a per-employee card surfaces
// the performance score bar, role KPIs, signal log, and action chrome so
// HR can decide whether to Trigger PIP / Override / Open detail.
// ─────────────────────────────────────────────────────────────────────────────
type WatchZone = 'PIP Trigger' | 'Risk Zone' | 'Watchlist' | 'Healthy';

interface WatchEmployee {
  id: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  cycles: string;
  trend: 'declining' | 'improving' | 'stable';
  zone: WatchZone;
  pipEligible: boolean;
  score: number;
  delta: number;
  perfBars: number[];
  roleKpis: { name: string; value: number; target: number }[];
  signals: { text: string; pts: number; week: string; tone: 'red' | 'amber' | 'blue' }[];
  conditionsMet: boolean;
}

const WATCH_EMPLOYEES: WatchEmployee[] = [
  {
    id: 'we1', name: 'Vikram Chauhan', initials: 'VC', accent: '#7c5cfc',
    department: 'Finance', cycles: '2/2 cycles', trend: 'declining',
    zone: 'PIP Trigger', pipEligible: true, score: 49, delta: -8,
    perfBars: [60, 55, 65, 50, 70, 55, 70, 75, 90],
    roleKpis: [
      { name: 'Accuracy',       value: 52, target: 90 },
      { name: 'SLA Compliance', value: 60, target: 85 },
      { name: 'Audit Ready',    value: 55, target: 80 },
    ],
    signals: [
      { text: 'Missing punch 5 days + absent 3',           pts: -15, week: 'W-6', tone: 'red' },
      { text: 'Q1 KPI rating 2.1/5 — below 2.5 threshold', pts: -10, week: 'W-4', tone: 'red' },
      { text: '2 formal warnings issued',                   pts: -5,  week: 'W-2', tone: 'amber' },
    ],
    conditionsMet: true,
  },
  {
    id: 'we2', name: 'Karan Mehta', initials: 'KM', accent: '#7c5cfc',
    department: 'Engineering', cycles: '2/2 cycles', trend: 'declining',
    zone: 'PIP Trigger', pipEligible: true, score: 51, delta: -7,
    perfBars: [70, 60, 65, 70, 80, 75, 80, 85, 95],
    roleKpis: [
      { name: 'Delivery Timeline', value: 40, target: 85 },
      { name: 'Code Quality',      value: 52, target: 80 },
      { name: 'Rework Rate',       value: 45, target: 75 },
    ],
    signals: [
      { text: 'Sprint velocity 42% below target for 2 cycles', pts: -15, week: 'W-8', tone: 'red' },
      { text: '7 late marks in 60 days',                       pts: -10, week: 'W-6', tone: 'red' },
      { text: '1 formal warning issued',                       pts: -5,  week: 'W-4', tone: 'amber' },
    ],
    conditionsMet: true,
  },
  {
    id: 'we3', name: 'Varun Malhotra', initials: 'VM', accent: '#f97316',
    department: 'Data Science', cycles: '1/2 cycles', trend: 'declining',
    zone: 'Risk Zone', pipEligible: false, score: 63, delta: -8,
    perfBars: [75, 80, 70, 78, 65, 70, 78, 85, 90],
    roleKpis: [
      { name: 'Model Accuracy', value: 68, target: 85 },
      { name: 'Delivery',       value: 60, target: 80 },
      { name: 'Collaboration',  value: 72, target: 75 },
    ],
    signals: [
      { text: 'ML model 35% behind schedule',         pts: -10, week: 'W-4', tone: 'red' },
      { text: 'WFH misuse detected, 4 missed check-ins',pts: -5, week: 'W-3', tone: 'amber' },
      { text: '2 overdue tasks this cycle',            pts: -2,  week: 'W-2', tone: 'blue' },
    ],
    conditionsMet: false,
  },
  {
    id: 'we4', name: 'Ritika Chauhan', initials: 'RC', accent: '#dc2626',
    department: 'QA / Testing', cycles: '1/2 cycles', trend: 'declining',
    zone: 'Risk Zone', pipEligible: false, score: 68, delta: -5,
    perfBars: [78, 72, 80, 75, 70, 80, 82, 88, 92],
    roleKpis: [
      { name: 'Defect Leakage', value: 65, target: 85 },
      { name: 'Test Coverage',  value: 70, target: 80 },
      { name: 'Bug Closure',    value: 72, target: 75 },
    ],
    signals: [
      { text: 'Design QA failures up 28%', pts: -8, week: 'W-4', tone: 'red' },
      { text: 'Avg 1 late per week',        pts: -2, week: 'W-3', tone: 'blue' },
      { text: 'Client satisfaction drop',   pts: -5, week: 'W-2', tone: 'amber' },
    ],
    conditionsMet: false,
  },
  {
    id: 'we5', name: 'Kiran Patel', initials: 'KP', accent: '#0ea5e9',
    department: 'HR & Admin', cycles: '1/2 cycles', trend: 'declining',
    zone: 'Risk Zone', pipEligible: false, score: 70, delta: -5,
    perfBars: [80, 78, 75, 82, 78, 80, 85, 88, 92],
    roleKpis: [
      { name: 'Case Resolution',  value: 62, target: 80 },
      { name: 'Policy Adherence', value: 74, target: 85 },
      { name: 'Response',         value: 68, target: 80 },
    ],
    signals: [
      { text: 'SLA compliance 61% — below 80% threshold', pts: -10, week: 'W-5', tone: 'red' },
    ],
    conditionsMet: false,
  },
  {
    id: 'we6', name: 'Harsh Thakur', initials: 'HT', accent: '#0a716a',
    department: 'Management', cycles: '1/2 cycles', trend: 'declining',
    zone: 'Risk Zone', pipEligible: false, score: 72, delta: -6,
    perfBars: [82, 80, 78, 80, 76, 82, 86, 90, 94],
    roleKpis: [
      { name: 'Delivery Predict.', value: 70, target: 85 },
      { name: 'Escalation Mgmt',   value: 74, target: 80 },
      { name: 'Planning',          value: 68, target: 75 },
    ],
    signals: [
      { text: '7 late arrivals in 60 days', pts: -5, week: 'W-5', tone: 'amber' },
    ],
    conditionsMet: false,
  },
];

const WATCH_ZONE_TONE: Record<WatchZone, { tone: string; bg: string; head: string; iconBg: string }> = {
  'PIP Trigger': { tone: '#dc2626', bg: '#fee2e2', head: 'linear-gradient(180deg,#fee2e2 0%,#fff 100%)', iconBg: '#fecaca' },
  'Risk Zone':   { tone: '#f97316', bg: '#ffedd5', head: 'linear-gradient(180deg,#ffedd5 0%,#fff 100%)', iconBg: '#fed7aa' },
  'Watchlist':   { tone: '#f59e0b', bg: '#fef3c7', head: 'linear-gradient(180deg,#fef3c7 0%,#fff 100%)', iconBg: '#fde68a' },
  'Healthy':     { tone: '#16a34a', bg: '#d1fae5', head: 'linear-gradient(180deg,#d1fae5 0%,#fff 100%)', iconBg: '#a7f3d0' },
};

// Brand palette used by the per-employee cards. Severity is conveyed by
// the zone pill inside the header; the card chrome itself rotates through
// the same purple/green/amber/indigo/sky tones the Score Engine uses.
const WATCH_BRAND_PALETTE: { tone: string; head: string; iconBg: string }[] = [
  { tone: '#7c5cfc', head: 'linear-gradient(180deg,#f3eeff 0%,#fff 100%)', iconBg: '#ece6ff' }, // purple
  { tone: '#10b981', head: 'linear-gradient(180deg,#d1fae5 0%,#fff 100%)', iconBg: '#a7f3d0' }, // green
  { tone: '#f59e0b', head: 'linear-gradient(180deg,#fef3c7 0%,#fff 100%)', iconBg: '#fde68a' }, // amber
  { tone: '#6366f1', head: 'linear-gradient(180deg,#e0e7ff 0%,#fff 100%)', iconBg: '#c7d2fe' }, // indigo
  { tone: '#0ea5e9', head: 'linear-gradient(180deg,#dbeafe 0%,#fff 100%)', iconBg: '#bfdbfe' }, // sky
  { tone: '#ec4899', head: 'linear-gradient(180deg,#fdd9ea 0%,#fff 100%)', iconBg: '#fbcfe8' }, // pink
];

function WatchlistView() {
  const [filter, setFilter] = useState<'all' | WatchZone>('all');
  const [search, setSearch] = useState('');

  const counts = {
    'PIP Trigger': WATCH_EMPLOYEES.filter(e => e.zone === 'PIP Trigger').length,
    'Risk Zone':   WATCH_EMPLOYEES.filter(e => e.zone === 'Risk Zone').length,
    'Watchlist':   WATCH_EMPLOYEES.filter(e => e.zone === 'Watchlist').length,
    'Healthy':     WATCH_EMPLOYEES.filter(e => e.zone === 'Healthy').length,
  };

  const filtered = WATCH_EMPLOYEES.filter(e => {
    if (filter !== 'all' && e.zone !== filter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return e.name.toLowerCase().includes(q) || e.department.toLowerCase().includes(q);
  });

  return (
    <>
      {/* 4 zone KPIs + 1 ORG SNAPSHOT */}
      <Row className="g-3 mb-3 align-items-stretch">
        {(['PIP Trigger', 'Risk Zone', 'Watchlist', 'Healthy'] as WatchZone[]).map(z => {
          const meta = WATCH_ZONE_TONE[z];
          const range = z === 'PIP Trigger' ? 'SCORE < 60'
            : z === 'Risk Zone'   ? 'SCORE 60–74'
            : z === 'Watchlist'   ? 'SCORE 75–84'
            :                       'SCORE ≥ 85';
          const ratio = Math.min(100, (counts[z] / WATCH_EMPLOYEES.length) * 100);
          return (
            <Col key={z} xl md={6} sm={6} xs={12}>
              <div className="pip-watch-zone-card h-100">
                <span className="pip-watch-zone-strip" style={{ background: meta.tone }} />
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <span className="pip-watch-zone-dot" style={{ background: meta.tone }} />
                  <span className="pip-watch-zone-range" style={{ color: meta.tone }}>{range}</span>
                </div>
                <div className="pip-watch-zone-num" style={{ color: meta.tone }}>
                  <AnimatedNumber value={counts[z]} />
                </div>
                <div className="pip-watch-zone-label">{z}</div>
                <Progress value={ratio} className="animated-progress progress-sm mt-2" barStyle={{ background: meta.tone }} />
              </div>
            </Col>
          );
        })}
        <Col xl md={6} sm={12} xs={12}>
          <ScoreCard
            tone="#7c5cfc"
            headBg="linear-gradient(180deg,#f3eeff 0%,#fff 100%)"
            iconBg="#ece6ff"
            icon="ri-pie-chart-line"
            title="Org Snapshot"
            subtitle="Org-wide health"
          >
            <div className="pip-watch-org-row">
              <span>Avg Org Score</span>
              <strong>68%</strong>
            </div>
            <Progress value={68} color="primary" className="animated-progress progress-sm mb-2" />
            <div className="pip-watch-org-row">
              <span>Declining Trend</span>
              <strong className="text-danger">7 emps</strong>
            </div>
            <div className="pip-watch-org-row">
              <span>Under Watch</span>
              <strong className="text-warning">7 emps</strong>
            </div>
          </ScoreCard>
        </Col>
      </Row>

      {/* Search + filter chips */}
      <div className="d-flex align-items-center flex-wrap gap-2 mb-3">
        <div className="lp-search-box flex-grow-1" style={{ minWidth: 260 }}>
          <i className="ri-search-line" />
          <input type="text" placeholder="Search employee or role…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {(['all', 'PIP Trigger', 'Risk Zone', 'Watchlist'] as const).map(f => (
          <button
            key={f}
            type="button"
            className={`pip-score-filter ${filter === f ? 'is-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <button type="button" className="rec-btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }}>
          <i className="ri-grid-line" />All Departments
        </button>
      </div>

      <div className="pip-wiz-help-label" style={{ marginBottom: 14 }}>
        EMPLOYEE PERFORMANCE WATCH
        <span className="text-muted" style={{ fontWeight: 500, textTransform: 'none', marginLeft: 8 }}>
          — {filtered.length} employees requiring attention
        </span>
      </div>

      {/* Employee cards grid */}
      <Row className="g-3">
        {filtered.length === 0 ? (
          <Col xs={12}>
            <div className="pip-card text-center py-5 text-muted">
              <i className="ri-team-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
              No employees match this filter
            </div>
          </Col>
        ) : filtered.map((e, i) => <WatchEmployeeCard key={e.id} emp={e} idx={i} />)}
      </Row>
    </>
  );
}

function WatchEmployeeCard({ emp, idx }: { emp: WatchEmployee; idx: number }) {
  const meta = WATCH_ZONE_TONE[emp.zone];
  // Card chrome (top strip + header gradient) cycles through the brand
  // palette so the page reads consistent with the Score Engine. Severity
  // is still surfaced via the zone pill, the score box and the perf bar.
  const brand = WATCH_BRAND_PALETTE[idx % WATCH_BRAND_PALETTE.length];
  const target = 85;
  const perfPct = Math.min(100, (emp.score / 100) * 100);

  return (
    <Col lg={6}>
      {/* Same headed-card chrome the Score Engine uses: top accent strip
          + tinted header band + white body. Chrome stays brand-toned;
          severity bleeds in through the zone pill + score box only. */}
      <div className="pip-headed-card h-100">
        <span className="pip-headed-card-strip" style={{ background: brand.tone }} />
        <div className="pip-headed-card-head" style={{ background: brand.head }}>
          <span
            className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
            style={{ width: 40, height: 40, fontSize: 12, background: `linear-gradient(135deg, ${brand.tone}, ${brand.tone}cc)` }}
          >
            {emp.initials}
          </span>
          <div className="flex-grow-1 min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="pip-headed-card-title">{emp.name}</span>
              <span className="rec-pill" style={{ background: meta.bg, color: meta.tone }}>{emp.zone}</span>
              {emp.pipEligible && (
                <span className="rec-pill" style={{ background: '#fee2e2', color: '#b91c1c' }}>PIP Eligible</span>
              )}
            </div>
            <div className="pip-headed-card-sub">
              {emp.department} · {emp.cycles} · <span style={{ color: meta.tone, fontWeight: 600 }}>↓ {emp.trend}</span>
            </div>
          </div>
          <div className="pip-watch-score-box" style={{ background: meta.bg, color: meta.tone }}>
            <div className="pip-watch-score-num">{emp.score}</div>
            <div className="pip-watch-score-label">Score</div>
            <div className="pip-watch-score-delta">↓ {Math.abs(emp.delta)}</div>
          </div>
        </div>

        <div className="pip-headed-card-body">
          {/* Performance Score bar with target tick */}
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="text-muted" style={{ fontSize: 11.5 }}>Performance Score</span>
            <span className="text-muted" style={{ fontSize: 11.5 }}>Target {target}</span>
          </div>
          <div className="pip-watch-perf-bar-wrap">
            <Progress value={perfPct} className="animated-progress progress-sm" barStyle={{ background: brand.tone }} />
            <span className="pip-watch-perf-target" style={{ left: `${target}%` }} />
          </div>

          {/* Mini distribution histogram */}
          <div className="pip-watch-dist mt-2 mb-3">
            {emp.perfBars.map((h, i) => (
              <span
                key={i}
                className="pip-watch-dist-bar"
                style={{ height: `${h * 0.5}%`, background: i === emp.perfBars.length - 1 ? brand.tone : `${brand.tone}40` }}
              />
            ))}
          </div>

          {/* Role KPIs */}
          <div className="pip-wiz-help-label">ROLE KPIS</div>
          <div className="d-flex flex-column gap-2 mb-3">
            {emp.roleKpis.map(k => {
              const pct = Math.min(100, (k.value / k.target) * 100);
              const tone = pct >= 90 ? '#16a34a' : pct >= 75 ? '#f59e0b' : pct >= 60 ? '#f97316' : '#dc2626';
              return (
                <div key={k.name} className="pip-watch-kpi-row">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="fs-13">{k.name}</span>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      <strong style={{ color: tone }}>{k.value}</strong> / {k.target}
                    </span>
                  </div>
                  <Progress value={pct} className="animated-progress progress-sm" barStyle={{ background: tone }} />
                </div>
              );
            })}
          </div>

          {/* Signal log */}
          <div className="pip-wiz-help-label">SIGNAL LOG</div>
          <div className="pip-watch-signals mb-3">
            {emp.signals.map((s, i) => {
              const dotColor = s.tone === 'red' ? '#dc2626' : s.tone === 'amber' ? '#f59e0b' : '#0ea5e9';
              const ptsColor = s.pts <= -10 ? '#dc2626' : s.pts <= -5 ? '#f59e0b' : '#0ea5e9';
              return (
                <div key={i} className="pip-watch-signal-row">
                  <span className="pip-watch-signal-dot" style={{ background: dotColor }} />
                  <span className="flex-grow-1 fs-13">{s.text}</span>
                  <span className="fw-bold" style={{ color: ptsColor, fontSize: 12 }}>{s.pts}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>{s.week}</span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="pip-watch-foot">
            <div className="d-flex align-items-center gap-1 flex-grow-1" style={{ fontSize: 12 }}>
              {emp.conditionsMet ? (
                <span className="text-danger fw-semibold">
                  <i className="ri-error-warning-line me-1" />All PIP conditions met
                </span>
              ) : (
                <span className="text-muted">{emp.cycles.split(' ')[0]} cycles below threshold</span>
              )}
            </div>
            <button type="button" className="rec-btn-ghost" style={{ padding: '4px 10px', fontSize: 11.5 }}>
              <i className="ri-calendar-2-line" />Dates
            </button>
            <button type="button" className="rec-btn-ghost" style={{ padding: '4px 10px', fontSize: 11.5 }}>
              <i className="ri-eye-line" />Detail
            </button>
            <button type="button" className="rec-btn-soft" style={{ padding: '4px 10px', fontSize: 11.5 }}>
              <i className="ri-edit-line" />Override
            </button>
            {emp.pipEligible && (
              <button type="button" className="lv-btn-danger" style={{ padding: '5px 12px', fontSize: 11.5 }}>
                <i className="ri-flashlight-line" />Trigger PIP
              </button>
            )}
          </div>
        </div>
      </div>
    </Col>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIP's Status view — operational tracker for every PIP in flight. Top KPIs
// partition the active PIPs by risk + state; the table shows per-row trigger,
// timeline, MCA progress (Maker → Checker → Approver), and current stage.
// ─────────────────────────────────────────────────────────────────────────────
type StatusFilter = 'active' | 'completed';
type RiskBandPip = 'Critical' | 'High' | 'Medium';
type PipStage = 'Active' | 'Under Review' | 'Escalated' | 'Completed' | 'Failed';

interface StatusRow {
  id: string;
  name: string;
  initials: string;
  accent: string;
  dept: string;
  manager: string;
  trigger: string;
  triggerTags: string[];
  startDate: string;
  endDate: string;
  daysLeft: number;
  daysLabel: string;
  timelineState: 'At Risk' | 'On Track' | 'Failed';
  risk: RiskBandPip;
  progress: number;
  mcaStep: 1 | 2 | 3; // current MCA filled step (1=Maker, 2=Checker, 3=Approver done)
  mcaWith: string;
  stage: PipStage;
  state: 'active' | 'completed';
}

const STATUS_ROWS: StatusRow[] = [
  {
    id: 'st1', name: 'Karan Mehta', initials: 'KM', accent: '#7c5cfc',
    dept: 'Software Dev', manager: 'Gaurav Jagtap',
    trigger: 'Attendance + KPI', triggerTags: ['Attendance', 'KPI'],
    startDate: 'Mar 01', endDate: 'Apr 30', daysLeft: 8, daysLabel: '8d left', timelineState: 'At Risk',
    risk: 'Critical', progress: 78, mcaStep: 3, mcaWith: 'HR', stage: 'Active', state: 'active',
  },
  {
    id: 'st2', name: 'Varun Malhotra', initials: 'VM', accent: '#10b981',
    dept: 'Data Science', manager: 'Tanya More',
    trigger: 'Manager Report', triggerTags: ['Manager'],
    startDate: 'Mar 15', endDate: 'May 14', daysLeft: 22, daysLabel: '22d left', timelineState: 'At Risk',
    risk: 'High', progress: 45, mcaStep: 2, mcaWith: 'Manager', stage: 'Under Review', state: 'active',
  },
  {
    id: 'st3', name: 'Ritika Chauhan', initials: 'RC', accent: '#f59e0b',
    dept: 'UI/UX', manager: 'Parth Lakare',
    trigger: 'KPI Below Threshold', triggerTags: ['KPI'],
    startDate: 'Apr 01', endDate: 'May 31', daysLeft: 39, daysLabel: '39d left', timelineState: 'On Track',
    risk: 'Medium', progress: 20, mcaStep: 2, mcaWith: 'Manager', stage: 'Active', state: 'active',
  },
  {
    id: 'st4', name: 'Yash Bhosale', initials: 'YB', accent: '#6366f1',
    dept: 'Mobile Dev', manager: 'Parth Lakare',
    trigger: 'Repeated Warnings', triggerTags: ['Warning', 'Manager'],
    startDate: 'Feb 15', endDate: 'Apr 16', daysLeft: 0, daysLabel: 'Ended', timelineState: 'Failed',
    risk: 'High', progress: 95, mcaStep: 3, mcaWith: 'HR Head', stage: 'Escalated', state: 'active',
  },
  {
    id: 'st5', name: 'Aarav Mehta', initials: 'AM', accent: '#0ea5e9',
    dept: 'Sales', manager: 'Arjun Nair',
    trigger: 'Quarterly Review', triggerTags: ['KPI'],
    startDate: 'Jan 10', endDate: 'Mar 10', daysLeft: 0, daysLabel: 'Closed', timelineState: 'On Track',
    risk: 'Medium', progress: 100, mcaStep: 3, mcaWith: 'Approved', stage: 'Completed', state: 'completed',
  },
  {
    id: 'st6', name: 'Priya Sharma', initials: 'PS', accent: '#ec4899',
    dept: 'HR', manager: 'Sunita Ghosh',
    trigger: 'Attendance', triggerTags: ['Attendance'],
    startDate: 'Dec 15', endDate: 'Feb 13', daysLeft: 0, daysLabel: 'Closed', timelineState: 'On Track',
    risk: 'Medium', progress: 100, mcaStep: 3, mcaWith: 'Approved', stage: 'Completed', state: 'completed',
  },
  {
    id: 'st7', name: 'Manish Verma', initials: 'MV', accent: '#10b981',
    dept: 'DevOps', manager: 'Gaurav Jagtap',
    trigger: 'Sprint Velocity', triggerTags: ['KPI'],
    startDate: 'Jan 20', endDate: 'Mar 20', daysLeft: 0, daysLabel: 'Closed', timelineState: 'On Track',
    risk: 'High', progress: 100, mcaStep: 3, mcaWith: 'Approved', stage: 'Completed', state: 'completed',
  },
];

const STATUS_KPIS = [
  { key: 'active',    label: 'Active PIPs',  sub: 'Currently in progress',     tone: '#f59e0b' },
  { key: 'critical',  label: 'Critical Risk',sub: 'Immediate action needed',   tone: '#dc2626' },
  { key: 'high',      label: 'High Risk',    sub: 'Critical + High combined',  tone: '#f97316' },
  { key: 'escalated', label: 'Escalated',    sub: 'Needs urgent review',       tone: '#7c5cfc' },
  { key: 'completed', label: 'Completed',    sub: 'Closed this quarter',       tone: '#16a34a' },
] as const;

function PipStatusView() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState('All');
  const [stage, setStage] = useState('All');
  const [dept, setDept] = useState('All');

  const counts = {
    active:    STATUS_ROWS.filter(r => r.state === 'active').length,
    critical:  STATUS_ROWS.filter(r => r.state === 'active' && r.risk === 'Critical').length,
    high:      STATUS_ROWS.filter(r => r.state === 'active' && (r.risk === 'High' || r.risk === 'Critical')).length,
    escalated: STATUS_ROWS.filter(r => r.stage === 'Escalated').length,
    completed: STATUS_ROWS.filter(r => r.state === 'completed').length,
  };

  const filtered = STATUS_ROWS.filter(r => {
    if (filter === 'active'    && r.state !== 'active')    return false;
    if (filter === 'completed' && r.state !== 'completed') return false;
    if (risk !== 'All' && r.risk !== risk) return false;
    if (stage !== 'All' && r.stage !== stage) return false;
    if (dept !== 'All' && r.dept !== dept) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.name.toLowerCase().includes(q) || r.dept.toLowerCase().includes(q);
  });

  const uniqDepts = Array.from(new Set(STATUS_ROWS.map(r => r.dept)));

  return (
    <>
      {/* Top 5 KPIs — same compact tile pattern as the Watchlist zones */}
      <Row className="g-3 mb-3 align-items-stretch">
        {STATUS_KPIS.map(k => (
          <Col key={k.key} xl md={4} sm={6} xs={12}>
            <div className="pip-watch-zone-card h-100">
              <span className="pip-watch-zone-strip" style={{ background: k.tone }} />
              <span className="pip-watch-zone-dot" style={{ background: k.tone }} />
              <div className="pip-watch-zone-num" style={{ color: k.tone }}>
                <AnimatedNumber value={(counts as Record<string, number>)[k.key]} />
              </div>
              <div className="pip-watch-zone-label">{k.label}</div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{k.sub}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filter pills + search + dropdowns */}
      <div className="d-flex align-items-center flex-wrap gap-2 mb-3">
        <button
          type="button"
          className={`pip-status-tab ${filter === 'active' ? 'is-active' : ''}`}
          onClick={() => setFilter('active')}
        >
          <i className="ri-pulse-line" />Active PIPs
          <span className="pip-status-tab-count">{counts.active}</span>
        </button>
        <button
          type="button"
          className={`pip-status-tab ${filter === 'completed' ? 'is-active' : ''}`}
          onClick={() => setFilter('completed')}
        >
          <i className="ri-checkbox-circle-line" />Completed
          <span className="pip-status-tab-count">{counts.completed}</span>
        </button>
        <div className="lp-search-box flex-grow-1" style={{ minWidth: 220 }}>
          <i className="ri-search-line" />
          <input type="text" placeholder="Search employee or department…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="lp-field-input" style={{ width: 130 }} value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="All">All Risk</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
        </select>
        <select className="lp-field-input" style={{ width: 130 }} value={stage} onChange={e => setStage(e.target.value)}>
          <option value="All">All Stages</option>
          <option>Active</option>
          <option>Under Review</option>
          <option>Escalated</option>
          <option>Completed</option>
          <option>Failed</option>
        </select>
        <select className="lp-field-input" style={{ width: 130 }} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="All">All Depts</option>
          {uniqDepts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="pip-active-table-wrap">
        <table className="pip-active-table pip-status-table">
          <thead>
            <tr>
              <th>EMPLOYEE</th>
              <th>TRIGGER</th>
              <th>TIMELINE</th>
              <th>RISK</th>
              <th style={{ minWidth: 140 }}>PROGRESS</th>
              <th>MCA</th>
              <th>STAGE</th>
              <th style={{ textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-5 text-muted">
                  <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                  No PIPs match this filter
                </td>
              </tr>
            ) : filtered.map(r => {
              const riskTone =
                r.risk === 'Critical' ? { bg: '#fee2e2', fg: '#b91c1c' }
                : r.risk === 'High'   ? { bg: '#fde8c4', fg: '#a4661c' }
                :                       { bg: '#fef3c7', fg: '#92400e' };
              const stageTone =
                r.stage === 'Active'        ? { bg: '#d1fae5', fg: '#047857' }
                : r.stage === 'Under Review' ? { bg: '#ede9fe', fg: '#5a3fd1' }
                : r.stage === 'Escalated'   ? { bg: '#fee2e2', fg: '#b91c1c' }
                : r.stage === 'Failed'      ? { bg: '#fee2e2', fg: '#b91c1c' }
                :                              { bg: '#dbeafe', fg: '#1e40af' };
              const progColor = r.progress >= 90 ? 'success' : r.progress >= 50 ? 'warning' : 'danger';
              const timelineColor =
                r.timelineState === 'At Risk' ? '#a4661c'
                : r.timelineState === 'Failed'  ? '#b91c1c'
                :                                  '#047857';
              return (
                <tr key={r.id} className="pip-status-row" style={{ '--row-tone': r.accent } as React.CSSProperties}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span
                        className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                        style={{ width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)` }}
                      >
                        {r.initials}
                      </span>
                      <div>
                        <div className="fw-semibold fs-13">{r.name}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{r.dept} · {r.manager}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="fw-semibold fs-13">{r.trigger}</div>
                    <div className="d-flex gap-1 mt-1 flex-wrap">
                      {r.triggerTags.map(t => (
                        <span key={t} className="pip-status-tag">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="fs-13">
                      <strong>{r.startDate}</strong> → <strong>{r.endDate}</strong>
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <span className="text-muted">{r.daysLabel}</span>
                      <span className="mx-1 text-muted">·</span>
                      <span style={{ color: timelineColor, fontWeight: 600 }}>{r.timelineState}</span>
                    </div>
                  </td>
                  <td>
                    <span className="rec-pill" style={{ background: riskTone.bg, color: riskTone.fg }}>{r.risk}</span>
                  </td>
                  <td>
                    <div className="text-success fw-bold mb-1" style={{ fontSize: 12, color: progColor === 'success' ? '#16a34a' : progColor === 'warning' ? '#a4661c' : '#b91c1c' }}>
                      {r.progress}%
                    </div>
                    <Progress value={r.progress} color={progColor} className="animated-progress progress-sm" />
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-1">
                      {[1, 2, 3].map(s => (
                        <span
                          key={s}
                          className={`pip-mca-dot ${s <= r.mcaStep ? 'is-on' : ''}`}
                          style={s <= r.mcaStep ? { background: '#7c5cfc' } : undefined}
                        />
                      ))}
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>With: {r.mcaWith}</div>
                  </td>
                  <td>
                    <span className="rec-pill" style={{ background: stageTone.bg, color: stageTone.fg }}>{r.stage}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="rec-btn-soft" style={{ padding: '4px 12px', fontSize: 11.5 }}>
                      <i className="ri-eye-line" />View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ComingSoonView({ label }: { label: TopTab }) {
  const titles: Record<TopTab, string> = {
    dashboard:  'Dashboard',
    score:      'Score Engine',
    watchlist:  'Watchlist',
    status:     "PIP's Status",
  };
  return (
    <div className="pip-card text-center py-5">
      <i className="ri-tools-line" style={{ fontSize: 36, opacity: 0.35 }} />
      <div className="fw-bold mt-2">{titles[label]}</div>
      <div className="text-muted fs-13 mt-1">This view is under construction. The Dashboard tab is fully wired.</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Initiate-PIP wizard — 6-step modal with sidebar stepper. Uses an indigo
// gradient header (rec-form-modal-navy aesthetic) so it reads as a
// premium / authoritative internal HR submission, not the consumer-y orange
// from the original mock.
// ─────────────────────────────────────────────────────────────────────────────
type StepKey = 'snapshot' | 'issues' | 'goals' | 'milestones' | 'history' | 'approval';

const PIP_STEPS: { key: StepKey; num: number; icon: string; label: string }[] = [
  { key: 'snapshot',   num: 1, icon: 'ri-user-3-line',         label: 'Snapshot & Trigger' },
  { key: 'issues',     num: 2, icon: 'ri-search-eye-line',     label: 'Issues & Root Cause' },
  { key: 'goals',      num: 3, icon: 'ri-focus-3-line',        label: 'SMART Goals' },
  { key: 'milestones', num: 4, icon: 'ri-calendar-todo-line',  label: 'Milestones & Actions' },
  { key: 'history',    num: 5, icon: 'ri-bar-chart-2-line',    label: 'History & Outcome' },
  { key: 'approval',   num: 6, icon: 'ri-shield-check-line',   label: 'MCA Approval' },
];

const defaultPipDraft = (): PipDraft => ({
  employee: '', department: '',
  triggerSource: '', severity: '', triggerReason: '',
  pipDuration: '60', startDate: '',
  template: null,
  detectedIssues: ['Missed Deadlines'],
  rootCause: '', managerNotes: '',
  goals: [
    'Achieve 90%+ task completion rate within the PIP window',
    'Reduce late arrivals to ≤2 per month over 4 consecutive weeks',
    'Complete assigned skill development module within 2 weeks',
  ],
  successCriteria: '', expectedOutcome: 'Improved Performance',
  milestones: [
    'Week 1 — Baseline correction: gaps identified, goals signed',
    'Week 2 — Improvement checkpoint: first measurable progress',
    'Week 3 — Consistency validation: pattern confirmed or flagged',
    'Week 4 — Final evaluation',
  ],
  actions: ['weekly_1_1', 'task_priority', 'skill_training', 'mentor'],
  mentor: '', training: '', supportNotes: '',
  checkInFreq: 'weekly', escalationRule: 'two_at_risk',
  week1Target: '', midPlanTarget: '',
  slaAlert: '7_days', outcomeExpectation: '',
  approvalNote: '',
});

const TEMPLATES = [
  { key: 'low_productivity' as const, label: 'Low Productivity', tone: '#f59e0b', bg: '#fef3c7' },
  { key: 'attendance'       as const, label: 'Attendance Issue', tone: '#dc2626', bg: '#fee2e2' },
  { key: 'behavioral'       as const, label: 'Behavioral Issue', tone: '#7c5cfc', bg: '#ede9fe' },
];

const ACTION_OPTIONS = [
  { key: 'weekly_1_1',    label: 'Weekly 1:1 Meetings',    sub: '30-min structured check-in every week' },
  { key: 'task_priority', label: 'Task Prioritisation Support', sub: 'Manager helps re-prioritise workload each sprint' },
  { key: 'skill_training',label: 'Skill Training Program', sub: 'Enrol in targeted upskilling module' },
  { key: 'mentor',        label: 'Assign Mentor',          sub: 'Pair with senior employee for guidance' },
  { key: 'hr_counsel',    label: 'HR Counseling Sessions', sub: 'Bi-weekly HR-facilitated support sessions' },
  { key: 'peer_review',   label: 'Peer Review Inclusion',  sub: 'Include in structured peer feedback loop' },
];

function InitiatePipModal({
  isOpen, onClose, onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (draft: PipDraft) => void;
}) {
  const [step, setStep] = useState<StepKey>('snapshot');
  const [draft, setDraft] = useState<PipDraft>(defaultPipDraft);
  const [completed, setCompleted] = useState<Set<StepKey>>(new Set());

  // Reset on close so a fresh open starts clean.
  useEffect(() => {
    if (!isOpen) {
      setStep('snapshot');
      setDraft(defaultPipDraft());
      setCompleted(new Set());
    }
  }, [isOpen]);

  const currentIndex = PIP_STEPS.findIndex(s => s.key === step);
  const goNext = () => {
    setCompleted(prev => new Set(prev).add(step));
    if (currentIndex < PIP_STEPS.length - 1) {
      setStep(PIP_STEPS[currentIndex + 1].key);
    } else {
      onSubmit(draft);
    }
  };
  const goBack = () => {
    if (currentIndex > 0) setStep(PIP_STEPS[currentIndex - 1].key);
  };

  const update = (patch: Partial<PipDraft>) => setDraft(prev => ({ ...prev, ...patch }));

  // Apply a quick template — pre-fills issues so HR can iterate from there.
  const applyTemplate = (t: PipTemplate) => {
    update({ template: t });
    if (t === 'low_productivity') {
      update({ detectedIssues: ['Low Productivity', 'Missed Deadlines'], rootCause: 'Skill / Capacity Gap' });
    } else if (t === 'attendance') {
      update({ detectedIssues: ['High Absenteeism'], rootCause: 'Attendance / Discipline' });
    } else if (t === 'behavioral') {
      update({ detectedIssues: ['Behavioral Concern', 'Team Conflict'], rootCause: 'Behavioural / Conduct' });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      backdrop="static"
      size="xl"
      contentClassName="pip-wiz-content border-0"
      modalClassName="pip-wiz-modal"
    >
      <ModalBody className="p-0">
        <div className="pip-wiz-shell">
          {/* Header */}
          <div className="pip-wiz-header">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span className="pip-wiz-header-icon">
                <i className="ri-shield-flash-line" />
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>
                  Initiate Performance Improvement Plan
                </h5>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                  6-step structured governance flow · MCA approval required
                </div>
              </div>
            </div>
            <button type="button" className="pip-wiz-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>

          {/* Body — sidebar stepper + main step content */}
          <div className="pip-wiz-body">
            <aside className="pip-wiz-sidebar">
              {PIP_STEPS.map((s, i) => {
                const isActive = step === s.key;
                const isDone   = completed.has(s.key);
                const isLast   = i === PIP_STEPS.length - 1;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`pip-wiz-step ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                    onClick={() => setStep(s.key)}
                  >
                    <span className="pip-wiz-step-num">
                      {isDone ? <i className="ri-check-line" /> : s.num}
                    </span>
                    <span className="pip-wiz-step-body">
                      <span className="pip-wiz-step-label">
                        <i className={s.icon} />{s.label}
                      </span>
                      <span className="pip-wiz-step-status">
                        {isActive ? '▸ In progress' : isDone ? '✓ Completed' : ''}
                      </span>
                    </span>
                    {!isLast && <span className="pip-wiz-step-line" />}
                  </button>
                );
              })}
            </aside>

            <main className="pip-wiz-main">
              {step === 'snapshot'   && <Step1Snapshot   draft={draft} update={update} applyTemplate={applyTemplate} />}
              {step === 'issues'     && <Step2Issues     draft={draft} update={update} />}
              {step === 'goals'      && <Step3Goals      draft={draft} update={update} />}
              {step === 'milestones' && <Step4Milestones draft={draft} update={update} />}
              {step === 'history'    && <Step5History    draft={draft} update={update} />}
              {step === 'approval'   && <Step6Approval   draft={draft} update={update} />}
            </main>
          </div>

          {/* Footer */}
          <div className="pip-wiz-footer">
            <button
              type="button"
              className="rec-btn-ghost"
              onClick={goBack}
              disabled={currentIndex === 0}
            >
              <i className="ri-arrow-left-s-line" />Back
            </button>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Step <strong className="text-body">{currentIndex + 1}</strong> of {PIP_STEPS.length}
              <span className="mx-2">·</span>
              {PIP_STEPS[currentIndex].label}
            </span>
            {currentIndex < PIP_STEPS.length - 1 ? (
              <button type="button" className="pip-wiz-next" onClick={goNext}>
                Next<i className="ri-arrow-right-s-line" />
              </button>
            ) : (
              <button type="button" className="pip-wiz-submit" onClick={goNext}>
                <i className="ri-check-line" />Submit PIP
              </button>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Snapshot & Trigger
// ─────────────────────────────────────────────────────────────────────────────
function Step1Snapshot({
  draft, update, applyTemplate,
}: {
  draft: PipDraft;
  update: (p: Partial<PipDraft>) => void;
  applyTemplate: (t: PipTemplate) => void;
}) {
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 1 · Employee Snapshot &amp; Trigger</div>

      <div className="pip-wiz-help-label">QUICK TEMPLATES — CLICK TO AUTO-FILL GOALS &amp; MILESTONES</div>
      <div className="d-flex gap-2 flex-wrap mb-3">
        {TEMPLATES.map(t => (
          <button
            key={t.key}
            type="button"
            className={`pip-tpl-chip ${draft.template === t.key ? 'is-active' : ''}`}
            style={{
              background: draft.template === t.key ? t.tone : t.bg,
              color:      draft.template === t.key ? '#fff'  : t.tone,
              borderColor: draft.template === t.key ? t.tone : 'transparent',
            }}
            onClick={() => applyTemplate(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Row className="g-2">
        <Col md={6}>
          <label className="rec-form-label">Employee<span className="req">*</span></label>
          <select className="rec-input" value={draft.employee} onChange={e => update({ employee: e.target.value })}>
            <option value="">Select employee…</option>
            <option>Karan Mehta</option>
            <option>Vikram Chauhan</option>
            <option>Varun Malhotra</option>
            <option>Ritika Chauhan</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Department</label>
          <select className="rec-input" value={draft.department} onChange={e => update({ department: e.target.value })}>
            <option value="">Select…</option>
            <option>Engineering</option>
            <option>Data Science</option>
            <option>Sales</option>
            <option>UI/UX</option>
            <option>HR &amp; Admin</option>
            <option>Finance</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Trigger Source<span className="req">*</span></label>
          <select className="rec-input" value={draft.triggerSource} onChange={e => update({ triggerSource: e.target.value })}>
            <option value="">Select…</option>
            <option>Manager-flagged</option>
            <option>HR-flagged</option>
            <option>System (KPI threshold)</option>
            <option>360° feedback</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Severity<span className="req">*</span></label>
          <select className="rec-input" value={draft.severity} onChange={e => update({ severity: e.target.value })}>
            <option value="">Select…</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </Col>
        <Col md={12}>
          <label className="rec-form-label">Trigger Reason<span className="req">*</span></label>
          <textarea
            className="rec-input rec-textarea"
            rows={3}
            placeholder="Describe the specific performance or behavioral issue that triggered this PIP…"
            value={draft.triggerReason}
            onChange={e => update({ triggerReason: e.target.value })}
          />
        </Col>
        <Col md={6}>
          <label className="rec-form-label">PIP Duration</label>
          <select className="rec-input" value={draft.pipDuration} onChange={e => update({ pipDuration: e.target.value })}>
            <option value="30">30 days</option>
            <option value="45">45 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Start Date</label>
          <input
            type="date"
            className="rec-input"
            value={draft.startDate}
            onChange={e => update({ startDate: e.target.value })}
          />
        </Col>
      </Row>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Issues & Root Cause
// ─────────────────────────────────────────────────────────────────────────────
function Step2Issues({
  draft, update,
}: { draft: PipDraft; update: (p: Partial<PipDraft>) => void }) {
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 2 · Auto-Detected Issues &amp; Root Cause</div>

      <label className="rec-form-label">Root Cause<span className="req">*</span></label>
      <select className="rec-input mb-3" value={draft.rootCause} onChange={e => update({ rootCause: e.target.value })}>
        <option value="">Select root cause…</option>
        <option>Skill / Capacity Gap</option>
        <option>Attendance / Discipline</option>
        <option>Behavioural / Conduct</option>
        <option>Workload / Allocation</option>
        <option>Process / Tools</option>
      </select>

      <div className="pip-evidence-stack">
        <div className="pip-evidence-card pip-evidence-card-blue">
          <i className="ri-bar-chart-2-line" />
          <div>
            <div className="fw-bold" style={{ fontSize: 12.5 }}>Performance / KPI</div>
            <div style={{ fontSize: 12 }}>Q1 rating 2.4/5 — below 2.5 threshold</div>
          </div>
        </div>
        <div className="pip-evidence-card pip-evidence-card-red">
          <i className="ri-alarm-warning-line" />
          <div>
            <div className="fw-bold" style={{ fontSize: 12.5 }}>Attendance</div>
            <div style={{ fontSize: 12 }}>7 late marks, 3 absent (last 60 days)</div>
          </div>
        </div>
        <div className="pip-evidence-card pip-evidence-card-amber">
          <i className="ri-error-warning-line" />
          <div>
            <div className="fw-bold" style={{ fontSize: 12.5 }}>Warning Registry</div>
            <div style={{ fontSize: 12 }}>1 formal warning on record</div>
          </div>
        </div>
      </div>

      <label className="rec-form-label mt-3">Manager Observation Notes<span className="req">*</span></label>
      <textarea
        className="rec-input rec-textarea"
        rows={3}
        placeholder="Specific incidents, conversations, prior warnings, impact on team…"
        value={draft.managerNotes}
        onChange={e => update({ managerNotes: e.target.value })}
      />

      <label className="rec-form-label mt-3">Attach Evidence</label>
      <div className="pip-attach-zone">
        <i className="ri-attachment-line" />
        Attach screenshots, emails, KPI reports, warning letters
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — SMART Goals
// ─────────────────────────────────────────────────────────────────────────────
function Step3Goals({
  draft, update,
}: { draft: PipDraft; update: (p: Partial<PipDraft>) => void }) {
  const setGoal = (i: number, value: string) => {
    const next = [...draft.goals];
    next[i] = value;
    update({ goals: next });
  };
  const addGoal = () => update({ goals: [...draft.goals, ''] });
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 3 · SMART Improvement Goals</div>

      <div className="pip-wiz-tip">
        <i className="ri-information-line" />
        Goals must be <strong>Specific</strong> · <strong>Measurable</strong> · <strong>Achievable</strong> · <strong>Relevant</strong> · <strong>Time-bound</strong>.
        Pre-filled from template — edit as needed.
      </div>

      <label className="rec-form-label">Improvement Goals<span className="req">*</span></label>
      <div className="pip-goals">
        {draft.goals.map((g, i) => (
          <div key={i} className="pip-goal-row">
            <span className="pip-goal-num">{i + 1}</span>
            <input
              type="text"
              className="rec-input"
              value={g}
              placeholder={`Goal ${i + 1}`}
              onChange={e => setGoal(i, e.target.value)}
            />
          </div>
        ))}
      </div>
      <button type="button" className="rec-btn-ghost mt-2" onClick={addGoal}>
        <i className="ri-add-line" />Add Goal
      </button>

      <Row className="g-2 mt-2">
        <Col md={7}>
          <label className="rec-form-label">Success Criteria<span className="req">*</span></label>
          <input
            type="text"
            className="rec-input"
            placeholder="e.g. 3 consecutive weeks of 90%+ completion"
            value={draft.successCriteria}
            onChange={e => update({ successCriteria: e.target.value })}
          />
        </Col>
        <Col md={5}>
          <label className="rec-form-label">Expected Outcome</label>
          <select className="rec-input" value={draft.expectedOutcome} onChange={e => update({ expectedOutcome: e.target.value })}>
            <option>Improved Performance</option>
            <option>Confirmed Continuation</option>
            <option>Role Realignment</option>
            <option>Separation</option>
          </select>
        </Col>
      </Row>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Milestones & Action Plan
// ─────────────────────────────────────────────────────────────────────────────
function Step4Milestones({
  draft, update,
}: { draft: PipDraft; update: (p: Partial<PipDraft>) => void }) {
  const setMilestone = (i: number, value: string) => {
    const next = [...draft.milestones];
    next[i] = value;
    update({ milestones: next });
  };
  const toggleAction = (k: string) => {
    update({
      actions: draft.actions.includes(k)
        ? draft.actions.filter(x => x !== k)
        : [...draft.actions, k],
    });
  };
  const weekTones = ['#7c5cfc', '#0ea5e9', '#f59e0b', '#16a34a'];
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 4 · Milestones &amp; Manager Action Plan</div>

      <div className="pip-wiz-help-label">AUTO-GENERATED MILESTONES <span className="text-muted" style={{ fontWeight: 500, textTransform: 'none' }}>— editable</span></div>
      <div className="pip-milestones">
        {draft.milestones.map((m, i) => (
          <div key={i} className="pip-milestone-row">
            <span className="pip-milestone-week" style={{ background: weekTones[i % 4] }}>W{i + 1}</span>
            <input
              type="text"
              className="rec-input"
              value={m}
              onChange={e => setMilestone(i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="pip-wiz-help-label mt-3">MANAGER ACTION PLAN — SELECT ALL THAT APPLY</div>
      <Row className="g-2">
        {ACTION_OPTIONS.map(a => {
          const active = draft.actions.includes(a.key);
          return (
            <Col md={6} key={a.key}>
              <label className={`pip-action-card ${active ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleAction(a.key)}
                />
                <div className="flex-grow-1">
                  <div className="fw-semibold" style={{ fontSize: 13 }}>{a.label}</div>
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{a.sub}</div>
                </div>
              </label>
            </Col>
          );
        })}
      </Row>

      <Row className="g-2 mt-2">
        <Col md={6}>
          <label className="rec-form-label">Assign Mentor</label>
          <select className="rec-input" value={draft.mentor} onChange={e => update({ mentor: e.target.value })}>
            <option value="">Select…</option>
            <option>Gaurav Jagtap</option>
            <option>Priya Mehta</option>
            <option>Sneha Joshi</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Training Program</label>
          <select className="rec-input" value={draft.training} onChange={e => update({ training: e.target.value })}>
            <option value="">Select…</option>
            <option>Productivity Bootcamp</option>
            <option>Communication Skills</option>
            <option>Domain Re-skill (Engineering)</option>
          </select>
        </Col>
        <Col md={12}>
          <label className="rec-form-label">Support Notes</label>
          <textarea
            className="rec-input rec-textarea"
            rows={2}
            placeholder="Any additional accommodations, interventions, or context for the action plan…"
            value={draft.supportNotes}
            onChange={e => update({ supportNotes: e.target.value })}
          />
        </Col>
      </Row>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — History & Outcome
// ─────────────────────────────────────────────────────────────────────────────
function Step5History({
  draft, update,
}: { draft: PipDraft; update: (p: Partial<PipDraft>) => void }) {
  const weekTones = ['#7c5cfc', '#0ea5e9', '#f59e0b', '#16a34a'];
  const weekLabels = ['Baseline correction', 'Improvement check', 'Consistency test', 'Final evaluation'];
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 5 · History Context, Review Plan &amp; Outcome</div>

      {/* History tiles — same KPI-card recipe as the dashboard:
          accent strip, label + value text, gradient icon block. */}
      <Row className="g-3 align-items-stretch">
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#dc2626,#f87171)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">PREVIOUS WARNINGS</span>
              <span className="pip-summary-value" style={{ color: '#b91c1c' }}>1 on record</span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#fee2e2,#fecaca)', color: '#b91c1c' }}>
              <i className="ri-alarm-warning-line" />
            </span>
          </div>
        </Col>
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#f59e0b,#fcd34d)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">PAST PIPS</span>
              <span className="pip-summary-value" style={{ color: '#92400e' }}>None</span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#fef3c7,#fde68a)', color: '#92400e' }}>
              <i className="ri-history-line" />
            </span>
          </div>
        </Col>
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#0ea5e9,#7dd3fc)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">LAST REVIEW RATING</span>
              <span className="pip-summary-value" style={{ color: '#0c63b0' }}>2.4/5 — Below</span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', color: '#0c63b0' }}>
              <i className="ri-star-line" />
            </span>
          </div>
        </Col>
      </Row>

      {/* Week cards — same KPI-card chrome with a colored accent strip
          and a gradient icon block carrying the week number. */}
      <Row className="g-3 mt-1 align-items-stretch">
        {weekLabels.map((label, i) => {
          const tone = weekTones[i];
          // Soft gradient backgrounds matching each week's tone.
          const iconGrad =
            tone === '#7c5cfc' ? 'linear-gradient(135deg,#ede9fe,#ddd6fe)'
            : tone === '#0ea5e9' ? 'linear-gradient(135deg,#dbeafe,#bfdbfe)'
            : tone === '#f59e0b' ? 'linear-gradient(135deg,#fef3c7,#fde68a)'
            :                       'linear-gradient(135deg,#d1fae5,#a7f3d0)';
          return (
            <Col md={3} key={label}>
              <div className="pip-summary-card pip-summary-card--side pip-summary-card--compact">
                <span className="pip-summary-strip" style={{ background: tone }} />
                <div className="pip-summary-text">
                  <span className="pip-summary-label" style={{ color: tone }}>WEEK {i + 1}</span>
                  <span className="pip-summary-value" style={{ color: tone, fontSize: 13.5 }}>{label}</span>
                </div>
                <span className="pip-summary-icon" style={{ background: iconGrad, color: tone, fontWeight: 800 }}>
                  W{i + 1}
                </span>
              </div>
            </Col>
          );
        })}
      </Row>

      <Row className="g-2 mt-2">
        <Col md={6}>
          <label className="rec-form-label">Check-in Frequency</label>
          <select className="rec-input" value={draft.checkInFreq} onChange={e => update({ checkInFreq: e.target.value })}>
            <option value="weekly">Weekly (recommended)</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="custom">Custom</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Escalation Rule</label>
          <select className="rec-input" value={draft.escalationRule} onChange={e => update({ escalationRule: e.target.value })}>
            <option value="two_at_risk">Auto-escalate if 2 consecutive At Risk reviews</option>
            <option value="one_critical">Auto-escalate on any Critical review</option>
            <option value="manual">Manual escalation only</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Week 1 Target</label>
          <input
            type="text"
            className="rec-input"
            placeholder="What should be visible by Week 1?"
            value={draft.week1Target}
            onChange={e => update({ week1Target: e.target.value })}
          />
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Mid-plan Target</label>
          <input
            type="text"
            className="rec-input"
            placeholder="Milestone to hit at Week 2–3"
            value={draft.midPlanTarget}
            onChange={e => update({ midPlanTarget: e.target.value })}
          />
        </Col>
        <Col md={6}>
          <label className="rec-form-label">SLA Alert</label>
          <select className="rec-input" value={draft.slaAlert} onChange={e => update({ slaAlert: e.target.value })}>
            <option value="7_days">Alert HR if no review in 7 days</option>
            <option value="14_days">Alert HR if no review in 14 days</option>
          </select>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Outcome Expectation<span className="req">*</span></label>
          <select className="rec-input" value={draft.outcomeExpectation} onChange={e => update({ outcomeExpectation: e.target.value })}>
            <option value="">Select…</option>
            <option>Successful — confirm continuation</option>
            <option>Conditional — extend with revised plan</option>
            <option>Unsuccessful — separation</option>
          </select>
        </Col>
      </Row>

      <div className="pip-success-banner mt-3">
        <i className="ri-checkbox-circle-line" />
        Automatic review reminders will be sent at Days 7, 14, 21 and final to Manager, HR, and Employee.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6 — MCA Approval
// ─────────────────────────────────────────────────────────────────────────────
function Step6Approval({
  draft, update,
}: { draft: PipDraft; update: (p: Partial<PipDraft>) => void }) {
  return (
    <div className="pip-wiz-step-pane">
      <div className="pip-wiz-step-title">Step 6 · Final Review &amp; MCA Approval</div>

      <Row className="g-3 mb-3 align-items-stretch">
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#7c5cfc,#a78bfa)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">EMPLOYEE</span>
              <span className="pip-summary-value" style={{ color: '#5a3fd1' }}>
                {draft.employee || 'Not selected'}
              </span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#ede9fe,#ddd6fe)', color: '#5a3fd1' }}>
              <i className="ri-user-3-line" />
            </span>
          </div>
        </Col>
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#0ea5e9,#7dd3fc)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">PIP TEMPLATE</span>
              <span className="pip-summary-value" style={{ color: '#0c63b0' }}>
                {draft.template === 'low_productivity' ? 'Low Productivity'
                  : draft.template === 'attendance' ? 'Attendance Issue'
                  : draft.template === 'behavioral' ? 'Behavioral Issue'
                  : 'Custom'}
              </span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', color: '#0c63b0' }}>
              <i className="ri-file-list-3-line" />
            </span>
          </div>
        </Col>
        <Col md={4}>
          <div className="pip-summary-card">
            <span className="pip-summary-strip" style={{ background: 'linear-gradient(90deg,#f59e0b,#fcd34d)' }} />
            <div className="pip-summary-text">
              <span className="pip-summary-label">RISK LEVEL</span>
              <span className="pip-summary-value" style={{ color: '#a4661c' }}>
                {draft.severity || 'Moderate Risk'}
              </span>
            </div>
            <span className="pip-summary-icon" style={{ background: 'linear-gradient(135deg,#fef3c7,#fde68a)', color: '#a4661c' }}>
              <i className="ri-error-warning-line" />
            </span>
          </div>
        </Col>
      </Row>

      <div className="pip-risk-banner">
        <span className="dot" />
        <div>
          <div className="fw-bold" style={{ fontSize: 13 }}>{draft.severity ? `${draft.severity} Risk` : 'Moderate Risk'}</div>
          <div style={{ fontSize: 12 }}>Complete employee selection to see risk guidance.</div>
        </div>
      </div>

      <div className="pip-mca-card">
        <div className="pip-mca-title">
          <i className="ri-shield-line" />Maker → Checker → Approver Governance Chain
        </div>

        {/* Bootstrap "Progress with Steps" pattern from the template.
            Step centres are at 16.67% / 50% / 83.33% (the centres of
            three equal columns) so the round buttons line up exactly
            with the labels in the row below. The connecting line is
            inset to match — runs from the first centre to the last. */}
        <div className="position-relative mt-4 mb-3 pip-mca-progress" style={{ marginLeft: '16.67%', marginRight: '16.67%' }}>
          <div className="progress" style={{ height: '2px' }}>
            <div className="progress-bar bg-primary" role="progressbar" style={{ width: '50%' }} aria-valuenow={50} aria-valuemin={0} aria-valuemax={100} />
          </div>
          <button type="button" className="position-absolute top-0 start-0 translate-middle btn btn-sm btn-primary rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Maker (Manager)">
            <i className="ri-user-3-line" />
          </button>
          <button type="button" className="position-absolute top-0 start-50 translate-middle btn btn-sm btn-primary rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Checker (HR)">
            <i className="ri-shield-user-line" />
          </button>
          <button type="button" className="position-absolute top-0 start-100 translate-middle btn btn-sm btn-light rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Approver (HR Head)">
            <i className="ri-shield-check-line" />
          </button>
        </div>

        {/* Step labels — column centres match the icon centres above. */}
        <Row className="text-center g-2 mt-4">
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Maker (Manager)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Initiates PIP</div>
          </Col>
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Checker (HR)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Reviews &amp; validates</div>
          </Col>
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Approver (HR Head)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Final authorization</div>
          </Col>
        </Row>
      </div>

      <div className="pip-success-banner mt-3">
        <i className="ri-checkbox-circle-line" />
        After approval, PIP activates automatically. Employee is notified. Record is immutable and audit-trailed.
      </div>

      <label className="rec-form-label mt-3">Approval Note (optional)</label>
      <input
        type="text"
        className="rec-input"
        placeholder="Add any context for the approver…"
        value={draft.approvalNote}
        onChange={e => update({ approvalNote: e.target.value })}
      />
    </div>
  );
}
