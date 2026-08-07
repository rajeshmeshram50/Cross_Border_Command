import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import SearchableSelect from './ui/SearchableSelect';
import WorklistPager from './ui/WorklistPager';
import ExpenseSettlementModal from './ExpenseSettlementModal';

/* Consolidated ("batch") payment: settle several small APPROVED, unpaid expense
   claims of ONE employee with a single payout (one UTR + one proof), synced to
   Zoho Books as one itemised expense. Views: history → select → pay. */

type BatchRow = {
  id: number; employee_name: string; employee_code?: string | null;
  reference_number: string; payment_type: string; total_amount: number;
  note?: string | null; paid_at?: string | null; count: number;
  exp_nos: string[]; proof_url?: string | null;
  zoho_status?: string | null; zoho_url?: string | null;
};
type PayableClaim = {
  id: number; exp_no: string; title: string; category_name?: string | null;
  expense_date?: string | null; amount: number; note?: string | null;
  attachments: number; status: string; payable: boolean;
  pending_stage?: 'manager' | 'hr' | null;
};
type Emp = { id: number; first_name?: string; last_name?: string; display_name?: string; emp_code?: string };

const PAGE = 8;
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BatchPaymentModal({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [view, setView] = useState<'history' | 'select' | 'pay'>('history');
  const [history, setHistory] = useState<BatchRow[]>([]);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [empId, setEmpId] = useState<number | ''>('');
  const [payable, setPayable] = useState<PayableClaim[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reference, setReference] = useState('');
  const [paymentType, setPaymentType] = useState('Bank Transfer');
  const [expenseType, setExpenseType] = useState<'Goods' | 'Service'>('Goods');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [histPage, setHistPage] = useState(1);
  const [claimPage, setClaimPage] = useState(1);
  // Per-claim review (pending → approve) / view (approved) drill-in.
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);

  const empName = (e: Emp) => e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.emp_code || `#${e.id}`;

  useEffect(() => {
    if (!open) return;
    setView('history'); resetForm(); setHistPage(1);
    loadHistory();
    api.get('/employees').then(r => setEmployees(Array.isArray(r.data) ? r.data : [])).catch(() => setEmployees([]));
  }, [open]);

  const resetForm = () => {
    setEmpId(''); setPayable([]); setSelected(new Set()); setClaimPage(1);
    setReference(''); setPaymentType('Bank Transfer'); setExpenseType('Goods'); setNote(''); setProof(null);
  };

  const loadHistory = () => {
    setLoading(true);
    api.get('/expense-claims/batch-payments').then(r => setHistory(r.data?.data ?? [])).catch(() => setHistory([])).finally(() => setLoading(false));
  };
  const loadPayable = (id: number) => {
    setSelected(new Set()); setClaimPage(1); setLoading(true);
    api.get('/expense-claims/batch-payable', { params: { employee_id: id } })
      .then(r => setPayable(r.data?.data ?? [])).catch(() => setPayable([])).finally(() => setLoading(false));
  };

  const syncZoho = async (id: number) => {
    setSyncingId(id);
    try {
      const { data: r } = await api.post(`/expense-claims/batch-payments/${id}/sync-zoho`);
      toast.success('Synced to Zoho Books', r?.message ?? 'Pushed as one itemised expense.');
      loadHistory();
    } catch (e: any) {
      toast.error('Zoho sync failed', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSyncingId(null); }
  };

  const selectedClaims = useMemo(() => payable.filter(c => selected.has(c.id)), [payable, selected]);
  const total = useMemo(() => +selectedClaims.reduce((s, c) => s + c.amount, 0).toFixed(2), [selectedClaims]);
  const payableRows = payable.filter(c => c.payable);
  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = payableRows.length > 0 && payableRows.every(c => selected.has(c.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(payableRows.map(c => c.id)));

  const submit = async () => {
    if (selected.size === 0) { toast.error('Select claims', 'Tick at least one approved expense.'); return; }
    if (!reference.trim()) { toast.error('Reference required', 'Enter the UTR / reference number.'); return; }
    if (!proof) { toast.error('Proof required', 'Attach the proof of payment.'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('employee_id', String(empId));
      selected.forEach(id => fd.append('claim_ids[]', String(id)));
      fd.append('reference_number', reference.trim());
      fd.append('payment_type', paymentType);
      fd.append('expense_type', expenseType);
      if (note.trim()) fd.append('note', note.trim());
      fd.append('proof', proof);
      const { data: r } = await api.post('/expense-claims/batch-pay', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Batch payment recorded', r?.message ?? 'Paid.');
      onDone(); resetForm(); setView('history'); loadHistory();
    } catch (e: any) {
      toast.error('Could not record payment', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  const pillStatus = (c: PayableClaim) => {
    if (c.status === 'approved') return <span style={{ ...chip, background: '#d1fae5', color: '#065f46' }}>Approved</span>;
    const stageLabel = c.pending_stage === 'hr' ? 'Pending HR approval' : 'Pending reporting manager';
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...chip, background: '#fef3c7', color: '#a16207' }}>Pending review</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>({stageLabel})</span>
      </span>
    );
  };

  const histSlice = history.slice((histPage - 1) * PAGE, histPage * PAGE);
  const claimSlice = payable.slice((claimPage - 1) * PAGE, claimPage * PAGE);

  return createPortal(
    <>
      <style>{BPW_CSS}</style>
      <div style={backdrop} onMouseDown={onClose}>
        <div style={card} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
          {/* Header */}
          <div style={header}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={heroIco}><i className="ri-stack-line" /></span>
              <div>
                <div style={{ fontSize: 11.5, letterSpacing: 1, opacity: .85, textTransform: 'uppercase' }}>HRMS · Expense Management</div>
                <div style={{ fontSize: 23, fontWeight: 800 }}>Pay Multiple Claims</div>
                <div style={{ fontSize: 13, opacity: .92 }}>Pay several small approved claims of one employee together — one UTR, one proof, one Zoho expense.</div>
              </div>
            </div>
            <button onClick={onClose} style={xBtn} aria-label="Close">✕</button>
          </div>

          {/* Boxed wizard stepper (matches the Return-payment flow). */}
          {view !== 'history' && (
            <div style={rail}>
              <div className="bpw-stepper">
                {[
                  { n: 1, key: 'select', title: 'Select claims', sub: 'Employee & expenses', icon: 'ri-list-check-2' },
                  { n: 2, key: 'pay', title: 'Payment details', sub: 'UTR, method & proof', icon: 'ri-bank-card-line' },
                ].map((s, i, arr) => {
                  const isActive = view === s.key;
                  const isDone = view === 'pay' && s.key === 'select';
                  const cls = isActive ? 'bpw-step-active' : isDone ? 'bpw-step-done' : 'bpw-step-pending';
                  return (
                    <Fragment key={s.n}>
                      <div className={`bpw-step ${cls}`} onClick={() => { if (s.key === 'select') setView('select'); else if (selected.size > 0) setView('pay'); }}>
                        <div className="bpw-badge-wrap">
                          <div className="bpw-badge">{isDone ? <i className="ri-check-line" /> : <i className={s.icon} />}</div>
                          <div className="bpw-num">{isDone ? <i className="ri-check-line" /> : s.n}</div>
                        </div>
                        <div className="bpw-text">
                          <div className="bpw-title">{s.title}</div>
                          <div className="bpw-sub">{s.sub}</div>
                        </div>
                      </div>
                      {i < arr.length - 1 && <div className="bpw-connector"><div className="bpw-line" data-done={isDone ? '1' : '0'} /></div>}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}

          <div style={body}>
            {/* ───── HISTORY ───── */}
            {view === 'history' && (
              <>
                <div style={rowBetween}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>Previous batch payments</div>
                  <button style={primaryBtn} onClick={() => { resetForm(); setView('select'); }}><span style={{ fontSize: 16 }}>＋</span> Make New Payment</button>
                </div>
                <div style={tableWrap}>
                  <table style={table}>
                    <thead><tr>{['SR NO', 'DATE', 'EMPLOYEE', 'EXPENSE IDS', 'METHOD', 'UTR / REFERENCE', 'AMOUNT', 'NOTE', 'ZOHO', 'PROOF'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {loading ? <tr><td colSpan={10} style={emptyTd}>Loading…</td></tr>
                        : history.length === 0 ? <tr><td colSpan={10} style={emptyTd}>No batch payments yet.</td></tr>
                          : histSlice.map((b, i) => (
                            <tr key={b.id}>
                              <td style={td}>{(histPage - 1) * PAGE + i + 1}</td>
                              <td style={td}>{fmtDate(b.paid_at)}</td>
                              <td style={td}><div style={{ fontWeight: 600 }}>{b.employee_name}</div><div style={{ fontSize: 11, color: '#64748b' }}>{b.employee_code}</div></td>
                              <td style={td}><ExpenseIds nos={b.exp_nos} /></td>
                              <td style={td}>{b.payment_type}</td>
                              <td style={{ ...td, fontFamily: 'monospace' }}>{b.reference_number}</td>
                              <td style={{ ...td, fontWeight: 700 }}>{inr(b.total_amount)}</td>
                              <td style={{ ...td, maxWidth: 150, color: '#64748b' }} title={b.note ?? ''}>{b.note || '—'}</td>
                              <td style={td}>{b.zoho_status === 'synced' && b.zoho_url
                                ? <a href={b.zoho_url} target="_blank" rel="noreferrer" style={link}>View</a>
                                : <button style={{ ...syncBtn, opacity: syncingId === b.id ? .6 : 1 }} disabled={syncingId === b.id} onClick={() => syncZoho(b.id)}>{syncingId === b.id ? 'Syncing…' : 'Zoho Sync'}</button>}</td>
                              <td style={td}>{b.proof_url ? <a href={resolveFileUrl(b.proof_url)} target="_blank" rel="noreferrer" style={link}>File</a> : '—'}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
                {history.length > PAGE && <WorklistPager total={history.length} page={histPage} pageSize={PAGE} onPage={setHistPage} />}
              </>
            )}

            {/* ───── STEP 1 — select employee + claims ───── */}
            {view === 'select' && (
              <>
                <div style={{ maxWidth: 420, marginBottom: 14 }}>
                  <label style={lbl}>Employee <span style={req}>*</span></label>
                  <SearchableSelect
                    menuMaxHeight={188}
                    value={empId ? String(empId) : null}
                    options={employees.map(e => ({ value: String(e.id), raw: e }))}
                    onChange={v => { const id = v ? Number(v) : ''; setEmpId(id); if (id) loadPayable(id); else setPayable([]); }}
                    placeholder="Select employee…"
                    searchPlaceholder="Search by name or code…"
                    getSearchText={(e: Emp) => `${empName(e)} ${e.emp_code ?? ''}`}
                    renderTrigger={(e: Emp) => <span>{empName(e)}{e.emp_code ? ` (${e.emp_code})` : ''}</span>}
                    renderOption={(e: Emp) => <span>{empName(e)}{e.emp_code ? ` (${e.emp_code})` : ''}</span>}
                  />
                </div>

                <div style={tableWrap}>
                  <table style={table}>
                    <thead><tr>
                      <th style={{ ...th, width: 40 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={payableRows.length === 0} /></th>
                      {['SR', 'EXP ID', 'DATE', 'CATEGORY', 'NOTE', 'FILES', 'AMOUNT', 'STATUS', 'ACTION'].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {empId === '' ? <tr><td colSpan={10} style={emptyTd}><i className="ri-user-search-line" style={{ fontSize: 18, display: 'block', marginBottom: 4 }} />Select an employee above to see their approved, unpaid claims.</td></tr>
                        : loading ? <tr><td colSpan={10} style={emptyTd}>Loading…</td></tr>
                          : payable.length === 0 ? <tr><td colSpan={10} style={emptyTd}>No unpaid claims for this employee.</td></tr>
                            : claimSlice.map((c, i) => (
                              <tr key={c.id} style={selected.has(c.id) ? { background: '#ecfeff' } : undefined}>
                                <td style={td}>{c.payable ? <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /> : <span title="Approve it first" style={{ color: '#cbd5e1' }}>—</span>}</td>
                                <td style={td}>{(claimPage - 1) * PAGE + i + 1}</td>
                                <td style={{ ...td, fontFamily: 'monospace' }}>{c.exp_no}</td>
                                <td style={td}>{fmtDate(c.expense_date)}</td>
                                <td style={td}>{c.category_name || '—'}</td>
                                <td style={td}><div style={noteCell} title={c.note ?? ''}>{c.note || c.title}</div></td>
                                <td style={td}>{c.attachments || 0}</td>
                                <td style={{ ...td, fontWeight: 700 }}>{inr(c.amount)}</td>
                                <td style={td}>{pillStatus(c)}</td>
                                <td style={td}>{c.payable
                                  ? <button style={ghostSm} onClick={() => setViewId(c.id)}>View</button>
                                  : c.pending_stage === 'hr'
                                    ? <button style={warnSm} onClick={() => setReviewId(c.id)}>Review &amp; Approve</button>
                                    : <button style={disabledSm} disabled title="Waiting for the reporting manager to approve first">Review &amp; Approve</button>}</td>
                              </tr>
                            ))}
                    </tbody>
                  </table>
                </div>
                {payable.length > PAGE && <WorklistPager total={payable.length} page={claimPage} pageSize={PAGE} onPage={setClaimPage} />}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}><i className="ri-information-line" /> Only <b>approved</b> claims are selectable. Approve a pending one with <b>Review &amp; Approve</b> to include it.</div>
                  {selected.size > 0 && <div style={selChip}><b>{selected.size}</b> selected · <b>{inr(total)}</b></div>}
                </div>
              </>
            )}

            {/* ───── STEP 2 — payment form ───── */}
            {view === 'pay' && (
              <>
                <div style={totalBanner}>
                  <div>
                    <div style={{ fontSize: 12, opacity: .85, letterSpacing: .5 }}>TOTAL TO PAY (LOCKED)</div>
                    <div style={{ fontSize: 30, fontWeight: 800 }}>{inr(total)}</div>
                    <div style={{ fontSize: 12, opacity: .85 }}>{selected.size} claim(s) · sum can’t be changed</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 480, justifyContent: 'flex-end' }}>
                    {selectedClaims.map(c => <span key={c.id} style={chipDark}>{c.exp_no} · {inr(c.amount)}</span>)}
                  </div>
                </div>

                <div style={grid3}>
                  <div>
                    <label style={lbl}>UTR / Reference Number <span style={req}>*</span></label>
                    <input style={input} value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. HDFC0012345678" />
                  </div>
                  <div>
                    <label style={lbl}>Method <span style={req}>*</span></label>
                    <select style={input} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                      {['Bank Transfer', 'UPI', 'PhonePe', 'Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Goods / Service <span style={req}>*</span></label>
                    <select style={input} value={expenseType} onChange={e => setExpenseType(e.target.value as 'Goods' | 'Service')}>
                      <option value="Goods">Goods</option><option value="Service">Service</option>
                    </select>
                  </div>
                </div>
                <div style={{ ...grid2, marginTop: 14 }}>
                  <div>
                    <label style={lbl}>Note (optional)</label>
                    <input style={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Reference / remark for this payout" />
                  </div>
                  <div>
                    <label style={lbl}>Proof of payment <span style={req}>*</span></label>
                    <input ref={proofInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={e => setProof(e.target.files?.[0] ?? null)} />
                    {proof ? (
                      <div style={proofBox}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <i className="ri-file-text-line" style={{ fontSize: 18, color: '#0e7490', flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: '#0f172a' }}>{proof.name}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button type="button" style={proofBtn} onClick={() => window.open(URL.createObjectURL(proof), '_blank')}><i className="ri-eye-line" /> View</button>
                          <button type="button" style={proofBtn} onClick={() => proofInputRef.current?.click()}><i className="ri-refresh-line" /> Reupload</button>
                        </span>
                      </div>
                    ) : (
                      <div style={attachZone} onClick={() => proofInputRef.current?.click()}>
                        <i className="ri-attachment-2" style={{ fontSize: 18 }} /> <span style={{ fontWeight: 700, letterSpacing: .3 }}>ATTACH PROOF</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={footer}>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>
              {view === 'pay' ? `Paying ${selected.size} claim(s) · ${inr(total)} · one itemised Zoho expense (sync separately).`
                : view === 'select' ? 'Only approved, unpaid claims can be batch-paid.'
                  : 'Pay several small approved claims of one employee at once.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {view === 'pay' && <button style={ghostBtn} onClick={() => setView('select')}>← Back</button>}
              {view === 'select' && <button style={ghostBtn} onClick={() => { resetForm(); setView('history'); }}>← History</button>}
              <button style={ghostBtn} onClick={onClose}>Close</button>
              {view === 'select' && (
                <button style={{ ...primaryBtn, opacity: selected.size === 0 ? .5 : 1 }} disabled={selected.size === 0} onClick={() => setView('pay')}>Next → {inr(total)}</button>
              )}
              {view === 'pay' && (
                <button style={{ ...primaryBtn, opacity: saving ? .6 : 1 }} disabled={saving} onClick={submit}>{saving ? 'Paying…' : `Pay ${inr(total)}`}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Per-claim review (approve a pending claim) / view (an approved one). */}
      <ExpenseSettlementModal claimId={reviewId} review onClose={() => { setReviewId(null); if (empId) loadPayable(Number(empId)); }} onDone={() => { if (empId) loadPayable(Number(empId)); }} />
      <ExpenseSettlementModal claimId={viewId} readOnly onClose={() => setViewId(null)} onDone={() => {}} />
    </>,
    document.body,
  );
}

/* Expense IDs cell — a couple of pills + a "+N" badge that reveals ALL the ids
   in a hover popover (mirrors the SEGMENT "+N" pattern in the master grids). */
function ExpenseIds({ nos }: { nos: string[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = nos.slice(0, 2);
  const rest = nos.length - shown.length;
  const open = () => { if (t.current) clearTimeout(t.current); if (ref.current) setRect(ref.current.getBoundingClientRect()); };
  const close = () => { t.current = setTimeout(() => setRect(null), 120); };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {shown.map(n => <span key={n} style={idPill}>{n}</span>)}
      {rest > 0 && <span ref={ref} style={morePill} onMouseEnter={open} onMouseLeave={close}>+{rest}</span>}
      {rect && createPortal(
        <div onMouseEnter={open} onMouseLeave={close}
          style={{ ...popover, top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)) }}>
          <div style={popTitle}>EXPENSE IDS ({nos.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {nos.map(n => <span key={n} style={idPill}>{n}</span>)}
          </div>
        </div>, document.body)}
    </span>
  );
}

/* — inline styles (self-contained; teal surface matches the Record Payment modal) — */
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const card: React.CSSProperties = {
  width: '100%', maxWidth: 1340, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
  background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 30px 80px rgba(2,44,52,.4)',
  // The SearchableSelect dropdown reads these Velzon theme variables for its
  // surfaces. This modal is portaled to <body> (outside the theme scope), so we
  // pin them here — otherwise the menu background is unresolved/transparent and
  // the table + note behind it bleed through.
  ['--vz-card-bg' as any]: '#ffffff',
  ['--vz-border-color' as any]: '#e2e8f0',
  ['--vz-secondary-bg' as any]: '#f1f5f9',
  ['--vz-body-color' as any]: '#0f172a',
  ['--vz-secondary-color' as any]: '#64748b',
  ['--vz-primary' as any]: '#0e7490',
  ['--vz-primary-bg-subtle' as any]: 'rgba(14,116,144,.10)',
};
const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '22px 26px', background: 'linear-gradient(120deg,#0e7490,#0891b2 55%,#06b6d4)', color: '#fff', flexShrink: 0 };
const heroIco: React.CSSProperties = { width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 };
const rail: React.CSSProperties = { display: 'flex', gap: 28, padding: '12px 26px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 };
const selChip: React.CSSProperties = { background: '#0e7490', color: '#fff', borderRadius: 999, padding: '6px 14px', fontWeight: 700, fontSize: 13 };
const body: React.CSSProperties = { padding: 22, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 26px', borderTop: '1px solid #eef2f4', background: '#f8fafc', flexShrink: 0 };
const xBtn: React.CSSProperties = { background: 'rgba(255,255,255,.2)', color: '#fff', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 14, flexShrink: 0 };
const rowBetween: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '11px 12px', background: '#0e7490', color: '#fff', fontSize: 11, letterSpacing: .3, textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', borderTop: '1px solid #eef2f4', verticalAlign: 'middle' };
const emptyTd: React.CSSProperties = { padding: 26, textAlign: 'center', color: '#94a3b8' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: .3, marginBottom: 5 };
const req: React.CSSProperties = { color: '#ef4444' };
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 14, background: '#fff', boxSizing: 'border-box' };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 9, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 14 };
const ghostSm: React.CSSProperties = { background: '#fff', color: '#0e7490', border: '1px solid #99f6e4', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const warnSm: React.CSSProperties = { background: '#fffbeb', color: '#a16207', border: '1px solid #fde68a', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const disabledSm: React.CSSProperties = { background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'not-allowed', whiteSpace: 'nowrap' };
const noteCell: React.CSSProperties = { maxWidth: 220, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const attachZone: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', border: '1.5px dashed #94d8e6', borderRadius: 10, background: '#f0fbfe', color: '#0e7490', cursor: 'pointer', fontSize: 13 };
const proofBox: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, background: '#f8fafc' };
const proofBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: '#0e7490', border: '1px solid #99f6e4', borderRadius: 7, padding: '4px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const syncBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const link: React.CSSProperties = { color: '#0891b2', fontWeight: 600, textDecoration: 'none' };
const chip: React.CSSProperties = { display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontWeight: 700, fontSize: 11 };
const idPill: React.CSSProperties = { display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' };
const morePill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 22, padding: '0 8px', borderRadius: 999, background: '#4f46e5', color: '#fff', fontWeight: 800, fontSize: 11, cursor: 'pointer' };
const popover: React.CSSProperties = { position: 'fixed', zIndex: 9100, minWidth: 220, maxWidth: 320, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 16px 40px rgba(15,23,42,.18)', padding: 12 };
const popTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: .5, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 };
const chipDark: React.CSSProperties = { display: 'inline-block', padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,.2)', color: '#fff', fontWeight: 700, fontSize: 11.5 };

/* Boxed wizard stepper — mirrors the Return-payment flow's stepper, teal-themed. */
const BPW_CSS = `
.bpw-stepper{display:flex;align-items:center;gap:0;max-width:640px;}
.bpw-connector{flex:0 0 28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bpw-line{height:3px;width:100%;border-radius:2px;background:#e2e8f0;}
.bpw-line[data-done="1"]{background:linear-gradient(90deg,#22c55e,#16a34a);}
.bpw-step{flex:1;padding:11px 14px;border-radius:14px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden;transition:all .25s;cursor:pointer;min-width:0;}
.bpw-badge-wrap{position:relative;flex-shrink:0;width:40px;height:40px;}
.bpw-badge{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:19px;transition:all .25s;}
.bpw-num{position:absolute;bottom:-4px;right:-4px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;border:2px solid #fff;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.15);}
.bpw-text{min-width:0;flex:1;}
.bpw-title{font-size:12.5px;font-weight:800;letter-spacing:-.2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bpw-sub{font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bpw-step-active{background:linear-gradient(135deg,#e0f7fb 0%,#cbeef6 100%);border:2px solid #22d3ee;box-shadow:0 6px 20px rgba(8,145,178,.18);}
.bpw-step-active .bpw-badge{background:linear-gradient(135deg,#0891b2,#0e7490);color:#fff;box-shadow:0 5px 14px rgba(14,116,144,.48);}
.bpw-step-active .bpw-num{background:linear-gradient(135deg,#0e7490,#155e75);color:#fff;}
.bpw-step-active .bpw-title{color:#083344;}
.bpw-step-active .bpw-sub{color:#0e7490;}
.bpw-step-done{background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border:2px solid #34d399;box-shadow:0 6px 20px rgba(16,185,129,.18);}
.bpw-step-done .bpw-badge{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 5px 12px rgba(22,163,74,.42);}
.bpw-step-done .bpw-num{background:#fff;color:#16a34a;box-shadow:0 1px 3px rgba(22,163,74,.30);}
.bpw-step-done .bpw-title{color:#065f46;}
.bpw-step-done .bpw-sub{color:#059669;}
.bpw-step-pending{background:#f8fafc;border:1.5px solid #e2e8f0;opacity:.85;}
.bpw-step-pending .bpw-badge{background:linear-gradient(135deg,#f1f5f9,#e2e8f0);color:#94a3b8;}
.bpw-step-pending .bpw-num{background:#e2e8f0;color:#94a3b8;}
.bpw-step-pending .bpw-title{color:#94a3b8;}
.bpw-step-pending .bpw-sub{color:#cbd5e1;}
`;
const totalBanner: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: 'linear-gradient(120deg,#0e7490,#0891b2 60%,#06b6d4)', color: '#fff', borderRadius: 14, padding: '18px 22px', marginBottom: 18, flexWrap: 'wrap' };
