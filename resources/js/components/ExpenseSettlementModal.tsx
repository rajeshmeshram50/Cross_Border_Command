import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

/**
 * Record Payment (settlement) for an APPROVED expense claim — a 2-step wizard,
 * styled to match the app's CLM/P2P draft wizards (teal header + step nav):
 *  Step 1 · Payment Verification — set the final sanctioned amount; if it's less
 *           than the claimed amount, capture the deduction reason. (Fixed once.)
 *  Step 2 · Final Payment — category (defaults to the claim's, "+" adds a new one
 *           from the master), proof of payment, expense type, amount (partial
 *           payments allowed), and a note.
 */

type Summary = {
  id: number;
  title: string;
  employee_name: string | null;
  currency: string | null;
  claimed_amount: number;
  category_id: number | null;
  category_name: string | null;
  sanctioned_amount: number | null;
  deduction_amount: number;
  deduction_reason: string | null;
  total_paid: number;
  remaining_amount: number | null;
  settlement_status: 'unpaid' | 'partial' | 'paid';
  payments: {
    id: number; amount: number; category_name: string | null;
    payment_type: string | null; expense_type: string | null;
    note: string | null; paid_by_name: string | null; paid_at: string | null;
  }[];
};

type Cat = { id: number; name: string; code?: string | null };

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [step, setStep] = useState<1 | 2>(1);

  const [sanctioned, setSanctioned] = useState('');
  const [deductionReason, setDeductionReason] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [expenseType, setExpenseType] = useState('');
  const [note, setNote] = useState('');

  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [addingBusy, setAddingBusy] = useState(false);

  const firstPayment = !summary?.sanctioned_amount;

  const loadCats = () =>
    api.get('/expense-claims/categories')
      .then(r => setCats(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => setCats([]));

  useEffect(() => {
    if (!open || claimId == null) { setSummary(null); return; }
    setStep(1);
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/expense-claims/${claimId}/settlement`).then(r => r.data),
      loadCats(),
    ])
      .then(([s]) => {
        setSummary(s);
        const first = !s.sanctioned_amount;
        setSanctioned(String(first ? s.claimed_amount : s.sanctioned_amount));
        setDeductionReason(s.deduction_reason ?? '');
        const remaining = first ? s.claimed_amount : (s.remaining_amount ?? 0);
        setAmount(String(remaining));
        setCategoryId(s.category_id ? String(s.category_id) : '');
        setPaymentType('');
        setExpenseType('');
        setNote(`Paid ${inr(remaining)} to ${s.employee_name || 'the employee'} towards "${s.title}".`);
      })
      .catch(() => toast.error('Load failed', 'Could not load the claim settlement.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimId]);

  const sanctionedNum = Math.max(0, Number(sanctioned) || 0);
  const claimed = summary?.claimed_amount ?? 0;
  const deduction = firstPayment ? Math.max(0, +(claimed - sanctionedNum).toFixed(2)) : (summary?.deduction_amount ?? 0);
  const paidSoFar = summary?.total_paid ?? 0;
  const remaining = useMemo(
    () => +((firstPayment ? sanctionedNum : (summary?.sanctioned_amount ?? 0)) - paidSoFar).toFixed(2),
    [firstPayment, sanctionedNum, summary, paidSoFar],
  );
  const amountNum = Math.max(0, Number(amount) || 0);

  const goStep2 = () => {
    if (firstPayment) {
      if (sanctionedNum <= 0) { toast.warning('Enter the sanctioned amount', 'The final amount to pay must be greater than zero.'); return; }
      if (sanctionedNum > claimed + 0.005) { toast.warning('Too high', `The sanctioned amount can't exceed the claimed amount (${inr(claimed)}).`); return; }
      if (deduction > 0.005 && !deductionReason.trim()) { toast.warning('Deduction reason required', 'Explain why the sanctioned amount is less than the claim.'); return; }
    }
    setAmount(String(remaining));
    setNote(`Paid ${inr(remaining)} to ${summary?.employee_name || 'the employee'} towards "${summary?.title ?? ''}".`);
    setStep(2);
  };

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    setAddingBusy(true);
    try {
      const { data: nc } = await api.get(`/master/expense_category/next-code`);
      const code = nc?.code || nc?.data?.code || `EXC-${Date.now().toString().slice(-4)}`;
      const { data: created } = await api.post('/master/expense_category', { code, name, status: 'Active' });
      await loadCats();
      const newId = created?.data?.id ?? created?.id;
      if (newId) setCategoryId(String(newId));
      setAddingCat(false); setNewCat('');
      toast.success('Category added', `"${name}" is now available.`);
    } catch (e: any) {
      toast.error('Could not add category', e?.response?.data?.message ?? 'Please try again.');
    } finally { setAddingBusy(false); }
  };

  const submit = async () => {
    if (claimId == null) return;
    if (amountNum <= 0) { toast.warning('Enter an amount', 'The payment amount must be greater than zero.'); return; }
    if (amountNum > remaining + 0.005) { toast.warning('Too high', `You can pay at most the remaining ${inr(remaining)}.`); return; }
    if (!paymentType) { toast.warning('Select payment type', 'Choose Cash, Cheque or UPI.'); return; }
    if (!expenseType) { toast.warning('Select expense type', 'Choose Goods or Service.'); return; }
    setSaving(true);
    try {
      const { data: r } = await api.post(`/expense-claims/${claimId}/settle`, {
        ...(firstPayment ? { sanctioned_amount: sanctionedNum, deduction_reason: deductionReason || null } : {}),
        amount: amountNum,
        category_id: categoryId ? Number(categoryId) : null,
        payment_type: paymentType,
        expense_type: expenseType,
        note: note || null,
      });
      toast.success('Payment recorded', r?.message ?? 'The settlement was recorded.');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error('Could not record payment', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return createPortal(
    <div className="esm-backdrop" onMouseDown={onClose}>
      <style>{CSS}</style>
      <div className="esm-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* ── Teal hero header ── */}
        <div className="esm-hero">
          <div className="esm-hero-l">
            <span className="esm-hero-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
            </span>
            <div>
              <div className="esm-hero-title">Record Payment{summary ? <span className="esm-hero-sub-inline"> · {summary.title}</span> : ''}</div>
              <div className="esm-hero-sub">Settle an approved expense claim · reimbursement</div>
            </div>
          </div>
          <div className="esm-hero-r">
            <span className="esm-step-pill">Step {step} of 2</span>
            <button className="esm-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── Step nav ── */}
        <div className="esm-steps">
          <div className={`esm-stepcard ${step === 1 ? 'is-active' : 'is-done'}`}>
            <span className="esm-stepnum">1</span>
            <div><div className="esm-steptitle">Payment Verification</div><div className="esm-stepdesc">Final amount &amp; deduction</div></div>
          </div>
          <div className={`esm-stepcard ${step === 2 ? 'is-active' : ''}`}>
            <span className="esm-stepnum">2</span>
            <div><div className="esm-steptitle">Final Payment</div><div className="esm-stepdesc">Category, method &amp; amount</div></div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="esm-body">
          {loading || !summary ? (
            <div className="esm-loading"><i className="ri-loader-4-line ri-spin" /> Loading…</div>
          ) : step === 1 ? (
            <>
              <div className="esm-grid">
                <div className="esm-ro"><label>EMPLOYEE</label><div className="esm-ro-v">{summary.employee_name || '—'}</div></div>
                <div className="esm-ro"><label>CLAIMED AMOUNT</label><div className="esm-ro-v">{inr(claimed)}</div></div>

                {firstPayment ? (
                  <>
                    <div className="esm-fld">
                      <label>FINAL SANCTIONED AMOUNT <span className="esm-req">*</span></label>
                      <input className="esm-in" type="number" min={0} value={sanctioned} onChange={e => setSanctioned(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="esm-ro"><label>DEDUCTION (AUTO)</label><div className={`esm-ro-v ${deduction > 0 ? 'is-neg' : ''}`}>{inr(deduction)}</div></div>
                    {deduction > 0.005 && (
                      <div className="esm-fld esm-col2">
                        <label>DEDUCTION REASON <span className="esm-req">*</span></label>
                        <textarea className="esm-in" rows={2} value={deductionReason} onChange={e => setDeductionReason(e.target.value)} placeholder="Why is the paid amount less than the claim?" />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="esm-ro"><label>SANCTIONED</label><div className="esm-ro-v">{inr(summary.sanctioned_amount ?? 0)}</div></div>
                    <div className="esm-ro"><label>PAID SO FAR</label><div className="esm-ro-v is-pos">{inr(paidSoFar)}</div></div>
                    <div className="esm-ro"><label>REMAINING</label><div className="esm-ro-v is-warn">{inr(remaining)}</div></div>
                    {summary.deduction_amount > 0 && (
                      <div className="esm-col2 esm-hint">Deduction: {inr(summary.deduction_amount)} — {summary.deduction_reason || '—'}</div>
                    )}
                  </>
                )}
              </div>

              {summary.payments.length > 0 && (
                <div className="esm-paylist">
                  <label>PAYMENTS SO FAR</label>
                  {summary.payments.map(p => (
                    <div className="esm-payrow" key={p.id}>
                      <span>{inr(p.amount)} · {p.payment_type || '—'} · {p.category_name || '—'}</span>
                      <span className="esm-muted">{p.paid_by_name || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="esm-grid">
              <div className="esm-fld">
                <label>CATEGORY</label>
                {!addingCat ? (
                  <div className="esm-inline">
                    <select className="esm-in" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                      <option value="">— Select category —</option>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" className="esm-plus" title="Add a new category" onClick={() => setAddingCat(true)}>+</button>
                  </div>
                ) : (
                  <div className="esm-inline">
                    <input className="esm-in" placeholder="New category name" value={newCat} onChange={e => setNewCat(e.target.value)} />
                    <button type="button" className="esm-addbtn" disabled={addingBusy || !newCat.trim()} onClick={addCategory}>{addingBusy ? '…' : 'Add'}</button>
                    <button type="button" className="esm-plus" onClick={() => { setAddingCat(false); setNewCat(''); }}>✕</button>
                  </div>
                )}
              </div>
              <div className="esm-fld">
                <label>PROOF OF PAYMENT <span className="esm-req">*</span></label>
                <select className="esm-in" value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                  <option value="UPI">UPI</option>
                </select>
              </div>
              <div className="esm-fld">
                <label>EXPENSE TYPE <span className="esm-req">*</span></label>
                <select className="esm-in" value={expenseType} onChange={e => setExpenseType(e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="Goods">Goods</option>
                  <option value="Service">Service</option>
                </select>
              </div>
              <div className="esm-fld">
                <label>AMOUNT <span className="esm-req">*</span> <span className="esm-muted">(max {inr(remaining)})</span></label>
                <input className="esm-in" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="esm-fld esm-col2">
                <label>NOTE</label>
                <textarea className="esm-in" rows={2} value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="esm-foot">
          <button className="esm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <div className="esm-foot-r">
            {step === 2 && <button className="esm-btn-ghost" onClick={() => setStep(1)} disabled={saving}>‹ Back</button>}
            {step === 1 ? (
              <button className="esm-btn-primary" onClick={goStep2} disabled={loading || !summary}>Next ›</button>
            ) : (
              <button className="esm-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Recording…' : 'Record Payment'}</button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CSS = `
.esm-backdrop{position:fixed;inset:0;z-index:2999990;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;}
.esm-modal{width:100%;max-width:760px;max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(2,44,52,.35);font-family:inherit;}
[data-bs-theme="dark"] .esm-modal{background:#0b1e27;color:#e2e8f0;}
/* Hero */
.esm-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);color:#fff;}
.esm-hero-l{display:flex;align-items:center;gap:12px;min-width:0;}
.esm-hero-ico{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-hero-title{font-size:16px;font-weight:800;line-height:1.2;}
.esm-hero-sub-inline{font-weight:600;opacity:.9;}
.esm-hero-sub{font-size:11.5px;opacity:.85;margin-top:1px;}
.esm-hero-r{display:flex;align-items:center;gap:10px;flex-shrink:0;}
.esm-step-pill{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:3px 11px;font-size:11px;font-weight:700;white-space:nowrap;}
.esm-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:13px;cursor:pointer;}
.esm-x:hover{background:rgba(255,255,255,.3);}
/* Steps */
.esm-steps{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 20px;background:#ecfeff;}
[data-bs-theme="dark"] .esm-steps{background:#0d2730;}
.esm-stepcard{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:#fff;border:1.5px solid #e2eef2;opacity:.7;}
[data-bs-theme="dark"] .esm-stepcard{background:#0b2029;border-color:#173947;}
.esm-stepcard.is-active{opacity:1;border-color:#0891b2;box-shadow:0 2px 10px rgba(8,145,178,.15);}
.esm-stepcard.is-done{opacity:1;}
.esm-stepnum{width:26px;height:26px;border-radius:50%;background:#0891b2;color:#fff;font-weight:800;font-size:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-stepcard:not(.is-active):not(.is-done) .esm-stepnum{background:#94a3b8;}
.esm-steptitle{font-size:12.5px;font-weight:700;color:#0c4a6e;}
[data-bs-theme="dark"] .esm-steptitle{color:#cffafe;}
.esm-stepdesc{font-size:10.5px;color:#64748b;}
/* Body */
.esm-body{padding:20px;overflow-y:auto;}
.esm-loading{text-align:center;color:#64748b;padding:30px 0;}
.esm-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.esm-col2{grid-column:1 / -1;}
.esm-fld,.esm-ro{display:flex;flex-direction:column;gap:5px;min-width:0;}
.esm-fld label,.esm-ro label,.esm-paylist>label{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#64748b;text-transform:uppercase;}
.esm-req{color:#ef4444;}
.esm-ro-v{font-size:14px;font-weight:700;color:#0f172a;}
[data-bs-theme="dark"] .esm-ro-v{color:#e2e8f0;}
.esm-ro-v.is-neg{color:#e11d48;}
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
.esm-hint{font-size:11.5px;color:#64748b;}
.esm-paylist{margin-top:16px;display:flex;flex-direction:column;gap:4px;}
.esm-payrow{display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px dashed #e2e8f0;}
.esm-muted{color:#94a3b8;}
/* Footer */
.esm-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid #eef2f4;background:#f8fafc;}
[data-bs-theme="dark"] .esm-foot{background:#0b1a22;border-color:#173947;}
.esm-foot-r{display:flex;gap:10px;}
.esm-btn-ghost{border:1.5px solid #d5dfe4;background:#fff;color:#475569;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;}
.esm-btn-ghost:hover{background:#f1f5f9;}
[data-bs-theme="dark"] .esm-btn-ghost{background:#0b2029;border-color:#173947;color:#cbd5e1;}
.esm-btn-primary{border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(120deg,#0891b2,#06b6d4);box-shadow:0 4px 12px rgba(8,145,178,.28);}
.esm-btn-primary:hover{filter:brightness(1.05);}
.esm-btn-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
@media (max-width:640px){.esm-grid,.esm-steps{grid-template-columns:1fr;}}
`;
