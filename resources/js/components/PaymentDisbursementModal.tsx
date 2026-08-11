import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

/**
 * "Proceed to Pay" disbursement flow:
 *   mode select → payment advice → 3-level sign-off → initiate → success.
 *   Backed by /payroll/payment/* endpoints.
 *
 * Salaries are disbursed by cheque / payment-advice letter only. The online
 * NEFT batch was withdrawn, so there is no bank-file rail here.
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
type BankGroup = 'hdfc' | 'other';
interface AdviceRow { payslip_id: number; name: string; emp_code: string; department: string | null; bank: string | null; bank_group: BankGroup; account: string | null; ifsc: string | null; amount: number; status: 'Ready' | 'Held'; }
interface Payment { id: number; mode: 'cheque'; status: string; company_name: string; bank_name: string | null; period: string | null; eligible_count: number; held_count: number; total_count: number; total: number; rows: AdviceRow[]; batch_ref: string | null; }

const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const fmtShort = (n: number) => { if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`; if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`; if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`; return `₹${Math.round(n)}`; };
/* The advice is read as two sheets — the bank files them separately. The
   server tags each row (App\Support\BankGroup), so the tab only filters. */
const TABS: { key: BankGroup; label: string; icon: string }[] = [
  { key: 'hdfc',  label: 'HDFC Bank',  icon: 'ri-bank-line' },
  { key: 'other', label: 'Other Bank', icon: 'ri-exchange-line' },
];

const ACCENTS = ['#7c5cfc', '#0ab39c', '#3b82f6', '#f59e0b', '#e83e8c', '#0c63b0', '#108548', '#a06f00'];

