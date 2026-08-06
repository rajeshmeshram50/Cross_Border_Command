import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Col, Row, Spinner } from 'reactstrap';
import { MasterSelect } from '../pages/master/masterFormKit';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
// Reuses the .ep-pay-* class set already defined for the Employee Profile's
// payslip viewer so this component renders identically without duplicating
// the CSS rules.
import '../pages/employee/EmployeeProfile.css';

export interface PayslipLine { label: string; amount: number }

export interface PayslipEmployee {
  name: string;
  empId: string;
  designation: string;
  department: string;
}

export interface PayslipRecentEntry { label: string; now?: boolean; payslipId?: number; status?: string }

export interface PayslipViewerModalProps {
  open: boolean;
  onClose: () => void;
  employee: PayslipEmployee;
  /** Defaulted to 'March' / '2026' to match the screenshot's mock data. */
  defaultMonth?: string;
  defaultYear?: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  workingDays?: number;
  daysPresent?: number;
  lossOfPay?: number;
  paidDays?: number;
  /** Overtime — only rendered when the employee master marks this employee
   *  overtime-applicable. The OT Hours KPI and the "Overtime Allowance"
   *  earnings line both key off this, so staff the policy doesn't cover see
   *  neither. */
  overtimeApplicable?: boolean;
  overtimeHours?: number;
  /** Payable OT, already priced as hourly × multiplier × hours upstream. */
  overtimeAmount?: number;
  /** Hours the ATTENDANCE shows past the shift end. Differs from the paid
   *  hours whenever OT hasn't been approved as an adjustment yet — the KPI
   *  shows these (the real worked hours), the allowance shows what's payable. */
  overtimeDetectedHours?: number;
  /** OT rate multiplier from the employee's Overtime (OT) policy, e.g. 1.5. */
  overtimeMultiplier?: number;
  /** Effective per-hour OT rate (hourly × multiplier) — shown as the workings. */
  overtimeRate?: number;
  overtimeRateName?: string | null;
  recentMonths?: PayslipRecentEntry[];
  companyName?: string;
  companyMeta?: string;
  companyInitials?: string;
  hrEmail?: string;
  /** Rule 16 — when false, the slip is provisional (run not yet approved):
   *  a badge shows and Download/Email are disabled. Undefined = treat as final
   *  (back-compat for the EmployeeProfile caller). */
  isFinal?: boolean;
  /** Fired when a "Recent Payslips" entry is clicked so the parent can load
   *  that month's payslip. */
  onSelectRecent?: (entry: PayslipRecentEntry) => void;
  /** When set, Download/Print hit the real server PDF for this payslip.
   *  Without it the buttons fall back to a toast (legacy EmployeeProfile use). */
  payslipId?: number;
}

const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'] as const;
const MONTH_ABBR_TO_FULL: Record<string, string> = {
  Jan:'January', Feb:'February', Mar:'March', Apr:'April', May:'May', Jun:'June',
  Jul:'July', Aug:'August', Sep:'September', Oct:'October', Nov:'November', Dec:'December',
};

/**
 * Standalone payslip viewer modal — same visual + interaction model as the
 * one shipped inside EmployeeProfile, extracted so the HR Payroll page (and
 * any future caller) can render it without duplicating markup.
 *
 * Renders to a body-portal so it always escapes the parent stacking context.
 */
