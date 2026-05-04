import { useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, Col, Row, Input, Button } from 'reactstrap';
import { MasterFormStyles, MasterSelect } from './master/masterFormKit';
import './employee-onboarding/HrEmployeeOnboarding.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types — wire to GET /api/leaves when the backend is available
// ─────────────────────────────────────────────────────────────────────────────
type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Earned' | 'Maternity' | 'Comp Off' | 'LOP';
type LeaveStage =
  | 'Approved'
  | 'Pending (Manager)'
  | 'Pending (HR)'
  | 'Rejected'
  | 'Cancelled';
type PayrollMode = 'Paid Leave' | 'Unpaid' | 'Half-Pay';
type ProofState = 'Uploaded' | 'Missing' | 'N/A';

interface ApprovalNode {
  initials: string;
  name: string;
  role: 'Self' | 'Manager' | 'HR' | 'Reviewer';
  decision: 'approved' | 'pending' | 'idle' | 'rejected';
}

interface LeaveRequest {
  id: string;
  empCode: string;               // LV-001
  empInitials: string;
  empName: string;
  empRole: string;               // department/designation
  accent: string;                // avatar color
  type: LeaveType;
  durationDays: number;
  durationLabel: string;         // "3 days"
  rangeLabel: string;            // "Apr 14 – Apr 16"
  appliedOn: string;             // "May 1, 2026"
  stage: LeaveStage;
  stageNote?: string;            // "Approved: Apr 13" / "3d pending"
  approvalChain: ApprovalNode[];
  payroll: PayrollMode;
  proof: ProofState;
  proofVia?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette helpers
// ─────────────────────────────────────────────────────────────────────────────
const STAGE_TONE: Record<LeaveStage, { fg: string; bg: string; dot: string }> = {
  'Approved':          { fg: '#0a716a', bg: '#d3f0ee', dot: '#0ab39c' },
  'Pending (Manager)': { fg: '#a4661c', bg: '#fde8c4', dot: '#f59e0b' },
  'Pending (HR)':      { fg: '#a4661c', bg: '#fde8c4', dot: '#f59e0b' },
  'Rejected':          { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444' },
  'Cancelled':         { fg: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
};

const TYPE_TONE: Record<LeaveType, { fg: string; bg: string }> = {
  'Annual':    { fg: '#5a3fd1', bg: '#ece6ff' },
  'Sick':      { fg: '#b91c1c', bg: '#fee2e2' },
  'Casual':    { fg: '#0c63b0', bg: '#dceefe' },
  'Earned':    { fg: '#0a716a', bg: '#d3f0ee' },
  'Maternity': { fg: '#a02960', bg: '#fdd9ea' },
  'Comp Off':  { fg: '#a4661c', bg: '#fde8c4' },
  'LOP':       { fg: '#374151', bg: '#eef2f6' },
};

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

// ─────────────────────────────────────────────────────────────────────────────
// Dummy data — replace with `GET /api/leaves?fy=2025-26` when wired
// ─────────────────────────────────────────────────────────────────────────────
const buildRequests = (): LeaveRequest[] => [
  {
    id: 'LV-1042', empCode: 'LV-001',
    empInitials: 'GJ', empName: 'Gaurav Jagtap', empRole: 'Software Development', accent: accent(0),
    type: 'Annual', durationDays: 3, durationLabel: '3 days', rangeLabel: 'Apr 14 – Apr 16', appliedOn: 'Apr 12, 2026',
    stage: 'Approved', stageNote: 'Approved: Apr 13',
    approvalChain: [
      { initials: 'GJ', name: 'Gaurav Jagtap',   role: 'Self',    decision: 'approved' },
      { initials: 'PL', name: 'Pranav Lokhande', role: 'Manager', decision: 'approved' },
      { initials: 'RV', name: 'Rajesh Verma',    role: 'HR',      decision: 'approved' },
    ],
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Parth',
  },
  {
    id: 'LV-1043', empCode: 'LV-002',
    empInitials: 'RC', empName: 'Ritika Chauhan', empRole: 'UI/UX Designing', accent: accent(1),
    type: 'Sick', durationDays: 2, durationLabel: '2 days', rangeLabel: 'Apr 09 – Apr 10', appliedOn: 'Apr 07, 2026',
    stage: 'Approved', stageNote: 'Approved: Apr 08',
    approvalChain: [
      { initials: 'RC', name: 'Ritika Chauhan',  role: 'Self',    decision: 'approved' },
      { initials: 'PL', name: 'Pranav Lokhande', role: 'Manager', decision: 'approved' },
      { initials: 'RV', name: 'Rajesh Verma',    role: 'HR',      decision: 'approved' },
    ],
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Parth',
  },
  {
    id: 'LV-1044', empCode: 'LV-003',
    empInitials: 'HT', empName: 'Harsh Thakur', empRole: 'Business Analyst', accent: accent(2),
    type: 'Casual', durationDays: 1, durationLabel: '1 day', rangeLabel: 'Apr 11', appliedOn: 'Apr 08, 2026',
    stage: 'Pending (Manager)', stageNote: '3d pending',
    approvalChain: [
      { initials: 'HT', name: 'Harsh Thakur', role: 'Self',    decision: 'approved' },
      { initials: '',   name: 'Manager',      role: 'Manager', decision: 'pending'  },
      { initials: '',   name: 'HR',           role: 'HR',      decision: 'idle'     },
    ],
    payroll: 'Paid Leave', proof: 'N/A',
  },
  {
    id: 'LV-1045', empCode: 'LV-004',
    empInitials: 'SJ', empName: 'Swati Joshi', empRole: 'Software Testing', accent: accent(3),
    type: 'Sick', durationDays: 1, durationLabel: '1 day', rangeLabel: 'Apr 08', appliedOn: 'Apr 06, 2026',
    stage: 'Approved', stageNote: 'Approved: Apr 07',
    approvalChain: [
      { initials: 'SJ', name: 'Swati Joshi',  role: 'Self',    decision: 'approved' },
      { initials: 'AP', name: 'Atharv Patil', role: 'Manager', decision: 'approved' },
      { initials: 'RV', name: 'Rajesh Verma', role: 'HR',      decision: 'approved' },
    ],
    payroll: 'Paid Leave', proof: 'Missing', proofVia: 'Atharv',
  },
  {
    id: 'LV-1046', empCode: 'LV-005',
    empInitials: 'NK', empName: 'Neha Kulkarni', empRole: 'Product Design', accent: accent(4),
    type: 'Earned', durationDays: 5, durationLabel: '5 days', rangeLabel: 'Apr 21 – Apr 25', appliedOn: 'Apr 14, 2026',
    stage: 'Pending (HR)', stageNote: '1d pending',
    approvalChain: [
      { initials: 'NK', name: 'Neha Kulkarni', role: 'Self',    decision: 'approved' },
      { initials: 'VR', name: 'Vishal Rao',    role: 'Manager', decision: 'approved' },
      { initials: '',   name: 'HR',            role: 'HR',      decision: 'pending'  },
    ],
    payroll: 'Paid Leave', proof: 'Uploaded', proofVia: 'Vishal',
  },
  {
    id: 'LV-1047', empCode: 'LV-006',
    empInitials: 'RG', empName: 'Rahul Gupta', empRole: 'Account Executive', accent: accent(5),
    type: 'LOP', durationDays: 2, durationLabel: '2 days', rangeLabel: 'Apr 02 – Apr 03', appliedOn: 'Apr 01, 2026',
    stage: 'Rejected', stageNote: 'Rejected: Apr 02',
    approvalChain: [
      { initials: 'RG', name: 'Rahul Gupta', role: 'Self',    decision: 'approved' },
      { initials: 'PI', name: 'Priya Iyer',  role: 'Manager', decision: 'rejected' },
      { initials: '',   name: 'HR',          role: 'HR',      decision: 'idle'     },
    ],
    payroll: 'Unpaid', proof: 'N/A',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedNumber — same simple count-up the Onboarding KPIs use
// ─────────────────────────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  return <>{value.toLocaleString()}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny atoms for the approval chain
// ─────────────────────────────────────────────────────────────────────────────
const ChainAvatar = ({ node }: { node: ApprovalNode }) => {
  const isPending  = node.decision === 'pending';
  const isApproved = node.decision === 'approved';
  const isRejected = node.decision === 'rejected';
  const isIdle     = node.decision === 'idle';

  const bg =
    isApproved ? 'linear-gradient(135deg,#0ab39c,#108548)'
    : isRejected ? 'linear-gradient(135deg,#f06548,#dc2626)'
    : isPending ? 'linear-gradient(135deg,#f7b84b,#f59e0b)'
    : '#e5e7eb';
  const fg = isIdle ? '#9ca3af' : '#ffffff';
  const ring =
    isApproved ? '0 0 0 3px rgba(10,179,156,0.18)'
    : isRejected ? '0 0 0 3px rgba(220,38,38,0.18)'
    : isPending ? '0 0 0 3px rgba(245,158,11,0.18)'
    : 'none';

  return (
    <span
      className="lv-chain-avatar"
      title={`${node.role}: ${node.name}`}
      style={{ background: bg, color: fg, boxShadow: ring }}
    >
      {isApproved && !node.initials ? <i className="ri-check-line" /> :
       isRejected && !node.initials ? <i className="ri-close-line" /> :
       (node.initials || <i className="ri-time-line" />)}
    </span>
  );
};

const ApprovalChain = ({ chain }: { chain: ApprovalNode[] }) => (
  <div className="lv-chain">
    {chain.map((n, i) => (
      <span key={i} className="lv-chain-item">
        <ChainAvatar node={n} />
        {i < chain.length - 1 && <i className="ri-arrow-right-line lv-chain-arrow" />}
      </span>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// HrLeave — page component (Onboarding-Hub style)
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 8;

export default function HrLeave() {
  const [requests] = useState<LeaveRequest[]>(buildRequests);

  const [tab,     setTab]     = useState<'pending' | 'approved'>('pending');
  const [search,  setSearch]  = useState('');
  const [type,    setType]    = useState<string>('All');
  const [payroll, setPayroll] = useState<string>('All');
  const [page,    setPage]    = useState(1);

  const counts = useMemo(() => {
    const approved = requests.filter(r => r.stage === 'Approved');
    const pending  = requests.filter(r => r.stage.startsWith('Pending'));
    const rejected = requests.filter(r => r.stage === 'Rejected');
    return {
      total:        requests.length,
      pending:      pending.length,
      approved:     approved.length,
      approvedDays: approved.reduce((s, r) => s + r.durationDays, 0),
      rejected:     rejected.length,
      onLeaveToday: 1,
    };
  }, [requests]);

  // Tab-filtered + search/filter pipeline
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter(r => {
      const inTab =
        tab === 'pending'   ? r.stage.startsWith('Pending')
                            : r.stage === 'Approved';
      if (!inTab) return false;
      if (type    !== 'All' && r.type    !== type)    return false;
      if (payroll !== 'All' && r.payroll !== payroll) return false;
      if (!q) return true;
      return [r.empName, r.empRole, r.id, r.empCode, r.type].some(v => v.toLowerCase().includes(q));
    });
  }, [requests, tab, search, type, payroll]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const sliceFrom = (safePage - 1) * PAGE_SIZE;
  const visible   = filtered.slice(sliceFrom, sliceFrom + PAGE_SIZE);
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  const TYPE_OPTIONS = [
    { value: 'All',       label: 'All' },
    { value: 'Annual',    label: 'Annual' },
    { value: 'Sick',      label: 'Sick' },
    { value: 'Casual',    label: 'Casual' },
    { value: 'Earned',    label: 'Earned' },
    { value: 'Maternity', label: 'Maternity' },
    { value: 'Comp Off',  label: 'Comp Off' },
    { value: 'LOP',       label: 'LOP' },
  ];
  const PAYROLL_OPTIONS = [
    { value: 'All',        label: 'All' },
    { value: 'Paid Leave', label: 'Paid Leave' },
    { value: 'Unpaid',     label: 'Unpaid' },
    { value: 'Half-Pay',   label: 'Half-Pay' },
  ];

  // KPI cards definition — mirrors Onboarding Hub (strip + tinted icon)
  const KPI_CARDS = [
    { key: 'pending',      label: 'Pending Approval',   icon: 'ri-time-line',           strip: 'linear-gradient(90deg,#7c5cfc,#a78bfa)', tint: '#ece6ff', fg: '#5a3fd1' },
    { key: 'approved',     label: 'Approved (Month)',   icon: 'ri-checkbox-circle-line',strip: 'linear-gradient(90deg,#0ab39c,#34d399)', tint: '#d3f0ee', fg: '#0a716a' },
    { key: 'onLeaveToday', label: 'On Leave Today',     icon: 'ri-user-3-line',         strip: 'linear-gradient(90deg,#3b82f6,#60a5fa)', tint: '#dceefe', fg: '#0c63b0' },
    { key: 'rejected',     label: 'Rejected',           icon: 'ri-close-circle-line',   strip: 'linear-gradient(90deg,#f06548,#fda192)', tint: '#fde2dc', fg: '#b91c1c' },
    { key: 'total',        label: 'Total Requests',     icon: 'ri-stack-line',          strip: 'linear-gradient(90deg,#f59e0b,#fbcc77)', tint: '#fde8c4', fg: '#a4661c' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <MasterFormStyles />
      <LeaveStyles />

      {/* ── Hero card (purple-tinted, separate container — matches Onboarding Hub) ── */}
      <div className="onb-hero-card mb-3">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
            style={{
              width: 46, height: 46,
              background: 'linear-gradient(135deg, #7c5cfc 0%, #5a3fd1 100%)',
              boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
            }}
          >
            <i className="ri-calendar-2-line" style={{ color: '#fff', fontSize: 21 }} />
          </span>
          <div className="min-w-0">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Leave Management</h5>
              <span className="onb-hero-pill"><span className="dot" />FY 2025–26</span>
            </div>
            <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
              Leave requests, balances, and approval pipeline across all employees
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Button className="lv-secondary-btn rounded-pill">
            <i className="ri-calendar-event-line me-2" style={{ fontSize: 15 }} />Holidays
          </Button>
          <Button className="onb-checklist-cta rounded-pill">
            <i className="ri-check-double-line me-2" style={{ fontSize: 16 }} />
            Approve All
          </Button>
        </div>
      </div>

      {/* ── KPI cards row ── */}
      <Row className="g-3 mb-3 align-items-stretch">
        {KPI_CARDS.map(k => (
          <Col key={k.key} xl={true} md={4} sm={6} xs={12}>
            <div
              className="onb-surface onb-kpi-card"
              style={{
                borderRadius: 14,
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                padding: '16px 18px',
                position: 'relative',
                overflow: 'hidden',
                height: '100%',
              }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.strip }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                <div className="min-w-0">
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                    {k.label}
                  </p>
                  <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                    <AnimatedNumber value={(counts as any)[k.key] ?? 0} />
                  </h3>
                </div>
                <div className="onb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={k.icon} style={{ fontSize: 20, color: k.fg }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Tabs (pill-style, free — matches Onboarding screenshot) ── */}
      <div className="d-flex mb-3" style={{ gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'pending'  as const, label: 'Pending Approvals',  count: counts.pending,  icon: 'ri-time-line' },
          { key: 'approved' as const, label: 'Approved Leaves',    count: counts.approved, icon: 'ri-checkbox-circle-line' },
        ].map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key); setPage(1); }}
              className="btn d-inline-flex align-items-center gap-2 fw-semibold"
              style={{
                borderRadius: 999,
                padding: '8px 16px',
                fontSize: 13,
                background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'var(--vz-card-bg)',
                color: on ? '#fff' : 'var(--vz-secondary-color)',
                border: on ? 'none' : '1px solid var(--vz-border-color)',
                boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
              }}
            >
              <i className={t.icon} style={{ fontSize: 14 }} />
              {t.label}
              <span
                className="badge rounded-pill"
                style={{
                  fontSize: 11,
                  background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                  color: on ? '#fff' : 'var(--vz-secondary-color)',
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters + Table — own card, like Employee Onboarding list ── */}
      <Card>
        <CardBody>
          <Row className="g-2 align-items-center mb-3">
            <Col md={5} sm={12}>
              <div className="search-box">
                <Input
                  type="text"
                  className="form-control"
                  placeholder="Search name, ID, type…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
                <i className="ri-search-line search-icon"></i>
              </div>
            </Col>
            <Col md={7} sm={12} className="d-flex justify-content-md-end gap-3 flex-wrap align-items-center">
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Type</span>
                <div style={{ minWidth: 170 }}>
                  <MasterSelect
                    value={type}
                    onChange={v => { setType(v); setPage(1); }}
                    options={TYPE_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Payroll</span>
                <div style={{ minWidth: 170 }}>
                  <MasterSelect
                    value={payroll}
                    onChange={v => { setPayroll(v); setPage(1); }}
                    options={PAYROLL_OPTIONS}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {filtered.length} results
              </div>
            </Col>
          </Row>

          <div className="table-responsive table-card rounded p-2">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col" className="ps-3" style={{ width: 60 }}>Sr. No.</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Leave ID</th>
                  <th scope="col">Type</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Date Range</th>
                  <th scope="col">Approval Chain</th>
                  <th scope="col">Payroll</th>
                  <th scope="col">Proof</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pe-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-5 text-muted">
                      <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                      No leave requests match your filters
                    </td>
                  </tr>
                ) : visible.map((r, idx) => {
                  const tone = STAGE_TONE[r.stage];
                  const tType = TYPE_TONE[r.type];
                  return (
                    <tr key={r.id}>
                      <td className="ps-3 fw-semibold text-muted">{sliceFrom + idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div
                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{
                              width: 34, height: 34, fontSize: 12,
                              background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`,
                              boxShadow: `0 2px 6px ${r.accent}40`,
                            }}
                          >
                            {r.empInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="fw-semibold fs-13">{r.empName}</div>
                            <div className="text-muted" style={{ fontSize: 11.5 }}>{r.empRole}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="onb-id-pill">{r.empCode}</span>
                      </td>
                      <td>
                        <span className="lv-type-pill" style={{ background: tType.bg, color: tType.fg }}>
                          {r.type}
                        </span>
                      </td>
                      <td>
                        <span className="fw-semibold fs-13">{r.durationLabel}</span>
                      </td>
                      <td>
                        <div className="lv-range-cell">
                          <div className="lv-range-text">{r.rangeLabel}</div>
                          <div className="lv-range-applied">Applied: {r.appliedOn}</div>
                        </div>
                      </td>
                      <td>
                        <ApprovalChain chain={r.approvalChain} />
                      </td>
                      <td>
                        <span className="onb-role-pill">{r.payroll}</span>
                      </td>
                      <td>
                        {r.proof === 'Uploaded' ? (
                          <div className="lv-proof-cell">
                            <span className="lv-proof-ok">
                              <i className="ri-check-line" />Uploaded
                            </span>
                            {r.proofVia && <div className="lv-proof-via">via {r.proofVia}</div>}
                          </div>
                        ) : r.proof === 'Missing' ? (
                          <div className="lv-proof-cell">
                            <span className="lv-proof-bad">
                              <i className="ri-close-line" />Missing
                            </span>
                            {r.proofVia && <div className="lv-proof-via">via {r.proofVia}</div>}
                          </div>
                        ) : (
                          <span className="text-muted fw-semibold" style={{ fontSize: 12 }}>N/A</span>
                        )}
                      </td>
                      <td>
                        <span className="onb-pill" style={{ background: tone.bg, color: tone.fg }}>
                          <span className="d" style={{ background: tone.dot }} />
                          {r.stage}
                        </span>
                        {r.stage.startsWith('Pending') && r.stageNote && (
                          <div className="lv-sla-chip" title="SLA">{r.stageNote}</div>
                        )}
                      </td>
                      <td className="pe-3">
                        {r.stage.startsWith('Pending') ? (
                          <div className="d-flex align-items-center gap-2">
                            <button type="button" className="onb-edit-btn" title="View Details">
                              <i className="ri-eye-line" style={{ fontSize: 14 }} />
                            </button>
                            <button type="button" className="onb-init-btn" title="Approve">
                              <i className="ri-check-line" style={{ fontSize: 14 }} />
                              Approve
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="onb-vault-btn" title="View Details">
                            <i className="ri-file-list-3-line" style={{ fontSize: 14 }} />
                            View Details
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination — same layout as master TableContainer / onboarding */}
          <Row className="align-items-center mt-2 g-3 text-center text-sm-start">
            <div className="col-sm">
              <div className="text-muted">
                Showing
                <span className="fw-semibold ms-1">{visible.length}</span>
                {' '}of <span className="fw-semibold">{filtered.length}</span> Results
              </div>
            </div>
            <div className="col-sm-auto">
              <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
                <li className={safePage <= 1 ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage - 1); }}>Previous</a>
                </li>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                  <li key={p} className={p === safePage ? 'page-item active' : 'page-item'}>
                    <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(p); }}>{p}</a>
                  </li>
                ))}
                <li className={safePage >= pageCount ? 'page-item disabled' : 'page-item'}>
                  <a href="#" className="page-link" onClick={(e) => { e.preventDefault(); goto(safePage + 1); }}>Next</a>
                </li>
              </ul>
            </div>
          </Row>
        </CardBody>
      </Card>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeaveStyles — page-scoped CSS for the few `lv-*` extras we add on top of
// the Onboarding-Hub classes (chain avatars, type pill, proof cell, SLA chip).
// ─────────────────────────────────────────────────────────────────────────────
function LeaveStyles(): ReactNode {
  return (
    <style>{`
      .lv-secondary-btn {
        background: rgba(255,255,255,0.85) !important;
        color: #5a3fd1 !important;
        border: 1px solid rgba(124,92,252,0.30) !important;
        font-size: 13px;
        font-weight: 700;
        padding: 9px 16px;
        display: inline-flex;
        align-items: center;
        transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
      }
      .lv-secondary-btn:hover {
        background: #ffffff !important;
        transform: translateY(-1px);
        box-shadow: 0 6px 14px rgba(124,92,252,0.18);
      }
      [data-bs-theme="dark"] .lv-secondary-btn {
        background: rgba(255,255,255,0.06) !important;
        color: #c4b5fd !important;
        border-color: rgba(124,92,252,0.40) !important;
      }

      /* Type pill — solid-coloured chip in the table */
      .lv-type-pill {
        display: inline-flex; align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11.5px; font-weight: 700;
        letter-spacing: 0.01em;
      }

      /* Date range cell — primary line + applied-on subtitle */
      .lv-range-cell { line-height: 1.3; }
      .lv-range-text { font-size: 13px; font-weight: 700; color: var(--vz-body-color); }
      .lv-range-applied { font-size: 11px; color: var(--vz-secondary-color); margin-top: 2px; }

      /* SLA chip under the status pill */
      .lv-sla-chip {
        display: inline-flex; align-items: center;
        margin-top: 4px;
        padding: 2px 8px;
        border-radius: 6px;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fde68a;
        font-size: 10px; font-weight: 700;
      }
      [data-bs-theme="dark"] .lv-sla-chip {
        background: rgba(245,158,11,0.16);
        color: #fbbf24;
        border-color: rgba(245,158,11,0.40);
      }

      /* Approval chain — small avatars connected with arrows */
      .lv-chain { display: inline-flex; align-items: center; gap: 3px; }
      .lv-chain-item { display: inline-flex; align-items: center; gap: 3px; }
      .lv-chain-arrow { color: #cbd5e1; font-size: 13px; }
      .lv-chain-avatar {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 50%;
        font-size: 10px; font-weight: 800;
        flex-shrink: 0;
        transition: transform .15s ease;
      }
      .lv-chain-avatar:hover { transform: scale(1.10); }
      .lv-chain-avatar i { font-size: 12px; }

      /* Proof cell */
      .lv-proof-cell { line-height: 1.3; }
      .lv-proof-ok {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px;
        border-radius: 999px;
        background: #d3f0ee; color: #0a716a;
        font-size: 11px; font-weight: 700;
        border: 1px solid #b6e4dd;
      }
      .lv-proof-bad {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px;
        border-radius: 999px;
        background: #fde2dc; color: #b91c1c;
        font-size: 11px; font-weight: 700;
        border: 1px solid #fecaca;
      }
      .lv-proof-via {
        font-size: 10.5px;
        color: var(--vz-secondary-color);
        margin-top: 3px;
      }
    `}</style>
  );
}