export default function PaymentDisbursementModal({ open, onClose, runId, cycleLabel, onPaid }: PaymentDisbursementModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('mode');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState({ prepared_by: '', verified_by: '', approved_by: '' });
  const [result, setResult] = useState<{ paid: number; held: number; batch_ref: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [tab, setTab] = useState<BankGroup>('hdfc');

  useEffect(() => {
    if (open) { setStep('mode'); setPayment(null); setPrep({ prepared_by: '', verified_by: '', approved_by: '' }); setResult(null); setTab('hdfc'); }
  }, [open]);

  const readyRows = useMemo(() => payment?.rows.filter(r => r.status === 'Ready') ?? [], [payment]);

  /** Rows on the open sheet, and what that sheet is worth. */
  const tabRows  = useMemo(() => payment?.rows.filter(r => r.bank_group === tab) ?? [], [payment, tab]);
  const tabTotal = useMemo(() => tabRows.filter(r => r.status === 'Ready').reduce((sum, r) => sum + r.amount, 0), [tabRows]);
  const tabReady = useMemo(() => tabRows.filter(r => r.status === 'Ready').length, [tabRows]);
  const tabHeld  = tabRows.length - tabReady;
  /** Row counts per tab — shown on the tab itself so an empty sheet is not a surprise. */
  const tabCounts = useMemo(() => {
    const c: Record<BankGroup, number> = { hdfc: 0, other: 0 };
    payment?.rows.forEach(r => { c[r.bank_group] = (c[r.bank_group] ?? 0) + 1; });
    return c;
  }, [payment]);

  if (!open) return null;

  const choose = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      const res = await api.post('/payroll/payment/prepare', { run_id: runId, mode: 'cheque' });
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

  /** Label + filename stem for whichever sheet is open. */
  const tabLabel = TABS.find(t => t.key === tab)?.label ?? '';
  const fileStem = `${tab === 'hdfc' ? 'HDFC' : 'OtherBank'}_${cycleLabel.replace(/\s+/g, '_')}`;

  const exportExcel = async () => {
    if (!payment) return;
    try {
      const XLSX = await import('xlsx');
      // The open sheet only — exporting all 13 rows from a screen showing 10
      // is how a batch gets filed with employees nobody reviewed.
      const sheet = tabRows.map((r, i) => ({ 'Sr': i + 1, 'Employee': r.name, 'Emp Code': r.emp_code, 'Department': r.department, 'Bank': r.bank, 'Account': r.account, 'IFSC': r.ifsc, 'Amount': r.amount, 'Status': r.status }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), tabLabel);
      XLSX.writeFile(wb, `PaymentAdvice_${fileStem}.xlsx`);
      toast.success('Excel ready', `${tabLabel} advice exported (${tabRows.length} employees).`);
    } catch { toast.error('Export failed', 'Could not build the Excel file.'); }
  };

  // PDF export — no client-side PDF lib is bundled, so render a clean printable
  // payment-advice document in a new window and hand off to the browser's
  // "Save as PDF". Keeps the feature dependency-free.
  const exportPdf = () => {
    if (!payment) return;
    const w = window.open('', '_blank', 'width=980,height=720');
    if (!w) { toast.error('Export failed', 'Allow pop-ups for this site to export the PDF.'); return; }
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const headCols = ['#', 'Employee', 'Emp Code', 'Department', 'Bank', 'Account', 'IFSC', 'Amount', 'Status'];
    const bodyRows = tabRows.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.emp_code)}</td><td>${esc(r.department)}</td><td>${esc(r.bank)}</td><td>${esc(r.account)}</td><td>${esc(r.ifsc)}</td><td class="amt">₹${fmtINR(r.amount)}</td><td>${esc(r.status)}</td></tr>`,
    ).join('');
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Payment Advice — ${esc(tabLabel)}</title>` +
      '<style>' +
      '*{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      'body{margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}' +
      '.meta{color:#555;font-size:12px;margin-bottom:16px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}' +
      'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}' +
      'th{background:#f3f4f6}.amt{text-align:right;font-weight:bold}' +
      '@media print{@page{margin:14mm}}' +
      '</style></head><body>' +
      `<h1>Payment Advice — ${esc(payment.company_name)}</h1>` +
      `<div class="meta">${esc(tabLabel)} · ${esc(payment.period || cycleLabel)} · ${tabReady} employees · Total ₹${fmtINR(tabTotal)}</div>` +
      `<table><thead><tr>${headCols.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>` +
      '</body></html>',
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
    toast.success('PDF ready', 'Use "Save as PDF" in the print dialog.');
  };

  const shell = (children: React.ReactNode, maxW: number) => createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <style>{`
        [data-bs-theme="dark"] .pdm-modal .table-light,
        [data-bs-theme="dark"] .pdm-modal .table-light th { background: var(--vz-secondary-bg) !important; color: var(--vz-body-color) !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-info-amber { background: rgba(245,158,11,0.14) !important; border-color: rgba(245,158,11,0.35) !important; color: #fcd34d !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-info-red { background: rgba(177,64,29,0.20) !important; color: #fda192 !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-badge-green { background: rgba(16,133,72,0.22) !important; color: #6ee7b7 !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-badge-neutral { background: rgba(255,255,255,0.10) !important; color: #cbd5e1 !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-badge-red { background: rgba(177,64,29,0.22) !important; color: #fda192 !important; }
        [data-bs-theme="dark"] .pdm-modal .btn-light { background: var(--vz-secondary-bg) !important; color: var(--vz-body-color) !important; border-color: var(--vz-border-color) !important; }
        .pdm-export-item { display: flex; align-items: center; width: 100%; padding: 8px 10px; border: none; background: transparent; border-radius: 8px; font-size: 13px; color: var(--vz-body-color); cursor: pointer; text-align: left; }
        .pdm-export-item:hover { background: var(--vz-secondary-bg); }
        /* Sheet tabs. The active one is marked by an underline flush with the
           header's bottom border, so the table below reads as that tab's body. */
        .pdm-tab {
          border: none; background: transparent; cursor: pointer;
          padding: 10px 14px 9px; margin-bottom: -1px;
          font-size: 12.5px; font-weight: 600;
          color: var(--vz-secondary-color);
          border-bottom: 2px solid transparent;
          display: inline-flex; align-items: center; gap: 2px;
          white-space: nowrap;
        }
        .pdm-tab:hover { color: var(--vz-body-color); }
        .pdm-tab[data-active="true"] { color: #5a3fd1; border-bottom-color: #7c5cfc; }
        [data-bs-theme="dark"] .pdm-modal .pdm-tab[data-active="true"] { color: #c4b5fd; }
        .pdm-tab-count {
          margin-left: 6px; padding: 1px 7px; border-radius: 999px;
          font-size: 10.5px; font-weight: 700;
          background: var(--vz-secondary-bg); color: var(--vz-secondary-color);
        }
        .pdm-tab[data-active="true"] .pdm-tab-count { background: #ece6ff; color: #5a3fd1; }
        [data-bs-theme="dark"] .pdm-modal .pdm-tab-count { background: rgba(255,255,255,0.10); color: #cbd5e1; }
        [data-bs-theme="dark"] .pdm-modal .pdm-tab[data-active="true"] .pdm-tab-count { background: rgba(124,92,252,0.28); color: #c4b5fd; }
        [data-bs-theme="dark"] .pdm-modal .pdm-acc-purple { background: rgba(124,92,252,0.20) !important; color: #c4b5fd !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-acc-green  { background: rgba(16,185,129,0.20) !important; color: #6ee7b7 !important; }
        [data-bs-theme="dark"] .pdm-modal .pdm-acc-amber  { background: rgba(245,158,11,0.20) !important; color: #fcd34d !important; }
      `}</style>
      <div onClick={e => e.stopPropagation()} className="pdm-modal" style={{ background: 'var(--shim-card-bg,#fff)', color: 'var(--vz-body-color)', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', width: '100%', maxWidth: maxW, maxHeight: 'calc(100vh - 32px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
          <ModeCard icon="ri-mail-send-line" tint="#ece6ff" fg="#5a3fd1" title="Cheque / Letter" sub="Print payment advice" disabled={busy} onClick={choose} />
        </div>
        {busy && <div className="text-center mt-3 text-muted" style={{ fontSize: 12.5 }}><i className="ri-loader-4-line" /> Preparing…</div>}
      </div>
    </>, 560);
  }

  // ── STEP: ADVICE / BATCH ──
  if (step === 'advice' && payment) {
    return shell(<>
      <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="d-flex align-items-center gap-2">
          <span className="d-inline-flex align-items-center justify-content-center rounded pdm-acc-purple" style={{ width: 38, height: 38, background: '#ece6ff', color: '#5a3fd1' }}><i className="ri-mail-line" style={{ fontSize: 18 }} /></span>
          <div>
            <h5 className="mb-0 fw-bold" style={{ fontSize: 15 }}>Cheque / Payment Advice Letter</h5>
            <small className="text-muted" style={{ fontSize: 11.5 }}>{payment.company_name} · {payment.period} · {payment.eligible_count} employees · {fmtShort(payment.total)}</small>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
      </div>

      <div className="pdm-tabs" style={{ padding: '0 22px', borderBottom: '1px solid var(--vz-border-color)', display: 'flex', gap: 4 }}>
        {TABS.map(t => (
          <button key={t.key} type="button" className="pdm-tab" data-active={tab === t.key}
            onClick={() => { setTab(t.key); setExportOpen(false); }}>
            <i className={`${t.icon} me-1`} />{t.label}
            <span className="pdm-tab-count">{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '8px 22px', background: 'var(--vz-secondary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--vz-border-color)' }}>
        <span className="fw-semibold" style={{ fontSize: 13 }}>{TABS.find(t => t.key === tab)?.label} total: <span style={{ color: '#108548' }}>₹{fmtINR(tabTotal)}</span> · Employees: {tabReady}{tabHeld > 0 ? ` · ${tabHeld} held` : ''}</span>
        <span className="badge rounded-pill pdm-badge-green" style={{ background: '#d6f4e3', color: '#108548' }}>{tabReady} ready</span>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table className="table align-middle table-nowrap mb-0" style={{ fontSize: 13 }}>
          <thead className="table-light" style={{ position: 'sticky', top: 0 }}>
            <tr><th className="ps-3">Employee</th><th>Bank</th><th>Account</th><th>IFSC</th><th className="text-end">Amount</th><th className="text-center pe-3">Status</th></tr>
          </thead>
          <tbody>
            {tabRows.map((r, i) => (
              <tr key={r.payslip_id}>
                <td className="ps-3">
                  <div className="d-flex align-items-center gap-2">
                    <span className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0" style={{ width: 30, height: 30, fontSize: 11, background: ACCENTS[i % ACCENTS.length] }}>{(r.name || 'NA').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                    <div><div className="fw-semibold">{r.name}</div><div className="text-muted" style={{ fontSize: 11 }}>{r.department || r.emp_code}</div></div>
                  </div>
                </td>
                <td>{r.bank || <span className="text-danger">— Missing —</span>}</td>
                <td className="font-monospace" style={{ fontSize: 12 }}>{r.account || '–'}</td>
                <td className="font-monospace" style={{ fontSize: 12 }}>{r.ifsc || '–'}</td>
                <td className="text-end fw-bold" style={{ color: '#108548' }}>₹{fmtINR(r.amount)}</td>
                <td className="text-center pe-3"><span className={`badge rounded-pill ${r.status === 'Ready' ? 'pdm-badge-neutral' : 'pdm-badge-red'}`} style={r.status === 'Ready' ? { background: '#eef2f6', color: '#5b6478' } : { background: '#fde7e3', color: '#b1401d' }}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {tabRows.length === 0 && (
          <div className="text-center text-muted" style={{ padding: '34px 20px', fontSize: 12.5 }}>
            <i className="ri-inbox-line d-block mb-1" style={{ fontSize: 22, opacity: 0.5 }} />
            No employees on the {TABS.find(t => t.key === tab)?.label} sheet this cycle.
          </div>
        )}
      </div>

      <div style={{ padding: '12px 22px', borderTop: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn btn-light btn-sm fw-semibold" onClick={() => setExportOpen(o => !o)}>
            <i className="ri-download-2-line me-1" /> Export <i className="ri-arrow-down-s-line ms-1" />
          </button>
          {exportOpen && (
            <>
              <div onClick={() => setExportOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
              <div className="pdm-export-menu" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, minWidth: 190, background: 'var(--shim-card-bg,#fff)', border: '1px solid var(--vz-border-color)', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.22)', padding: 6, zIndex: 10 }}>
                <div className="text-uppercase fw-bold px-2 pt-1 pb-2" style={{ fontSize: 9.5, letterSpacing: '0.07em', color: 'var(--vz-secondary-color)' }}>Export as</div>
                <button type="button" className="pdm-export-item" onClick={() => { setExportOpen(false); exportExcel(); }}>
                  <i className="ri-file-excel-2-line me-2 text-success" />Excel (.xlsx)
                </button>
                <button type="button" className="pdm-export-item" onClick={() => { setExportOpen(false); exportPdf(); }}>
                  <i className="ri-file-pdf-2-line me-2 text-danger" />PDF (.pdf)
                </button>
              </div>
            </>
          )}
        </div>
        <button type="button" className="btn btn-sm fw-semibold ms-auto text-white" disabled={busy || readyRows.length === 0}
          style={{ background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)', border: 'none', opacity: busy || readyRows.length === 0 ? 0.6 : 1, padding: '8px 16px' }}
          onClick={() => setStep('approval')}>
          <i className="ri-shield-check-line me-1" /> Approve &amp; Submit to Bank
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
        <div className="p-2 px-3 mb-3 pdm-info-amber" style={{ background: '#fef9e7', border: '1px solid #f6e3a1', borderRadius: 10, fontSize: 12.5, color: '#a06f00' }}>
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
        {result.held > 0 && <div className="p-2 px-3 mb-3 text-center pdm-info-red" style={{ background: '#fde7e3', color: '#b1401d', borderRadius: 10, fontSize: 12.5 }}>{result.held} employee(s) held for missing bank / blocking issues. Fix and pay again.</div>}
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
        <span className={`d-inline-flex align-items-center justify-content-center rounded ${grad ? '' : 'pdm-acc-amber'}`} style={{ width: 38, height: 38, background: grad ? 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' : iconTint, color: iconFg }}><i className={icon} style={{ fontSize: 19 }} /></span>
        <div><h5 className="mb-0 fw-bold" style={{ fontSize: 16 }}>{title}</h5><small className="text-muted" style={{ fontSize: 11.5 }}>{sub}</small></div>
      </div>
      <button type="button" className="btn btn-sm" onClick={onClose}><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
    </div>
  );
}

function ModeCard({ icon, tint, fg, title, sub, onClick, disabled }: { icon: string; tint: string; fg: string; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-start flex-grow-1" style={{ border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '14px 16px', background: 'var(--shim-secondary-bg,#f3f4f6)', cursor: disabled ? 'wait' : 'pointer', minWidth: 200, opacity: disabled ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className={`d-inline-flex align-items-center justify-content-center rounded ${fg === '#0a8a78' ? 'pdm-acc-green' : 'pdm-acc-purple'}`} style={{ width: 40, height: 40, background: tint, color: fg, flexShrink: 0 }}><i className={icon} style={{ fontSize: 19 }} /></span>
      <div><div className="fw-bold" style={{ fontSize: 13.5 }}>{title}</div><div className="text-muted" style={{ fontSize: 11.5 }}>{sub}</div></div>
    </button>
  );
}
