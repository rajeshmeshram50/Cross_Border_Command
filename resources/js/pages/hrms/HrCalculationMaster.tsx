 import { useMemo, useState } from 'react';
import { Col, Row } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
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

// Bundle of currently-active rules — the engine reads from this instead of
// the module-level constants so editing a threshold in the UI immediately
// re-runs the preview against the new value.
interface RuleState {
  ptRules:        typeof PT_RULES;
  leaveRules:     typeof LEAVE_RULES;
  lateConfig:     typeof LATE_CONFIG;
  overtimeConfig: typeof OVERTIME_CONFIG;
}

const DEFAULT_RULES: RuleState = {
  ptRules:        PT_RULES,
  leaveRules:     LEAVE_RULES,
  lateConfig:     LATE_CONFIG,
  overtimeConfig: OVERTIME_CONFIG,
};

function computePT(gender: string, salary: number, rules = PT_RULES): number {
  const rule = rules.find(r => r.gender === gender);
  if (!rule || salary <= rule.threshold) return 0;
  return rule.amount;
}

function computeLeave(role: string, leaves: number, salary: number, rules = LEAVE_RULES) {
  const rule = rules.find(r => r.role === role);
  const free = rule?.free ?? 0;
  const excess = Math.max(0, leaves - free);
  const deduction = Math.round(excess * (salary / WORKING_DAYS));
  return { excess, deduction };
}

function computeLate(lateMarks: number, salary: number, cfg = LATE_CONFIG) {
  const halfDays = cfg.threshold > 0 ? Math.floor(lateMarks / cfg.threshold) : 0;
  const halfDayRate = (salary / WORKING_DAYS) * 0.5;
  return { halfDays, deduction: Math.round(halfDays * halfDayRate) };
}

function computeOvertime(hours: number, salary: number, cfg = OVERTIME_CONFIG) {
  const hourly = salary / WORKING_DAYS / HOURS_PER_DAY;
  return Math.round(hours * hourly * cfg.multiplier);
}

