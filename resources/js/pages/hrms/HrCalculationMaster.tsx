 import { useMemo, useState } from 'react';
import { Col, Row } from 'reactstrap';
import '../../../css/recruitment.css';
import '../../../css/pip.css';

// ─────────────────────────────────────────────────────────────────────────────
// Calculation Master — payroll rule engine.
//
// Layout: 3-column page (sidebar / content / live preview). The right
// preview panel runs the same calculation engine the backend will run, so
// HR can sanity-check the rules against any sample employee before saving.
//
// Backend stub: GET /api/payroll/rules + POST /api/payroll/rules/preview.
// All numbers, thresholds and tables here are mock — see top-of-file
// constants. Wiring the backend is a one-line swap (replace constants
// with useEffect(api.get(...))).
// ─────────────────────────────────────────────────────────────────────────────

type SectionKey = 'pt' | 'leave' | 'late' | 'overtime' | 'deduction' | 'governance';

// ─── Mock rule data ─────────────────────────────────────────────────────────

const PT_RULES = [
  { gender: 'Female', threshold: 20000, amount: 200, note: 'PT applied if salary exceeds threshold' },
  { gender: 'Male',   threshold: 15000, amount: 200, note: 'PT applied if salary exceeds threshold' },
];

interface LeaveRule { role: string; free: number; logic: string; status: string; statusTone: 'red' | 'amber' | 'green' }
const LEAVE_RULES: LeaveRule[] = [
  { role: 'Intern',    free: 0, logic: 'Any leave taken impacts salary proportionally',  status: 'Full Impact', statusTone: 'red' },
  { role: 'Manager',   free: 3, logic: 'Up to threshold: no deduction; excess deducted', status: 'Threshold',   statusTone: 'amber' },
  { role: 'Team Lead', free: 2, logic: 'Up to threshold: no deduction; excess deducted', status: 'Threshold',   statusTone: 'amber' },
  { role: 'Employee',  free: 1, logic: 'Standard: 1 casual leave free per month',          status: 'Standard',    statusTone: 'green' },
];

const LATE_CONFIG = { threshold: 3, halfDays: 1, remainder: 'Carry forward to next month' };

const OVERTIME_CONFIG = {
  eligibleAfter: 9,                     // hrs/day
  multiplier: 1.5,                       // × hourly rate
  multiplierLabel: '1.5× hourly rate',
  approval: 'Manager Pre-approval',
};

interface DeductionTrigger { trigger: string; action: string; severity: 'High' | 'Medium' | 'Low'; approval: string }
const DEDUCTION_TRIGGERS: DeductionTrigger[] = [
  { trigger: 'Task SLA Breach',         action: 'Salary Hold',         severity: 'High',   approval: 'HR + Manager'  },
  { trigger: 'Notice Period Violation', action: 'F&F Deduction',        severity: 'High',   approval: 'HR Head'       },
  { trigger: 'Asset Not Returned',      action: 'Deduction from F&F',   severity: 'Medium', approval: 'HR'            },
  { trigger: 'Policy Violation',         action: 'Payroll Block',        severity: 'Medium', approval: 'HR + Checker'  },
  { trigger: 'Advance Not Cleared',     action: 'Recovery from Salary', severity: 'Low',    approval: 'Finance'       },
];

const FNF_DEDUCTIONS = [
  'Notice period shortfall',
  'Pending task deductions',
  'Unreturned assets',
  'Salary advance recovery',
];
const FNF_ADDITIONS = [
  'Earned leave encashment',
  'Pending salary dues',
  'Performance bonus (pro-rata)',
  'Gratuity (if eligible)',
];

interface GovernanceRow { type: string; maker: string; checker: string; approver: string; audit: 'Full Audit' | 'System Log' }
const GOVERNANCE_FLOW: GovernanceRow[] = [
  { type: 'Salary Override',       maker: 'HR Exec',    checker: 'HR Manager', approver: 'Finance Head',   audit: 'Full Audit' },
  { type: 'Rule Threshold Change', maker: 'HR Exec',    checker: 'HR Manager', approver: 'HR Head',        audit: 'Full Audit' },
  { type: 'Payroll Hold Removal',  maker: 'HR Manager', checker: 'Finance',    approver: 'Finance Head',   audit: 'Full Audit' },
  { type: 'Late Mark Waiver',      maker: 'Manager',    checker: 'HR Exec',    approver: 'HR Manager',     audit: 'Full Audit' },
  { type: 'OT Approval Override',  maker: 'Manager',    checker: 'HR Exec',    approver: 'Auto if <4hrs',  audit: 'System Log' },
];

