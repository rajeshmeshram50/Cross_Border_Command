import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
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
  const [gstOpen, setGstOpen] = useState(false);   // GST amount breakdown sub-modal

  // "SPI" when opened from an SPI, else "PO" — drives the add-modal title/button.
  const label = spiId ? 'SPI' : 'PO';
  // Direct-SPI mode: no linked PO → pay against the SPI itself (SPI endpoints).
  // With-PO SPI (both ids) still pays through the PO (poId present).
  const spiMode = !poId && !!spiId;
  const entityId = poId ?? spiId;
  const apiBase = spiMode ? `/p2p/supplier-purchase-invoices/${spiId}` : `/p2p/purchase-orders/${poId}`;

  const load = () => {
    if (!entityId) return;
    setLoading(true);
    api.get<{ status: boolean; data: Summary }>(`${apiBase}/payment-summary`)
      .then(({ data: r }) => { setData(r.data); setTdsInput(String(r.data.amounts.tdsPct ?? 0)); })
      .catch(() => toast.error('Load failed', `Could not load the ${label} payment summary.`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open || !entityId) return;
    setAddOpen(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poId, spiId]);

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
    if (!entityId) return;
    if (!a?.tdsCut) { toast.warning('Deduct the TDS first', 'Save the TDS deduction in Payment Details before recording a payment.'); return; }
    setAddOpen(true);
  };

  const saveTds = async () => {
    if (!entityId) return;
    setSavingTds(true);
    try {
      const { data: r } = await api.post<{ status: boolean; data: Summary }>(
        `${apiBase}/payment-summary/tds`, { tds_percentage: Number(tdsInput) || 0 });
      setData(r.data); setTdsInput(String(r.data.amounts.tdsPct ?? 0));
      toast.success('TDS deducted', `TDS can be deducted only once for this ${label}.`);
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
              <span className="pop-head-title">Payment Summary Against {label}</span>
              {data?.po.code && <span className="pop-chip">{data.po.code}</span>}
              {data?.po.pi_number && <span className="pop-chip">{data.po.pi_number}</span>}
            </div>
            <button className="pop-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {/* ── Supplier card (translucent, floating on the teal hero) ── */}
          <div className="pop-sup">
            {loading && !data ? (
              Array.from({ length: 9 }).map((_, i) => (
                <div className="pop-sup-cell" key={i}>
                  <div className="pop-sk pop-sk--hero" style={{ width: '55%', height: 8, marginBottom: 6 }} />
                  <div className="pop-sk pop-sk--hero" style={{ width: '82%', height: 12 }} />
                </div>
              ))
            ) : (
              <>
                <SupCell label="SUPPLIER" value={sup?.name} strong />
                <SupCell label="SUPPLIER CODE" value={sup?.code} />
                <SupCell label="TYPE" value={sup?.type} />
                <SupCell label="GST NUMBER" value={sup?.gstNo} />
                <SupCell label="GST STATUS" value={sup?.gstStatus} />
                <SupCell label="STATE" value={sup?.state ? `${sup.state}${sup.stateCode ? ` (${sup.stateCode})` : ''}` : undefined} />
                <SupCell label="CITY" value={sup?.city} />
                <SupCell label="CONTACT PERSON" value={sup?.contact} />
                <SupCell label="PHONE" value={sup?.phone} />
              </>
            )}
          </div>
        </div>

        {loading && !data ? <PopBodySkeleton /> : <div className="pop-body">
          {/* ── KPI cards ── */}
          <div className="pop-kpis">
            <Kpi tone="teal"  label={`TOTAL ${label} AMOUNT`} value={inr(a?.totalPo)} sub="Incl. GST & charges" icon={<IcoDoc />} />
            <Kpi tone="green" label="AMOUNT PAID"     value={inr(a?.amountPaid)} sub={`${a?.paidCount ?? 0} payment${(a?.paidCount ?? 0) === 1 ? '' : 's'} recorded`} icon={<IcoCheck />} />
            <Kpi tone="amber" label="BALANCE AMOUNT"  value={inr(a?.balance)} sub="Outstanding" icon={<IcoWallet />} />
            <Kpi tone="blue"  label="TOTAL GST"       value={inr(a?.gstAmount)} sub={`${a?.gstPct ?? 0}% effective`} icon={<IcoPct />} />
            <Kpi tone="rose"  label="TDS AMOUNT"      value={inr(a?.tdsAmount)} sub="Deducted at source" icon={<IcoMinus />} />
          </div>

          {/* ── Progress ── */}
          <div className="pop-prog">
            <div className="pop-prog-top">
              <span>Payment Progress</span>
              <span className="pop-prog-num">{inr(a?.amountPaid)} of {inr(a?.netPayable)} net payable · {a?.progressPct ?? 0}% paid</span>
            </div>
            <div className="pop-prog-bar"><div className="pop-prog-fill" style={{ width: `${a?.progressPct ?? 0}%` }} /></div>
          </div>

          {/* ── Payment Details (TDS) ── */}
          <Section tag="Payment" title="Payment Details" sub={`Figures derived from ${label} line items · enter TDS % to compute net payable`}
            right={<button type="button" className="pop-gstbtn" disabled={!entityId} onClick={(e) => { e.stopPropagation(); setGstOpen(true); }} title="View the per-product CGST / SGST breakdown">
              <IcoPct /><span>GST Breakdown</span>
            </button>}>
            <div className="pop-tbl-wrap">
              <table className="pop-tbl pop-tbl-c">
                <thead><tr>
                  <th>BASE AMOUNT<br />(RATE)</th><th>GST AMOUNT</th><th>TOTAL {label} AMOUNT</th>
                  <th>TDS DEDUCTION<br />PERCENTAGE (%)</th><th>TDS AMOUNT</th><th>NET PAYABLE AMOUNT<br />AFTER TDS DEDUCTION</th><th>ACTION</th>
                </tr></thead>
                <tbody><tr>
                  <td><span className="pop-ro">{inr(a?.base)}</span></td>
                  <td><span className="pop-ro">{inr(a?.gstAmount)}</span></td>
                  <td><span className="pop-ro">{inr(a?.totalPo)}</span></td>
                  <td><input className="pop-in pop-in--pct" type="number" min={0} max={100} value={tdsInput}
                       onChange={(e) => {
                         const v = e.target.value;
                         if (v === '') { setTdsInput(''); return; }
                         const n = Number(v);
                         if (Number.isNaN(n)) return;
                         setTdsInput(String(Math.min(100, Math.max(0, n))));  // TDS % can't exceed 100
                       }} disabled={tdsLocked} /></td>
                  <td><span className="pop-ro">{inr(preview?.tdsAmount ?? a?.tdsAmount)}</span></td>
                  <td><span className="pop-ro">{inr(preview?.netPayable ?? a?.netPayable)}</span></td>
                  <td><button className={`pop-btn-save ${a?.tdsCut ? 'is-cut' : ''}`} disabled={savingTds || tdsLocked} onClick={saveTds} title={a?.tdsCut ? `TDS already deducted for this ${label}` : 'Deduct the TDS'}>{savingTds ? '…' : (a?.tdsCut ? '✓ Deducted' : 'Deduct')}</button></td>
                </tr></tbody>
              </table>
            </div>
          </Section>

          {/* ── Payment History ── */}
          <Section
            tag="Payment"
            icon={<IcoHistory w={16} />}
            title={`Payment History Against ${label}`}
            sub={`Recorded payments against this ${spiMode ? 'supplier invoice' : 'purchase order'}`}
            right={<button className="pop-btn-add" disabled={!entityId} onClick={tryAddPayment}>+ Update {label} Payment</button>}
            count={`${data?.payments.length ?? 0} transaction${(data?.payments.length ?? 0) === 1 ? '' : 's'}`}
          >
            <div className="pop-tbl-wrap pay-hist-wrap">
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
                        ? <a className="pop-attach" href={p.attachment_url} target="_blank" rel="noreferrer" title={p.attachment_name || 'View'}>
                            <IcoClip /><span className="pop-attach-name">{p.attachment_name || 'View'}</span>
                          </a>
                        : '—'}</td>
                      <td className="pop-amt">{inr(p.balance_after)}</td>
                      <td><span className={`pop-badge ${p.status === 'Cleared' ? 'is-ok' : 'is-pend'}`}>● {p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>}

        {/* ── Footer ── */}
        <div className="pop-foot">
          <button className="pop-btn-ghost" onClick={onClose}>Previous</button>
          <button className="pop-btn-submit" onClick={onClose}>Submit</button>
        </div>
      </div>

      {/* ── Nested "Update PO/SPI Payment" add-payment popup ── */}
      {addOpen && data && entityId && (
        <UpdatePaymentModal
          postUrl={`${apiBase}/payments`}
          spiTrace={spiMode ? null : spiId}
          label={label}
          poCode={data.po.code}
          supplierName={data.supplier.name ?? ''}
          totalPo={data.amounts.totalPo}
          netPayable={data.amounts.netPayable}
          amountPaid={data.amounts.amountPaid}
          outstanding={data.amounts.balance}
          onClose={() => setAddOpen(false)}
          onSaved={(summary) => { setData(summary); setAddOpen(false); onChanged?.(); }}
        />
      )}

      {/* ── GST amount breakdown (per-product CGST / SGST) ── */}
      {gstOpen && entityId && <GstBreakdownModal detailUrl={apiBase} label={label} onClose={() => setGstOpen(false)} />}
    </div>,
    document.body,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * "Update PO Payment" / "Update SPI Payment" — the add-a-payment popup.
 * ──────────────────────────────────────────────────────────────────────── */
function UpdatePaymentModal({
  postUrl, spiTrace, label, poCode, supplierName, totalPo, netPayable, amountPaid, outstanding, onClose, onSaved,
}: {
  postUrl: string; spiTrace: number | null; label: string;
  poCode: string; supplierName: string;
  totalPo: number; netPayable: number; amountPaid: number; outstanding: number;
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
  const [booting, setBooting] = useState(true);   // brief shimmer on open
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 450);
    return () => clearTimeout(t);
  }, []);

  // Local preview URL for the chosen proof file (view / download before upload).
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Inline, per-field validation — all fields are required.
  const amtNum = Number(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || !amtNum || amtNum <= 0) errors.amount = 'Enter an amount greater than zero.';
  else if (amtNum > outstanding + 0.001) errors.amount = `Cannot exceed the outstanding balance of ${inr(outstanding)}.`;
  if (!utrDate) errors.utrDate = 'Select the UTR / cheque date.';
  if (!bank.trim()) errors.bank = 'Enter the bank name.';
  if (!utr.trim()) errors.utr = 'Enter the UTR / cheque number.';
  if (!file) errors.file = 'Upload the proof of payment.';
  const showErr = (k: string) => ((touched[k] || submitAttempted) ? errors[k] : undefined);
  const mark = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const submit = async () => {
    setSubmitAttempted(true);
    if (Object.keys(errors).length) { toast.warning('Check the form', 'Please fill all required fields correctly.'); return; }
    const amt = amtNum;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(amt));
      if (bank.trim()) fd.append('bank_name', bank.trim());
      if (utr.trim()) fd.append('utr_cheque_number', utr.trim());
      if (utrDate) fd.append('utr_cheque_date', utrDate);
      // Trace the SPI entry only when paying through a PO (With-PO SPI).
      if (spiTrace) fd.append('supplier_purchase_invoice_id', String(spiTrace));
      if (file) fd.append('attachment', file);
      const { data: r } = await api.post<{ status: boolean; data: Summary }>(
        postUrl, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Payment recorded', `The payment was added against this ${label}.`);
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
          {booting ? <UpmSkeleton /> : (<>
          {/* Outstanding balance card */}
          <div className="upm-bal">
            <span className="upm-bal-ico"><IcoWallet /></span>
            <div className="upm-bal-txt">
              <div className="upm-bal-lab">OUTSTANDING BALANCE</div>
              <div className="upm-bal-val">{inr(outstanding)}</div>
            </div>
            <div className="upm-bal-chips">
              <span className="upm-bal-chip">Total PO {inr(totalPo)}</span>
              <span className="upm-bal-chip is-net">Net Payable {inr(netPayable)}</span>
              <span className="upm-bal-chip">Already Paid {inr(amountPaid)}</span>
            </div>
          </div>

          <div className="upm-grid">
            <label className="upm-fld">
              <span className="upm-fld-lab">AMOUNT TO BE PAY <span className="upm-req">*</span></span>
              <span className={`upm-money ${showErr('amount') ? 'is-error' : ''}`}><span className="upm-money-pre">₹</span>
                <input className="upm-in upm-in-money" type="number" min={0} value={amount}
                  onChange={(e) => setAmount(e.target.value)} onBlur={() => mark('amount')} placeholder="0.00" autoFocus />
              </span>
              {showErr('amount')
                ? <span className="upm-err">{errors.amount}</span>
                : <span className="upm-help">Outstanding balance: {inr(outstanding)}</span>}
            </label>
            <div className="upm-fld">
              <span className="upm-fld-lab">UTR / CHEQUE DATE <span className="upm-req">*</span></span>
              <MasterDatePicker value={utrDate} placeholder="Select date"
                invalid={!!showErr('utrDate')}
                onChange={(v) => { setUtrDate(v); mark('utrDate'); }} />
              {showErr('utrDate') && <span className="upm-err">{errors.utrDate}</span>}
            </div>
            <label className="upm-fld">
              <span className="upm-fld-lab">BANK NAME <span className="upm-req">*</span></span>
              <input className={`upm-in ${showErr('bank') ? 'is-error' : ''}`} value={bank}
                onChange={(e) => setBank(e.target.value)} onBlur={() => mark('bank')} placeholder="Enter bank name" />
              {showErr('bank') && <span className="upm-err">{errors.bank}</span>}
            </label>
            <label className="upm-fld">
              <span className="upm-fld-lab">UTR / CHEQUE NUMBER <span className="upm-req">*</span></span>
              <input className={`upm-in ${showErr('utr') ? 'is-error' : ''}`} value={utr}
                onChange={(e) => setUtr(e.target.value)} onBlur={() => mark('utr')} placeholder="Enter UTR / cheque number" />
              {showErr('utr') && <span className="upm-err">{errors.utr}</span>}
            </label>
            <div className="upm-fld upm-fld-full">
              <span className="upm-fld-lab">PROOF OF PAYMENT <span className="upm-req">*</span></span>
              {file ? (
                <div className="upm-filerow">
                  <span className="upm-filerow-ico"><IcoClip /></span>
                  <span className="upm-filerow-name" title={file.name}>{file.name}</span>
                  <span className="upm-filerow-acts">
                    <button type="button" className="upm-fbtn" title="View" onClick={() => { if (fileUrl) window.open(fileUrl, '_blank', 'noopener'); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg> View
                    </button>
                    <a className="upm-fbtn" title="Download" href={fileUrl ?? '#'} download={file.name}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> Download
                    </a>
                    <button type="button" className="upm-fbtn upm-fbtn--re" title="Reupload" onClick={() => fileRef.current?.click()}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg> Reupload
                    </button>
                  </span>
                </div>
              ) : (
                <button type="button" className={`upm-drop ${showErr('file') ? 'is-error' : ''}`}
                  onClick={() => { fileRef.current?.click(); mark('file'); }}>
                  <span className="upm-drop-ico"><IcoUpload /></span>
                  <span className="upm-drop-txt">
                    <span className="upm-drop-t1">CLICK TO UPLOAD PROOF OF PAYMENT</span>
                    <span className="upm-drop-t2">PDF, JPG or PNG · NO FILE CHOSEN</span>
                  </span>
                </button>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); mark('file'); }} />
              {showErr('file') && <span className="upm-err">{errors.file}</span>}
            </div>
          </div>
          </>)}
        </div>

        <div className="upm-foot">
          <button className="upm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="upm-btn-save" onClick={submit} disabled={saving || booting}>{saving ? 'Saving…' : 'Save Payment'}</button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * GST Amount Breakdown — the per-product CGST / SGST split behind "GST Amount".
 * Pulls the PO's line items (same source the wizard's product table uses).
 * ──────────────────────────────────────────────────────────────────────── */
type GstItem = {
  id?: number; code?: string; name?: string; qty?: number | string; rate?: number | string;
  gst?: number | string; cgstP?: number | string; sgstP?: number | string;
  cgstA?: number | string; sgstA?: number | string; cost?: number | string;
};
function GstBreakdownModal({ detailUrl, label, onClose }: { detailUrl: string; label: string; onClose: () => void }) {
  const [items, setItems] = useState<GstItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.get<{ status: boolean; data: { items?: GstItem[] } }>(detailUrl)
      .then(({ data: r }) => { if (alive) setItems(r.data?.items ?? []); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [detailUrl]);

  // SPI items expose a combined `gst` %; split it in half for the CGST/SGST columns.
  const half = (g: number | string | undefined) => (g == null || g === '' ? undefined : Number(g) / 2);
  const pct = (v: number | string | undefined) => (v == null || v === '' ? '—' : `${Number(v)}%`);
  const totCgst = (items ?? []).reduce((s, it) => s + Number(it.cgstA || 0), 0);
  const totSgst = (items ?? []).reduce((s, it) => s + Number(it.sgstA || 0), 0);
  const totCost = (items ?? []).reduce((s, it) => s + Number(it.cost || 0), 0);

  return createPortal(
    <div className="gst-backdrop" onMouseDown={onClose}>
      <div className="gst-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="gst-head">
          <span className="gst-head-l"><span className="gst-head-ico"><IcoPct /></span>GST Amount Breakdown</span>
          <button className="gst-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="gst-body">
          <div className="pop-tbl-wrap gst-tbl-wrap">
            <table className="pop-tbl pop-tbl-c" style={{ minWidth: 820 }}>
              <thead><tr>
                <th>SR NO</th><th>PRODUCT CODE</th><th style={{ textAlign: 'left' }}>PRODUCT NAME ({label})</th>
                <th>QTY ({label})</th><th>RATE</th><th>CGST (%)</th><th>SGST (%)</th>
                <th>CGST AMOUNT</th><th>SGST AMOUNT</th><th>PRODUCT COST</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="pop-empty">Loading…</td></tr>
                ) : (items?.length ?? 0) === 0 ? (
                  <tr><td colSpan={10} className="pop-empty">No product lines on this {label}.</td></tr>
                ) : items!.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td>{i + 1}</td>
                    <td><span className="pop-ro" style={{ minWidth: 0 }}>{it.code || '—'}</span></td>
                    <td style={{ textAlign: 'left' }} title={it.name || ''}><span className="gst-name">{it.name || '—'}</span></td>
                    <td>{it.qty ?? '—'}</td>
                    <td>{inr(Number(it.rate || 0))}</td>
                    <td>{pct(it.cgstP ?? half(it.gst))}</td>
                    <td>{pct(it.sgstP ?? half(it.gst))}</td>
                    <td className="pop-amt">{inr(Number(it.cgstA || 0))}</td>
                    <td className="pop-amt">{inr(Number(it.sgstA || 0))}</td>
                    <td className="pop-amt">{inr(Number(it.cost || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && (items?.length ?? 0) > 0 && (
            <div className="gst-totals">
              <div className="gst-tot-item"><span className="gst-tot-k">Total CGST</span><span className="gst-tot-v">{inr(totCgst)}</span></div>
              <div className="gst-tot-item"><span className="gst-tot-k">Total SGST</span><span className="gst-tot-v">{inr(totSgst)}</span></div>
              <div className="gst-tot-item is-hl"><span className="gst-tot-k">Total GST (CGST + SGST)</span><span className="gst-tot-v">{inr(totCgst + totSgst)}</span></div>
              <div className="gst-tot-item is-cost"><span className="gst-tot-k">Total Product Cost</span><span className="gst-tot-v">{inr(totCost)}</span></div>
            </div>
          )}
        </div>
        <div className="gst-foot"><button className="pop-btn-ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>,
    document.body,
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
function Section({ tag, title, sub, right, count, icon, children }: { tag?: string; title: string; sub: string; right?: React.ReactNode; count?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="pop-sec">
      <div className="pop-sec-head">
        <div className="pop-sec-l">
          <span className="pop-sec-ico">{icon ?? <IcoCard w={16} />}</span>
          <div>
            <div className="pop-sec-title-row">
              {tag && <><span className="pop-sec-tag">{tag}</span><span className="pop-sec-div">|</span></>}
              <span className="pop-sec-title">{title}</span>
            </div>
            <div className="pop-sec-sub">{sub}</div>
          </div>
        </div>
        <div className="pop-sec-r">
          {right}
          {count && <span className="pop-sec-count">{count}</span>}
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
const IcoHistory = ({ w = 16 }: { w?: number }) => <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3.5 2"/></svg>;
const IcoClip = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
const IcoDoc = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IcoCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>;
const IcoWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 12h.01M2 10h20"/></svg>;
const IcoPct = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
const IcoMinus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
const IcoUpload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

/* ── Shimmer skeletons (shown while data loads) ── */
const Sk = (props: React.CSSProperties & { hero?: boolean }) => {
  const { hero, ...style } = props;
  return <span className={`pop-sk ${hero ? 'pop-sk--hero' : ''}`} style={style} />;
};
function PopTableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="pop-sec">
      <div className="pop-sec-head">
        <div className="pop-sec-l">
          <Sk width={32} height={32} borderRadius={10} />
          <div>
            <Sk width={130} height={10} display="block" marginBottom={6} />
            <Sk width={210} height={8} display="block" />
          </div>
        </div>
      </div>
      <div className="pop-sec-body">
        <div className="pop-tbl-wrap" style={{ padding: 12 }}>
          {Array.from({ length: rows + 1 }).map((_, r) => (
            <div key={r} style={{ display: 'flex', gap: 12, marginBottom: r === rows ? 0 : 12 }}>
              {Array.from({ length: cols }).map((_, c) => (
                <Sk key={c} flex={1} height={r === 0 ? 10 : 28} borderRadius={7} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function PopBodySkeleton() {
  return (
    <div className="pop-body">
      <div className="pop-kpis">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="pop-kpi" key={i}>
            <Sk width={38} height={38} borderRadius={11} flexShrink={0} />
            <div style={{ flex: 1 }}>
              <Sk width="60%" height={8} display="block" marginBottom={7} />
              <Sk width="82%" height={15} display="block" marginBottom={6} />
              <Sk width="50%" height={8} display="block" />
            </div>
          </div>
        ))}
      </div>
      <div className="pop-prog">
        <div className="pop-prog-top">
          <Sk width={130} height={10} />
          <Sk width={170} height={10} />
        </div>
        <Sk width="100%" height={8} borderRadius={20} display="block" />
      </div>
      <PopTableSkeleton rows={1} cols={7} />
      <PopTableSkeleton rows={3} cols={8} />
    </div>
  );
}
function UpmSkeleton() {
  return (
    <>
      <div className="upm-bal">
        <Sk width={42} height={42} borderRadius={11} flexShrink={0} />
        <div style={{ flex: 1 }}>
          <Sk width={120} height={9} display="block" marginBottom={7} />
          <Sk width={110} height={20} display="block" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Sk width={90} height={30} borderRadius={8} />
          <Sk width={110} height={30} borderRadius={8} />
        </div>
      </div>
      <div className="upm-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="upm-fld" key={i}>
            <Sk width="45%" height={9} display="block" marginBottom={3} />
            <Sk width="100%" height={44} borderRadius={10} display="block" />
          </div>
        ))}
        <div className="upm-fld upm-fld-full">
          <Sk width="30%" height={9} display="block" marginBottom={3} />
          <Sk width="100%" height={60} borderRadius={12} display="block" />
        </div>
      </div>
    </>
  );
}

const CSS = `
.pop-backdrop{position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow-y:auto;font-family:var(--font-sans,'Inter',sans-serif);}
.pop-modal{width:100%;max-width:1120px;margin:auto;background:#f8fafc;border:1.5px solid rgba(255,255,255,.5);border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.45);display:flex;flex-direction:column;}
.pop-hero{background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);}
.pop-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px 4px;background:transparent;color:#fff;}
.pop-head-l{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap;}
.pop-head-ico{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;}
.pop-head-title{font-size:16px;font-weight:800;line-height:1;}
.pop-chip{font-size:11px;font-weight:700;font-family:monospace;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:3px 10px;border-radius:20px;}
.pop-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;}
.pop-x:hover{background:rgba(255,255,255,.3);}
.pop-body{padding:13px 18px;display:flex;flex-direction:column;gap:10px;}
/* Inner supplier card aligns to the header's TEXT column: left edge starts at
   the "Payment Summary" heading (just past the 34px icon + 10px gap + 22px pad
   = 66px), right edge ends at the close (✕) button (22px pad + 30px btn = 52px). */
.pop-sup{margin:0 52px 14px 66px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:9px 20px;display:grid;grid-template-columns:repeat(5,1fr);gap:1px 18px;color:#e0f2fe;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);}
.pop-sup-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.72);}
.pop-sup-val{font-size:13px;font-weight:700;color:#fff;margin-top:2px;}
.pop-sup-val.is-strong{font-size:14px;}
.pop-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
.pop-kpi{background:#fff;border:1px solid #eef2f7;border-radius:14px;padding:7px 14px;display:flex;gap:10px;align-items:center;border-left:4px solid #94a3b8;box-shadow:0 4px 13px rgba(15,23,42,.06);}
.pop-kpi-ico{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
.pop-kpi-ico svg{width:18px;height:18px;}
.pop-kpi-teal{border-left-color:#06b6d4;} .pop-kpi-teal .pop-kpi-ico{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 7px 16px rgba(8,145,178,.38);}
.pop-kpi-green{border-left-color:#10b981;} .pop-kpi-green .pop-kpi-ico{background:linear-gradient(135deg,#34d399,#059669);box-shadow:0 7px 16px rgba(5,150,105,.34);}
.pop-kpi-amber{border-left-color:#f59e0b;} .pop-kpi-amber .pop-kpi-ico{background:linear-gradient(135deg,#fbbf24,#d97706);box-shadow:0 7px 16px rgba(217,119,6,.34);}
.pop-kpi-blue{border-left-color:#6366f1;} .pop-kpi-blue .pop-kpi-ico{background:linear-gradient(135deg,#818cf8,#4f46e5);box-shadow:0 7px 16px rgba(79,70,229,.34);}
.pop-kpi-rose{border-left-color:#f43f5e;} .pop-kpi-rose .pop-kpi-ico{background:linear-gradient(135deg,#fb7185,#e11d48);box-shadow:0 7px 16px rgba(225,29,72,.32);}
.pop-kpi-lab{font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#5c7d9e;}
.pop-kpi-val{font-size:18px;font-weight:800;color:#123a5e;margin:1px 0;}
.pop-kpi-sub{font-size:10.5px;color:#7b96ad;font-weight:500;}
.pop-prog{background:linear-gradient(180deg,#f3fafd,#ecf6fa);border:1px solid #cdeef5;border-radius:12px;padding:14px 18px;}
.pop-prog-top{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;}
.pop-prog-num{color:#0e7490;font-weight:700;}
.pop-prog-bar{height:8px;background:#e2e8f0;border-radius:20px;overflow:hidden;}
.pop-prog-fill{height:100%;background:linear-gradient(90deg,#06b6d4,#0e7490);border-radius:20px;transition:width .3s;}
.pop-sec{position:relative;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.04);}
/* Teal left-accent bar, matching the Purchase Order strip's .cstrip__accent. */
.pop-sec::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;z-index:5;background:linear-gradient(180deg,#22d3ee,#0891b2,#0e7490);}
/* Exact match to the Purchase Order page header strip (.cstrip--teal): the same
   base gradient PLUS its sheen (top highlight) + glow (radial cyan) overlays. */
.pop-sec-head{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 25%,#cffafe 55%,#bff0f7 85%,#a5e9f3 100%);border-bottom:1px solid #9ce1ee;box-shadow:0 2px 0 rgba(255,255,255,.85) inset;}
.pop-sec-head::before{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
.pop-sec-head::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(103,232,249,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(34,211,238,.28) 0%,transparent 55%);}
.pop-sec-l,.pop-sec-r{position:relative;z-index:1;}
.pop-sec-l{display:flex;align-items:center;gap:11px;}
.pop-sec-ico{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 0 0 2.5px rgba(6,182,212,.22),0 3px 10px rgba(8,145,178,.4);}
.pop-sec-ico svg{width:15px;height:15px;}
.pop-sec-title-row{display:flex;align-items:center;gap:7px;}
.pop-sec-tag{font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:.02em;}
.pop-sec-div{color:#7dd3e0;font-weight:400;}
.pop-sec-title{font-size:13.5px;font-weight:800;color:#0c4a6e;letter-spacing:-.01em;}
.pop-sec-sub{font-size:10.5px;color:#0e7490;margin-top:2px;}
.pop-sec-r{display:flex;align-items:center;gap:10px;}
.pop-sec-count{font-size:11px;color:#64748b;font-weight:600;}
.pop-sec-chev{width:28px;height:28px;border-radius:50%;border:1px solid #cffafe;background:#fff;color:#0e7490;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(6,182,212,.18);flex-shrink:0;}
.pop-sec-chev:hover{background:#ecfeff;}
.pop-sec-chev svg{transition:transform .2s ease;}
.pop-sec-chev.is-collapsed svg{transform:rotate(-90deg);}
.pop-sec-body{padding:12px 16px;background:linear-gradient(180deg,#f0fdff 0%,#f8fafc 100%);}
/* Table = white rounded card (teal header + white rows) sitting on the body. */
.pop-tbl{background:transparent;}
.pop-tbl tbody tr{background:#fff;} .pop-tbl tbody td{background:#fff;}
.pop-tbl-wrap{overflow-x:auto;overflow-y:hidden;border-radius:12px;border:1px solid #dbeef4;box-shadow:0 2px 8px rgba(15,23,42,.05);}
.pop-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:760px;}
.pop-tbl thead tr{background:linear-gradient(90deg,#0e7490 0%,#0891b2 45%,#22d3ee 100%);}
.pop-tbl thead th{text-align:left;vertical-align:middle;padding:11px 12px;background:transparent;color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.04em;line-height:1.25;white-space:nowrap;}
.pop-tbl thead th.pop-th-r{text-align:right;} .pop-tbl thead th.pop-th-c{text-align:center;}
.pop-tbl-c thead th,.pop-tbl-c tbody td{text-align:center;}
.pop-tbl-c .pop-in{text-align:center;}
.pop-tbl tbody td{padding:11px 12px;border-bottom:1px solid #eef2f7;color:#334155;font-weight:500;white-space:nowrap;vertical-align:middle;}
.pop-tbl tbody td.pop-td-r{text-align:right;} .pop-tbl tbody td.pop-td-c{text-align:center;}
.pop-ro{display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:6px 10px;font-weight:700;color:#334155;min-width:70px;}
.pop-in{width:100%;min-width:90px;height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:12px;font-family:inherit;outline:none;background:#fff;}
.pop-in--pct{max-width:96px;min-width:0;margin:0 auto;}
.pop-in:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.15);}
.pop-amt{font-weight:800;color:#0f172a;}
.pop-empty{text-align:center;color:#94a3b8;padding:22px;font-weight:500;}
.pop-btn-save{background:linear-gradient(135deg,#0e7490,#0891b2 60%,#06b6d4);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(8,145,178,.32);}
.pop-btn-save:hover:not(:disabled){filter:brightness(1.06);} .pop-btn-save:disabled{opacity:.6;cursor:not-allowed;}
.pop-btn-save.is-cut,.pop-btn-save.is-cut:disabled{background:linear-gradient(135deg,#34d399,#059669);color:#fff;opacity:1;cursor:default;box-shadow:0 3px 8px rgba(5,150,105,.3);}
.pop-btn-add{background:linear-gradient(135deg,#0c4a6e,#0e7490);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;gap:6px;align-items:center;box-shadow:0 3px 10px rgba(14,116,144,.3);}
.pop-btn-add:hover:not(:disabled){filter:brightness(1.09);} .pop-btn-add:disabled{opacity:.5;cursor:not-allowed;}
.pop-btn-ghost{background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:8px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;}
.pop-btn-ghost:hover{background:#f1f5f9;}
.pop-btn-submit{background:linear-gradient(135deg,#0e7490 0%,#0891b2 55%,#22d3ee 100%);color:#fff;border:none;border-radius:10px;padding:9px 26px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(8,145,178,.32);}
.pop-btn-submit:hover{filter:brightness(1.06);}
.pop-badge{font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:20px;}
.pop-badge.is-ok{background:#dcfce7;color:#16a34a;} .pop-badge.is-pend{background:#fef3c7;color:#b45309;}
.pop-link{color:#0e7490;font-weight:600;text-decoration:none;} .pop-link:hover{text-decoration:underline;}
.pop-attach{display:inline-flex;align-items:center;gap:6px;max-width:190px;padding:5px 11px;border:1px solid #bfe8f2;border-radius:20px;background:#f2fdff;color:#0e7490;font-size:11px;font-weight:600;text-decoration:none;vertical-align:middle;}
.pop-attach:hover{background:#e2f6fb;border-color:#9ce1ee;}
.pop-attach svg{flex-shrink:0;}
.pop-attach-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pop-del{width:24px;height:24px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;}
.pop-foot{display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 22px;background:#fff;border-top:1px solid #e2e8f0;}

/* ── Update Payment popup ── */
.upm-backdrop{position:fixed;inset:0;z-index:1320;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px 16px;font-family:var(--font-sans,'Inter',sans-serif);}
.upm-modal{width:100%;max-width:920px;background:#fff;border:1.5px solid rgba(255,255,255,.5);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.5);display:flex;flex-direction:column;}
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
.upm-bal{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;background:linear-gradient(120deg,#ecfeff,#f0fdfa);border:1px solid #cffafe;border-radius:12px;padding:14px 16px;}
.upm-bal-ico{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.upm-bal-txt{flex:1 1 190px;min-width:170px;}
.upm-bal-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#0891b2;white-space:nowrap;}
.upm-bal-val{font-size:21px;font-weight:800;color:#0f172a;white-space:nowrap;line-height:1.2;}
.upm-bal-chips{display:flex;gap:8px;flex-wrap:wrap;flex:1 1 auto;justify-content:flex-end;}
.upm-bal-chip{font-size:11px;font-weight:700;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;white-space:nowrap;}
.upm-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;}
.upm-fld{display:flex;flex-direction:column;gap:5px;}
.upm-fld-full{grid-column:1/-1;}
.upm-fld-lab{font-size:10px;font-weight:700;letter-spacing:.05em;color:#64748b;}
.upm-req{color:#ef4444;font-weight:800;}
.upm-err{font-size:10.5px;font-weight:600;color:#ef4444;}
.upm-in{height:44px;border:1.5px solid #cbd5e1;border-radius:10px;padding:0 12px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#0f172a;}
.upm-in:focus{border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.15);}
.upm-in.is-error{border-color:#ef4444;} .upm-in.is-error:focus{box-shadow:0 0 0 3px rgba(239,68,68,.15);}
.upm-money.is-error .upm-in{border-color:#ef4444;} .upm-drop.is-error{border-color:#ef4444 !important;background:#fef2f2;}
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
.upm-bal-chip.is-net{background:linear-gradient(135deg,#ecfeff,#cffafe);border-color:#7dd3e0;color:#0c4a6e;}
/* Chosen proof file: row with view / download / reupload actions. */
.upm-filerow{display:flex;align-items:center;gap:12px;width:100%;background:#f0fdff;border:1.5px solid #bfe8f2;border-radius:12px;padding:12px 16px;}
.upm-filerow-ico{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#06b6d4,#0e7490);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.upm-filerow-name{flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#0e7490;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.upm-filerow-acts{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.upm-fbtn{display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border:1.5px solid #bfe8f2;background:#fff;color:#0e7490;font-family:inherit;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;text-decoration:none;}
.upm-fbtn:hover{background:#ecfeff;border-color:#0891b2;}
.upm-fbtn--re{color:#0c4a6e;}
.upm-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;}
.upm-btn-ghost{background:#fff;border:1px solid #cbd5e1;color:#475569;border-radius:9px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;}
.upm-btn-ghost:hover:not(:disabled){background:#f1f5f9;}
.upm-btn-save{background:linear-gradient(120deg,#0e7490,#06b6d4);color:#fff;border:none;border-radius:9px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;}
.upm-btn-save:hover:not(:disabled){filter:brightness(1.05);} .upm-btn-save:disabled,.upm-btn-ghost:disabled{opacity:.6;cursor:not-allowed;}
@media (max-width:900px){.pop-sup,.pop-kpis{grid-template-columns:repeat(2,1fr);}.upm-grid{grid-template-columns:1fr;}}

/* ── GST Breakdown button + modal ── */
.pop-gstbtn{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border:1.5px solid #7dd3e0;background:#fff;color:#0e7490;font-family:inherit;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;box-shadow:0 2px 6px rgba(6,182,212,.12);}
.pop-gstbtn:hover:not(:disabled){background:#ecfeff;border-color:#0891b2;}
.pop-gstbtn:disabled{opacity:.5;cursor:not-allowed;}
.pop-gstbtn svg{width:14px;height:14px;}
.gst-backdrop{position:fixed;inset:0;z-index:1320;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px 16px;font-family:var(--font-sans,'Inter',sans-serif);}
.gst-modal{width:100%;max-width:1000px;background:#fff;border:1.5px solid rgba(255,255,255,.5);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.5);display:flex;flex-direction:column;}
.gst-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;background:linear-gradient(120deg,#0e7490,#0891b2 55%,#06b6d4);color:#fff;}
.gst-head-l{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;}
.gst-head-ico{width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;}
.gst-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;}
.gst-x:hover{background:rgba(255,255,255,.3);}
.gst-body{padding:16px 18px;}
/* ~5 rows visible, the rest scroll; header + totals stay pinned. */
.gst-tbl-wrap{max-height:340px;overflow-y:auto;}
.gst-tbl-wrap .pop-tbl thead th{position:sticky;top:0;z-index:3;background:#0891b2;}
/* Payment History: show ~3 rows, the rest scroll (header stays pinned). */
.pay-hist-wrap{max-height:172px;overflow-y:auto;}
.pay-hist-wrap .pop-tbl thead th{position:sticky;top:0;z-index:3;background:#0891b2;}
.gst-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;line-height:1.35;max-width:260px;}
/* Totals summary bar (below the scrollable table). */
.gst-totals{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;}
.gst-tot-item{flex:1 1 160px;display:flex;flex-direction:column;gap:3px;padding:10px 14px;border-radius:11px;border:1px solid #dbeef4;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.05);}
.gst-tot-k{font-size:10px;font-weight:700;letter-spacing:.04em;color:#64748b;text-transform:uppercase;}
.gst-tot-v{font-size:16px;font-weight:800;color:#0f172a;}
.gst-tot-item.is-hl{background:linear-gradient(135deg,#0e7490,#0891b2 60%,#06b6d4);border-color:#0891b2;box-shadow:0 4px 12px rgba(8,145,178,.3);}
.gst-tot-item.is-hl .gst-tot-k{color:rgba(255,255,255,.85);}
.gst-tot-item.is-hl .gst-tot-v{color:#fff;}
.gst-tot-item.is-cost{background:linear-gradient(180deg,#f0fdff,#f8fafc);}
.gst-tot td{background:linear-gradient(90deg,#ecfeff,#f0fdfa);border-top:2px solid #bfe8f2;color:#0f172a;}
.gst-tot--gst td{background:linear-gradient(90deg,#cffafe,#a5f3fc);border-top:1px solid #7dd3e0;color:#0c4a6e;font-size:12.5px;}
.gst-foot{display:flex;justify-content:flex-end;padding:12px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;}

/* ── Shimmer skeletons ── */
.pop-sk{position:relative;overflow:hidden;background:#e2e8f0;border-radius:6px;display:inline-block;vertical-align:middle;}
.pop-sk::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:pop-shimmer 1.25s infinite;}
.pop-sk--hero{background:rgba(255,255,255,.18);}
.pop-sk--hero::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.38),transparent);}
@keyframes pop-shimmer{100%{transform:translateX(100%);}}

/* ── Dark mode (html[data-bs-theme="dark"] is an ancestor of this portal) ── */
[data-bs-theme="dark"] .pop-sk{background:#334155;}
[data-bs-theme="dark"] .pop-sk::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent);}
[data-bs-theme="dark"] .pop-modal{background:#0f172a;border-color:rgba(148,163,184,.16);box-shadow:0 30px 80px rgba(0,0,0,.6);}
[data-bs-theme="dark"] .pop-foot{background:#0f172a;border-top-color:rgba(148,163,184,.14);}
[data-bs-theme="dark"] .pop-kpi{background:#1e293b;border-color:rgba(148,163,184,.14);box-shadow:0 4px 13px rgba(0,0,0,.35);}
[data-bs-theme="dark"] .pop-kpi-lab{color:#94a3b8;}
[data-bs-theme="dark"] .pop-kpi-val{color:#f1f5f9;}
[data-bs-theme="dark"] .pop-kpi-sub{color:#94a3b8;}
[data-bs-theme="dark"] .pop-prog{background:linear-gradient(180deg,#12222c,#0e1c25);border-color:rgba(6,182,212,.25);}
[data-bs-theme="dark"] .pop-prog-top{color:#cbd5e1;}
[data-bs-theme="dark"] .pop-prog-num{color:#22d3ee;}
[data-bs-theme="dark"] .pop-prog-bar{background:#1e293b;}
[data-bs-theme="dark"] .pop-sec{background:#1e293b;border-color:rgba(148,163,184,.14);box-shadow:0 2px 10px rgba(0,0,0,.3);}
[data-bs-theme="dark"] .pop-sec-head{background:linear-gradient(110deg,#0e2a33 0%,#0c3543 55%,#0a3d4d 100%);border-bottom-color:rgba(6,182,212,.28);box-shadow:none;}
[data-bs-theme="dark"] .pop-sec-head::before{background:linear-gradient(180deg,rgba(255,255,255,.06),transparent);}
[data-bs-theme="dark"] .pop-sec-head::after{background-image:radial-gradient(ellipse at 10% 50%,rgba(34,211,238,.22) 0%,transparent 55%),radial-gradient(ellipse at 90% 50%,rgba(34,211,238,.14) 0%,transparent 60%);}
[data-bs-theme="dark"] .pop-sec-title{color:#e0f7ff;}
[data-bs-theme="dark"] .pop-sec-tag{color:#38bdf8;}
[data-bs-theme="dark"] .pop-sec-sub{color:#67e8f9;}
[data-bs-theme="dark"] .pop-sec-div{color:#0e7490;}
[data-bs-theme="dark"] .pop-sec-count{color:#94a3b8;}
[data-bs-theme="dark"] .pop-sec-chev{background:#0f172a;border-color:rgba(6,182,212,.3);color:#67e8f9;}
[data-bs-theme="dark"] .pop-sec-chev:hover{background:#134e5a;}
[data-bs-theme="dark"] .pop-sec-body{background:linear-gradient(180deg,#0e1c25 0%,#111827 100%);}
[data-bs-theme="dark"] .pop-tbl-wrap{border-color:rgba(148,163,184,.16);box-shadow:0 2px 8px rgba(0,0,0,.3);}
[data-bs-theme="dark"] .pop-tbl tbody tr,[data-bs-theme="dark"] .pop-tbl tbody td{background:#1e293b;}
[data-bs-theme="dark"] .pop-tbl tbody td{color:#cbd5e1;border-bottom-color:rgba(148,163,184,.12);}
[data-bs-theme="dark"] .pop-ro{background:#0f172a;border-color:rgba(148,163,184,.18);color:#e2e8f0;}
[data-bs-theme="dark"] .pop-in{background:#0f172a;border-color:rgba(148,163,184,.25);color:#e2e8f0;color-scheme:dark;}
[data-bs-theme="dark"] .pop-amt{color:#f1f5f9;}
[data-bs-theme="dark"] .pop-empty{color:#64748b;}
[data-bs-theme="dark"] .pop-btn-ghost{background:#1e293b;border-color:rgba(148,163,184,.25);color:#cbd5e1;}
[data-bs-theme="dark"] .pop-btn-ghost:hover{background:#334155;}
[data-bs-theme="dark"] .pop-attach{background:rgba(6,182,212,.1);border-color:rgba(6,182,212,.3);color:#67e8f9;}
[data-bs-theme="dark"] .pop-attach:hover{background:rgba(6,182,212,.18);border-color:rgba(6,182,212,.45);}
[data-bs-theme="dark"] .pop-badge.is-ok{background:rgba(22,163,74,.22);color:#4ade80;}
[data-bs-theme="dark"] .pop-badge.is-pend{background:rgba(180,83,9,.28);color:#fcd34d;}

[data-bs-theme="dark"] .upm-modal{background:#0f172a;box-shadow:0 30px 80px rgba(0,0,0,.65);}
[data-bs-theme="dark"] .upm-bal{background:linear-gradient(120deg,#0e2730,#0d2620);border-color:rgba(6,182,212,.28);}
[data-bs-theme="dark"] .upm-bal-lab{color:#22d3ee;}
[data-bs-theme="dark"] .upm-bal-val{color:#f1f5f9;}
[data-bs-theme="dark"] .upm-bal-chip{background:#1e293b;border-color:rgba(148,163,184,.2);color:#cbd5e1;}
[data-bs-theme="dark"] .upm-fld-lab{color:#94a3b8;}
[data-bs-theme="dark"] .upm-in{background:#0f172a;border-color:rgba(148,163,184,.25);color:#e2e8f0;color-scheme:dark;}
[data-bs-theme="dark"] .upm-money-pre{color:#22d3ee;}
[data-bs-theme="dark"] .upm-help{color:#94a3b8;}
[data-bs-theme="dark"] .upm-drop{background:#111827;border-color:rgba(6,182,212,.35);}
[data-bs-theme="dark"] .upm-drop:hover{background:#0e2730;border-color:#06b6d4;}
[data-bs-theme="dark"] .upm-drop.is-error{background:rgba(239,68,68,.12);}
[data-bs-theme="dark"] .upm-drop-t1{color:#67e8f9;}
[data-bs-theme="dark"] .upm-drop-t2{color:#64748b;}
[data-bs-theme="dark"] .upm-foot{background:#0b1220;border-top-color:rgba(148,163,184,.16);}
[data-bs-theme="dark"] .upm-btn-ghost{background:#1e293b;border-color:rgba(148,163,184,.25);color:#cbd5e1;}
[data-bs-theme="dark"] .upm-btn-ghost:hover:not(:disabled){background:#334155;}
[data-bs-theme="dark"] .upm-bal-chip.is-net{background:linear-gradient(135deg,#0e3a44,#0c4a5a);border-color:rgba(6,182,212,.4);color:#a5f3fc;}
[data-bs-theme="dark"] .upm-filerow{background:#0e2730;border-color:rgba(6,182,212,.3);}
[data-bs-theme="dark"] .upm-filerow-name{color:#67e8f9;}
[data-bs-theme="dark"] .upm-fbtn{background:#0b2b34;border-color:#1c5563;color:#67e8f9;}
[data-bs-theme="dark"] .upm-fbtn:hover{background:#123b47;border-color:#0891b2;}
[data-bs-theme="dark"] .pop-gstbtn{background:#0b2b34;border-color:#1c5563;color:#67e8f9;}
[data-bs-theme="dark"] .pop-gstbtn:hover:not(:disabled){background:#123b47;border-color:#0891b2;}
[data-bs-theme="dark"] .gst-modal{background:#0f172a;box-shadow:0 30px 80px rgba(0,0,0,.65);}
[data-bs-theme="dark"] .gst-body{background:#0f172a;}
[data-bs-theme="dark"] .gst-foot{background:#0b1220;border-top-color:rgba(148,163,184,.16);}
[data-bs-theme="dark"] .gst-tot-item{background:#1e293b;border-color:rgba(148,163,184,.16);}
[data-bs-theme="dark"] .gst-tot-item .gst-tot-v{color:#f1f5f9;}
[data-bs-theme="dark"] .gst-tot-item.is-cost{background:linear-gradient(180deg,#0e1c25,#111827);}
`;