function computeAll(input: PayInputs, rules: RuleState = DEFAULT_RULES): PayResults {
  const pt    = computePT(input.gender, input.salary, rules.ptRules);
  const leave = computeLeave(input.role, input.leaves, input.salary, rules.leaveRules);
  const late  = computeLate(input.lateMarks, input.salary, rules.lateConfig);
  const ot    = computeOvertime(input.overtimeHrs, input.salary, rules.overtimeConfig);
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

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════

export default function HrCalculationMaster() {
  const toast = useToast();
  const [section, setSection] = useState<SectionKey>('pt');

  // Editable rule state — seeded from the PT_RULES / LEAVE_RULES /
  // LATE_CONFIG / OVERTIME_CONFIG / DEDUCTION_TRIGGERS constants up top.
  // Real backend hookup is `useEffect(api.get(...))` → setPtRules(...) etc.
  const [ptRules,         setPtRules]         = useState(PT_RULES);
  const [leaveRules,      setLeaveRules]      = useState(LEAVE_RULES);
  const [lateConfig,      setLateConfig]      = useState(LATE_CONFIG);
  const [overtimeConfig,  setOvertimeConfig]  = useState(OVERTIME_CONFIG);
  const [deductTriggers,  setDeductTriggers]  = useState(DEDUCTION_TRIGGERS);

  const [inputs, setInputs] = useState<PayInputs>({
    role: 'Team Lead',
    gender: 'Male',
    salary: 25000,
    leaves: 3,
    lateMarks: 6,
    overtimeHrs: 4,
  });

  // Re-run the engine whenever any input OR rule changes — drives the
  // right-panel preview. Rules in state mean tweaking a threshold here
  // immediately shows its effect on the preview. No save needed to test.
  const results = useMemo(
    () => computeAll(inputs, { ptRules, leaveRules, lateConfig, overtimeConfig }),
    [inputs, ptRules, leaveRules, lateConfig, overtimeConfig],
  );

  const handleSaveRules = () => {
    // Wire to POST /api/payroll/rules later. For now, mock-confirm.
    toast.success('Rules saved', 'Payroll calculation rules updated successfully');
  };

  return (
    <Row>
      <Col xs={12}>
        <div className="rec-page cm-page">
          {/* ── Hero header — same .onb-hero-card structure used by HrPIP /
              HrLeave / HrExpenseManagement, but with this page's blue→magenta
              accent gradient (also reused on the icon and Run Preview button
              so the three elements feel like one design system). */}
          <div
            className="onb-hero-card mb-3"
            style={{ background: 'linear-gradient(177deg, #d99af1 0%, #ede4ff 100%)', borderColor: '#e3d6ff' }}
          >
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{ width: 48, height: 48, background: 'linear-gradient(149deg, rgb(31,73,167) 0%, rgb(210,4,206) 100%)', boxShadow: '0 8px 18px rgba(120,40,180,0.32)' }}
              >
                <i className="ri-stack-line" style={{ color: '#fff', fontSize: 22 }} />
              </span>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Calculation Master</h5>
                  <span className="pip-pill pip-pill-warn"><span className="dot" />Rule Engine</span>
                </div>
                <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                  Time &amp; Pay Inputs · Payroll Rule Engine · Live preview engine
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button type="button" className="rec-btn-ghost" onClick={handleSaveRules}>
                <i className="ri-save-line" />Save Rules
              </button>
              <button
                type="button"
                className="pip-btn-initiate"
                style={{ background: 'linear-gradient(149deg, rgb(31,73,167) 0%, rgb(210,4,206) 100%)', boxShadow: '0 6px 14px rgba(120,40,180,0.32)' }}
              >
                <i className="ri-play-circle-line" />Run Preview
              </button>
            </div>
          </div>

          {/* ── Top tabs — same .rec-tab-track pattern Recruitment / Exit
              Management use, so this page reads as part of the same module
              family instead of inventing a custom sidebar. */}
          <div className="rec-tab-track mb-3">
            {SECTIONS.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={`rec-tab ${section === s.key ? 'is-active in-progress' : ''}`}
              >
                <i className={s.icon} />
                {s.title}
              </button>
            ))}
          </div>

          {/* ── 2-column body — content + live preview ── */}
          <Row className="g-3">
            <Col xl={9} lg={8}>
              {section === 'pt'         && <PtSection         rules={ptRules}        setRules={setPtRules} />}
              {section === 'leave'      && <LeaveSection      rules={leaveRules}     setRules={setLeaveRules} />}
              {section === 'late'       && <LateSection       config={lateConfig}    setConfig={setLateConfig} />}
              {section === 'overtime'   && <OvertimeSection   config={overtimeConfig} setConfig={setOvertimeConfig} />}
              {section === 'deduction'  && <DeductionSection  triggers={deductTriggers} setTriggers={setDeductTriggers} />}
              {section === 'governance' && <GovernanceSection />}
            </Col>
            <Col xl={3} lg={4}>
              <RulePreview inputs={inputs} setInputs={setInputs} results={results} />
            </Col>
          </Row>
        </div>
      </Col>
    </Row>
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

