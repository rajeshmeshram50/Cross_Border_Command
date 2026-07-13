import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../utils/formatDmy';

/* ────────────────────────────────────────────────────────────────────────────
 * Payment Summary Against PO  (+ nested "Update PO/SPI Payment" add-payment popup)
 *
 * Records payments made to a supplier against a Purchase Order. Payments ALWAYS
 * subtract from the PO's balance (never a separate SPI amount) — this same modal
 * opens from both the PO screen and the SPI screen (passing the SPI's linked PO
 * id + spiId for entry-point trace). Data loads per PO id from
 * GET /p2p/purchase-orders/{po}/payment-summary.
 * ──────────────────────────────────────────────────────────────────────── */

type Summary = {
  po: { id: number; code: string; pi_number: string | null; status: string };
  supplier: {
    name?: string; code?: string; type?: string; state?: string; stateCode?: string;
    city?: string; contact?: string; phone?: string; gstNo?: string; gstStatus?: string;
  };
  amounts: {
    base: number; gstPct: number; gstAmount: number; totalPo: number;
    tdsPct: number; tdsAmount: number; tdsCut: boolean; netPayable: number;
    amountPaid: number; balance: number; paidCount: number; progressPct: number;
  };
  payments: Array<{
    id: number; sr: number; amount: number; bank_name: string | null;
    utr_cheque_number: string | null; utr_cheque_date: string | null;
    attachment_url: string | null; attachment_name: string | null;
    balance_after: number; status: string;
  }>;
};

