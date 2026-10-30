import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import DataTable, { type DataTableColumn } from './ui/DataTable';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import SearchableSelect from './ui/SearchableSelect';
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

/* History rows per page. The claims table does not page — it scrolls. */
// The proof link opens in a new tab (plain browser navigation), so it can't
// send the Authorization header. Append the Sanctum token as ?token= — the
// batch-payment-proof route authenticates from the query token. Without this
// the request hits auth and 500s with "Route [login] not defined".
const tokenUrl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(localStorage.getItem('cbc_token') || '')}`;
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
  // Per-claim review (pending → approve) / view (approved) drill-in.
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);

  const empName = (e: Emp) => e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.emp_code || `#${e.id}`;

  useEffect(() => {
    if (!open) return;
    setView('history'); resetForm();
    loadHistory();
    /* Active staff only — a batch payment cannot be raised against someone who
       has left. (#164) The list was fetched unfiltered, so exited, resigned and
       terminated employees sat in the Select Employee dropdown and could be
       picked for a payout.

       `enabled=1` is the API's own filter for this: it drops soft-deleted rows
       and anyone whose status is inactive / terminated / resigned, and reads a
       NULL status as Active the same way this screen does — a plain
       `status != 'Exited'` would have silently hidden every employee whose
       status was never set. An exit still IN PROGRESS keeps status 'Active' and
       stays listed on purpose: outstanding expenses are usually settled on the
       way out, and hiding those people would block a legitimate payment. */
    api.get('/employees', { params: { view: 'list', enabled: 1 } })
      .then(r => setEmployees(Array.isArray(r.data) ? r.data : []))
      .catch(() => setEmployees([]));
  }, [open]);

  /* Lock background scroll while open (QA #99).
   *
   * The lock used to target `main`, which is the HTML element — but this app
   * scrolls inside <div class="main-content"> (see velzon/Layouts/index.tsx,
   * where #layout-wrapper is overflow:hidden and .main-content carries
   * overflowY:auto). There is no <main> element on the page at all, so the
   * query matched nothing and the page behind the modal kept scrolling.
   *
   * Every plausible scroll container is locked by selector rather than one
   * guessed element, and each one's previous inline value is restored — not
   * blanked — so a container that was deliberately styled keeps its styling. */
  useEffect(() => {
    if (!open) return;

    const targets: HTMLElement[] = [document.documentElement, document.body];
    document.querySelectorAll<HTMLElement>('main, .main-content, .page-content')
      .forEach(el => targets.push(el));

    const prev = targets.map(el => el.style.overflow);
    targets.forEach(el => { el.style.overflow = 'hidden'; });

    return () => {
      targets.forEach((el, i) => { el.style.overflow = prev[i]; });
    };
  }, [open]);

  const resetForm = () => {
    setEmpId(''); setPayable([]); setSelected(new Set());
    setReference(''); setPaymentType('Bank Transfer'); setExpenseType('Goods'); setNote(''); setProof(null);
  };

  const loadHistory = () => {
    setLoading(true);
    api.get('/expense-claims/batch-payments').then(r => setHistory(r.data?.data ?? [])).catch(() => setHistory([])).finally(() => setLoading(false));
  };
  const loadPayable = (id: number) => {
    setSelected(new Set()); setLoading(true);
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
    if (c.status === 'approved') return <span style={{ ...chip, background: 'var(--bpw-ok-bg)', color: 'var(--bpw-ok-fg)' }}>Approved</span>;
    const stageLabel = c.pending_stage === 'hr' ? 'Pending HR approval' : 'Pending reporting manager';
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...chip, background: 'var(--bpw-warn-bg-2)', color: 'var(--bpw-warn-fg)' }}>Pending review</span>
        <span style={{ fontSize: 10, color: 'var(--bpw-muted-2)' }}>({stageLabel})</span>
      </span>
    );
  };

  /* The shared table's columns. Sr No comes from <DataTable serial> and the
     pager rides inside the card, so histPage / histSlice / WorklistPager are
     no longer needed. (QA 114 / 129) */
  const historyColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      header: 'Date',
      id: 'date',
      accessorFn: (b: any) => b.paid_at,
      meta: { width: 120 },
      cell: info => fmtDate(info.row.original.paid_at),
    },
    {
      header: 'Employee',
      accessorKey: 'employee_name',
      meta: { width: 180, wrap: true },
      cell: info => {
        const b = info.row.original;
        return (
          <>
            <div style={{ fontWeight: 600 }}>{b.employee_name}</div>
            <div style={{ fontSize: 11, color: 'var(--bpw-muted)' }}>{b.employee_code}</div>
          </>
        );
      },
    },
    {
      header: 'Expense IDs',
      id: 'exp_nos',
      enableSorting: false,
      /* 240 + wrap: at 190 the row showed two ids and then clipped the "+N"
         pill that says how many more there are — the one part of the cell
         that cannot be inferred from what is visible. */
      meta: { width: 240, wrap: true },
      cell: info => <ExpenseIds nos={info.row.original.exp_nos} />,
    },
    { header: 'Method', accessorKey: 'payment_type', meta: { width: 130 } },
    {
      header: 'UTR / Reference',
      accessorKey: 'reference_number',
      meta: { width: 160 },
      cell: info => <span style={{ fontFamily: 'monospace' }}>{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Amount',
      id: 'total_amount',
      accessorFn: (b: any) => Number(b.total_amount ?? 0),
      meta: { width: 130, align: 'right' },
      cell: info => <span style={{ fontWeight: 600 }}>{inr(info.row.original.total_amount)}</span>,
    },
    {
      header: 'Note',
      accessorKey: 'note',
      meta: { width: 170, wrap: true },
      cell: info => {
        const n = info.row.original.note;
        return <span style={{ color: 'var(--bpw-muted)' }} title={n ?? ''}>{n || '—'}</span>;
      },
    },
    {
      header: 'Zoho',
      id: 'zoho',
      enableSorting: false,
      meta: { width: 120, align: 'center' },
      /* Synced rows report their STATE, not an action — a "View" link read as
         something still to do. The badge keeps the link when Zoho gave us a
         url; without one it is plain text. Unsynced rows keep the button. */
      cell: info => {
        const b = info.row.original;
        if (b.zoho_status === 'synced') {
          return b.zoho_url
            ? <a href={b.zoho_url} target="_blank" rel="noreferrer" style={syncedBadge} title="Open in Zoho"><i className="ri-checkbox-circle-fill" />Synced</a>
            : <span style={syncedBadge}><i className="ri-checkbox-circle-fill" />Synced</span>;
        }
        return (
          <button style={{ ...syncBtn, opacity: syncingId === b.id ? .6 : 1 }}
            disabled={syncingId === b.id} onClick={() => syncZoho(b.id)}>
            {syncingId === b.id ? 'Syncing…' : 'Zoho Sync'}
          </button>
        );
      },
    },
    {
      header: 'Proof',
      id: 'proof',
      enableSorting: false,
      meta: { width: 90, align: 'center' },
      cell: info => {
        const b = info.row.original;
        return b.proof_url
          ? <a href={tokenUrl(resolveFileUrl(b.proof_url))} target="_blank" rel="noreferrer" style={link}>File</a>
          : '—';
      },
    },
  ], [syncingId, syncZoho]);

  return createPortal(
    <>
      <style>{BPW_CSS}</style>
      <div style={backdrop} onMouseDown={saving ? undefined : onClose}>
        <div className="bpw-root" style={{ ...card, position: 'relative' }} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
          {/* Full-modal blocking loader while the payment is processing — no
              other control (close, reupload, pay again) is clickable until it
              finishes. (QA #112) */}
          {saving && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--bpw-veil)', backdropFilter: 'blur(1.5px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <svg className="bpw-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--bpw-accent-fg)' }}>Processing payment…</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bpw-muted)' }}>Please don’t close this window.</div>
            </div>
          )}
          {/* Header */}
          <div className="bpw-head" style={header}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={heroIco}><i className="ri-stack-line" /></span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>Pay Multiple Claims</div>
                <div style={{ fontSize: 11, opacity: .85, marginTop: 1 }}>Pay several small approved claims of one employee together — one UTR, one proof, one Zoho expense.</div>
              </div>
            </div>
            {/* The page action sits in the header, ahead of the close button —
               it belongs to the dialog, not to the list below it. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button style={headerCta} onClick={() => { resetForm(); setView('select'); }}><i className="ri-add-line" />Make New Payment</button>
              <button onClick={onClose} style={xBtn} aria-label="Close"><i className="ri-close-line" /></button>
            </div>
          </div>

          {/* HISTORY is the base popup's only content. */}
          <div className="bpw-body" style={body}>
            <DataTable<any>
              data={history}
              columns={historyColumns}
              /* In the toolbar, not above the card: the left half was empty and
                 the search floated alone on the right. */
              title="Previous batch payments"
              subtitle="One UTR, one proof, one Zoho expense per batch"
              serial={{ header: 'Sr No' }}
              accent="violet"
              loading={loading}
              minWidth={1180}
              emptyMessage="No batch payments yet."
            />          </div>
          <div className="bpw-foot" style={footer}>
            <div style={{ fontSize: 12.5, color: 'var(--bpw-muted)' }}>Pay several small approved claims of one employee at once.</div>
            <button style={ghostBtn} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {/* ═══ Nested wizard popup — opens ON TOP of the history popup when the
          user clicks "Make New Payment" (view select/pay). Closing it (✕ /
          backdrop / History) returns to the history popup underneath. ═══ */}
      {(view === 'select' || view === 'pay') && (
        <div style={{ ...backdrop, zIndex: 9100 }} onMouseDown={saving ? undefined : () => { resetForm(); setView('history'); }}>
          <div className="bpw-root" style={{ ...card, position: 'relative' }} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            {saving && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--bpw-veil)', backdropFilter: 'blur(1.5px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <svg className="bpw-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--bpw-accent-fg)' }}>Processing payment…</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bpw-muted)' }}>Please don’t close this window.</div>
              </div>
            )}
            <div className="bpw-head" style={header}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={heroIco}><i className="ri-stack-line" /></span>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>Pay Multiple Claims</div>
                  <div style={{ fontSize: 11, opacity: .85, marginTop: 1 }}>Pay several small approved claims of one employee together — one UTR, one proof, one Zoho expense.</div>
                </div>
              </div>
              <button onClick={() => { resetForm(); setView('history'); }} style={xBtn} aria-label="Close"><i className="ri-close-line" /></button>
            </div>
            <div className="bpw-rail" style={rail}>
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

          <div className="bpw-body" style={body}>
            {/* ───── STEP 1 — select employee + claims ───── */}
            {view === 'select' && (
              <>
                <div
                  style={{
                    maxWidth: 520,
                    marginBottom: 14,
                    position: 'relative',
                    zIndex: 100,
                  }}
                >
                  <label style={lbl}>
                    Employee <span style={req}>*</span>
                  </label>

                  <SearchableSelect
                    menuMaxHeight={188}
                    value={empId ? String(empId) : null}
                    options={employees.map(e => ({ value: String(e.id), raw: e }))}
                    onChange={v => {
                      const id = v ? Number(v) : '';
                      setEmpId(id);
                      if (id) loadPayable(id);
                      else setPayable([]);
                    }}
                    placeholder="Select employee…"
                    searchPlaceholder="Search by name or code…"
                    getSearchText={(e: Emp) => `${empName(e)} ${e.emp_code ?? ''}`}
                    renderTrigger={(e: Emp) => (
                      <span>{empName(e)}{e.emp_code ? ` (${e.emp_code})` : ''}</span>
                    )}
                    renderOption={(e: Emp) => (
                      <span>{empName(e)}{e.emp_code ? ` (${e.emp_code})` : ''}</span>
                    )}
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
                            : payable.map((c, i) => (
                              <tr key={c.id} style={selected.has(c.id) ? { background: 'var(--bpw-row-sel)' } : undefined}>
                                <td style={td}>{c.payable ? <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /> : <span title="Approve it first" style={{ color: 'var(--bpw-muted-2)' }}>—</span>}</td>
                                <td style={td}>{i + 1}</td>
                                <td style={{ ...td, fontFamily: 'monospace' }}>{c.exp_no}</td>
                                <td style={td}>{fmtDate(c.expense_date)}</td>
                                <td style={td}>{c.category_name || '—'}</td>
                                <td style={td}><div style={noteCell} title={c.note ?? ''}>{c.note || c.title}</div></td>
                                <td style={td}>{c.attachments || 0}</td>
                                <td style={{ ...td, fontWeight: 600 }}>{inr(c.amount)}</td>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: 'var(--bpw-muted)' }}><i className="ri-information-line" /> Only <b>approved</b> claims are selectable. Approve a pending one with <b>Review &amp; Approve</b> to include it.</div>
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
                    <select style={selectInput} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                      {['Bank Transfer', 'UPI', 'PhonePe', 'Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Goods / Service <span style={req}>*</span></label>
                    <select style={selectInput} value={expenseType} onChange={e => setExpenseType(e.target.value as 'Goods' | 'Service')}>
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
                    <input ref={proofInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={e => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) {
                        // Proof must be a receipt/image — no Excel/Word (QA #111).
                        const ext = (f.name.split('.').pop() || '').toLowerCase();
                        if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
                          toast.error('Unsupported file', 'Proof of payment must be a PDF, JPG, PNG or WEBP file.');
                          e.target.value = ''; return;
                        }
                        if (f.size > 2 * 1024 * 1024) {
                          toast.error('File too large', 'Proof must be 2 MB or smaller.');
                          e.target.value = ''; return;
                        }
                      }
                      setProof(f);
                      e.target.value = '';
                    }} />
                    {proof ? (
                      <div style={proofBox}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <i className="ri-file-text-line" style={{ fontSize: 18, color: 'var(--bpw-accent-fg)', flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: 'var(--bpw-text)' }}>{proof.name}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button type="button" style={proofBtn} onClick={() => window.open(URL.createObjectURL(proof), '_blank')}><i className="ri-eye-line" /> View</button>
                          <button type="button" style={proofBtn} onClick={() => proofInputRef.current?.click()}><i className="ri-refresh-line" /> Reupload</button>
                        </span>
                      </div>
                    ) : (
                      <div style={attachZone} onClick={() => proofInputRef.current?.click()}>
                        <i className="ri-attachment-2" style={{ fontSize: 16 }} /> <span style={{ fontWeight: 700, letterSpacing: .3 }}>ATTACH PROOF</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="bpw-foot" style={footer}>
            <div style={{ fontSize: 12.5, color: 'var(--bpw-muted)' }}>
              {view === 'pay' ? `Paying ${selected.size} claim(s) · ${inr(total)} · one itemised Zoho expense (sync separately).`
                : view === 'select' ? 'Only approved, unpaid claims can be batch-paid.'
                  : 'Pay several small approved claims of one employee at once.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {view === 'pay' && <button style={ghostBtn} onClick={() => setView('select')}>← Back</button>}
              {/* Closes the WIZARD, not the dialog — the history list is
                  underneath, and the ✕ and backdrop both go back to it. */}
              <button style={ghostBtn} onClick={() => { resetForm(); setView('history'); }}>Close</button>
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
      )}

      {/* Per-claim review (approve a pending claim) / view (an approved one). */}
      {/* Opened from the wizard popup (z-index 9100) — layer above it (9300) so
          the review/view modal isn't hidden behind the wizard. */}
      <ExpenseSettlementModal claimId={reviewId} review zIndexBase={9300} onClose={() => { setReviewId(null); if (empId) loadPayable(Number(empId)); }} onDone={() => { if (empId) loadPayable(Number(empId)); }} />
      <ExpenseSettlementModal claimId={viewId} readOnly zIndexBase={9300} onClose={() => setViewId(null)} onDone={() => {}} />
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

/* — inline styles (self-contained) —
   Violet, matching the rest of Expense Management: the approval dialogs, the
   Batch Payment / Export pills on the page behind, and .hrexp-cta. It was
   teal, which made this the only Expense surface in a different colour.
   Every stop was swapped at the SAME lightness, so the gradients, tints and
   shadows keep their shape and only the hue moved. */
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const card: React.CSSProperties = {
  /* maxHeight 100%, not 92vh. The backdrop is a flex container with padding:20,
     so it already reserves a 20px margin top and bottom — 92vh then capped the
     card ~4vh SHORT of the room it actually had, and that missing strip was
     enough to push the body into scrolling on a laptop or at browser zoom even
     when the content would otherwise have fit (QA #126). 100% fills the
     backdrop's content box exactly: 100vh − 40px. */
  width: '100%', maxWidth: 1340, maxHeight: '100%', display: 'flex', flexDirection: 'column',
  background: 'var(--bpw-surface)', color: 'var(--bpw-text)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 30px 80px rgba(2,44,52,.4)',
  // The SearchableSelect dropdown reads these Velzon theme variables for its
  // surfaces. This modal is portaled to <body> (outside the theme scope), so we
  // pin them here — otherwise the menu background is unresolved/transparent and
  // the table + note behind it bleed through.
  ['--vz-card-bg' as any]: 'var(--bpw-surface)',
  ['--vz-border-color' as any]: 'var(--bpw-border)',
  ['--vz-secondary-bg' as any]: 'var(--bpw-surface-2)',
  ['--vz-body-color' as any]: 'var(--bpw-text)',
  ['--vz-secondary-color' as any]: 'var(--bpw-muted)',
  ['--vz-primary' as any]: 'var(--bpw-accent-fg)',
  ['--vz-primary-bg-subtle' as any]: 'rgba(109,40,217,.10)',
};
/* Teal kept deliberately — this dialog is colour-coded for payments. What
   changes is the SCALE: it ran a 23px/800 title and a 44px chip against the
   15px/700 and 32px .rec-form-header uses everywhere else, which is what
   read as a different typeface (#61). No font-family was ever set here. */
const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 22px 12px', background: 'linear-gradient(120deg,#6d28d9,#7c5cfc 55%,#a78bfa)', color: '#fff', flexShrink: 0 };
const heroIco: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 };
const rail: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 28, padding: '12px 26px', borderBottom: '1px solid var(--bpw-border)', background: 'var(--bpw-surface-2)', flexShrink: 0 };
const selChip: React.CSSProperties = { background: '#6d28d9', color: '#fff', borderRadius: 999, padding: '6px 14px', fontWeight: 700, fontSize: 13 };
// flex-grow 0 so the body sizes to its content (never stretches to fill the
// card, which produced a spurious vertical scrollbar when everything already
// fit — QA #126). flex-shrink 1 + overflowY:auto still lets genuinely tall
// content scroll within the 92vh cap.
/* 8px at the sides: the table card inside carries its own border and
   toolbar padding, so a 22px gutter only narrowed the columns. Top and
   bottom keep the 22 — that gap is against the header band and the footer,
   not against a card edge. */
const body: React.CSSProperties = { padding: '22px 8px', overflowY: 'auto', flex: '0 1 auto', minHeight: 0 };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 26px', borderTop: '1px solid var(--bpw-border-soft)', background: 'var(--bpw-surface-2)', flexShrink: 0 };
/* The CTA as it sits ON the header gradient: a filled pill would fight the
   band it is painted on, so it takes the same translucent-white treatment
   as the close button beside it. */
const headerCta: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 34, padding: '0 14px', background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.30)', color: '#fff', borderRadius: 999, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' };
const xBtn: React.CSSProperties = { background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 17, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const rowBetween: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
const tableWrap: React.CSSProperties = {
  /* About five rows before it gives way. The thead is sticky, so the column
     labels stay with the rows being scrolled past. */
  overflowX: 'auto', overflowY: 'auto', maxHeight: 300,
  border: '1px solid var(--bpw-border)', borderRadius: 12,
};
const table: React.CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 };
/* Matched to .cpay-cols--head on the SPI Payment History table: 8.5px / 800 /
   .05em, uppercase, over a soft vertical wash. The colour is the violet
   equivalent of that table's #6b8a97 — muted, not the saturated violet it
   used before, which at this size and weight read as a second heading rather
   than a column label. */
const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, textAlign: 'left', padding: '9px 12px', background: 'var(--bpw-th-bg), var(--bpw-surface)', color: 'var(--bpw-th-fg)', borderBottom: '1px solid var(--bpw-accent-border)', fontSize: 8.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
/* 500 body / 600 emphasis, the same two weights .dt-table uses on the page
   behind this dialog — it carried no weight at all, so cells fell to the
   body default while the amounts ran at 700 and read heavier than anything
   outside. Size stays 13px: this is a focused dialog, not the dense list. */
const td: React.CSSProperties = { padding: '10px 12px', borderTop: '1px solid var(--bpw-border-soft)', verticalAlign: 'middle', fontWeight: 500 };
const emptyTd: React.CSSProperties = { padding: 26, textAlign: 'center', color: 'var(--bpw-muted-2)' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--bpw-label)', textTransform: 'uppercase', letterSpacing: .3, marginBottom: 5 };
const req: React.CSSProperties = { color: '#ef4444' };
/* 42px stated, not implied: the attach zone and the uploaded-proof row have
   to match it, and three controls agreeing by padding alone is how they
   drifted apart. */
const FIELD_H = 42;
const input: React.CSSProperties = { width: '100%', height: FIELD_H, padding: '0 12px', border: '1px solid var(--bpw-input-border)', borderRadius: 9, fontSize: 14, background: 'var(--bpw-surface)', boxSizing: 'border-box' };
/* The text input, minus the browser's own arrow. The chevron is drawn here
   so it follows the theme; a native one does not. */
const selectInput: React.CSSProperties = {
  ...input,
  appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  paddingRight: 34, cursor: 'pointer',
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237c5cfc' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
};
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 };
/* Teal, drawn from the header gradient above (#6d28d9 -> #7c5cfc -> #a78bfa)
   so the primary action belongs to this dialog rather than looking borrowed
   from the page behind it (#61). Geometry still matches .hrexp-cta — the
   pill that opens this modal — so only the hue differs. */
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, padding: '0 18px', background: 'linear-gradient(135deg,#a78bfa 0%,#7c5cfc 55%,#6d28d9 100%)', color: '#fff', border: 'none', borderRadius: 999, boxShadow: '0 8px 18px rgba(109,40,217,0.32)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, padding: '0 18px', background: 'var(--bpw-surface)', color: 'var(--bpw-text)', border: '1px solid var(--bpw-input-border)', borderRadius: 999, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' };
const ghostSm: React.CSSProperties = { background: 'var(--bpw-surface)', color: 'var(--bpw-accent-fg)', border: '1px solid var(--bpw-accent-border)', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const warnSm: React.CSSProperties = { background: 'var(--bpw-warn-bg)', color: 'var(--bpw-warn-fg)', border: '1px solid var(--bpw-warn-border)', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const disabledSm: React.CSSProperties = { background: 'var(--bpw-surface-2)', color: 'var(--bpw-muted-2)', border: '1px solid var(--bpw-border)', borderRadius: 7, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: 'not-allowed', whiteSpace: 'nowrap' };
const noteCell: React.CSSProperties = { maxWidth: 220, color: 'var(--bpw-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const attachZone: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: FIELD_H, padding: '0 14px', boxSizing: 'border-box', border: '1.5px dashed var(--bpw-accent-dash)', borderRadius: 9, background: 'var(--bpw-accent-soft)', color: 'var(--bpw-accent-fg)', cursor: 'pointer', fontSize: 13 };
const proofBox: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, height: FIELD_H, padding: '0 12px', boxSizing: 'border-box', border: '1px solid var(--bpw-input-border)', borderRadius: 9, background: 'var(--bpw-surface-2)' };
const proofBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bpw-surface)', color: 'var(--bpw-accent-fg)', border: '1px solid var(--bpw-accent-border)', borderRadius: 7, padding: '4px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const syncBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#7c5cfc', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
/* Reuses --bpw-ok-*, which already has a dark-mode pair, so the badge does
   not need its own colours maintained. */
const syncedBadge: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bpw-ok-bg)', color: 'var(--bpw-ok-fg)', border: 'none', borderRadius: 999, padding: '4px 10px', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', textDecoration: 'none' };
const link: React.CSSProperties = { color: 'var(--bpw-link)', fontWeight: 600, textDecoration: 'none' };
const chip: React.CSSProperties = { display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontWeight: 700, fontSize: 11 };
const idPill: React.CSSProperties = { display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: 'var(--bpw-pill-bg)', color: 'var(--bpw-pill-fg)', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' };
const morePill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 22, padding: '0 8px', borderRadius: 999, background: '#4f46e5', color: '#fff', fontWeight: 800, fontSize: 11, cursor: 'pointer' };
const popover: React.CSSProperties = { position: 'fixed', zIndex: 9100, minWidth: 220, maxWidth: 320, background: 'var(--bpw-surface)', border: '1px solid var(--bpw-border)', borderRadius: 12, boxShadow: '0 16px 40px rgba(15,23,42,.18)', padding: 12 };
const popTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: .5, color: 'var(--bpw-muted)', textTransform: 'uppercase', marginBottom: 8 };
const chipDark: React.CSSProperties = { display: 'inline-block', padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,.2)', color: '#fff', fontWeight: 700, fontSize: 11.5 };

