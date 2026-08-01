import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect } from './ui/MasterSelect';

/**
 * Record Payment (settlement) for an APPROVED expense claim — styled like the
 * app's "Payment Summary Against PO" screen (teal header + progress bar):
 *
 *  Overview (step 1) — the claim + employee's proof, the ONE-TIME deduction
 *    (editable only until the first payment locks it), the net-payable summary,
 *    and the PAYMENT HISTORY table. A single expense can be paid in several
 *    installments, so this is the landing screen you return to after each payment.
 *  Add Payment (step 2) — the payment entry form only: category (defaults to the
 *    claim's, "+" adds a new one), payment method, proof of payment, net payable,
 *    amount (partial allowed), note. Reached via the "+ Add Payment" button.
 *
 * The sanctioned amount = claim − Σ deductions, fixed on the first payment; every
 * later "+ Add Payment" skips straight to the form since deductions are locked.
 */

type Attachment = { name: string; size?: number | null; url: string };
type DeductionRow = { amount: number; reason: string };

type Summary = {
  id: number;
  claim_no: string | null;
  title: string;
  employee_name: string | null;
  expense_date: string | null;
  currency: string | null;
  claimed_amount: number;
  category_id: number | null;
  category_name: string | null;
  sanctioned_amount: number | null;
  deduction_amount: number;
  deductions: DeductionRow[];
  total_paid: number;
  remaining_amount: number | null;
  settlement_status: 'unpaid' | 'partial' | 'paid';
  attachments: Attachment[];
  payments: {
    id: number; amount: number; category_name: string | null;
    payment_type: string | null; expense_type: string | null;
    note: string | null; proof_name: string | null; proof_url: string | null;
    paid_by_name: string | null; paid_at: string | null;
  }[];
};