const inr = (n: number | null | undefined) =>
  '₹' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Local (not UTC) yyyy-mm-dd for the date input default. */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function PoPaymentModal({
  open, poId, spiId = null, onClose, onChanged,
}: {
  open: boolean;
  poId: number | null;
  spiId?: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  useScrollLock(open);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [tdsInput, setTdsInput] = useState('0');
  const [savingTds, setSavingTds] = useState(false);
  const [addOpen, setAddOpen] = useState(false);   // "Update Payment" sub-modal

  // "SPI" when opened from an SPI, else "PO" — drives the add-modal title/button.
  const label = spiId ? 'SPI' : 'PO';

  const load = () => {
    if (!poId) return;
    setLoading(true);
    api.get<{ status: boolean; data: Summary }>(`/p2p/purchase-orders/${poId}/payment-summary`)
      .then(({ data: r }) => { setData(r.data); setTdsInput(String(r.data.amounts.tdsPct ?? 0)); })
      .catch(() => toast.error('Load failed', 'Could not load the PO payment summary.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open || !poId) return;
    setAddOpen(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poId]);

  // Live TDS preview (persisted only on Save).
  const preview = useMemo(() => {
    if (!data) return null;
    const pct = Math.max(0, Math.min(100, Number(tdsInput) || 0));
    const tdsAmount = Math.round(data.amounts.base * pct) / 100;
    // Net payable = (base − TDS) + GST = base + GST − TDS.
    const baseGst = data.amounts.base + data.amounts.gstAmount;
    return { tdsAmount, netPayable: Math.round((baseGst - tdsAmount) * 100) / 100 };
  }, [data, tdsInput]);

  if (!open) return null;

  const a = data?.amounts;
  const sup = data?.supplier;
  // TDS is cut ONCE per PO: once cut, the % input + button lock (no re-cut).
  const tdsLocked = !!a?.tdsCut;
  // "Update Payment" is only allowed after the one-time TDS deduction is cut.
  const tryAddPayment = () => {
    if (!poId) return;
    if (!a?.tdsCut) { toast.warning('Cut the TDS first', 'Save the TDS deduction in Payment Details before recording a payment.'); return; }
    setAddOpen(true);
  };

  const saveTds = async () => {
    if (!poId) return;
    setSavingTds(true);
    try {
      const { data: r } = await api.post<{ status: boolean; data: Summary }>(
        `/p2p/purchase-orders/${poId}/payment-summary/tds`, { tds_percentage: Number(tdsInput) || 0 });
      setData(r.data); setTdsInput(String(r.data.amounts.tdsPct ?? 0));
      toast.success('TDS saved', 'Net payable recomputed.');
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save TDS %.');
    } finally { setSavingTds(false); }
  };

  return createPortal(
    <div className="pop-backdrop" onMouseDown={onClose}>
      <style>{CSS}</style>
      <div className="pop-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* ── Hero: title bar + supplier card share ONE continuous teal panel ── */}
        <div className="pop-hero">
          <div className="pop-head">
            <div className="pop-head-l">
              <span className="pop-head-ico"><IcoCard w={18} /></span>
              <span className="pop-head-title">Payment Summary Against PO</span>
              {data?.po.code && <span className="pop-chip">{data.po.code}</span>}
              {data?.po.pi_number && <span className="pop-chip">{data.po.pi_number}</span>}
            </div>
            <button className="pop-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {/* ── Supplier card (translucent, floating on the teal hero) ── */}
          <div className="pop-sup">
            <SupCell label="SUPPLIER" value={sup?.name} strong />
            <SupCell label="SUPPLIER CODE" value={sup?.code} />
            <SupCell label="TYPE" value={sup?.type} />
            <SupCell label="GST NUMBER" value={sup?.gstNo} />
            <SupCell label="GST STATUS" value={sup?.gstStatus} />
            <SupCell label="STATE" value={sup?.state ? `${sup.state}${sup.stateCode ? ` (${sup.stateCode})` : ''}` : undefined} />
            <SupCell label="CITY" value={sup?.city} />
            <SupCell label="CONTACT PERSON" value={sup?.contact} />
            <SupCell label="PHONE" value={sup?.phone} />
          </div>
        </div>

        <div className="pop-body">
          {/* ── KPI cards ── */}
          <div className="pop-kpis">
            <Kpi tone="teal"  label="TOTAL PO AMOUNT" value={inr(a?.totalPo)} sub="Incl. GST & charges" icon={<IcoDoc />} />
            <Kpi tone="green" label="AMOUNT PAID"     value={inr(a?.amountPaid)} sub={`${a?.paidCount ?? 0} payment${(a?.paidCount ?? 0) === 1 ? '' : 's'} recorded`} icon={<IcoCheck />} />
            <Kpi tone="amber" label="BALANCE AMOUNT"  value={inr(a?.balance)} sub="Outstanding" icon={<IcoWallet />} />
            <Kpi tone="blue"  label="TOTAL GST"       value={inr(a?.gstAmount)} sub={`${a?.gstPct ?? 0}% effective`} icon={<IcoPct />} />
            <Kpi tone="rose"  label="TDS AMOUNT"      value={inr(a?.tdsAmount)} sub="Deducted at source" icon={<IcoMinus />} />
          </div>

          {/* ── Progress ── */}
          <div className="pop-prog">
            <div className="pop-prog-top">
              <span>Payment Progress</span>
              <span className="pop-prog-num">{inr(a?.amountPaid)} of {inr(a?.totalPo)} · {a?.progressPct ?? 0}% paid</span>
            </div>
            <div className="pop-prog-bar"><div className="pop-prog-fill" style={{ width: `${a?.progressPct ?? 0}%` }} /></div>
          </div>

          {/* ── Payment Details (TDS) ── */}
          <Section tag="Payment" title="Payment Details" sub="Figures derived from PO line items · enter TDS % to compute net payable">
            <div className="pop-tbl-wrap">
              <table className="pop-tbl">
                <thead><tr>
                  <th>BASE AMOUNT (RATE)</th><th>GST AMOUNT</th><th>TOTAL PO AMOUNT</th>
                  <th>TDS DEDUCTION PERCENTAGE</th><th>TDS AMOUNT</th><th>NET PAYABLE AMOUNT (AFTER TDS DEDUCTION)</th><th className="pop-th-r">ACTION</th>
                </tr></thead>
                <tbody><tr>
                  <td><span className="pop-ro">{inr(a?.base)}</span></td>
                  <td><span className="pop-ro">{inr(a?.gstAmount)}</span></td>
                  <td><span className="pop-ro">{inr(a?.totalPo)}</span></td>
                  <td><input className="pop-in" type="number" min={0} max={100} value={tdsInput}
                       onChange={(e) => setTdsInput(e.target.value)} disabled={tdsLocked} /></td>
                  <td><span className="pop-ro">{inr(preview?.tdsAmount ?? a?.tdsAmount)}</span></td>
                  <td><span className="pop-ro">{inr(preview?.netPayable ?? a?.netPayable)}</span></td>
                  <td className="pop-td-r"><button className={`pop-btn-save ${a?.tdsCut ? 'is-cut' : ''}`} disabled={savingTds || tdsLocked} onClick={saveTds} title={a?.tdsCut ? 'TDS already cut for this PO' : 'Cut the TDS'}>{savingTds ? '…' : (a?.tdsCut ? '✓ Cut' : 'Save')}</button></td>
                </tr></tbody>
              </table>
            </div>
          </Section>

          {/* ── Payment History ── */}
          <Section
            tag="Payment"
            title={`Payment History Against ${label}`}
            sub="Recorded payments against this purchase order"
            right={<button className="pop-btn-add" disabled={!poId} onClick={tryAddPayment}>+ Update {label} Payment</button>}
            count={`${data?.payments.length ?? 0} transaction${(data?.payments.length ?? 0) === 1 ? '' : 's'}`}
          >
            <div className="pop-tbl-wrap">
              <table className="pop-tbl">
                <thead><tr>
                  <th>SR NO</th><th>AMOUNT TO BE PAY</th><th>BANK NAME</th><th>UTR / CHEQUE NUMBER</th>
                  <th>UTR / CHEQUE DATE</th><th>ATTACHMENT</th><th>BALANCE AMOUNT</th><th>STATUS</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="pop-empty">Loading…</td></tr>
                  ) : (data?.payments.length ?? 0) === 0 ? (
                    <tr><td colSpan={8} className="pop-empty">No payments recorded yet.</td></tr>
                  ) : data!.payments.map(p => (
                    <tr key={p.id}>
                      <td>{p.sr}</td>
                      <td className="pop-amt">{inr(p.amount)}</td>
                      <td>{p.bank_name || '—'}</td>
                      <td>{p.utr_cheque_number || '—'}</td>
                      <td>{p.utr_cheque_date ? formatDmy(new Date(p.utr_cheque_date)) : '—'}</td>
                      <td>{p.attachment_url
                        ? <a className="pop-link" href={p.attachment_url} target="_blank" rel="noreferrer">📎 {p.attachment_name || 'View'}</a>
                        : '—'}</td>
                      <td className="pop-amt">{inr(p.balance_after)}</td>
                      <td><span className={`pop-badge ${p.status === 'Cleared' ? 'is-ok' : 'is-pend'}`}>● {p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        {/* ── Footer ── */}
        <div className="pop-foot">
          <button className="pop-btn-ghost" onClick={onClose}>Previous</button>
          <button className="pop-btn-submit" onClick={onClose}>Submit</button>
        </div>
      </div>

      {/* ── Nested "Update PO/SPI Payment" add-payment popup ── */}
      {addOpen && data && poId && (
        <UpdatePaymentModal
          poId={poId}
          spiId={spiId}
          label={label}
          poCode={data.po.code}
          supplierName={data.supplier.name ?? ''}
          totalPo={data.amounts.totalPo}
          amountPaid={data.amounts.amountPaid}
          outstanding={data.amounts.balance}
          onClose={() => setAddOpen(false)}
          onSaved={(summary) => { setData(summary); setAddOpen(false); onChanged?.(); }}
        />
      )}
    </div>,
    document.body,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Update PO Payment" / "Update SPI Payment" — the add-a-payment popup.
 * ──────────────────────────────────────────────────────────────────────── */
function UpdatePaymentModal({
  poId, spiId, label, poCode, supplierName, totalPo, amountPaid, outstanding, onClose, onSaved,
}: {
  poId: number; spiId: number | null; label: string;
  poCode: string; supplierName: string;
  totalPo: number; amountPaid: number; outstanding: number;
  onClose: () => void;
  onSaved: (summary: Summary) => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [utr, setUtr] = useState('');
  const [utrDate, setUtrDate] = useState(todayLocal());
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.warning('Enter an amount', 'Payment amount must be greater than zero.'); return; }
    if (amt > outstanding + 0.001) { toast.warning('Exceeds balance', `Amount cannot exceed the outstanding balance of ${inr(outstanding)}.`); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(amt));
      if (bank.trim()) fd.append('bank_name', bank.trim());
      if (utr.trim()) fd.append('utr_cheque_number', utr.trim());
      if (utrDate) fd.append('utr_cheque_date', utrDate);
      if (spiId) fd.append('supplier_purchase_invoice_id', String(spiId));
      if (file) fd.append('attachment', file);
      const { data: r } = await api.post<{ status: boolean; data: Summary }>(
        `/p2p/purchase-orders/${poId}/payments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Payment recorded', 'The payment was added against this PO.');
      onSaved(r.data);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not record the payment.');
    } finally { setSaving(false); }
  };

  return (
    <div className="upm-backdrop" onMouseDown={onClose}>
      <div className="upm-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upm-head">
          <div className="upm-head-l">
            <span className="upm-head-ico"><IcoCard w={18} /></span>
            <div>
              <div className="upm-title">Update {label} Payment</div>
              <div className="upm-sub"><span className="upm-chip">{poCode}</span><span className="upm-dot">•</span>{supplierName}</div>
            </div>
          </div>
          <button className="upm-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upm-body">
          {/* Outstanding balance card */}
          <div className="upm-bal">
            <span className="upm-bal-ico"><IcoWallet /></span>
            <div className="upm-bal-txt">
              <div className="upm-bal-lab">OUTSTANDING BALANCE</div>
              <div className="upm-bal-val">{inr(outstanding)}</div>
            </div>
            <div className="upm-bal-chips">
              <span className="upm-bal-chip">Total PO {inr(totalPo)}</span>
              <span className="upm-bal-chip">Already Paid {inr(amountPaid)}</span>
            </div>
          </div>

          <div className="upm-grid">
            <label className="upm-fld">
              <span className="upm-fld-lab">AMOUNT TO BE PAY</span>
              <span className="upm-money"><span className="upm-money-pre">₹</span>
                <input className="upm-in upm-in-money" type="number" min={0} value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
              </span>
              <span className="upm-help">Outstanding balance: {inr(outstanding)}</span>
            </label>
            <label className="upm-fld">
              <span className="upm-fld-lab">UTR / CHEQUE DATE</span>
              <input className="upm-in" type="date" value={utrDate} onChange={(e) => setUtrDate(e.target.value)} />
            </label>
            <label className="upm-fld">
              <span className="upm-fld-lab">BANK NAME</span>
              <input className="upm-in" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Enter bank name" />
            </label>
            <label className="upm-fld">
              <span className="upm-fld-lab">UTR / CHEQUE NUMBER</span>
              <input className="upm-in" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="Enter UTR / cheque number" />
            </label>
            <label className="upm-fld upm-fld-full">
              <span className="upm-fld-lab">PROOF OF PAYMENT</span>
              <button type="button" className="upm-drop" onClick={() => fileRef.current?.click()}>
                <span className="upm-drop-ico"><IcoUpload /></span>
                <span className="upm-drop-txt">
                  <span className="upm-drop-t1">{file ? file.name : 'CLICK TO UPLOAD PROOF OF PAYMENT'}</span>
                  <span className="upm-drop-t2">{file ? 'Click to replace' : 'PDF, JPG or PNG · NO FILE CHOSEN'}</span>
                </span>
              </button>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <div className="upm-foot">
          <button className="upm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="upm-btn-save" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Payment'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── small presentational helpers ── */
function SupCell({ label, value, strong }: { label: string; value?: string | null; strong?: boolean }) {
  return (
    <div className="pop-sup-cell">
      <div className="pop-sup-lab">{label}</div>
      <div className={`pop-sup-val ${strong ? 'is-strong' : ''}`}>{value || '—'}</div>
    </div>
  );
}
function Kpi({ tone, label, value, sub, icon }: { tone: string; label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div className={`pop-kpi pop-kpi-${tone}`}>
      <span className="pop-kpi-ico">{icon}</span>
      <div className="pop-kpi-txt">
        <div className="pop-kpi-lab">{label}</div>
        <div className="pop-kpi-val">{value}</div>
        <div className="pop-kpi-sub">{sub}</div>
      </div>
    </div>
  );
}
function Section({ tag, title, sub, right, count, children }: { tag?: string; title: string; sub: string; right?: React.ReactNode; count?: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="pop-sec">
      <div className="pop-sec-head">
        <div className="pop-sec-l">
          <span className="pop-sec-ico"><IcoCard w={14} /></span>
          <div>
            <div className="pop-sec-title-row">
              {tag && <><span className="pop-sec-tag">{tag}</span><span className="pop-sec-div">|</span></>}
              <span className="pop-sec-title">{title}</span>
            </div>
            <div className="pop-sec-sub">{sub}</div>
          </div>
        </div>
        <div className="pop-sec-r">
          {count && <span className="pop-sec-count">{count}</span>}
          {right}
          <button type="button" className={`pop-sec-chev ${collapsed ? 'is-collapsed' : ''}`} onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand' : 'Collapse'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        </div>
      </div>
      {!collapsed && <div className="pop-sec-body">{children}</div>}
    </div>
  );
}

const IcoCard = ({ w = 16 }: { w?: number }) => <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
const IcoDoc = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IcoCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>;
const IcoWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 12h.01M2 10h20"/></svg>;
const IcoPct = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
const IcoMinus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
const IcoUpload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

const CSS = `
.pop-backdrop{position:fixed;inset:0;z-index:1090;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow-y:auto;font-family:var(--font-sans,'Inter',sans-serif);}
.pop-modal{width:100%;max-width:1180px;margin:auto;background:#f8fafc;border:1.5px solid rgba(255,255,255,.5);border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.45);display:flex;flex-direction:column;}
.pop-hero{background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);}
.pop-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px 12px;background:transparent;color:#fff;}
.pop-head-l{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;}
.pop-head-ico{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;}
.pop-head-title{font-size:16px;font-weight:800;}
.pop-chip{font-size:11px;font-weight:700;font-family:monospace;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:3px 10px;border-radius:20px;}
.pop-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;}
.pop-x:hover{background:rgba(255,255,255,.3);}
.pop-body{padding:18px 22px;display:flex;flex-direction:column;gap:14px;}
/* Inner supplier card aligns to the header's TEXT column: left edge starts at
   the "Payment Summary" heading (just past the 34px icon + 10px gap + 22px pad
   = 66px), right edge ends at the close (✕) button (22px pad + 30px btn = 52px). */
.pop-sup{margin:0 52px 18px 66px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:15px 20px;display:grid;grid-template-columns:repeat(5,1fr);gap:14px 18px;color:#e0f2fe;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);}
.pop-sup-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.72);}
.pop-sup-val{font-size:13px;font-weight:700;color:#fff;margin-top:2px;}
.pop-sup-val.is-strong{font-size:14px;}
.pop-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
.pop-kpi{background:#fff;border:1px solid #eef2f7;border-radius:14px;padding:10px 14px;display:flex;gap:10px;align-items:center;border-left:4px solid #94a3b8;box-shadow:0 4px 13px rgba(15,23,42,.06);}
.pop-kpi-ico{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
.pop-kpi-ico svg{width:18px;height:18px;}
.pop-kpi-teal{border-left-color:#06b6d4;} .pop-kpi-teal .pop-kpi-ico{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 7px 16px rgba(8,145,178,.38);}
.pop-kpi-green{border-left-color:#10b981;} .pop-kpi-green .pop-kpi-ico{background:linear-gradient(135deg,#34d399,#059669);box-shadow:0 7px 16px rgba(5,150,105,.34);}
.pop-kpi-amber{border-left-color:#f59e0b;} .pop-kpi-amber .pop-kpi-ico{background:linear-gradient(135deg,#fbbf24,#d97706);box-shadow:0 7px 16px rgba(217,119,6,.34);}
.pop-kpi-blue{border-left-color:#6366f1;} .pop-kpi-blue .pop-kpi-ico{background:linear-gradient(135deg,#818cf8,#4f46e5);box-shadow:0 7px 16px rgba(79,70,229,.34);}
.pop-kpi-rose{border-left-color:#f43f5e;} .pop-kpi-rose .pop-kpi-ico{background:linear-gradient(135deg,#fb7185,#e11d48);box-shadow:0 7px 16px rgba(225,29,72,.32);}
.pop-kpi-lab{font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#64748b;}
.pop-kpi-val{font-size:18px;font-weight:800;color:#0f172a;margin:2px 0;}
.pop-kpi-sub{font-size:10.5px;color:#94a3b8;font-weight:500;}
.pop-prog{background:linear-gradient(90deg,#e6f6fb 0%,#eefafc 45%,#f6fdfe 100%);border:1px solid #cdeef5;border-radius:12px;padding:14px 18px;}
.pop-prog-top{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;}
.pop-prog-num{color:#0e7490;font-weight:700;}
.pop-prog-bar{height:8px;background:#e2e8f0;border-radius:20px;overflow:hidden;}
.pop-prog-fill{height:100%;background:linear-gradient(90deg,#06b6d4,#0e7490);border-radius:20px;transition:width .3s;}
.pop-sec{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.04);}
.pop-sec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;background:linear-gradient(90deg,#c9edf5 0%,#e4fafc 52%,#f4fefe 100%);border-bottom:1px solid #cffafe;}
.pop-sec-l{display:flex;align-items:center;gap:11px;}
.pop-sec-ico{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#22d3ee,#0891b2);display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 5px 12px rgba(8,145,178,.34);}
.pop-sec-ico svg{width:16px;height:16px;}
.pop-sec-title-row{display:flex;align-items:center;gap:7px;}
.pop-sec-tag{font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:.02em;}
.pop-sec-div{color:#7dd3e0;font-weight:400;}
.pop-sec-title{font-size:13.5px;font-weight:800;color:#0c4a6e;letter-spacing:-.01em;}
.pop-sec-sub{font-size:10.5px;color:#0891b2;margin-top:2px;}
.pop-sec-r{display:flex;align-items:center;gap:10px;}
.pop-sec-count{font-size:11px;color:#64748b;font-weight:600;}
.pop-sec-chev{width:28px;height:28px;border-radius:50%;border:1px solid #cffafe;background:#fff;color:#0e7490;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(6,182,212,.18);flex-shrink:0;}
.pop-sec-chev:hover{background:#ecfeff;}
.pop-sec-chev svg{transition:transform .2s ease;}
.pop-sec-chev.is-collapsed svg{transform:rotate(-90deg);}
.pop-sec-body{padding:12px 16px;}
.pop-tbl-wrap{overflow-x:auto;}
.pop-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:760px;}
.pop-tbl thead tr{background:linear-gradient(90deg,#0e7490 0%,#0891b2 45%,#22d3ee 100%);}
.pop-tbl thead th{text-align:left;vertical-align:middle;padding:11px 12px;background:transparent;color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.04em;line-height:1.25;white-space:nowrap;}
.pop-tbl thead th:first-child{border-top-left-radius:9px;border-bottom-left-radius:9px;} .pop-tbl thead th:last-child{border-top-right-radius:9px;border-bottom-right-radius:9px;}
.pop-tbl thead th.pop-th-r{text-align:right;} .pop-tbl thead th.pop-th-c{text-align:center;}
.pop-tbl tbody td{padding:11px 12px;border-bottom:1px solid #eef2f7;color:#334155;font-weight:500;white-space:nowrap;vertical-align:middle;}
.pop-tbl tbody td.pop-td-r{text-align:right;} .pop-tbl tbody td.pop-td-c{text-align:center;}
.pop-ro{display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:6px 10px;font-weight:700;color:#334155;min-width:70px;}
.pop-in{width:100%;min-width:90px;height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:12px;font-family:inherit;outline:none;background:#fff;}
.pop-in:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.15);}
.pop-amt{font-weight:800;color:#0f172a;}
.pop-empty{text-align:center;color:#94a3b8;padding:22px;font-weight:500;}
.pop-btn-save{background:#0e7490;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;}
.pop-btn-save:hover:not(:disabled){background:#155e75;} .pop-btn-save:disabled{opacity:.6;cursor:not-allowed;}
.pop-btn-save.is-cut,.pop-btn-save.is-cut:disabled{background:linear-gradient(135deg,#34d399,#059669);color:#fff;opacity:1;cursor:default;box-shadow:0 3px 8px rgba(5,150,105,.3);}
.pop-btn-add{background:#0f172a;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;gap:5px;align-items:center;}
.pop-btn-add:hover:not(:disabled){background:#1e293b;} .pop-btn-add:disabled{opacity:.5;cursor:not-allowed;}
.pop-btn-ghost{background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:8px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;}
.pop-btn-ghost:hover{background:#f1f5f9;}
.pop-btn-submit{background:#0e7490;color:#fff;border:none;border-radius:8px;padding:9px 26px;font-size:13px;font-weight:800;cursor:pointer;}
.pop-btn-submit:hover{background:#155e75;}
.pop-badge{font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:20px;}
.pop-badge.is-ok{background:#dcfce7;color:#16a34a;} .pop-badge.is-pend{background:#fef3c7;color:#b45309;}
.pop-link{color:#0e7490;font-weight:600;text-decoration:none;} .pop-link:hover{text-decoration:underline;}
.pop-del{width:24px;height:24px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;}
.pop-foot{display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 22px;background:#fff;border-top:1px solid #e2e8f0;}

/* ── Update Payment popup ── */
.upm-backdrop{position:fixed;inset:0;z-index:1100;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px 16px;font-family:var(--font-sans,'Inter',sans-serif);}
.upm-modal{width:100%;max-width:760px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.5);display:flex;flex-direction:column;}
.upm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:linear-gradient(120deg,#0e7490,#06b6d4);color:#fff;}
.upm-head-l{display:flex;align-items:center;gap:11px;}
.upm-head-ico{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;}
.upm-title{font-size:15px;font-weight:800;}
.upm-sub{font-size:11.5px;color:rgba(255,255,255,.9);display:flex;align-items:center;gap:7px;margin-top:2px;}
.upm-chip{font-family:monospace;font-weight:700;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:2px 8px;border-radius:20px;}
.upm-dot{opacity:.7;}
.upm-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;}
.upm-x:hover{background:rgba(255,255,255,.3);}
.upm-body{padding:18px 20px;display:flex;flex-direction:column;gap:16px;}
.upm-bal{display:flex;align-items:center;gap:14px;background:linear-gradient(120deg,#ecfeff,#f0fdfa);border:1px solid #cffafe;border-radius:12px;padding:14px 16px;}
.upm-bal-ico{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.upm-bal-txt{flex:1;min-width:0;}
.upm-bal-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#0891b2;}
.upm-bal-val{font-size:22px;font-weight:800;color:#0f172a;}
.upm-bal-chips{display:flex;gap:8px;flex-wrap:wrap;}
.upm-bal-chip{font-size:11px;font-weight:700;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;white-space:nowrap;}
.upm-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;}
.upm-fld{display:flex;flex-direction:column;gap:5px;}
.upm-fld-full{grid-column:1/-1;}
.upm-fld-lab{font-size:10px;font-weight:700;letter-spacing:.05em;color:#64748b;}
.upm-in{height:44px;border:1.5px solid #cbd5e1;border-radius:10px;padding:0 12px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#0f172a;}
.upm-in:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.15);}
.upm-money{position:relative;display:flex;align-items:center;}
.upm-money-pre{position:absolute;left:12px;font-size:14px;font-weight:700;color:#0e7490;}
.upm-in-money{padding-left:28px;width:100%;}
.upm-help{font-size:10.5px;color:#64748b;font-weight:500;}
.upm-drop{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:#f8fafc;border:1.5px dashed #94d3e0;border-radius:12px;padding:16px 18px;cursor:pointer;}
.upm-drop:hover{background:#f0fdfa;border-color:#06b6d4;}
.upm-drop-ico{width:44px;height:44px;border-radius:11px;background:linear-gradient(135deg,#06b6d4,#0e7490);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.upm-drop-txt{display:flex;flex-direction:column;gap:2px;min-width:0;}
.upm-drop-t1{font-size:12.5px;font-weight:800;color:#0e7490;letter-spacing:.02em;}
.upm-drop-t2{font-size:10.5px;font-weight:600;color:#94a3b8;}
.upm-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;}
.upm-btn-ghost{background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:9px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;}
.upm-btn-ghost:hover:not(:disabled){background:#f1f5f9;}
.upm-btn-save{background:linear-gradient(120deg,#0e7490,#06b6d4);color:#fff;border:none;border-radius:9px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;}
.upm-btn-save:hover:not(:disabled){filter:brightness(1.05);} .upm-btn-save:disabled,.upm-btn-ghost:disabled{opacity:.6;cursor:not-allowed;}
@media (max-width:900px){.pop-sup,.pop-kpis{grid-template-columns:repeat(2,1fr);}.upm-grid{grid-template-columns:1fr;}}
`;