function PtSection({ rules, setRules }: {
  rules: typeof PT_RULES;
  setRules: React.Dispatch<React.SetStateAction<typeof PT_RULES>>;
}) {
  // Inline patch helper — keeps the table cells terse while still
  // immutably updating one field of one row.
  const patch = (idx: number, field: 'threshold' | 'amount', value: number) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  return (
    <>
      <SectionLabel>PROFESSIONAL TAX CONFIGURATION</SectionLabel>

      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Professional Tax Rules</div>
            <div className="pip-card-sub">PT applied based on gender and monthly gross salary threshold — edit a value to see it reflect in the right-side preview instantly.</div>
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
              {rules.map((r, i) => (
                <tr key={r.gender}>
                  <td><span className={STATUS_TONE_CLASS.blue}>{r.gender}</span></td>
                  <td>
                    <div className="d-flex align-items-center gap-1">
                      <span className="text-muted fs-13">&gt;</span>
                      <input
                        type="number"
                        className="form-control form-control-sm cm-input cm-input-narrow"
                        value={r.threshold}
                        onChange={e => patch(i, 'threshold', Number(e.target.value) || 0)}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-1">
                      <input
                        type="number"
                        className="form-control form-control-sm cm-input cm-input-narrow"
                        value={r.amount}
                        onChange={e => patch(i, 'amount', Number(e.target.value) || 0)}
                      />
                      <span className="text-muted fs-13">/ month</span>
                    </div>
                  </td>
                  <td><span className={STATUS_TONE_CLASS.green}>● Active</span></td>
                  <td className="text-muted fs-13">{r.note}</td>
                </tr>
              ))}
              <tr>
                <td className="text-muted fs-13">Below threshold (any gender)</td>
                <td className="cm-cell-mono">₹0</td>
                <td>—</td>
                <td><span className={STATUS_TONE_CLASS.amber}>Exempt</span></td>
                <td className="text-muted fs-13">PT not applicable</td>
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
        {/* Reuses .rec-page-kpis / .rec-kpi-card from recruitment.css.
            Palette tuned to the page hero (blue→magenta): rose for female,
            indigo for male, slate for exempt — feels like one design system
            instead of three random brand colours. */}
        <Row className="g-3 rec-page-kpis">
          {(() => {
            const female = rules.find(r => r.gender === 'Female');
            const male   = rules.find(r => r.gender === 'Male');
            return (<>
          <Col md={4}>
            <div className="rec-kpi-card h-100">
              <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#ec4899,#f472b6)' }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">Female · &gt; ₹{female?.threshold.toLocaleString('en-IN')}</span>
                <span className="rec-kpi-num" style={{ color: '#db2777' }}>₹{female?.amount}</span>
                <span className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>PT Deducted</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: 'linear-gradient(135deg,#fce7f3,#fbcfe8)', color: '#db2777' }}>
                <i className="ri-women-line" />
              </span>
            </div>
          </Col>
          <Col md={4}>
            <div className="rec-kpi-card h-100">
              <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">Male · &gt; ₹{male?.threshold.toLocaleString('en-IN')}</span>
                <span className="rec-kpi-num" style={{ color: '#5b21b6' }}>₹{male?.amount}</span>
                <span className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>PT Deducted</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: 'linear-gradient(135deg,#ede9fe,#ddd6fe)', color: '#5b21b6' }}>
                <i className="ri-men-line" />
              </span>
            </div>
          </Col>
          <Col md={4}>
            <div className="rec-kpi-card h-100">
              <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#64748b,#94a3b8)' }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">Below Threshold</span>
                <span className="rec-kpi-num" style={{ color: '#475569' }}>₹0</span>
                <span className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>PT Exempt</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: 'linear-gradient(135deg,#f1f5f9,#e2e8f0)', color: '#475569' }}>
                <i className="ri-prohibited-line" />
              </span>
            </div>
          </Col>
            </>);
          })()}
        </Row>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 2 — Leave Deduction
// ═════════════════════════════════════════════════════════════════════════════