/* Boxed wizard stepper — mirrors the Return-payment flow's stepper. */
const BPW_CSS = `
/* THEME TOKENS (QA #176). The modal was authored with its surfaces written as
   literal hexes, so in dark mode the card stayed white while the rest of the
   app went dark. It is portaled to <body> — and the "+N" popover is portaled
   separately again — so the tokens live on :root rather than on the card, or
   the popover would resolve none of them. Every name is --bpw- prefixed, so
   nothing outside this modal is touched. Velzon flips data-bs-theme on <html>;
   data-layout-mode is matched too because parts of the app still key off it. */
:root{
  --bpw-surface:#ffffff;
  --bpw-surface-2:#f8fafc;
  --bpw-border:#e2e8f0;
  --bpw-border-soft:#eef2f4;
  --bpw-input-border:#cbd5e1;
  --bpw-text:#0f172a;
  --bpw-label:#475569;
  --bpw-muted:#64748b;
  --bpw-muted-2:#94a3b8;
  --bpw-veil:rgba(255,255,255,.72);
  --bpw-row-sel:#f5f3ff;
  --bpw-accent-soft:#f5f3ff;
  --bpw-accent-dash:#c4b5fd;
  --bpw-warn-bg:#fffbeb;
  --bpw-pill-bg:#ede9fe;
  --bpw-pill-fg:#6d28d9;
  --bpw-th-bg:linear-gradient(180deg,#f1edfe,#faf8ff);
  --bpw-th-fg:#7d75a0;
  --bpw-step-pending-bg:#f8fafc;
  --bpw-accent-fg:#6d28d9;
  --bpw-accent-border:#ddd6fe;
  --bpw-link:#7c5cfc;
  --bpw-warn-fg:#a16207;
  --bpw-warn-border:#fde68a;
  --bpw-warn-bg-2:#fef3c7;
  --bpw-ok-bg:#d1fae5;
  --bpw-ok-fg:#065f46;
}
[data-bs-theme="dark"],
[data-layout-mode="dark"]{
  --bpw-surface:#212529;
  --bpw-surface-2:#2a2f34;
  --bpw-border:rgba(255,255,255,.13);
  --bpw-border-soft:rgba(255,255,255,.08);
  --bpw-input-border:rgba(255,255,255,.20);
  --bpw-text:#e9ecef;
  --bpw-label:#ced4da;
  --bpw-muted:#adb5bd;
  --bpw-muted-2:#8d959d;
  --bpw-veil:rgba(33,37,41,.78);
  --bpw-row-sel:rgba(167,139,250,.16);
  --bpw-accent-soft:rgba(124,92,252,.14);
  --bpw-accent-dash:#7c5cfc;
  --bpw-warn-bg:rgba(161,98,7,.18);
  --bpw-pill-bg:rgba(3,105,161,.30);
  --bpw-pill-fg:#c4b5fd;
  --bpw-th-bg:linear-gradient(180deg,rgba(124,92,252,.18),rgba(124,92,252,.10));
  --bpw-th-fg:#a79bc4;
  --bpw-step-pending-bg:rgba(255,255,255,.04);
  --bpw-accent-fg:#c4b5fd;
  --bpw-accent-border:rgba(196,181,253,.38);
  --bpw-link:#c4b5fd;
  --bpw-warn-fg:#fbbf24;
  --bpw-warn-border:rgba(251,191,36,.40);
  --bpw-warn-bg-2:rgba(161,98,7,.28);
  --bpw-ok-bg:rgba(16,185,129,.22);
  --bpw-ok-fg:#6ee7b7;
}
/* Native form controls and the file input keep the OS light scheme unless the
   subtree declares otherwise, which left white boxes inside the dark card. */
[data-bs-theme="dark"] .bpw-root,
[data-layout-mode="dark"] .bpw-root{color-scheme:dark;}
.bpw-root input,.bpw-root select,.bpw-root textarea{color:var(--bpw-text);}
@keyframes bpwSpin{to{transform:rotate(360deg);}}
.bpw-spin{animation:bpwSpin .8s linear infinite;transform-origin:center;}
/* No max-width: the rail is two steps, and capping it at 640px while every
   step was flex:1 is what truncated "Payment details" to "Payment deta…".
   Matches the Generate Document stepper, which sizes steps to content. */
.bpw-stepper{display:flex;align-items:center;gap:0;width:50%;}
/* SHORT VIEWPORTS — trim the chrome before the body starts scrolling.
   The header, step rail and footer are fixed-height and carry generous
   padding; on a laptop or at browser zoom they ate enough of the card that
   content which would otherwise have fit was pushed into a scrollbar (QA #126).
   !important because these three carry inline styles. */
@media (max-height: 800px){
  .bpw-head{padding:14px 22px !important;}
  .bpw-rail{padding:8px 22px !important;}
  .bpw-body{padding:14px !important;}
  .bpw-foot{padding:10px 22px !important;}
}
@media (max-width: 900px){
  /* A quarter of a narrow card is a sliver, not a step. */
  .bpw-stepper{width:100% !important;}
}
@media (max-height: 680px){
  .bpw-head{padding:10px 18px !important;}
  .bpw-rail{padding:6px 18px !important;}
  .bpw-body{padding:10px !important;}
  .bpw-foot{padding:8px 18px !important;}
}
.bpw-connector{flex:0 1 auto;min-width:28px;max-width:140px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.bpw-line{height:3px;width:100%;border-radius:2px;background:var(--bpw-border);}
.bpw-line[data-done="1"]{background:linear-gradient(90deg,#22c55e,#16a34a);}
.bpw-step{flex:1 1 0;padding:8px 13px;border-radius:12px;display:flex;align-items:center;gap:10px;position:relative;overflow:hidden;transition:all .25s;cursor:pointer;min-width:0;}
.bpw-badge-wrap{position:relative;flex-shrink:0;width:40px;height:40px;}
.bpw-badge{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .25s;}
.bpw-num{position:absolute;bottom:-3px;right:-3px;width:15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;border:2px solid var(--bpw-surface);line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.15);}
.bpw-text{min-width:0;flex:1;}
.bpw-title{font-size:12.5px;font-weight:800;letter-spacing:-.2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bpw-sub{font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bpw-step-active{background:linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%);border:2px solid #c4b5fd;box-shadow:0 6px 20px rgba(124,92,252,.18);}
.bpw-step-active .bpw-badge{background:linear-gradient(135deg,#7c5cfc,#6d28d9);color:#fff;box-shadow:0 5px 14px rgba(109,40,217,.48);}
.bpw-step-active .bpw-num{background:linear-gradient(135deg,#6d28d9,#5b21b6);color:#fff;}
.bpw-step-active .bpw-title{color:#2e1065;}
.bpw-step-active .bpw-sub{color:#6d28d9;}
.bpw-step-done{background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border:2px solid #34d399;box-shadow:0 6px 20px rgba(16,185,129,.18);}
.bpw-step-done .bpw-badge{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 5px 12px rgba(22,163,74,.42);}
.bpw-step-done .bpw-num{background:#fff;color:#16a34a;box-shadow:0 1px 3px rgba(22,163,74,.30);}
.bpw-step-done .bpw-title{color:#065f46;}
.bpw-step-done .bpw-sub{color:#059669;}
.bpw-step-pending{background:var(--bpw-step-pending-bg);border:1.5px solid var(--bpw-border);opacity:.85;}
.bpw-step-pending .bpw-badge{background:var(--bpw-surface-2);color:var(--bpw-muted-2);}
.bpw-step-pending .bpw-num{background:var(--bpw-border);color:var(--bpw-muted-2);}
.bpw-step-pending .bpw-title{color:var(--bpw-muted-2);}
.bpw-step-pending .bpw-sub{color:var(--bpw-muted-2);}
`;
const totalBanner: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: 'linear-gradient(120deg,#6d28d9,#7c5cfc 60%,#a78bfa)', color: '#fff', borderRadius: 14, padding: '18px 22px', marginBottom: 18, flexWrap: 'wrap' };
