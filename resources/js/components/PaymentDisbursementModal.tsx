import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

/**
 * "Proceed to Pay" disbursement flow:
 *   mode select → payment advice (cheque) / NEFT batch (online) → 3-level
 *   sign-off → initiate → success. Backed by /payroll/payment/* endpoints.
 */
export interface PaymentDisbursementModalProps {
  open: boolean;
  onClose: () => void;
  runId: number | null;
  cycleLabel: string;
  /** Fired after a successful initiate so the parent can refresh the cycle. */
  onPaid?: () => void;
}

type Step = 'mode' | 'advice' | 'approval' | 'success';
interface AdviceRow { payslip_id: number; name: string; emp_code: string; department: string | null; bank: string | null; account: string | null; ifsc: string | null; amount: number; status: 'Ready' | 'Held'; }
interface Payment { id: number; mode: 'cheque' | 'online'; status: string; company_name: string; bank_name: string | null; period: string | null; eligible_count: number; held_count: number; total_count: number; total: number; rows: AdviceRow[]; batch_ref: string | null; }

const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const fmtShort = (n: number) => { if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`; if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`; if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`; return `₹${Math.round(n)}`; };
const ACCENTS = ['#7c5cfc', '#0ab39c', '#3b82f6', '#f59e0b', '#e83e8c', '#0c63b0', '#108548', '#a06f00'];

export default function PaymentDisbursementModal({ open, onClose, runId, cycleLabel, onPaid }: PaymentDisbursementModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('mode');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState({ prepared_by: '', verified_by: '', approved_by: '' });
  const [result, setResult] = useState<{ paid: number; held: number; batch_ref: string } | null>(null);

  useEffect(() => {
    if (open) { setStep('mode'); setPayment(null); setPrep({ prepared_by: '', verified_by: '', approved_by: '' }); setResult(null); }
  }, [open]);

  const readyRows = useMemo(() => payment?.rows.filter(r => r.status === 'Ready') ?? [], [payment]);

  if (!open) return null;

  const choose = async (mode: 'cheque' | 'online') => {
    if (!runId) return;
    setBusy(true);
    try {
      const res = await api.post('/payroll/payment/prepare', { run_id: runId, mode });
      setPayment(res.data?.data);
      setStep('advice');
    } catch (err: any) {
      toast.error('Could not prepare payment', err?.response?.data?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const submitApproval = async () => {
    if (!payment) return;
    if (!prep.prepared_by.trim() || !prep.verified_by.trim() || !prep.approved_by.trim()) {
      toast.error('All three approvals required', 'Prepared, Verified and Approved are mandatory.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/payroll/payment/${payment.id}/approve`, prep);
      const res = await api.post(`/payroll/payment/${payment.id}/initiate`);
      const d = res.data?.data ?? {};
      setResult({ paid: d.paid ?? 0, held: d.held ?? 0, batch_ref: d.batch_ref ?? '' });
      setStep('success');
      onPaid?.();
    } catch (err: any) {
      toast.error('Payment failed', err?.response?.data?.message || 'Could not initiate payment.');
    } finally { setBusy(false); }
  };

  const exportExcel = async () => {
    if (!payment) return;
    try {
      const XLSX = await import('xlsx');
      const sheet = payment.rows.map((r, i) => ({ 'Sr': i + 1, 'Employee': r.name, 'Emp Code': r.emp_code, 'Department': r.department, 'Account': r.account, 'IFSC': r.ifsc, 'Amount': r.amount, 'Status': r.status }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Payment Advice');
      XLSX.writeFile(wb, `PaymentAdvice_${cycleLabel.replace(' ', '_')}.xlsx`);
      toast.success('Excel ready', 'Payment advice exported.');
    } catch { toast.error('Export failed', 'Could not build the Excel file.'); }
  };

  const exportBankFile = async () => {
    if (!payment) return;
    try {
      const res = await api.get(`/payroll/payment/${payment.id}/bank-file`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `BankFile_${cycleLabel.replace(' ', '_')}.csv`; a.click(); URL.revokeObjectURL(url);
      toast.success('Bank file ready', 'NEFT bank file downloaded.');
    } catch (err: any) { toast.error('Export failed', err?.response?.data?.message || 'Could not generate the bank file.'); }
  };

  const shell = (children: React.ReactNode, maxW: number) => createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--vz-card-bg,#fff)', color: 'var(--vz-body-color)', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', width: '100%', maxWidth: maxW, maxHeight: 'calc(100vh - 32px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>, document.body);

  // ── STEP: MODE SELECT ──
  if (step === 'mode') {
    return shell(<>
      <Header icon="ri-bank-card-line" title="Proceed to Pay" sub={`${cycleLabel} · Salary Disbursement`} onClose={onClose} />
      <div style={{ padding: 20 }}>
        <div className="text-uppercase fw-bold mb-2" style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--vz-secondary-color)' }}>Select Payment Mode</div>
        <div className="d-flex gap-3 flex-wrap">
          <ModeCard icon="ri-mail-send-line" tint="#ece6ff" fg="#5a3fd1" title="Cheque / Letter" sub="Print payment advice" disabled={busy} onClick={() => choose('cheque')} />
          <ModeCard icon="ri-bank-line" tint="#d6f4e3" fg="#0a8a78" title="Online Transfer" sub="Bank file / NEFT batch" disabled={busy} onClick={() => choose('online')} />
        </div>
        {busy && <div className="text-center mt-3 text-muted" style={{ fontSize: 12.5 }}><i className="ri-loader-4-line" /> Preparing…</div>}
      </div>
    </>, 560);
  }

  // ── STEP: ADVICE / BATCH ──
  if (step === 'advice' && payment) {
    const online = payment.mode === 'online';
    return shell(<>
      <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="d-flex align-items-center gap-2">
          <span className="d-inline-flex align-items-center justify-content-center rounded" style={{ width: 38, height: 38, background: online ? '#d6f4e3' : '#ece6ff', color: online ? '#0a8a78' : '#5a3fd1' }}><i className={online ? 'ri-bank-line' : 'ri-mail-line'} style={{ fontSize: 18 }} /></span>
          <div>
            <h5 className="mb-0 fw-bold" style={{ fontSize: 15 }}>{online ? 'Online Transfer · NEFT / Bank Batch' : 'Cheque / Payment Advice Letter'}</h5>
            <small className="text-muted" style={{ fontSize: 11.5 }}>{payment.company_name} · {payment.period} · {payment.eligible_count} employees · {fmtShort(payment.total)}</small>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
      </div>

      <div style={{ padding: '8px 22px', background: 'var(--vz-secondary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--vz-border-color)' }}>
        <span className="fw-semibold" style={{ fontSize: 13 }}>Total: <span style={{ color: '#108548' }}>₹{fmtINR(payment.total)}</span> · Employees: {payment.eligible_count}{payment.held_count > 0 ? ` · ${payment.held_count} held` : ''}</span>
        <span className="badge rounded-pill" style={{ background: '#d6f4e3', color: '#108548' }}>{readyRows.length} ready</span>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table className="table align-middle table-nowrap mb-0" style={{ fontSize: 13 }}>
          <thead className="table-light" style={{ position: 'sticky', top: 0 }}>
            <tr><th className="ps-3">Employee</th><th>Bank</th><th>Account</th>{!online && <th>IFSC</th>}<th className="text-end">Amount</th><th className="text-center pe-3">Status</th></tr>
          </thead>
          <tbody>
            {payment.rows.map((r, i) => (
              <tr key={r.payslip_id}>
                <td className="ps-3">
                  <div className="d-flex align-items-center gap-2">
                    <span className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0" style={{ width: 30, height: 30, fontSize: 11, background: ACCENTS[i % ACCENTS.length] }}>{(r.name || 'NA').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                    <div><div className="fw-semibold">{r.name}</div><div className="text-muted" style={{ fontSize: 11 }}>{r.department || r.emp_code}</div></div>
                  </div>
                </td>
                <td>{r.bank || <span className="text-danger">— Missing —</span>}</td>
                <td className="font-monospace" style={{ fontSize: 12 }}>{r.account || '–'}</td>
                {!online && <td className="font-monospace" style={{ fontSize: 12 }}>{r.ifsc || '–'}</td>}
                <td className="text-end fw-bold" style={{ color: '#108548' }}>₹{fmtINR(r.amount)}</td>
                <td className="text-center pe-3"><span className="badge rounded-pill" style={r.status === 'Ready' ? { background: '#eef2f6', color: '#5b6478' } : { background: '#fde7e3', color: '#b1401d' }}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '12px 22px', borderTop: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-light btn-sm fw-semibold" onClick={online ? exportBankFile : exportExcel}>
          <i className={online ? 'ri-download-2-line me-1' : 'ri-file-excel-2-line me-1'} /> {online ? 'Export Bank File' : 'Export Excel'}
        </button>
        {!online && <button type="button" className="btn btn-light btn-sm fw-semibold" onClick={exportExcel}><i className="ri-file-excel-2-line me-1" /> Excel</button>}
        <button type="button" className="btn btn-sm fw-semibold ms-auto text-white" disabled={busy || readyRows.length === 0}
          style={{ background: online ? 'linear-gradient(135deg,#0a8a78,#0ab39c)' : 'linear-gradient(135deg,#7c5cfc,#5a3fd1)', border: 'none', opacity: busy || readyRows.length === 0 ? 0.6 : 1, padding: '8px 16px' }}
          onClick={() => setStep('approval')}>
          <i className="ri-shield-check-line me-1" /> {online ? 'Approve & Initiate Payment' : 'Approve & Submit to Bank'}
        </button>
      </div>
    </>, 920);
  }

  // ── STEP: 3-LEVEL APPROVAL ──
  if (step === 'approval' && payment) {
    return shell(<>
      <Header icon="ri-shield-check-line" iconTint="#fdf3d6" iconFg="#a06f00" title="Approval Required" sub="3-level sign-off before payment execution" onClose={onClose} />
      <div style={{ padding: 20 }}>
        {([['prepared_by', 'Prepared By', 'Name of HR executive who prepared'], ['verified_by', 'Verified By', 'Name of Finance Manager who verified'], ['approved_by', 'Approved By', 'Name of Director / CEO who approved']] as const).map(([k, label, ph]) => (
          <div className="mb-3" key={k}>
            <label className="form-label fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.04em' }}>{label} <span className="text-danger">*</span></label>
            <input className="form-control" placeholder={ph} value={(prep as any)[k]} onChange={e => setPrep(p => ({ ...p, [k]: e.target.value }))} />
          </div>
        ))}
        <div className="p-2 px-3 mb-3" style={{ background: '#fef9e7', border: '1px solid #f6e3a1', borderRadius: 10, fontSize: 12.5, color: '#a06f00' }}>
          <i className="ri-alert-line me-1" /> All three approvals are mandatory. Payment will only execute after this form is submitted.
        </div>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-light flex-shrink-0" onClick={() => setStep('advice')} disabled={busy}>Back</button>
          <button type="button" className="btn fw-bold text-white flex-grow-1" disabled={busy}
            style={{ background: 'linear-gradient(135deg,#047857,#10b981)', border: 'none', opacity: busy ? 0.7 : 1 }} onClick={submitApproval}>
            {busy ? <i className="ri-loader-4-line me-1" /> : <i className="ri-check-double-line me-1" />} Confirm &amp; Approve Payment
          </button>
        </div>
      </div>
    </>, 520);
  }

  // ── STEP: SUCCESS ──
  if (step === 'success' && result) {
    return shell(<>
      <div style={{ padding: '28px 24px', textAlign: 'center', background: result.held === 0 ? 'linear-gradient(135deg,#064e3b,#047857,#10b981)' : 'linear-gradient(135deg,#a16207,#d97706)', color: '#fff', position: 'relative' }}>
        <button type="button" onClick={onClose} className="btn btn-sm position-absolute" style={{ top: 10, right: 10, color: '#fff' }}><i className="ri-close-line" /></button>
        <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 56, height: 56, background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.4)', fontSize: 30 }}><i className="ri-check-line" /></span>
        <h4 className="text-white fw-bold mt-2 mb-1" style={{ fontSize: 18 }}>{result.held === 0 ? 'Payment Initiated' : 'Partial Payment'}</h4>
        <small style={{ color: 'rgba(255,255,255,0.85)' }}>Batch {result.batch_ref}</small>
      </div>
      <div style={{ padding: 20 }}>
        <div className="d-flex text-center mb-3">
          <div className="flex-fill"><h3 className="fw-bold mb-0" style={{ color: '#108548' }}>{result.paid}</h3><div className="text-muted text-uppercase" style={{ fontSize: 10 }}>Paid</div></div>
          <div className="flex-fill"><h3 className="fw-bold mb-0" style={{ color: result.held ? '#b1401d' : 'var(--vz-secondary-color)' }}>{result.held}</h3><div className="text-muted text-uppercase" style={{ fontSize: 10 }}>Held</div></div>
        </div>
        {result.held > 0 && <div className="p-2 px-3 mb-3 text-center" style={{ background: '#fde7e3', color: '#b1401d', borderRadius: 10, fontSize: 12.5 }}>{result.held} employee(s) held for missing bank / blocking issues. Fix and pay again.</div>}
        <button type="button" className="btn btn-success w-100 fw-bold" onClick={onClose}>Done</button>
      </div>
    </>, 440);
  }

  return shell(<div style={{ padding: 30 }} className="text-center text-muted">Loading…</div>, 440);
}

function Header({ icon, title, sub, onClose, iconTint = '#5a3fd1', iconFg = '#fff' }: { icon: string; title: string; sub: string; onClose: () => void; iconTint?: string; iconFg?: string }) {
  const grad = iconFg === '#fff';
  return (
    <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="d-flex align-items-center gap-2">
        <span className="d-inline-flex align-items-center justify-content-center rounded" style={{ width: 38, height: 38, background: grad ? 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' : iconTint, color: iconFg }}><i className={icon} style={{ fontSize: 19 }} /></span>
        <div><h5 className="mb-0 fw-bold" style={{ fontSize: 16 }}>{title}</h5><small className="text-muted" style={{ fontSize: 11.5 }}>{sub}</small></div>
      </div>
      <button type="button" className="btn btn-sm" onClick={onClose}><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
    </div>
  );
}

function ModeCard({ icon, tint, fg, title, sub, onClick, disabled }: { icon: string; tint: string; fg: string; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-start flex-grow-1" style={{ border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '14px 16px', background: 'var(--vz-card-bg)', cursor: disabled ? 'wait' : 'pointer', minWidth: 200, opacity: disabled ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="d-inline-flex align-items-center justify-content-center rounded" style={{ width: 40, height: 40, background: tint, color: fg, flexShrink: 0 }}><i className={icon} style={{ fontSize: 19 }} /></span>
      <div><div className="fw-bold" style={{ fontSize: 13.5 }}>{title}</div><div className="text-muted" style={{ fontSize: 11.5 }}>{sub}</div></div>
    </button>
  );
}
