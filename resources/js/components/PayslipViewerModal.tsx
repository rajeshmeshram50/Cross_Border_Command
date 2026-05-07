import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Col, Row } from 'reactstrap';
import { MasterSelect } from '../pages/master/masterFormKit';
import { useToast } from '../contexts/ToastContext';
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

export interface PayslipRecentEntry { label: string; now?: boolean }

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
  recentMonths?: PayslipRecentEntry[];
  companyName?: string;
  companyMeta?: string;
  companyInitials?: string;
  hrEmail?: string;
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
  recentMonths = [
    { label: 'Mar 2026', now: true },
    { label: 'Feb 2026' },
    { label: 'Jan 2026' },
    { label: 'Dec 2025' },
    { label: 'Nov 2025' },
    { label: 'Oct 2025' },
  ],
  companyName = 'INORBVICT Healthcare India Pvt. Ltd.',
  companyMeta = 'Pune, Maharashtra, India · GSTIN: 27XXXXXXXXXXX · CIN: U85190MH2020PTC339XXX',
  companyInitials = 'IN',
  hrEmail = 'hr@inorbvict.com',
}: PayslipViewerModalProps) {
  const [year, setYear]   = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const toast = useToast();

  // Sync defaults when the modal is reopened with a different cycle/employee.
  useEffect(() => { if (open) { setYear(defaultYear); setMonth(defaultMonth); } }, [open, defaultYear, defaultMonth]);

  if (!open) return null;

  // Header action handlers — wired to toasts since the actual PDF/print/email
  // pipeline lives server-side and isn't part of this UI-only slice.
  const fileLabel = `${employee.name.replace(/\s+/g, '_')}_${month}_${year}`;
  const handleDownload = () => toast.success('Payslip downloaded',  `${fileLabel}.pdf`);
  const handlePrint    = () => toast.success('Sent to printer',     `${employee.name} · ${month} ${year}`);
  const handleEmail    = () => toast.success('Email sent',          `Payslip emailed to ${employee.name}.`);

  const totalEarnings   = earnings.reduce((s, r) => s + r.amount, 0);
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
                <h5 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Payslip Viewer</h5>
                <small className="text-muted" style={{ fontSize: 10.5 }}>Select month and year to view or download payslip</small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" onClick={handleDownload} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', border: 'none', fontSize: 11, padding: '5px 12px', borderRadius: 7, boxShadow: '0 3px 10px rgba(10,179,156,0.28)' }}>
                <i className="ri-download-2-line" /> Download PDF
              </button>
              <button type="button" onClick={handlePrint} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-printer-line" /> Print
              </button>
              <button type="button" onClick={handleEmail} className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-mail-line" /> Email
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
                  onChange={setYear}
                />
              </div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Month</div>
                <MasterSelect
                  value={month}
                  options={MONTH_FULL.map(m => ({ value: m, label: m }))}
                  onChange={setMonth}
                />
              </div>
              <button type="button" className="ep-pay-side-btn">
                <i className="ri-eye-line me-1" /> View Payslip
              </button>

              <div className="ep-pay-side-label mt-4">Recent Payslips</div>
              <div className="d-flex flex-column gap-2">
                {recentMonths.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`ep-pay-recent${p.now ? ' is-current' : ''}`}
                    onClick={() => {
                      const [m, y] = p.label.split(' ');
                      setMonth(MONTH_ABBR_TO_FULL[m] || m);
                      setYear(y);
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
                    <span className="ep-pay-company-logo">{companyInitials}</span>
                    <div>
                      <h5 className="mb-0 text-white fw-bold" style={{ fontSize: 14 }}>{companyName}</h5>
                      <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10.5 }}>{companyMeta}</small>
                    </div>
                  </div>
                  <div className="text-end">
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYSLIP</div>
                    <h4 className="text-white mb-0 fw-bold" style={{ fontSize: 17 }}>{month} {year}</h4>
                    <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10 }}>Pay Period: 01–31 {month.slice(0,3)} {year}</small>
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

              {/* 4 KPI strip */}
              <div className="ep-pay-kpis">
                {[
                  { label: 'Working Days', value: workingDays, tint: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
                  { label: 'Days Present', value: daysPresent, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                  { label: 'Loss of Pay',  value: lossOfPay,   tint: 'rgba(245,158,11,0.10)',  fg: '#a16207' },
                  { label: 'Paid Days',    value: paidDays,    tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
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
                        {earnings.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
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
                This is a computer-generated payslip. No signature required. Queries:{' '}
                <a href={`mailto:${hrEmail}`}>{hrEmail}</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