type Cat = { id: number; name: string; code?: string | null };

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};
const tokenUrl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(localStorage.getItem('cbc_token') || '')}`;

// KPI icons — same set as the PO "Payment Summary" modal.
const IcoDoc = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const IcoCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></svg>;
const IcoWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M16 12h.01M2 10h20" /></svg>;
const IcoMinus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;

export default function ExpenseSettlementModal({
  claimId, onClose, onDone,
}: {
  claimId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const open = claimId != null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  // The Add-Payment form opens as its own nested popup over the overview.
  const [showForm, setShowForm] = useState(false);

  // Editable deduction rows (first payment only).
  const [deductions, setDeductions] = useState<{ amount: string; reason: string }[]>([]);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [expenseType, setExpenseType] = useState('');
  const [note, setNote] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);

  const firstPayment = !summary?.sanctioned_amount;

  const loadCats = () =>
    api.get('/expense-claims/categories')
      .then(r => setCats(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => setCats([]));

  useEffect(() => {
    if (!open || claimId == null) { setSummary(null); return; }
    setShowForm(false);
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/expense-claims/${claimId}/settlement`).then(r => r.data),
      loadCats(),
    ])
      .then(([s]) => {
        setSummary(s);
        const first = !s.sanctioned_amount;
        setDeductions(first ? (s.deductions ?? []).map(d => ({ amount: String(d.amount), reason: d.reason })) : []);
        const remaining = first ? s.claimed_amount : (s.remaining_amount ?? 0);
        setAmount(String(remaining));
        setCategoryId(s.category_id ? String(s.category_id) : '');
        setPaymentType('');
        setExpenseType('');
        setProofFile(null);
        setNote(`Paid ${inr(remaining)} to ${s.employee_name || 'the employee'} towards "${s.title}".`);
      })
      .catch(() => toast.error('Load failed', 'Could not load the claim settlement.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimId]);

  const claimed = summary?.claimed_amount ?? 0;
  const totalDeduction = useMemo(
    () => +deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0).toFixed(2),
    [deductions],
  );
  const paidSoFar = summary?.total_paid ?? 0;
  const sanctioned = firstPayment ? +(claimed - totalDeduction).toFixed(2) : (summary?.sanctioned_amount ?? 0);
  const remaining = +(sanctioned - paidSoFar).toFixed(2);
  const amountNum = Math.max(0, Number(amount) || 0);
  const fullyPaid = !firstPayment && remaining <= 0.005;
  const payPct = sanctioned > 0 ? Math.min(100, Math.round((paidSoFar / sanctioned) * 100)) : 0;

  const setDed = (i: number, patch: Partial<{ amount: string; reason: string }>) =>
    setDeductions(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addDed = () => setDeductions(rows => [...rows, { amount: '', reason: '' }]);
  const removeDed = (i: number) => setDeductions(rows => rows.filter((_, idx) => idx !== i));

  const openPaymentForm = () => {
    setAmount(String(remaining));
    setPaymentType('');
    setExpenseType('');
    setProofFile(null);
    setNote(`Paid ${inr(remaining)} to ${summary?.employee_name || 'the employee'} towards "${summary?.title ?? ''}".`);
    setShowForm(true);
  };

  // Lock the ONE-TIME deduction (its own Submit button) — this fixes the net
  // payable before any payment. Once locked it can't be edited; the "+ Add
  // Payment" button in the Payment History header then becomes available.
  const submitDeductions = async () => {
    if (claimId == null || !summary) return;
    for (const d of deductions) {
      const amt = Number(d.amount) || 0;
      if (amt > 0 && !d.reason.trim()) { toast.warning('Deduction reason required', 'Every deduction needs a reason.'); return; }
    }
    if (totalDeduction >= claimed - 0.005) { toast.warning('Deductions too high', 'Deductions cannot equal or exceed the claimed amount.'); return; }
    setSaving(true);
    try {
      const { data: r } = await api.post(`/expense-claims/${claimId}/set-deductions`, {
        deductions: deductions.filter(d => (Number(d.amount) || 0) > 0).map(d => ({ amount: Number(d.amount), reason: d.reason })),
      });
      toast.success('Deduction locked', r?.message ?? 'The net payable is fixed. Use “+ Add Payment” to disburse.');
      const s = (await api.get<Summary>(`/expense-claims/${claimId}/settlement`)).data;
      setSummary(s);
      const rem = s.remaining_amount ?? s.sanctioned_amount ?? 0;
      setAmount(String(rem));
      setNote(`Paid ${inr(rem)} to ${s.employee_name || 'the employee'} towards "${s.title}".`);
    } catch (e: any) {
      toast.error('Could not lock deduction', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  const submit = async () => {
    if (claimId == null) return;
    if (amountNum <= 0) { toast.warning('Enter an amount', 'The payment amount must be greater than zero.'); return; }
    if (amountNum > remaining + 0.005) { toast.warning('Too high', `You can pay at most the remaining ${inr(remaining)}.`); return; }
    if (!paymentType) { toast.warning('Select a payment method', 'Choose how the reimbursement was paid.'); return; }
    if (!expenseType) { toast.warning('Select expense type', 'Choose Goods or Service.'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      if (firstPayment) {
        deductions.filter(d => (Number(d.amount) || 0) > 0).forEach((d, i) => {
          fd.append(`deductions[${i}][amount]`, String(Number(d.amount)));
          fd.append(`deductions[${i}][reason]`, d.reason);
        });
      }
      fd.append('amount', String(amountNum));
      if (categoryId) fd.append('category_id', categoryId);
      fd.append('payment_type', paymentType);
      fd.append('expense_type', expenseType);
      if (note) fd.append('note', note);
      if (proofFile) fd.append('proof', proofFile);
      const { data: r } = await api.post(`/expense-claims/${claimId}/settle`, fd);
      toast.success('Payment recorded', r?.message ?? 'The settlement was recorded.');
      onDone();
      // Close the Add-Payment popup and refresh the overview so the new payment
      // shows in the history; keep the main modal open.
      setShowForm(false);
      const s = (await api.get<Summary>(`/expense-claims/${claimId}/settlement`)).data;
      setSummary(s);
    } catch (e: any) {
      toast.error('Could not record payment', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return createPortal(
    <div className="esm-backdrop" onMouseDown={onClose}>
      <style>{CSS}</style>
      <div className="esm-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* ── Teal hero header (with embedded claim summary panel) ── */}
        <div className="esm-hero">
          <div className="esm-hero-top">
            <div className="esm-hero-l">
              <span className="esm-hero-ico">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
              </span>
              <div>
                <div className="esm-hero-eyebrow">HRMS · EXPENSE MANAGEMENT</div>
                <div className="esm-hero-title">Record Payment{summary ? <span className="esm-hero-sub-inline"> · {summary.title}</span> : ''}</div>
                <div className="esm-hero-sub">Settle an approved expense claim and record the reimbursement.</div>
              </div>
            </div>
            <button className="esm-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {summary && (
            <div className="esm-hpanel">
              <div className="esm-hp"><label>EXPENSE ID</label><div>{summary.claim_no || '—'}</div></div>
              <div className="esm-hp"><label>EMPLOYEE</label><div>{summary.employee_name || '—'}</div></div>
              <div className="esm-hp"><label>CLAIMED AMOUNT</label><div>{inr(claimed)}</div></div>
              <div className="esm-hp"><label>CATEGORY</label><div>{summary.category_name || '—'}</div></div>
              <div className="esm-hp"><label>RAISED DATE</label><div>{fmtDate(summary.expense_date)}</div></div>
              <div className="esm-hp"><label>CURRENCY</label><div>{summary.currency || 'INR'}</div></div>
              <div className="esm-hp esm-hp-proof">
                <label>PROOF OF PAYMENT (BY EMPLOYEE)</label>
                {summary.attachments.length === 0 ? (
                  <div className="esm-hp-none">No documents uploaded.</div>
                ) : (
                  <div className="esm-hp-docs">
                    {summary.attachments.map((a, i) => (
                      <a key={i} className="esm-hp-doc" href={tokenUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
                        <i className="ri-file-text-line" />
                        <span className="esm-hp-doc-name">{a.name}</span>
                        <i className="ri-external-link-line" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>


        {/* ── Body ── */}
        <div className="esm-body">
          {loading || !summary ? (
            <div className="esm-loading"><i className="ri-loader-4-line ri-spin" /> Loading…</div>
          ) : (
            <>
              {/* KPI strip — same look as the PO "Payment Summary" modal. */}
              <div className="esm-kpis">
                <div className="esm-kpi esm-kpi-teal">
                  <span className="esm-kpi-ico"><IcoDoc /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">CLAIMED AMOUNT</div>
                    <div className="esm-kpi-val">{inr(claimed)}</div>
                    <div className="esm-kpi-sub">Original claim</div>
                  </div>
                </div>
                <div className="esm-kpi esm-kpi-green">
                  <span className="esm-kpi-ico"><IcoCheck /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">AMOUNT PAID</div>
                    <div className="esm-kpi-val">{inr(paidSoFar)}</div>
                    <div className="esm-kpi-sub">{summary.payments.length} payment{summary.payments.length === 1 ? '' : 's'} recorded</div>
                  </div>
                </div>
                <div className="esm-kpi esm-kpi-amber">
                  <span className="esm-kpi-ico"><IcoWallet /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">BALANCE AMOUNT</div>
                    <div className="esm-kpi-val">{inr(remaining)}</div>
                    <div className="esm-kpi-sub">{fullyPaid ? 'Fully paid' : 'Outstanding'}</div>
                  </div>
                </div>
                <div className="esm-kpi esm-kpi-rose">
                  <span className="esm-kpi-ico"><IcoMinus /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">TOTAL DEDUCTED</div>
                    <div className="esm-kpi-val">{inr(firstPayment ? totalDeduction : (summary.deduction_amount || 0))}</div>
                    <div className="esm-kpi-sub">Deducted from claim</div>
                  </div>
                </div>
              </div>

              {/* Payment progress — sits above the deductions,
                  shown once the deduction is locked and payments can be recorded. */}
              {!firstPayment && (
                <div className="esm-prog2 esm-prog2--band">
                  <div className="esm-prog2-hd">
                    <span className="esm-prog2-lbl">Payment Progress</span>
                    <span className="esm-prog2-meta">{inr(paidSoFar)} of {inr(sanctioned)} net payable · {payPct}% paid</span>
                  </div>
                  <div className="esm-prog2-track"><div className="esm-prog2-fill" style={{ width: `${payPct}%` }} /></div>
                </div>
              )}

              {/* Deductions section — icon header, 2-col body (left deductions /
                  right net payable), submit button below. Editable only until the
                  first payment locks it (one-time). */}
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-scissors-cut-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Settlement</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Deductions</span>
                      </div>
                      <div className="esm-sec-sub">{firstPayment ? 'Apply any one-time deductions, then submit to lock the net payable' : 'Locked — the net payable is fixed for this claim'}</div>
                    </div>
                  </div>
                  {!firstPayment && <span className="esm-sec-badge esm-sec-badge--lock"><i className="ri-lock-2-line" /> Locked</span>}
                </div>
                <div className="esm-sec-body">
                  <div className="esm-ded-split">
                    <div className="esm-ded-l">
                      {firstPayment ? (
                        <>
                          <div className="esm-ded-hd">
                            <span className="esm-ded-hd-lbl">DEDUCTIONS (−)</span>
                            <button type="button" className="esm-ded-add" onClick={addDed}>+ Add</button>
                          </div>
                          {deductions.length === 0 ? (
                            <div className="esm-hint">No deductions — the full claimed amount will be sanctioned.</div>
                          ) : (
                            <div className="esm-ded-list">
                              {deductions.map((d, i) => (
                                <div className="esm-ded" key={i}>
                                  <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                                    <input className="esm-in" type="number" min={0} placeholder="0.00" value={d.amount} onChange={e => setDed(i, { amount: e.target.value })} />
                                  </div>
                                  <input className="esm-in esm-ded-reason" placeholder="Reason for this deduction…" value={d.reason} onChange={e => setDed(i, { reason: e.target.value })} />
                                  <button type="button" className="esm-ded-x" onClick={() => removeDed(i)} aria-label="Remove">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (summary.deductions ?? []).length > 0 ? (
                        <>
                          <div className="esm-ded-hd"><span className="esm-ded-hd-lbl">DEDUCTIONS APPLIED</span></div>
                          <div className="esm-ded-list">
                            {summary.deductions.map((d, i) => (
                              <div className="esm-payrow" key={i}><span>{d.reason}</span><span className="is-neg">− {inr(d.amount)}</span></div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="esm-ded-hd"><span className="esm-ded-hd-lbl">DEDUCTIONS</span></div>
                          <div className="esm-hint">No deductions were applied — the full claim is payable.</div>
                        </>
                      )}
                    </div>

                    <div className="esm-ded-r">
                      {firstPayment ? (
                        <div className="esm-sumbox">
                          <div className="esm-sumrow"><span>Claimed Amount</span><span>{inr(claimed)}</span></div>
                          <div className="esm-sumrow"><span>Total Deductions (−)</span><span className={totalDeduction > 0 ? 'is-neg' : ''}>− {inr(totalDeduction)}</span></div>
                          <div className="esm-sumrow is-grand"><span>Net Payable (Sanctioned)</span><span>{inr(sanctioned)}</span></div>
                        </div>
                      ) : (
                        <div className="esm-sumbox">
                          <div className="esm-sumrow"><span>Claimed Amount</span><span>{inr(claimed)}</span></div>
                          <div className="esm-sumrow"><span>Deducted (−)</span><span className={(summary.deduction_amount || 0) > 0 ? 'is-neg' : ''}>− {inr(summary.deduction_amount || 0)}</span></div>
                          <div className="esm-sumrow is-grand"><span>Net Payable (Sanctioned)</span><span>{inr(sanctioned)}</span></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {firstPayment && (
                    <div className="esm-sec-actions">
                      <span className="esm-sec-actions-hint">Once submitted, the deduction is locked and can’t be edited.</span>
                      <button type="button" className="esm-btn-submit" onClick={submitDeductions} disabled={saving || !summary}>{saving ? 'Submitting…' : 'Submit'}</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment History — a single expense may be paid in several installments. */}
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-history-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Payment</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Payment History</span>
                      </div>
                      <div className="esm-sec-sub">Recorded reimbursements against this claim</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    <span className="esm-sec-badge">{summary.payments.length} transaction{summary.payments.length === 1 ? '' : 's'}</span>
                    <button
                      type="button"
                      className="esm-sec-btn"
                      onClick={openPaymentForm}
                      disabled={firstPayment || fullyPaid}
                      title={firstPayment ? 'Submit the deduction first' : fullyPaid ? 'This claim is fully paid' : 'Record a payment'}
                    >
                      + Add Payment
                    </button>
                  </div>
                </div>
                <div className="esm-sec-body">
                  {summary.payments.length === 0 ? (
                    <div className="esm-hint">No payments recorded yet. Use “+ Add Payment” to record one.</div>
                  ) : (
                    <div className="esm-tblwrap">
                      <table className="esm-tbl">
                        <thead>
                          <tr>
                            <th>SR NO</th><th>AMOUNT PAID</th><th>METHOD</th><th>EXPENSE TYPE</th><th>PROOF</th><th>PAID BY</th><th>DATE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.payments.map((p, i) => (
                            <tr key={p.id}>
                              <td>{i + 1}</td>
                              <td className="esm-tbl-amt">{inr(p.amount)}</td>
                              <td>{p.payment_type || '—'}</td>
                              <td>{p.expense_type || '—'}</td>
                              <td>
                                {p.proof_url ? (
                                  <a className="esm-tbl-link" href={tokenUrl(p.proof_url)} target="_blank" rel="noreferrer" title={p.proof_name || 'Proof'}>
                                    <i className="ri-attachment-2" /> {p.proof_name || 'View'}
                                  </a>
                                ) : '—'}
                              </td>
                              <td>{p.paid_by_name || '—'}</td>
                              <td>{fmtDate(p.paid_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="esm-foot">
          <div className="esm-foot-hint">
            <i className="ri-information-line" />
            {fullyPaid ? 'This claim is fully paid.' : firstPayment ? 'Submit the one-time deduction, then use “+ Add Payment”.' : `Remaining ${inr(remaining)} — use “+ Add Payment” to disburse.`}
          </div>
          <div className="esm-foot-r">
            <button className="esm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          </div>
        </div>
      </div>

      {/* ── Add Payment — nested popup over the overview ── */}
      {showForm && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!saving) setShowForm(false); }}>
          <div className="esm-sub-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="esm-sub-head">
              <div className="esm-sub-head-l">
                <span className="esm-sub-head-ico"><i className="ri-bank-card-line" /></span>
                <div>
                  <div className="esm-sub-title">Record Payment</div>
                  <div className="esm-sub-hsub">
                    <span className="esm-sub-chip">{summary.claim_no || `#${summary.id}`}</span>
                    <span className="esm-sub-dot">•</span>
                    <span>{summary.employee_name || '—'}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="esm-sub-x" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close">✕</button>
            </div>
            <div className="esm-sub-body">
              {/* Outstanding balance strip (mirrors the PO "Update Payment" popup) */}
              <div className="esm-bal">
                <span className="esm-bal-ico"><IcoWallet /></span>
                <div className="esm-bal-txt">
                  <div className="esm-bal-lab">REMAINING (NET PAYABLE)</div>
                  <div className="esm-bal-val">{inr(remaining)}</div>
                </div>
                <div className="esm-bal-chips">
                  <span className="esm-bal-chip">Claimed {inr(claimed)}</span>
                  <span className="esm-bal-chip is-net">Net Payable {inr(sanctioned)}</span>
                  <span className="esm-bal-chip">Paid {inr(paidSoFar)}</span>
                </div>
              </div>
              <div className="esm-fgrid">
                {/* Row 1 — Category · Payment Method · Expense Type (4·4·4) */}
                <div className="esm-fld s4">
                  <label>CATEGORY</label>
                  <MasterSelect
                    value={categoryId}
                    onChange={setCategoryId}
                    options={cats.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="Select category"
                  />
                </div>
                <div className="esm-fld s4">
                  <label>PAYMENT METHOD <span className="esm-req">*</span></label>
                  <MasterSelect
                    value={paymentType}
                    onChange={setPaymentType}
                    options={['UPI', 'PhonePe', 'Cash', 'Cheque', 'Bank Transfer'].map(v => ({ value: v, label: v }))}
                    placeholder="Select method"
                  />
                </div>
                <div className="esm-fld s4">
                  <label>EXPENSE TYPE <span className="esm-req">*</span></label>
                  <div className="esm-radio-row">
                    {['Goods', 'Service'].map(v => (
                      <label key={v} className={`esm-radio ${expenseType === v ? 'is-on' : ''}`}>
                        <input type="radio" name="esm-exptype" checked={expenseType === v} onChange={() => setExpenseType(v)} />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Row 2 — Amount To Pay (4) · Proof of Payment (8) */}
                <div className="esm-fld s4">
                  <label>AMOUNT TO PAY <span className="esm-req">*</span> <span className="esm-muted">(max {inr(remaining)})</span></label>
                  <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                    <input className="esm-in" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <div className="esm-fld s8">
                  <label>PROOF OF PAYMENT</label>
                  {!proofFile ? (
                    <label className="esm-file">
                      <i className="ri-attachment-2" />
                      <span>Attach receipt / transfer proof</span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
                    </label>
                  ) : (
                    <div className="esm-file-chip">
                      <i className="ri-file-text-line" />
                      <span className="esm-file-name" title={proofFile.name}>{proofFile.name}</span>
                      <button type="button" className="esm-file-x" onClick={() => setProofFile(null)} aria-label="Remove">✕</button>
                    </div>
                  )}
                </div>

                {/* Row 3 — Note (12) */}
                <div className="esm-fld s12">
                  <label>NOTE</label>
                  <textarea className="esm-in" rows={2} value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="esm-sub-foot">
              <div className="esm-foot-hint"><i className="ri-information-line" /> Up to {inr(remaining)} can be paid.</div>
              <div className="esm-foot-r">
                <button className="esm-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Recording…' : 'Record Payment'}</button>
                <button className="esm-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

const CSS = `
.esm-backdrop{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;}
.esm-modal{width:100%;max-width:1240px;min-height:min(720px,94vh);max-height:94vh;display:flex;flex-direction:column;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 28px 70px rgba(2,44,52,.4);font-family:inherit;}
[data-bs-theme="dark"] .esm-modal{background:#0b1e27;color:#e2e8f0;}
/* Nested Add-Payment popup (over the overview) — styled like the PO "Update PO
   Payment" dialog: teal header + outstanding-balance strip + form. */
.esm-sub-backdrop{position:fixed;inset:0;z-index:9600;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;}
.esm-sub-modal{width:100%;max-width:1080px;max-height:92vh;display:flex;flex-direction:column;background:#fff;border:1.5px solid rgba(255,255,255,.5);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.5);}
[data-bs-theme="dark"] .esm-sub-modal{background:#0f172a;color:#e2e8f0;}
.esm-sub-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:linear-gradient(120deg,#0e7490,#06b6d4);color:#fff;}
.esm-sub-head-l{display:flex;align-items:center;gap:12px;min-width:0;}
.esm-sub-head-ico{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
.esm-sub-title{font-size:15px;font-weight:800;}
.esm-sub-hsub{font-size:11.5px;color:rgba(255,255,255,.9);display:flex;align-items:center;gap:7px;margin-top:2px;}
.esm-sub-chip{font-family:monospace;font-weight:700;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:2px 8px;border-radius:20px;}
.esm-sub-dot{opacity:.7;}
.esm-sub-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;flex-shrink:0;}
.esm-sub-x:hover{background:rgba(255,255,255,.3);}
.esm-sub-body{padding:18px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px;}
.esm-sub-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;border-top:1px solid #eef2f4;background:#f8fafc;}
[data-bs-theme="dark"] .esm-sub-foot{background:#0b1a22;border-color:#173947;}
/* Outstanding-balance strip */
.esm-bal{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;background:linear-gradient(120deg,#ecfeff,#f0fdfa);border:1px solid #cffafe;border-radius:12px;padding:14px 16px;}
[data-bs-theme="dark"] .esm-bal{background:linear-gradient(120deg,#0e2730,#0d2620);border-color:rgba(6,182,212,.28);}
.esm-bal-ico{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-bal-txt{flex:1 1 190px;min-width:170px;}
.esm-bal-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#0891b2;white-space:nowrap;}
.esm-bal-val{font-size:21px;font-weight:800;color:#0f172a;white-space:nowrap;line-height:1.2;}
[data-bs-theme="dark"] .esm-bal-val{color:#e2e8f0;}
.esm-bal-chips{display:flex;gap:8px;flex-wrap:wrap;flex:1 1 auto;justify-content:flex-end;}
.esm-bal-chip{font-size:11px;font-weight:700;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;white-space:nowrap;}
[data-bs-theme="dark"] .esm-bal-chip{background:#1e293b;border-color:rgba(148,163,184,.2);color:#cbd5e1;}
.esm-bal-chip.is-net{border-color:#7dd3e0;color:#0e7490;background:#f0fdff;}
[data-bs-theme="dark"] .esm-bal-chip.is-net{background:#0e2730;color:#67e8f9;border-color:rgba(6,182,212,.4);}
/* Add-Payment form — 12-col grid: row1 4·4·4, row2 4·8, row3 12 */
.esm-fgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px 18px;}
.esm-fgrid .s4{grid-column:span 4;}
.esm-fgrid .s8{grid-column:span 8;}
.esm-fgrid .s12{grid-column:span 12;}
@media (max-width:760px){.esm-fgrid .s4,.esm-fgrid .s8{grid-column:span 12;}}
/* Expense-type radio pair */
.esm-radio-row{display:flex;gap:10px;}
.esm-radio{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1.5px solid #dbe7ec;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:600;color:#475569;background:#fff;cursor:pointer;transition:border-color .15s,background .15s;}
.esm-radio input{accent-color:#0891b2;margin:0;}
.esm-radio.is-on{border-color:#0891b2;background:#ecfeff;color:#0e7490;box-shadow:0 0 0 3px rgba(34,211,238,.14);}
[data-bs-theme="dark"] .esm-radio{background:#0b2029;border-color:#173947;color:#cbd5e1;}
[data-bs-theme="dark"] .esm-radio.is-on{background:#0e2730;border-color:#0891b2;color:#67e8f9;}
.esm-hero{display:flex;flex-direction:column;gap:16px;padding:22px 28px;background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);color:#fff;}
.esm-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.esm-hero-l{display:flex;align-items:center;gap:14px;min-width:0;}
/* Embedded claim summary panel. Left edge indented past the hero icon so it
   lines up under the "Settle…" text; right edge stops at the close (×) button's
   left edge (32px button + a small gap). */
.esm-hpanel{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 20px;margin-left:62px;margin-right:40px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:14px 18px;}
.esm-hp{min-width:0;}
.esm-hp label{display:block;font-size:9.5px;font-weight:800;letter-spacing:.08em;opacity:.8;text-transform:uppercase;margin-bottom:3px;}
.esm-hp>div{font-size:14px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.esm-hp-proof{grid-column:span 2;}
.esm-hp-none{font-size:12px;font-weight:600;opacity:.75;}
.esm-hp-docs{display:flex;flex-wrap:wrap;gap:6px;}
.esm-hp-doc{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.16);color:#fff;text-decoration:none;font-size:12px;font-weight:600;}
.esm-hp-doc:hover{background:rgba(255,255,255,.28);}
.esm-hp-doc-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@media (max-width:820px){.esm-hpanel{grid-template-columns:repeat(2,1fr);margin-left:0;margin-right:0;}.esm-hp-proof{grid-column:span 2;}}
@media (max-width:480px){.esm-hpanel{grid-template-columns:1fr;}.esm-hp-proof{grid-column:span 1;}}
.esm-hero-ico{width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-hero-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.09em;opacity:.85;margin-bottom:2px;}
.esm-hero-title{font-size:20px;font-weight:800;line-height:1.15;}
.esm-hero-sub-inline{font-weight:600;opacity:.9;}
.esm-hero-sub{font-size:12px;opacity:.85;margin-top:3px;}
.esm-x{width:32px;height:32px;border-radius:9px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:14px;cursor:pointer;flex-shrink:0;}
.esm-x:hover{background:rgba(255,255,255,.3);}
/* Stage nav */
.esm-steps{display:flex;align-items:stretch;gap:10px;padding:16px 28px;background:#ecfeff;}
[data-bs-theme="dark"] .esm-steps{background:#0d2730;}
.esm-stepcard{flex:1;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;background:#fff;border:1.5px solid #e2eef2;opacity:.75;}
[data-bs-theme="dark"] .esm-stepcard{background:#0b2029;border-color:#173947;}
.esm-stepcard.is-active{opacity:1;border-color:#0891b2;border-top:3px solid #10b981;box-shadow:0 3px 14px rgba(8,145,178,.15);}
.esm-stepcard.is-done{opacity:1;}
.esm-steptxt{min-width:0;}
.esm-stepnum{width:34px;height:34px;border-radius:50%;background:#0891b2;color:#fff;font-weight:800;font-size:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-stepcard:not(.is-active):not(.is-done) .esm-stepnum{background:#94a3b8;}
.esm-step-eyebrow{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:800;letter-spacing:.08em;color:#0891b2;}
.esm-stepcard:not(.is-active) .esm-step-eyebrow{color:#94a3b8;}
.esm-active-pill{background:#dcfce7;color:#15803d;border-radius:999px;padding:1px 8px;font-size:9px;font-weight:800;letter-spacing:.04em;}
.esm-steptitle{font-size:14px;font-weight:800;color:#0c4a6e;line-height:1.2;margin-top:1px;}
[data-bs-theme="dark"] .esm-steptitle{color:#cffafe;}
.esm-stepdesc{font-size:11px;color:#64748b;}
.esm-step-chev{align-self:center;color:#67c8db;font-size:22px;font-weight:700;flex-shrink:0;}
.esm-body{padding:22px 28px;overflow-y:auto;flex:1;}
.esm-loading{text-align:center;color:#64748b;padding:30px 0;}
.esm-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.esm-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 20px;}
@media (max-width:720px){.esm-grid3{grid-template-columns:1fr 1fr;}}
@media (max-width:480px){.esm-grid3{grid-template-columns:1fr;}}
/* 12-column grid — row1: 3·3·3·3, row2: 3·3·6 (proof) */
.esm-grid12{display:grid;grid-template-columns:repeat(12,1fr);gap:14px 20px;align-items:start;}
.esm-grid12 .c3{grid-column:span 3;}
.esm-grid12 .c6{grid-column:span 6;}
@media (max-width:720px){.esm-grid12 .c3{grid-column:span 6;}.esm-grid12 .c6{grid-column:span 12;}}
@media (max-width:480px){.esm-grid12 .c3,.esm-grid12 .c6{grid-column:span 12;}}
.esm-divider{height:1px;background:#eef2f4;margin:4px 0 2px;}
[data-bs-theme="dark"] .esm-divider{background:#173947;}
.esm-col2{grid-column:1 / -1;}
.esm-fld,.esm-ro{display:flex;flex-direction:column;gap:5px;min-width:0;}
.esm-fld label,.esm-ro label,.esm-card>label,.esm-card-lbl,.esm-card-hd label{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#64748b;text-transform:uppercase;}
.esm-ro-sm{font-size:13px;font-weight:600;}
.esm-req{color:#ef4444;}
.esm-ro-v{font-size:14px;font-weight:700;color:#0f172a;}
[data-bs-theme="dark"] .esm-ro-v{color:#e2e8f0;}
.esm-ro-v.is-neg,.is-neg{color:#e11d48;}
.esm-ro-v.is-pos{color:#059669;}
.esm-ro-v.is-warn{color:#b45309;}
.esm-in{width:100%;border:1.5px solid #dbe7ec;border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;color:#0f172a;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;}
.esm-in:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.14);}
[data-bs-theme="dark"] .esm-in{background:#0b2029;border-color:#173947;color:#e2e8f0;}
textarea.esm-in{resize:vertical;}
.esm-inline{display:flex;gap:8px;align-items:stretch;}
.esm-inline .esm-in{flex:1;}
.esm-plus{width:40px;flex-shrink:0;border:1.5px solid #dbe7ec;border-radius:10px;background:#f1f5f9;color:#0891b2;font-size:16px;font-weight:700;cursor:pointer;}
.esm-plus:hover{background:#e0f2fe;}
.esm-addbtn{flex-shrink:0;border:none;border-radius:10px;background:#0891b2;color:#fff;font-weight:700;font-size:13px;padding:0 16px;cursor:pointer;}
.esm-addbtn:disabled{opacity:.5;cursor:not-allowed;}
.esm-hint{font-size:11.5px;color:#94a3b8;}
.esm-muted{color:#94a3b8;}
/* Read-only value styled like an input box (Net payable) */
.esm-ro-static{width:100%;border:1.5px solid #dbe7ec;border-radius:10px;padding:9px 12px;font-size:14px;font-weight:800;color:#0891b2;background:#f0fdff;}
[data-bs-theme="dark"] .esm-ro-static{background:#0b2029;border-color:#173947;color:#67e8f9;}
/* Proof-of-payment file picker */
.esm-file{display:flex;align-items:center;gap:8px;border:1.5px dashed #b6d9e2;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600;color:#0891b2;background:#f8feff;cursor:pointer;}
.esm-file:hover{background:#ecfeff;border-color:#22d3ee;}
.esm-file i{font-size:15px;}
.esm-file input{display:none;}
[data-bs-theme="dark"] .esm-file{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-file-chip{display:flex;align-items:center;gap:8px;border:1.5px solid #dbe7ec;border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:600;color:#0c4a6e;background:#f8fafc;}
.esm-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-file-x{width:26px;height:26px;flex-shrink:0;border:1.5px solid #fecdd3;border-radius:8px;background:#fff1f2;color:#e11d48;font-size:11px;cursor:pointer;}
.esm-file-x:hover{background:#ffe4e6;}
[data-bs-theme="dark"] .esm-file-chip{background:#0b2029;border-color:#173947;color:#cffafe;}
/* Cards — each Step-1 section sits in its own bordered card for a clean layout */
.esm-card{margin-top:16px;border:1.5px solid #e6eef2;border-left:4px solid #0891b2;border-radius:14px;padding:14px 16px;background:#fbfeff;display:flex;flex-direction:column;gap:10px;}
.esm-card--top{margin-top:0;border-left:1.5px solid #e6eef2;}
[data-bs-theme="dark"] .esm-card{background:#0c232c;border-color:#173947;border-left-color:#0891b2;}
[data-bs-theme="dark"] .esm-card--top{border-left-color:#173947;}
.esm-card-hd{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef4f6;padding-bottom:8px;}
[data-bs-theme="dark"] .esm-card-hd{border-color:#173947;}
/* Section card (Payment History / Payment Details) — left accent + header band */
/* Section cards — exact styling from the PO "Payment Summary" modal (pop-sec). */
.esm-sec{position:relative;margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.04);}
[data-bs-theme="dark"] .esm-sec{background:#0c232c;border-color:#173947;}
.esm-sec::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;z-index:5;background:linear-gradient(180deg,#22d3ee,#0891b2,#0e7490);}
.esm-sec-hd{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 16px;background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 25%,#cffafe 55%,#bff0f7 85%,#a5e9f3 100%);border-bottom:1px solid #9ce1ee;box-shadow:0 2px 0 rgba(255,255,255,.85) inset;}
[data-bs-theme="dark"] .esm-sec-hd{background:#0d2730;border-color:#173947;box-shadow:none;}
.esm-sec-hd::before{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
.esm-sec-hd::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(103,232,249,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(34,211,238,.28) 0%,transparent 55%);}
[data-bs-theme="dark"] .esm-sec-hd::before,[data-bs-theme="dark"] .esm-sec-hd::after{display:none;}
.esm-sec-l{position:relative;z-index:1;display:flex;align-items:center;gap:11px;}
.esm-sec-hd>.esm-sec-ico{position:relative;z-index:1;}
.esm-sec-ico{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 0 0 2.5px rgba(6,182,212,.22),0 3px 10px rgba(8,145,178,.4);font-size:15px;}
.esm-sec-tt{min-width:0;flex:1;position:relative;z-index:1;}
.esm-sec-title-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.esm-sec-tag{font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:.02em;}
.esm-sec-div{color:#7dd3e0;font-weight:400;}
.esm-sec-title{font-size:13.5px;font-weight:800;color:#0c4a6e;letter-spacing:-.01em;}
[data-bs-theme="dark"] .esm-sec-title{color:#cffafe;}
.esm-sec-sub{font-size:10.5px;color:#0e7490;margin-top:2px;}
[data-bs-theme="dark"] .esm-sec-sub{color:#67c8db;}
.esm-sec-badge{position:relative;z-index:1;flex-shrink:0;background:#fff;border:1px solid #cffafe;color:#0891b2;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;white-space:nowrap;}
[data-bs-theme="dark"] .esm-sec-badge{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-sec-badge--lock{background:#f1f5f9;border-color:#e2e8f0;color:#64748b;display:inline-flex;align-items:center;gap:4px;}
[data-bs-theme="dark"] .esm-sec-badge--lock{background:#0b2029;border-color:#173947;color:#94a3b8;}
.esm-sec-body{padding:14px 16px;background:linear-gradient(180deg,#f0fdff 0%,#f8fafc 100%);}
[data-bs-theme="dark"] .esm-sec-body{background:#0c232c;}
/* Section header right-side actions (+ Add Payment) */
.esm-sec-hd-actions{position:relative;z-index:1;display:flex;align-items:center;gap:10px;flex-shrink:0;}
.esm-sec-btn{border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(135deg,#0c4a6e,#0e7490);box-shadow:0 3px 10px rgba(14,116,144,.3);white-space:nowrap;display:inline-flex;gap:6px;align-items:center;}
.esm-sec-btn:hover:not(:disabled){filter:brightness(1.09);}
.esm-sec-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;}
/* Deductions 2-col body: left rows, right net-payable summary */
.esm-ded-split{display:flex;gap:16px;align-items:stretch;}
.esm-ded-l{flex:7;min-width:0;display:flex;flex-direction:column;gap:10px;}
.esm-ded-r{flex:3;min-width:0;display:flex;flex-direction:column;}
.esm-ded-r .esm-sumbox{margin-top:0;height:100%;display:flex;flex-direction:column;}
.esm-ded-r .esm-sumrow.is-grand{margin-top:auto;}
@media (max-width:720px){.esm-ded-split{flex-direction:column;}.esm-ded-l,.esm-ded-r{flex:1 1 auto;width:100%;}}
.esm-ded-hd{display:flex;align-items:center;justify-content:space-between;}
.esm-ded-hd-lbl{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#64748b;text-transform:uppercase;}
/* Submit-deduction action row under the 2-col body */
.esm-sec-actions{display:flex;align-items:center;justify-content:flex-end;gap:14px;margin-top:14px;padding-top:14px;border-top:1px solid #eef4f6;}
[data-bs-theme="dark"] .esm-sec-actions{border-color:#173947;}
.esm-sec-actions-hint{font-size:11.5px;color:#94a3b8;}
/* Bold Submit (lock deduction) button */
.esm-btn-submit{border:none;border-radius:10px;padding:11px 30px;font-size:14px;font-weight:800;letter-spacing:.02em;cursor:pointer;color:#fff;background:linear-gradient(120deg,#059669,#0891b2);box-shadow:0 6px 16px rgba(5,150,105,.35);}
.esm-btn-submit:hover{filter:brightness(1.06);}
.esm-btn-submit:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
/* KPI strip — exact styling/colors from the PO "Payment Summary" modal */
.esm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.esm-kpi{background:#fff;border:1px solid #eef2f7;border-radius:14px;padding:6px 13px;display:flex;gap:10px;align-items:center;border-left:4px solid #94a3b8;box-shadow:0 4px 13px rgba(15,23,42,.06);}
[data-bs-theme="dark"] .esm-kpi{background:#0c232c;border-color:#173947;}
.esm-kpi-txt{min-width:0;flex:1;}
.esm-kpi-ico{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
.esm-kpi-ico svg{width:18px;height:18px;}
.esm-kpi-teal{border-left-color:#06b6d4;} .esm-kpi-teal .esm-kpi-ico{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 7px 16px rgba(8,145,178,.38);}
.esm-kpi-green{border-left-color:#10b981;} .esm-kpi-green .esm-kpi-ico{background:linear-gradient(135deg,#34d399,#059669);box-shadow:0 7px 16px rgba(5,150,105,.34);}
.esm-kpi-amber{border-left-color:#f59e0b;} .esm-kpi-amber .esm-kpi-ico{background:linear-gradient(135deg,#fbbf24,#d97706);box-shadow:0 7px 16px rgba(217,119,6,.34);}
.esm-kpi-rose{border-left-color:#f43f5e;} .esm-kpi-rose .esm-kpi-ico{background:linear-gradient(135deg,#fb7185,#e11d48);box-shadow:0 7px 16px rgba(225,29,72,.32);}
.esm-kpi-lab{font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#5c7d9e;}
.esm-kpi-val{font-size:18px;font-weight:800;color:#123a5e;margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
[data-bs-theme="dark"] .esm-kpi-val{color:#e2e8f0;}
.esm-kpi-sub{font-size:10.5px;color:#7b96ad;font-weight:500;}
@media (max-width:720px){.esm-kpis{grid-template-columns:repeat(2,1fr);}}
@media (max-width:440px){.esm-kpis{grid-template-columns:1fr;}}
/* Payment progress bar */
.esm-prog2{margin-bottom:14px;}
.esm-prog2--band{margin-top:16px;margin-bottom:0;background:#f7feff;border:1px solid #e3eef2;border-radius:14px;padding:14px 18px;}
[data-bs-theme="dark"] .esm-prog2--band{background:#0c232c;border-color:#173947;}
.esm-prog2-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;}
.esm-prog2-lbl{font-size:11px;font-weight:800;letter-spacing:.05em;color:#0c4a6e;text-transform:uppercase;}
[data-bs-theme="dark"] .esm-prog2-lbl{color:#cffafe;}
.esm-prog2-meta{font-size:12px;font-weight:700;color:#0891b2;}
.esm-prog2-track{height:8px;border-radius:999px;background:#e2eef2;overflow:hidden;}
[data-bs-theme="dark"] .esm-prog2-track{background:#123642;}
.esm-prog2-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#10b981,#06b6d4);transition:width .3s;}
.esm-ded-add{border:1px dashed #22d3ee;background:#ecfeff;color:#0891b2;border-radius:8px;font-size:11.5px;font-weight:700;padding:3px 12px;cursor:pointer;}
.esm-ded-add:hover{background:#cffafe;}
/* Proof docs */
.esm-docs{display:flex;flex-wrap:wrap;gap:8px;}
.esm-doc{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:8px 12px;border:1.5px solid #dbe7ec;border-radius:10px;background:#f8fafc;color:#0c4a6e;text-decoration:none;font-size:12.5px;font-weight:600;}
.esm-doc:hover{border-color:#0891b2;background:#e0f2fe;}
.esm-doc-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-doc-ext{opacity:.55;font-size:12px;}
[data-bs-theme="dark"] .esm-doc{background:#0b2029;border-color:#173947;color:#cffafe;}
/* Deduction rows — show ~3, scroll the rest */
.esm-ded-list{display:flex;flex-direction:column;gap:8px;max-height:150px;overflow-y:auto;padding-right:4px;margin-right:-4px;}
.esm-ded-list::-webkit-scrollbar{width:7px;}
.esm-ded-list::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:7px;}
[data-bs-theme="dark"] .esm-ded-list::-webkit-scrollbar-thumb{background:#334155;}
.esm-ded{display:flex;gap:8px;align-items:center;}
.esm-ded-amt{display:flex;align-items:center;position:relative;flex:0 0 150px;}
.esm-ded-amt .esm-cur{position:absolute;left:11px;color:#64748b;font-size:13px;pointer-events:none;}
.esm-ded-amt .esm-in{padding-left:24px;}
.esm-ded-reason{flex:1;}
.esm-ded-x{width:34px;height:34px;flex-shrink:0;border:1.5px solid #fecdd3;border-radius:9px;background:#fff1f2;color:#e11d48;font-size:12px;cursor:pointer;}
.esm-ded-x:hover{background:#ffe4e6;}
/* 70 / 30 split — deductions on the left, claimed/summary on the right */
.esm-split{display:flex;gap:16px;margin-top:16px;align-items:stretch;}
.esm-split-l{flex:7;margin-top:0;min-width:0;}
.esm-split-r{flex:3;margin-top:0;min-width:0;display:flex;flex-direction:column;}
.esm-split-r .esm-sumrow.is-grand{margin-top:auto;}
@media (max-width:720px){.esm-split{flex-direction:column;}.esm-split-l,.esm-split-r{flex:1 1 auto;width:100%;}}
/* Summary box */
.esm-sumbox{margin-top:16px;border:1.5px solid #cffafe;border-radius:12px;overflow:hidden;}
[data-bs-theme="dark"] .esm-sumbox{border-color:#173947;}
.esm-sumrow{display:flex;justify-content:space-between;padding:9px 14px;font-size:12.5px;font-weight:600;color:#334155;background:#f8feff;}
.esm-sumrow+.esm-sumrow{border-top:1px solid #e2eef2;}
[data-bs-theme="dark"] .esm-sumrow{background:#0d2730;color:#cbd5e1;}
.esm-sumrow.is-grand{background:linear-gradient(120deg,#0891b2,#06b6d4);color:#fff;font-weight:800;font-size:13.5px;}
.esm-payrow{display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px dashed #e2e8f0;}
/* Payment history table */
/* History table — exact styling from the PO "Payment Summary" table (pop-tbl). */
.esm-tblwrap{overflow-x:auto;overflow-y:hidden;border-radius:12px;border:1px solid #dbeef4;box-shadow:0 2px 8px rgba(15,23,42,.05);}
[data-bs-theme="dark"] .esm-tblwrap{border-color:#173947;box-shadow:none;}
.esm-tbl{width:100%;border-collapse:collapse;font-size:12px;background:transparent;}
.esm-tbl thead tr{background:linear-gradient(90deg,#0e7490 0%,#0891b2 45%,#22d3ee 100%);}
.esm-tbl thead th{text-align:left;vertical-align:middle;background:transparent;color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.04em;line-height:1.25;padding:11px 12px;white-space:nowrap;}
[data-bs-theme="dark"] .esm-tbl thead tr{background:linear-gradient(90deg,#0e5566,#0b6f85 55%,#0e7f97);}
.esm-tbl tbody tr,.esm-tbl tbody td{background:#fff;}
.esm-tbl tbody td{padding:11px 12px;border-bottom:1px solid #eef2f7;color:#334155;font-weight:500;white-space:nowrap;vertical-align:middle;}
[data-bs-theme="dark"] .esm-tbl tbody tr,[data-bs-theme="dark"] .esm-tbl tbody td{background:#0c232c;border-color:#132e39;color:#cbd5e1;}
.esm-tbl tbody tr:hover td{background:#f6fdff;}
[data-bs-theme="dark"] .esm-tbl tbody tr:hover td{background:#0e2a34;}
.esm-tbl-amt{font-weight:800;color:#0f172a;}
[data-bs-theme="dark"] .esm-tbl-amt{color:#e2e8f0;}
.esm-tbl-link{display:inline-flex;align-items:center;gap:5px;max-width:170px;overflow:hidden;text-overflow:ellipsis;color:#0891b2;text-decoration:none;font-weight:600;}
.esm-tbl-link:hover{text-decoration:underline;}
.esm-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 28px;border-top:1px solid #eef2f4;background:#f8fafc;}
[data-bs-theme="dark"] .esm-foot{background:#0b1a22;border-color:#173947;}
.esm-foot-hint{display:flex;align-items:center;gap:7px;font-size:12px;color:#64748b;min-width:0;}
.esm-foot-hint i{color:#0891b2;font-size:15px;flex-shrink:0;}
.esm-foot-r{display:flex;gap:10px;flex-shrink:0;}
.esm-btn-ghost{border:1.5px solid #d5dfe4;background:#fff;color:#475569;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;}
.esm-btn-ghost:hover{background:#f1f5f9;}
[data-bs-theme="dark"] .esm-btn-ghost{background:#0b2029;border-color:#173947;color:#cbd5e1;}
.esm-btn-primary{border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(120deg,#0891b2,#06b6d4);box-shadow:0 4px 12px rgba(8,145,178,.28);}
.esm-btn-primary:hover{filter:brightness(1.05);}
.esm-btn-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
@media (max-width:640px){.esm-grid,.esm-steps{grid-template-columns:1fr;}.esm-ded-amt{flex-basis:120px;}}
`;