export default function PayslipViewerModal({
  open,
  onClose,
  employee,
  defaultMonth = 'March',
  defaultYear = '2026',
  earnings,
  deductions,
  workingDays = 31,
  daysPresent = 31,
  lossOfPay = 0,
  paidDays = 31,
  overtimeApplicable = false,
  overtimeHours = 0,
  overtimeDetectedHours = 0,
  overtimeAmount = 0,
  overtimeMultiplier,
  overtimeRate,
  overtimeRateName,
  recentMonths = [],
  companyName = '',
  companyMeta = '',
  companyInitials = '',
  hrEmail = '',
  isFinal,
  onSelectRecent,
  payslipId,
}: PayslipViewerModalProps) {
  const provisional = isFinal === false;
  const [year, setYear]   = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  // Which header action is in flight ('download'|'print'|'email'|'view') so
  // the button can spin + disable until it completes.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const toast = useToast();

  // Sync defaults when the modal is reopened with a different cycle/employee.
  useEffect(() => { if (open) { setYear(defaultYear); setMonth(defaultMonth); } }, [open, defaultYear, defaultMonth]);

  // Lock background scroll while the viewer is open so the underlying page
  // can't scroll behind it; restore the previous values on close/unmount.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  if (!open) return null;

  // Header action handlers. When a payslipId is supplied they hit the real
  // server-rendered PDF; otherwise (legacy EmployeeProfile use) they fall back
  // to a toast. Provisional slips can't be downloaded/emailed (Rule 16).
  const fileLabel = `${employee.name.replace(/\s+/g, '_')}_${month}_${year}`;
  const blockProvisional = () => toast.error('Payslip not final', 'This payslip is provisional — approve the payroll run first.');

  // Label ("Mon YYYY") of the payslip CURRENTLY on screen, used to highlight the
  // matching Recent Payslips entry. Previously the highlight followed each
  // entry's `now` flag (the real current month), so the current month stayed
  // highlighted even while a different period's payslip was open.
  const activeAbbr = Object.keys(MONTH_ABBR_TO_FULL).find(k => MONTH_ABBR_TO_FULL[k] === month) || month.slice(0, 3);
  const activeLabel = `${activeAbbr} ${year}`;

  const fetchPdfBlob = async () => {
    const res = await api.get(`/payroll/payslip/${payslipId}/pdf`, { responseType: 'blob' });
    return new Blob([res.data], { type: 'application/pdf' });
  };

  // Month/Year filter → load that period's payslip. We match the chosen
  // full-month + year against the Recent Payslips list (labelled "Mon YYYY")
  // and ask the parent to switch to it. Without this the filters only changed
  // the labels while View PDF kept opening the originally-opened payslip.
  const selectPeriod = (fullMonth: string, yr: string) => {
    const abbr = Object.keys(MONTH_ABBR_TO_FULL).find(k => MONTH_ABBR_TO_FULL[k] === fullMonth) || fullMonth.slice(0, 3);
    const entry = recentMonths.find(p => p.label === `${abbr} ${yr}`);
    if (entry) {
      onSelectRecent?.(entry);
    } else {
      toast.error('No payslip', `No payslip found for ${fullMonth} ${yr}.`);
    }
  };

  const handleDownload = async () => {
    if (provisional) return blockProvisional();
    if (!payslipId) return toast.success('Payslip downloaded', `${fileLabel}.pdf`);
    if (busyAction) return;
    setBusyAction('download');
    try {
      const url = URL.createObjectURL(await fetchPdfBlob());
      const a = document.createElement('a');
      a.href = url; a.download = `${fileLabel}.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Payslip downloaded', `${fileLabel}.pdf`);
    } catch {
      toast.error('Download failed', 'Could not generate the payslip PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  // Open the rendered PDF inline in a new tab (true "view" of the document).
  const handleViewPdf = async () => {
    if (!payslipId) return toast.error('Not available', 'Generate payroll to view the PDF.');
    if (busyAction) return;
    setBusyAction('view');
    try {
      const url = URL.createObjectURL(await fetchPdfBlob());
      window.open(url, '_blank');
      // Give the tab time to load before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('View failed', 'Could not open the payslip PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrint = async () => {
    if (!payslipId) return toast.success('Sent to printer', `${employee.name} · ${month} ${year}`);
    if (busyAction) return;
    setBusyAction('print');
    try {
      const url = URL.createObjectURL(await fetchPdfBlob());
      const w = window.open(url, '_blank');
      if (w) { w.onload = () => { try { w.print(); } catch { /* user can print manually */ } }; }
    } catch {
      toast.error('Print failed', 'Could not open the payslip PDF.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmail = async () => {
    if (provisional) return blockProvisional();
    if (!payslipId) return toast.success('Email sent', `Payslip emailed to ${employee.name}.`);
    if (busyAction) return;
    setBusyAction('email');
    try {
      const res = await api.post(`/payroll/payslip/${payslipId}/email`);
      toast.success('Payslip emailed', res.data?.message || `Sent to ${employee.name}.`);
    } catch (err: any) {
      toast.error('Email failed', err?.response?.data?.message || 'Could not email the payslip.');
    } finally {
      setBusyAction(null);
    }
  };

  /* Overtime. The payroll engine already folds an approved OT payout into the
     earnings breakup, so appending our own line would double it — only add one
     when the breakup doesn't already carry it. */
  const hasOtLine = earnings.some(r => /overtime/i.test(r.label));
  /* The KPI shows the hours the ATTENDANCE recorded — that's what "OT Hours"
     means to anyone reading a payslip. Overtime is no longer approval-gated:
     detected hours are paid directly, so the allowance normally matches. The
     zero-state only survives for a slip generated BEFORE that change, or one
     whose run is locked and can't recompute. */
  const otKpiHours = overtimeDetectedHours > 0 ? overtimeDetectedHours : overtimeHours;
  const otUnpaid   = overtimeApplicable && overtimeAmount <= 0 && overtimeDetectedHours > 0;
  const showOt     = overtimeApplicable && !hasOtLine && (overtimeAmount > 0 || otUnpaid);
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
  const otHoursLabel = num(otKpiHours);
  // Spell the pricing out next to the line so the figure is checkable by hand.
  const otWorkings = otUnpaid
    // Stale slip: regenerate the run to pick the overtime up.
    ? `${num(overtimeDetectedHours)} hr detected in attendance · regenerate this payroll run to include it.`
    : [
        overtimeRate ? `₹${overtimeRate.toLocaleString('en-IN')}/hr` : null,
        overtimeMultiplier ? `${overtimeMultiplier}×${overtimeRateName ? ` ${overtimeRateName}` : ''}` : null,
        `${num(overtimeHours)} hr`,
      ].filter(Boolean).join(' · ');

  const shownEarnings = showOt
    ? [...earnings, { label: 'Overtime Allowance', amount: overtimeAmount }]
    : earnings;

  const totalEarnings   = shownEarnings.reduce((s, r) => s + r.amount, 0);
  const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
  const netPay          = totalEarnings - totalDeductions;

  return createPortal(
    <div
      className="ep-modal-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        className="ep-modal-card ep-pay-modal"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%',
          maxWidth: 1180,
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div className="ep-pay-shell">
          {/* Header bar */}
          <div className="ep-pay-header">
            <div className="d-flex align-items-center gap-3">
              <span className="ep-pay-logo">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <h5 className="mb-0 fw-bold d-inline-flex align-items-center gap-2" style={{ fontSize: 13 }}>
                  Payslip Viewer
                  {provisional && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: '#a06f00', background: '#fdf3d6', border: '1px solid #f0d990', borderRadius: 999, padding: '2px 8px' }}>
                      PROVISIONAL
                    </span>
                  )}
                </h5>
                <small className="text-muted" style={{ fontSize: 10.5 }}>
                  {provisional ? 'Draft — approve the payroll run to finalize this slip' : 'Select month and year to view or download payslip'}
                </small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" onClick={handleDownload} disabled={!!busyAction} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', border: 'none', fontSize: 11, padding: '5px 12px', borderRadius: 7, boxShadow: '0 3px 10px rgba(10,179,156,0.28)', opacity: busyAction ? 0.7 : 1 }}>
                {busyAction === 'download' ? <Spinner size="sm" style={{ width: 12, height: 12 }} /> : <i className="ri-download-2-line" />} Download PDF
              </button>
              <button type="button" onClick={handlePrint} disabled={!!busyAction} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7, opacity: busyAction ? 0.7 : 1 }}>
                {busyAction === 'print' ? <Spinner size="sm" style={{ width: 12, height: 12 }} /> : <i className="ri-printer-line" />} Print
              </button>
              <button type="button" onClick={handleEmail} disabled={!!busyAction} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7, opacity: busyAction ? 0.7 : 1 }}>
                {busyAction === 'email' ? <Spinner size="sm" style={{ width: 12, height: 12 }} /> : <i className="ri-mail-line" />} Email
              </button>
              <button type="button" className="ep-pay-x" onClick={onClose} aria-label="Close">
                <i className="ri-close-line" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>

          {/* Body — sidebar + payslip preview */}
          <div className="ep-pay-body">
            {/* Sidebar */}
            <aside className="ep-pay-sidebar">
              <div className="ep-pay-side-label">Filter</div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Year</div>
                <MasterSelect
                  value={year}
                  options={['2026','2025','2024'].map(y => ({ value: y, label: y }))}
                  onChange={(y) => { setYear(y); selectPeriod(month, y); }}
                />
              </div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Month</div>
                <MasterSelect
                  value={month}
                  options={MONTH_FULL.map(m => ({ value: m, label: m }))}
                  onChange={(m) => { setMonth(m); selectPeriod(m, year); }}
                />
              </div>
              <button type="button" className="ep-pay-side-btn" onClick={handleViewPdf} disabled={!!busyAction} style={busyAction ? { opacity: 0.7 } : undefined}>
                {busyAction === 'view' ? <Spinner size="sm" className="me-1" style={{ width: 12, height: 12 }} /> : <i className="ri-eye-line me-1" />} View PDF
              </button>

              <div className="ep-pay-side-label mt-4">Recent Payslips</div>
              <div className="d-flex flex-column gap-2">
                {recentMonths.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`ep-pay-recent${p.label === activeLabel ? ' is-current' : ''}`}
                    onClick={() => {
                      const [m, y] = p.label.split(' ');
                      setMonth(MONTH_ABBR_TO_FULL[m] || m);
                      setYear(y);
                      onSelectRecent?.(p);
                    }}
                  >
                    <span>{p.label}</span>
                    {p.now ? <span className="ep-pay-now">NOW</span> : <i className="ri-arrow-right-s-line" />}
                  </button>
                ))}
              </div>
            </aside>

            {/* Payslip preview */}
            <div className="ep-pay-preview">
              {/* Company hero */}
              <div className="ep-pay-company">
                <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                <div className="d-flex align-items-start justify-content-between gap-3" style={{ position: 'relative', zIndex: 1 }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-pay-company-logo">{companyInitials || (companyName ? companyName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : 'CO')}</span>
                    <div>
                      <h5 className="mb-0 text-white fw-bold" style={{ fontSize: 14 }}>{companyName}</h5>
                      <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10.5 }}>{companyMeta}</small>
                    </div>
                  </div>
                  <div className="text-end">
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYSLIP</div>
                    <h4 className="text-white mb-0 fw-bold" style={{ fontSize: 17 }}>{month} {year}</h4>
                    <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>Pay Period: 01–31 {month.slice(0,3)} {year}</small>
                  </div>
                </div>

                {/* Inner identity strip */}
                <div className="ep-pay-identity">
                  {[
                    { label: 'Employee Name', value: employee.name },
                    { label: 'Employee ID',   value: employee.empId },
                    { label: 'Designation',   value: employee.designation },
                    { label: 'Department',    value: employee.department },
                    { label: 'Pay Period',    value: `${month.slice(0,3)} ${year}` },
                  ].map(c => (
                    <div className="ep-pay-identity-cell" key={c.label}>
                      <div className="ep-pay-identity-label">{c.label}</div>
                      <div className="ep-pay-identity-value">{c.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* KPI strip — 4 normally, 5 when overtime applies to this
                  employee (OT Hours sits after Paid Days). */}
              <div className="ep-pay-kpis">
                {[
                  { label: 'Total Days', value: workingDays, tint: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
                  { label: 'Days Present', value: daysPresent, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                  { label: 'Loss of Pay',  value: lossOfPay,   tint: 'rgba(245,158,11,0.10)',  fg: '#a16207' },
                  { label: 'Paid Days',    value: paidDays,    tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                  ...(overtimeApplicable
                    ? [{ label: 'OT Hours', value: otHoursLabel, tint: 'rgba(124,92,252,0.10)', fg: '#6d28d9' }]
                    : []),
                ].map(k => (
                  <div className="ep-pay-kpi" key={k.label} style={{ background: k.tint }}>
                    <div className="ep-pay-kpi-label">{k.label}</div>
                    <div className="ep-pay-kpi-value" style={{ color: k.fg }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Earnings + Deductions */}
              <Row className="g-2 mb-2">
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#10b981' }} />
                      <span style={{ color: '#108548' }}>EARNINGS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {shownEarnings.map(r => {
                          const isOt = r.label === 'Overtime Allowance';
                          return (
                            <tr key={r.label}>
                              <td>
                                {r.label}
                                {isOt && otWorkings && (
                                  <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                                    {otWorkings}
                                  </div>
                                )}
                              </td>
                              <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(16,185,129,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#108548' }}>Total Earnings</td>
                          <td className="text-end fw-bold" style={{ color: '#108548' }}>₹{totalEarnings.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#ef4444' }} />
                      <span style={{ color: '#b91c1c' }}>DEDUCTIONS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {deductions.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(239,68,68,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#b91c1c' }}>Total Deductions</td>
                          <td className="text-end fw-bold" style={{ color: '#b91c1c' }}>₹{totalDeductions.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
              </Row>

              {/* Net Pay banner */}
              <div className="ep-pay-net">
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>
                    NET PAY — {month.toUpperCase()} {year}
                  </div>
                  <h5 className="text-white fw-semibold mb-2" style={{ fontSize: 12 }}>Gross Earnings − Total Deductions</h5>
                  <div className="d-flex gap-3">
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>GROSS</div>
                      <div className="text-white fw-bold" style={{ fontSize: 12 }}>₹{totalEarnings.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>DEDUCTIONS</div>
                      <div className="fw-bold" style={{ color: '#fecaca', fontSize: 12 }}>−₹{totalDeductions.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0" style={{ fontSize: 26 }}>
                    ₹{netPay.toLocaleString('en-IN')}
                  </h2>
                  <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10 }}>Per Month (In Hand)</small>
                </div>
              </div>

              <div className="ep-pay-footer">
                This is a computer-generated payslip. No signature required.
                {hrEmail ? <> Queries: <a href={`mailto:${hrEmail}`}>{hrEmail}</a></> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