function LeaveSection({ rules, setRules }: {
  rules: LeaveRule[];
  setRules: React.Dispatch<React.SetStateAction<LeaveRule[]>>;
}) {
  const patchFree = (idx: number, value: number) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, free: value } : r));
  };

  return (
    <>
      <SectionLabel>LEAVE DEDUCTION CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Role-wise Leave Deduction Rules</div>
            <div className="pip-card-sub">Maximum free leaves allowed per month before salary deduction kicks in — edit a row to change the free quota for that role.</div>
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
              {rules.map((r, i) => (
                <tr key={r.role}>
                  <td><span className={STATUS_TONE_CLASS.blue}>{r.role}</span></td>
                  <td>
                    <div className="d-flex align-items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        className="form-control form-control-sm cm-input cm-input-narrow"
                        value={r.free}
                        onChange={e => patchFree(i, Number(e.target.value) || 0)}
                      />
                      <span className="text-muted fs-13">days</span>
                    </div>
                  </td>
                  <td className="text-muted fs-13">{r.logic}</td>
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

function LateSection({ config, setConfig }: {
  config: typeof LATE_CONFIG;
  setConfig: React.Dispatch<React.SetStateAction<typeof LATE_CONFIG>>;
}) {
  return (
    <>
      <SectionLabel>LATE MARK CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Late Mark → Half-Day Conversion Rules</div>
            <div className="pip-card-sub">Defines how accumulated late marks convert into salary deductions — change the threshold to retune the policy.</div>
          </div>
        </div>

        <Row className="g-3 mb-3">
          <Col md={6}>
            <label className="cm-label cm-label-block">CONVERSION THRESHOLD</label>
            <div className="d-flex align-items-center gap-2">
              <input
                type="number"
                min={1}
                className="form-control form-control-sm cm-input cm-input-narrow"
                value={config.threshold}
                onChange={e => setConfig(c => ({ ...c, threshold: Math.max(1, Number(e.target.value) || 1) }))}
              />
              <span className="text-muted fs-13">late marks =</span>
              <input
                type="number"
                min={1}
                className="form-control form-control-sm cm-input cm-input-narrow"
                value={config.halfDays}
                onChange={e => setConfig(c => ({ ...c, halfDays: Math.max(1, Number(e.target.value) || 1) }))}
              />
              <span className="text-muted fs-13">half-day</span>
            </div>
          </Col>
          <Col md={6}>
            <label className="cm-label cm-label-block">REMAINDER HANDLING</label>
            <select
              className="form-select form-select-sm cm-input"
              value={config.remainder}
              onChange={e => setConfig(c => ({ ...c, remainder: e.target.value }))}
            >
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
                <td>Every {config.threshold} late marks</td>
                <td><span className={STATUS_TONE_CLASS.amber}>{config.halfDays} half-day deduction</span></td>
                <td className="cm-cell-mono fs-12">floor(late_marks / {config.threshold})</td>
                <td className="cm-cell-mono fs-12">× (salary / working_days × 0.5)</td>
              </tr>
              <tr>
                <td>Remaining late marks</td>
                <td><span className={STATUS_TONE_CLASS.blue}>{config.remainder}</span></td>
                <td className="cm-cell-mono fs-12">late_marks mod {config.threshold}</td>
                <td className="cm-cell-mono fs-12">₹0 (no deduction)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="cm-formula">
          <span className="cm-formula-key">Half_Day_Cuts</span> = floor(late_marks / {config.threshold}) &nbsp;
          <span className="cm-formula-key">Late_Deduction</span> = Half_Day_Cuts × (gross_salary / 26 × 0.5) &nbsp;
          <span className="cm-formula-key">Carry_Forward</span> = late_marks mod {config.threshold}
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 4 — Overtime Rules
// ═════════════════════════════════════════════════════════════════════════════

function OvertimeSection({ config, setConfig }: {
  config: typeof OVERTIME_CONFIG;
  setConfig: React.Dispatch<React.SetStateAction<typeof OVERTIME_CONFIG>>;
}) {
  // Multiplier dropdown stores the label, but the engine needs the number.
  // Map both directions in one place so the UI <-> state contract is clear.
  const multiplierFromLabel = (label: string): number =>
    label.startsWith('1.25') ? 1.25 : label.startsWith('2') ? 2 : 1.5;

  return (
    <>
      <SectionLabel>OVERTIME CONFIGURATION</SectionLabel>

      <div className="pip-card">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Overtime Eligibility &amp; Rate Rules</div>
            <div className="pip-card-sub">Overtime applicable on approved hours beyond standard shift — change the multiplier to retune OT rates.</div>
          </div>
        </div>

        <Row className="g-3 mb-3">
          <Col md={4}>
            <label className="cm-label cm-label-block">ELIGIBLE AFTER (HRS/DAY)</label>
            <input
              type="number"
              min={1}
              max={12}
              className="form-control form-control-sm cm-input"
              value={config.eligibleAfter}
              onChange={e => setConfig(c => ({ ...c, eligibleAfter: Number(e.target.value) || 0 }))}
            />
          </Col>
          <Col md={4}>
            <label className="cm-label cm-label-block">OT RATE MULTIPLIER</label>
            <select
              className="form-select form-select-sm cm-input"
              value={config.multiplierLabel}
              onChange={e => setConfig(c => ({ ...c, multiplierLabel: e.target.value, multiplier: multiplierFromLabel(e.target.value) }))}
            >
              <option>1.25× hourly rate</option>
              <option>1.5× hourly rate</option>
              <option>2× hourly rate (weekends)</option>
            </select>
          </Col>
          <Col md={4}>
            <label className="cm-label cm-label-block">APPROVAL REQUIRED</label>
            <select
              className="form-select form-select-sm cm-input"
              value={config.approval}
              onChange={e => setConfig(c => ({ ...c, approval: e.target.value }))}
            >
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
                <td className="text-muted fs-13">Hours beyond shift duration</td>
                <td><span className={STATUS_TONE_CLASS.green}>{config.multiplier}× hourly</span></td>
                <td className="cm-cell-mono fs-12">ot_hrs × (salary/26/8) × {config.multiplier}</td>
              </tr>
              <tr>
                <td>Intern / Probation</td>
                <td className="text-muted fs-13">Not eligible for OT pay</td>
                <td><span className={STATUS_TONE_CLASS.amber}>Not eligible</span></td>
                <td className="cm-cell-mono fs-12">₹0</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="cm-formula">
          <span className="cm-formula-key">OT_Amount</span> = ot_hours × (gross_salary / 26 / 8) × {config.multiplier} &nbsp;
          <span className="cm-formula-key">Hourly_Rate</span> = gross_salary / 26 working days / 8 hrs per day
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 5 — Deduction & Salary Hold
// ═════════════════════════════════════════════════════════════════════════════

function DeductionSection({ triggers, setTriggers }: {
  triggers: DeductionTrigger[];
  setTriggers: React.Dispatch<React.SetStateAction<DeductionTrigger[]>>;
}) {
  const patch = <K extends keyof DeductionTrigger>(idx: number, field: K, value: DeductionTrigger[K]) => {
    setTriggers(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };

  return (
    <>
      <SectionLabel>DEDUCTION &amp; SALARY HOLD RULES</SectionLabel>

      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Salary Hold &amp; Deduction Triggers</div>
            <div className="pip-card-sub">Conditions that block or modify payroll disbursement — edit any field to update the policy.</div>
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
              {triggers.map((t, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      className="form-control form-control-sm cm-input"
                      value={t.trigger}
                      onChange={e => patch(i, 'trigger', e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className="form-select form-select-sm cm-input"
                      value={t.action}
                      onChange={e => patch(i, 'action', e.target.value)}
                    >
                      <option>Salary Hold</option>
                      <option>F&amp;F Deduction</option>
                      <option>Deduction from F&amp;F</option>
                      <option>Payroll Block</option>
                      <option>Recovery from Salary</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select form-select-sm cm-input"
                      value={t.severity}
                      onChange={e => patch(i, 'severity', e.target.value as DeductionTrigger['severity'])}
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-control form-control-sm cm-input"
                      value={t.approval}
                      onChange={e => patch(i, 'approval', e.target.value)}
                    />
                  </td>
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
  return (
    <>
      <SectionLabel>MCA GOVERNANCE CONFIGURATION</SectionLabel>

      {/* Reuses the existing .pip-mca-card stepper pattern from HrPIP's
          wizard so this page's governance flow looks identical to the
          one HR already knows. Same Bootstrap "Progress with Steps"
          markup — three round buttons centred at 16.67% / 50% / 83.33%
          with a 2px progress line connecting them. */}
      <div className="pip-mca-card mb-3">
        <div className="pip-mca-title">
          <i className="ri-shield-line" />Maker → Checker → Approver Governance Chain
        </div>

        <div className="position-relative mt-4 mb-3 pip-mca-progress" style={{ marginLeft: '16.67%', marginRight: '16.67%' }}>
          <div className="progress" style={{ height: '2px' }}>
            <div className="progress-bar bg-primary" role="progressbar" style={{ width: '50%' }} aria-valuenow={50} aria-valuemin={0} aria-valuemax={100} />
          </div>
          <button type="button" className="position-absolute top-0 start-0 translate-middle btn btn-sm btn-primary rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Maker (HR Exec)">
            <i className="ri-user-3-line" />
          </button>
          <button type="button" className="position-absolute top-0 start-50 translate-middle btn btn-sm btn-primary rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Checker (HR Manager)">
            <i className="ri-shield-user-line" />
          </button>
          <button type="button" className="position-absolute top-0 start-100 translate-middle btn btn-sm btn-light rounded-pill d-inline-flex align-items-center justify-content-center" style={{ width: '2.4rem', height: '2.4rem' }} title="Approver (Finance Head / HR Head)">
            <i className="ri-shield-check-line" />
          </button>
        </div>

        <Row className="text-center g-2 mt-4">
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Maker (HR Exec)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Initiates rule / salary override</div>
          </Col>
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Checker (HR Manager)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Reviews &amp; validates</div>
          </Col>
          <Col xs={4}>
            <div className="fw-semibold" style={{ fontSize: 13 }}>Approver (HR / Finance Head)</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Final sign-off</div>
          </Col>
        </Row>
      </div>

      {/* Per-override-type approval matrix — separate card from the MCA stepper. */}
      <div className="pip-card mb-3">
        <div className="pip-card-head">
          <div>
            <div className="pip-card-title">Override Approval Matrix</div>
            <div className="pip-card-sub">Who plays which role for each override type</div>
          </div>
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