interface OverrideFlag { icon: string; title: string; sub: string; tone: 'amber' | 'orange' }
const OVERRIDE_FLAGS: OverrideFlag[] = [
  { icon: 'ri-error-warning-line', title: 'Salary > Industry Band', sub: 'Auto-flagged for checker review', tone: 'amber'  },
  { icon: 'ri-error-warning-line', title: 'OT > 40hrs / month',     sub: 'Requires Finance approval',        tone: 'amber'  },
  { icon: 'ri-alert-line',          title: 'Rule changed mid-cycle', sub: 'Notifies all affected employees',  tone: 'orange' },
  { icon: 'ri-alert-line',          title: 'Manual leave waiver',     sub: 'Checker approval required',         tone: 'orange' },
];

// ─── Calculation engine ─────────────────────────────────────────────────────

const WORKING_DAYS = 26;
const HOURS_PER_DAY = 8;

interface PayInputs {
  role: string;
  gender: 'Male' | 'Female';
  salary: number;
  leaves: number;
  lateMarks: number;
  overtimeHrs: number;
}

interface PayResults {
  gross: number;
  pt: number;
  leave: number;
  leaveExcess: number;
  late: number;
  lateHalfDays: number;
  ot: number;
  net: number;
}

function computePT(gender: string, salary: number): number {
  const rule = PT_RULES.find(r => r.gender === gender);
  if (!rule || salary <= rule.threshold) return 0;
  return rule.amount;
}

function computeLeave(role: string, leaves: number, salary: number) {
  const rule = LEAVE_RULES.find(r => r.role === role);
  const free = rule?.free ?? 0;
  const excess = Math.max(0, leaves - free);
  const deduction = Math.round(excess * (salary / WORKING_DAYS));
  return { excess, deduction };
}

function computeLate(lateMarks: number, salary: number) {
  const halfDays = Math.floor(lateMarks / LATE_CONFIG.threshold);
  const halfDayRate = (salary / WORKING_DAYS) * 0.5;
  return { halfDays, deduction: Math.round(halfDays * halfDayRate) };
}

function computeOvertime(hours: number, salary: number) {
  const hourly = salary / WORKING_DAYS / HOURS_PER_DAY;
  return Math.round(hours * hourly * OVERTIME_CONFIG.multiplier);
}

function computeAll(input: PayInputs): PayResults {
  const pt = computePT(input.gender, input.salary);
  const leave = computeLeave(input.role, input.leaves, input.salary);
  const late = computeLate(input.lateMarks, input.salary);
  const ot = computeOvertime(input.overtimeHrs, input.salary);
  return {
    gross:        input.salary,
    pt,
    leave:        leave.deduction,
    leaveExcess:  leave.excess,
    late:         late.deduction,
    lateHalfDays: late.halfDays,
    ot,
    net:          input.salary - pt - leave.deduction - late.deduction + ot,
  };
}

// ─── Sidebar config ─────────────────────────────────────────────────────────

// Per-section accent colour drives the left strip on its sidebar tab + the
// icon tint, mirroring how the Master page rule cards use a colour-coded
// vertical bar to make categories scannable at a glance.
const SECTIONS: { key: SectionKey; icon: string; title: string; sub: string; group: 'rules' | 'governance'; accent: string }[] = [
  { key: 'pt',         icon: 'ri-coins-line',           title: 'Professional Tax',    sub: 'PT by gender & salary',       group: 'rules',      accent: '#f59e0b' },
  { key: 'leave',      icon: 'ri-calendar-event-line',  title: 'Leave Deduction',     sub: 'Role-wise leave rules',       group: 'rules',      accent: '#0ea5e9' },
  { key: 'late',       icon: 'ri-time-line',             title: 'Late Mark Rules',     sub: 'Late → half-day conversion',  group: 'rules',      accent: '#7c5cfc' },
  { key: 'overtime',   icon: 'ri-timer-2-line',          title: 'Overtime Rules',      sub: 'OT eligibility & rate',       group: 'rules',      accent: '#16a34a' },
  { key: 'deduction',  icon: 'ri-alert-line',            title: 'Deduction / Hold',    sub: 'Hold & payroll block rules',  group: 'rules',      accent: '#dc2626' },
  { key: 'governance', icon: 'ri-shield-check-line',     title: 'Override / Approval', sub: 'MCA governance flow',         group: 'governance', accent: '#0d9488' },
];

// ─── Tone helpers — pure CSS class lookups, no inline color logic ──────────

const STATUS_TONE_CLASS: Record<'red' | 'amber' | 'green' | 'blue', string> = {
  red:   'cm-pill cm-pill-red',
  amber: 'cm-pill cm-pill-amber',
  green: 'cm-pill cm-pill-green',
  blue:  'cm-pill cm-pill-blue',
};

const SEVERITY_TONE: Record<'High' | 'Medium' | 'Low', 'red' | 'amber' | 'green'> = {
  High:   'red',
  Medium: 'amber',
  Low:    'green',
};

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════

export default function HrCalculationMaster() {
  const [section, setSection] = useState<SectionKey>('pt');
  const [inputs, setInputs]   = useState<PayInputs>({
    role: 'Team Lead',
    gender: 'Male',
    salary: 25000,
    leaves: 3,
    lateMarks: 6,
    overtimeHrs: 4,
  });

  // Re-run the engine whenever any input changes — drives the right-panel preview.
  const results = useMemo(() => computeAll(inputs), [inputs]);

  return (
    <Row>
      <Col xs={12}>
        <div className="rec-page">
          {/* ── Hero header — same .onb-hero-card pattern used by HrPIP /
              HrLeave / HrExpenseManagement so the page reads as part of the
              same template family. Icon kept orange to match the Figma's
              "Rule Engine" theme; everything else inherits the standard
              purple HR hero gradient. */}
          <div className="onb-hero-card mb-3">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', boxShadow: '0 8px 18px rgba(245,158,11,0.32)' }}
              >
                <i className="ri-stack-line" style={{ color: '#fff', fontSize: 22 }} />
              </span>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <h5 className="fw-bold mb-0">Calculation Master</h5>
                  <span className="pip-pill pip-pill-warn"><span className="dot" />Rule Engine</span>
                </div>
                <div className="text-muted mt-1 fs-13">
                  Time &amp; Pay Inputs · Payroll Rule Engine · Live preview engine
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button type="button" className="rec-btn-ghost">
                <i className="ri-save-line" />Save Rules
              </button>
              <button type="button" className="pip-btn-initiate">
                <i className="ri-play-circle-line" />Run Preview
              </button>
            </div>
          </div>

          {/* ── 3-column body ── */}
          <Row className="g-3">
            <Col xl={2} lg={3} md={4}>
              <CalcSidebar active={section} onChange={setSection} />
            </Col>
            <Col xl={7} lg={9} md={8}>
              {section === 'pt'         && <PtSection />}
              {section === 'leave'      && <LeaveSection />}
              {section === 'late'       && <LateSection />}
              {section === 'overtime'   && <OvertimeSection />}
              {section === 'deduction'  && <DeductionSection />}
              {section === 'governance' && <GovernanceSection />}
            </Col>
            <Col xl={3} lg={12}>
              <RulePreview inputs={inputs} setInputs={setInputs} results={results} />
            </Col>
          </Row>
        </div>
      </Col>
    </Row>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sidebar — rule categories + governance group
// ═════════════════════════════════════════════════════════════════════════════

function CalcSidebar({ active, onChange }: { active: SectionKey; onChange: (k: SectionKey) => void }) {
  const renderItem = (s: typeof SECTIONS[number]) => (
    <button
      key={s.key}
      type="button"
      onClick={() => onChange(s.key)}
      className={`cm-side-item ${active === s.key ? 'is-active' : ''}`}
      // CSS variable drives the left strip + icon tint per category — same
      // pattern as the colour-coded Master page rule cards.
      style={{ ['--cm-accent' as any]: s.accent }}
    >
      <span className="cm-side-strip" />
      <span className="cm-side-icon"><i className={s.icon} /></span>
      <span className="cm-side-text">
        <span className="cm-side-title">{s.title}</span>
        <span className="cm-side-sub">{s.sub}</span>
      </span>
    </button>
  );

  return (
    <div className="cm-sidebar">
      <div className="cm-side-group-label">RULE CATEGORIES</div>
      {SECTIONS.filter(s => s.group === 'rules').map(renderItem)}
      <div className="cm-side-group-label cm-side-group-label-spaced">GOVERNANCE</div>
      {SECTIONS.filter(s => s.group === 'governance').map(renderItem)}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Right preview panel — inputs + live salary flow
// ═════════════════════════════════════════════════════════════════════════════

function RulePreview({ inputs, setInputs, results }: {
  inputs: PayInputs;
  setInputs: (i: PayInputs) => void;
  results: PayResults;
}) {
  const set = <K extends keyof PayInputs>(k: K, v: PayInputs[K]) => setInputs({ ...inputs, [k]: v });

  return (
    <div className="cm-preview">
      <div className="cm-preview-head">
        <h6 className="cm-preview-title">Rule Preview</h6>
        <p className="cm-preview-sub">Test rules with sample inputs</p>
      </div>

      <div className="cm-form">
        <div className="cm-field">
          <label className="cm-label">ROLE</label>
          <select className="form-select form-select-sm cm-input" value={inputs.role} onChange={e => set('role', e.target.value)}>
            {LEAVE_RULES.map(r => <option key={r.role} value={r.role}>{r.role}{r.role === 'Team Lead' ? ' (TL)' : ''}</option>)}
          </select>
        </div>
        <div className="cm-field">
          <label className="cm-label">GENDER</label>
          <select className="form-select form-select-sm cm-input" value={inputs.gender} onChange={e => set('gender', e.target.value as 'Male' | 'Female')}>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div className="cm-field">
          <label className="cm-label">GROSS SALARY (₹)</label>
          <input type="number" className="form-control form-control-sm cm-input" value={inputs.salary} onChange={e => set('salary', Number(e.target.value) || 0)} />
        </div>
        <div className="cm-field">
          <label className="cm-label">LEAVES TAKEN</label>
          <input type="number" className="form-control form-control-sm cm-input" value={inputs.leaves} onChange={e => set('leaves', Number(e.target.value) || 0)} />
        </div>
        <div className="cm-field">
          <label className="cm-label">LATE MARKS</label>
          <input type="number" className="form-control form-control-sm cm-input" value={inputs.lateMarks} onChange={e => set('lateMarks', Number(e.target.value) || 0)} />
        </div>
        <div className="cm-field">
          <label className="cm-label">OVERTIME (HRS)</label>
          <input type="number" className="form-control form-control-sm cm-input" value={inputs.overtimeHrs} onChange={e => set('overtimeHrs', Number(e.target.value) || 0)} />
        </div>
      </div>

      {/* Salary flow visualisation */}
      <div className="cm-flow">
        <div className="cm-flow-title">SALARY FLOW</div>

        <div className="cm-flow-step cm-flow-step-gross">
          <div className="cm-flow-label">Gross Salary</div>
          <div className="cm-flow-value">₹{results.gross.toLocaleString('en-IN')}</div>
        </div>

        <div className="cm-flow-connector" />

        <div className="cm-flow-step cm-flow-step-deduct">
          <div className="cm-flow-label">Deductions</div>
          <div className="cm-flow-line">
            <span>Professional Tax</span>
            <span className="cm-flow-amt cm-flow-amt-neg">-₹{results.pt.toLocaleString('en-IN')}</span>
          </div>
          <div className="cm-flow-line">
            <span>Leave ({results.leaveExcess} excess)</span>
            <span className="cm-flow-amt cm-flow-amt-neg">-₹{results.leave.toLocaleString('en-IN')}</span>
          </div>
          <div className="cm-flow-line">
            <span>Late Marks ({results.lateHalfDays} half-days)</span>
            <span className="cm-flow-amt cm-flow-amt-neg">-₹{results.late.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div className="cm-flow-connector" />

        <div className="cm-flow-step cm-flow-step-add">
          <div className="cm-flow-line">
            <span>Overtime (+₹{results.ot.toLocaleString('en-IN')})</span>
            <span className="cm-flow-amt cm-flow-amt-pos">+₹{results.ot.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div className="cm-flow-connector" />

        <div className="cm-flow-step cm-flow-step-net">
          <div className="cm-flow-label">NET PAY</div>
          <div className="cm-flow-value cm-flow-value-net">₹{results.net.toLocaleString('en-IN')}</div>
        </div>
      </div>
    </div>
  );
}

// Generic section header (small uppercase label + card)
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="cm-section-label">{children}</div>;
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 1 — Professional Tax
// ═════════════════════════════════════════════════════════════════════════════

function PtSection() {
  return (
    <>
      <SectionLabel>PROFESSIONAL TAX CONFIGURATION</SectionLabel>

      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Professional Tax Rules</div>
            <div className="pip-card-sub">PT applied based on gender and monthly gross salary threshold</div>
          </div>
        </div>
        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>GENDER</th>
                <th>THRESHOLD (₹)</th>
                <th>PT AMOUNT (₹/MONTH)</th>
                <th>STATUS</th>
                <th>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {PT_RULES.map(r => (
                <tr key={r.gender}>
                  <td><span className={STATUS_TONE_CLASS.blue}>{r.gender}</span></td>
                  <td className="cm-cell-mono">&gt; {r.threshold.toLocaleString('en-IN')}</td>
                  <td className="cm-cell-mono">{r.amount} / month</td>
                  <td><span className={STATUS_TONE_CLASS.green}>● Active</span></td>
                  <td className="text-muted fs-12">{r.note}</td>
                </tr>
              ))}
              <tr>
                <td className="text-muted fs-12">Below threshold (any gender)</td>
                <td className="cm-cell-mono">₹0</td>
                <td>—</td>
                <td><span className={STATUS_TONE_CLASS.amber}>Exempt</span></td>
                <td className="text-muted fs-12">PT not applicable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="cm-formula">
          <span className="cm-formula-key">Formula:</span> PT_Amount = (gross_salary &gt; threshold[gender]) ? pt_rate[gender] : 0
        </div>
      </div>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">PT Applicability Matrix</div>
            <div className="pip-card-sub">Visual reference for PT conditions across salary bands</div>
          </div>
        </div>
        <Row className="g-2">
          <Col md={4}>
            <div className="cm-matrix cm-matrix-female">
              <div className="cm-matrix-head">FEMALE · &gt; ₹20,000</div>
              <div className="cm-matrix-amount">₹200</div>
              <div className="cm-matrix-foot">PT Deducted</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="cm-matrix cm-matrix-male">
              <div className="cm-matrix-head">MALE · &gt; ₹15,000</div>
              <div className="cm-matrix-amount">₹200</div>
              <div className="cm-matrix-foot">PT Deducted</div>
            </div>
          </Col>
          <Col md={4}>
            <div className="cm-matrix cm-matrix-exempt">
              <div className="cm-matrix-head">BELOW THRESHOLD</div>
              <div className="cm-matrix-amount">₹0</div>
              <div className="cm-matrix-foot">PT Exempt</div>
            </div>
          </Col>
        </Row>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 2 — Leave Deduction
// ═════════════════════════════════════════════════════════════════════════════

function LeaveSection() {
  return (
    <>
      <SectionLabel>LEAVE DEDUCTION CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Role-wise Leave Deduction Rules</div>
            <div className="pip-card-sub">Maximum free leaves allowed per month before salary deduction kicks in</div>
          </div>
        </div>
        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>ROLE</th>
                <th>FREE LEAVES / MONTH</th>
                <th>DEDUCTION LOGIC</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {LEAVE_RULES.map(r => (
                <tr key={r.role}>
                  <td><span className={STATUS_TONE_CLASS.blue}>{r.role}</span></td>
                  <td className="cm-cell-mono">{r.free} <span className="text-muted">days</span></td>
                  <td className="text-muted fs-12">{r.logic}</td>
                  <td><span className={STATUS_TONE_CLASS[r.statusTone]}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cm-formula">
          <span className="cm-formula-key">Deduction</span> = max(0, leaves_taken − free_threshold) × (gross_salary / working_days)
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 3 — Late Mark Rules
// ═════════════════════════════════════════════════════════════════════════════

function LateSection() {
  return (
    <>
      <SectionLabel>LATE MARK CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Late Mark → Half-Day Conversion Rules</div>
            <div className="pip-card-sub">Defines how accumulated late marks convert into salary deductions</div>
          </div>
        </div>

        <Row className="g-3 mb-3">
          <Col md={6}>
            <label className="cm-label cm-label-block">CONVERSION THRESHOLD</label>
            <div className="d-flex align-items-center gap-2">
              <input type="number" className="form-control form-control-sm cm-input cm-input-narrow" value={LATE_CONFIG.threshold} readOnly />
              <span className="text-muted fs-13">late marks =</span>
              <input type="number" className="form-control form-control-sm cm-input cm-input-narrow" value={LATE_CONFIG.halfDays} readOnly />
              <span className="text-muted fs-13">half-day</span>
            </div>
          </Col>
          <Col md={6}>
            <label className="cm-label cm-label-block">REMAINDER HANDLING</label>
            <select className="form-select form-select-sm cm-input" defaultValue={LATE_CONFIG.remainder}>
              <option>Carry forward to next month</option>
              <option>Reset at month end</option>
              <option>Convert remainder to half-day if ≥2</option>
            </select>
          </Col>
        </Row>

        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>CONDITION</th>
                <th>RESULT</th>
                <th>HALF-DAYS</th>
                <th>DEDUCTION</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Every {LATE_CONFIG.threshold} late marks</td>
                <td><span className={STATUS_TONE_CLASS.amber}>1 half-day deduction</span></td>
                <td className="cm-cell-mono fs-12">floor(late_marks / {LATE_CONFIG.threshold})</td>
                <td className="cm-cell-mono fs-12">× (salary / working_days × 0.5)</td>
              </tr>
              <tr>
                <td>Remaining late marks</td>
                <td><span className={STATUS_TONE_CLASS.blue}>Carry forward</span></td>
                <td className="cm-cell-mono fs-12">late_marks mod {LATE_CONFIG.threshold}</td>
                <td className="cm-cell-mono fs-12">₹0 (no deduction)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="cm-formula">
          <span className="cm-formula-key">Half_Day_Cuts</span> = floor(late_marks / 3) &nbsp;
          <span className="cm-formula-key">Late_Deduction</span> = Half_Day_Cuts × (gross_salary / 26 × 0.5) &nbsp;
          <span className="cm-formula-key">Carry_Forward</span> = late_marks mod 3
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 4 — Overtime Rules
// ═════════════════════════════════════════════════════════════════════════════

function OvertimeSection() {
  return (
    <>
      <SectionLabel>OVERTIME CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Overtime Eligibility &amp; Rate Rules</div>
            <div className="pip-card-sub">Overtime applicable on approved hours beyond standard shift</div>
          </div>
        </div>

        <Row className="g-3 mb-3">
          <Col md={4}>
            <label className="cm-label cm-label-block">ELIGIBLE AFTER (HRS/DAY)</label>
            <input type="number" className="form-control form-control-sm cm-input" defaultValue={OVERTIME_CONFIG.eligibleAfter} />
          </Col>
          <Col md={4}>
            <label className="cm-label cm-label-block">OT RATE MULTIPLIER</label>
            <select className="form-select form-select-sm cm-input" defaultValue={OVERTIME_CONFIG.multiplierLabel}>
              <option>1.25× hourly rate</option>
              <option>1.5× hourly rate</option>
              <option>2× hourly rate (weekends)</option>
            </select>
          </Col>
          <Col md={4}>
            <label className="cm-label cm-label-block">APPROVAL REQUIRED</label>
            <select className="form-select form-select-sm cm-input" defaultValue={OVERTIME_CONFIG.approval}>
              <option>Manager Pre-approval</option>
              <option>Auto-approve under 4 hrs</option>
              <option>HR Approval</option>
            </select>
          </Col>
        </Row>

        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>ELIGIBILITY</th>
                <th>OT HOURS BASIS</th>
                <th>RATE</th>
                <th>FORMULA</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>All confirmed employees</td>
                <td className="text-muted fs-12">Hours beyond shift duration</td>
                <td><span className={STATUS_TONE_CLASS.green}>1.5× hourly</span></td>
                <td className="cm-cell-mono fs-12">ot_hrs × (salary/26/8) × 1.5</td>
              </tr>
              <tr>
                <td>Intern / Probation</td>
                <td className="text-muted fs-12">Not eligible for OT pay</td>
                <td><span className={STATUS_TONE_CLASS.amber}>Not eligible</span></td>
                <td className="cm-cell-mono fs-12">₹0</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="cm-formula">
          <span className="cm-formula-key">OT_Amount</span> = ot_hours × (gross_salary / 26 / 8) × ot_multiplier &nbsp;
          <span className="cm-formula-key">Hourly_Rate</span> = gross_salary / 26 working days / 8 hrs per day
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 5 — Deduction & Salary Hold
// ═════════════════════════════════════════════════════════════════════════════

function DeductionSection() {
  return (
    <>
      <SectionLabel>DEDUCTION &amp; SALARY HOLD RULES</SectionLabel>

      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Salary Hold &amp; Deduction Triggers</div>
            <div className="pip-card-sub">Conditions that block or modify payroll disbursement</div>
          </div>
        </div>
        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>TRIGGER CONDITION</th>
                <th>ACTION</th>
                <th>SEVERITY</th>
                <th>APPROVAL REQUIRED</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {DEDUCTION_TRIGGERS.map(t => (
                <tr key={t.trigger}>
                  <td>{t.trigger}</td>
                  <td><span className={STATUS_TONE_CLASS.amber}>{t.action}</span></td>
                  <td><span className={STATUS_TONE_CLASS[SEVERITY_TONE[t.severity]]}>{t.severity}</span></td>
                  <td className="text-muted fs-13">{t.approval}</td>
                  <td><span className={STATUS_TONE_CLASS.green}>● Active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">F&amp;F Settlement Deduction Logic</div>
            <div className="pip-card-sub">Full &amp; Final settlement computation rules</div>
          </div>
        </div>
        <Row className="g-3">
          <Col md={6}>
            <div className="cm-fnf cm-fnf-deduct">
              <div className="cm-fnf-title">DEDUCTIONS FROM F&amp;F</div>
              <ul className="cm-fnf-list">
                {FNF_DEDUCTIONS.map(d => <li key={d}>{d}</li>)}
              </ul>
            </div>
          </Col>
          <Col md={6}>
            <div className="cm-fnf cm-fnf-add">
              <div className="cm-fnf-title">ADDITIONS TO F&amp;F</div>
              <ul className="cm-fnf-list">
                {FNF_ADDITIONS.map(d => <li key={d}>{d}</li>)}
              </ul>
            </div>
          </Col>
        </Row>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 6 — Override / Approval Governance
// ═════════════════════════════════════════════════════════════════════════════

function GovernanceSection() {
  const stages = [
    { icon: 'ri-pencil-line',          title: 'Maker',    desc: 'Initiates rule change or salary override' },
    { icon: 'ri-eye-line',              title: 'Checker',  desc: 'Reviews the change for accuracy and policy compliance' },
    { icon: 'ri-checkbox-circle-line',  title: 'Approver', desc: 'Final sign-off. Change applied only after approval' },
  ];

  return (
    <>
      <SectionLabel>MCA GOVERNANCE CONFIGURATION</SectionLabel>

      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Maker-Checker-Approver Flow</div>
            <div className="pip-card-sub">All manual rule overrides must pass through this governance chain</div>
          </div>
        </div>

        <div className="cm-mca">
          {stages.map((s, i) => (
            <div key={s.title} className="cm-mca-stage">
              <span className={`cm-mca-icon cm-mca-icon-${i}`}><i className={s.icon} /></span>
              <div className="cm-mca-title">{s.title}</div>
              <div className="cm-mca-desc">{s.desc}</div>
            </div>
          ))}
        </div>

        <div className="pip-active-table-wrap">
          <table className="pip-active-table">
            <thead>
              <tr>
                <th>OVERRIDE TYPE</th>
                <th>MAKER</th>
                <th>CHECKER</th>
                <th>APPROVER</th>
                <th>AUDIT TRAIL</th>
              </tr>
            </thead>
            <tbody>
              {GOVERNANCE_FLOW.map(g => (
                <tr key={g.type}>
                  <td className="fw-semibold fs-13">{g.type}</td>
                  <td className="text-muted fs-13">{g.maker}</td>
                  <td className="text-muted fs-13">{g.checker}</td>
                  <td className="text-muted fs-13">{g.approver}</td>
                  <td>
                    <span className={g.audit === 'Full Audit' ? STATUS_TONE_CLASS.green : STATUS_TONE_CLASS.blue}>
                      {g.audit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Override Request Flags</div>
            <div className="pip-card-sub">System automatically flags these conditions for manual review</div>
          </div>
        </div>
        <Row className="g-3">
          {OVERRIDE_FLAGS.map(f => (
            <Col md={6} key={f.title}>
              <div className={`cm-flag cm-flag-${f.tone}`}>
                <span className="cm-flag-icon"><i className={f.icon} /></span>
                <div className="min-w-0">
                  <div className="fw-bold fs-13">{f.title}</div>
                  <div className="text-muted fs-12">{f.sub}</div>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </div>
    </>
  );
}
