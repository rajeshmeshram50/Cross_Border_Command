import { useState, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import DebitNoteTypeModal, { type DnType } from './DebitNoteTypeModal';
// Reuse the SPI wizard shell styling (.spi-dt-*) so Debit Note matches the SPI create flow 1:1.
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note — create/edit wizard (server-driven).
 *
 * Step 1: Basic details — debit note type (master dropdown + inline "+" manage
 *   popup) and the linked Supplier Purchase Invoice. Picking an SPI auto-fills
 *   SPI date, PO number/date, the supplier address & contact, and GST scrutiny.
 * Step 2: SPI details + the returned/adjusted product lines (seeded from the
 *   SPI), additions/deductions, reason and terms → Generate Debit Note.
 * ──────────────────────────────────────────────────────────────────────── */

// GRN ID + Warehouse aren't captured on the SPI yet — hardcoded for now
// (everything else in the SPI Details recap is fetched from the linked SPI).
const GRN_ID = 'GRN-001';
const WAREHOUSE = 'Central Warehouse — Mumbai';

const todayISO = new Date().toISOString().slice(0, 10);
const todayDisp = new Date().toLocaleDateString('en-US');
const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;

type ChargeRow = { amount: string; note: string };

// Supplier view derived from the linked SPI (server → supplierDetail shape).
interface SupplierView {
  code?: string; name?: string; type?: string; addr?: string; country?: string;
  state?: string; stateCode?: string; city?: string; contact?: string; desig?: string;
  phone?: string; email?: string; scrutiny?: string; gstNo?: string; gstStatus?: string;
  filing?: string; remarks?: string;
}

interface SpiOption { id: number; code: string; spiDate?: string; poCode?: string; supplier?: string }

// Editable debit-note product row.
interface ProdRow {
  product_id?: number | null; code: string; name: string; hsn: string;
  qtyPo: number; qtySpi: number; debitQty: number; rate: number;
  cgstPct: number; sgstPct: number; igstPct: number;
}

const num = (v: any) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

// Supplier Legal Status — the 5 compliance parameters shown once a supplier is
// linked (design mirrors the SPI / PO wizard's legal card grid).
const LEGAL_PARAMS = [
  { name: 'Company Due Diligence', d: 4, t: 4 },
  { name: 'Owner KYC Documents',   d: 4, t: 4 },
  { name: 'Trade Licenses',        d: 3, t: 3 },
  { name: 'Trade Documents',       d: 4, t: 4 },
  { name: 'Agreements',            d: 3, t: 3 },
];

export default function DebitNoteDetail({ onClose, onSaved, editId }: { onClose: () => void; onSaved?: () => void; editId?: number | null }) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [dnOpen, setDnOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [sumOpen, setSumOpen] = useState(false);
  const [spiOpen, setSpiOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);
  const [reasonOpen, setReasonOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);

  // ── Form state ──
  const [code, setCode] = useState<string>('—');
  const [types, setTypes] = useState<DnType[]>([]);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [dnTypeId, setDnTypeId] = useState<number | null>(null);
  const [spis, setSpis] = useState<SpiOption[]>([]);
  const [spiId, setSpiId] = useState<number | null>(null);
  const [spiCode, setSpiCode] = useState('');
  const [spiDate, setSpiDate] = useState('');
  const [poCode, setPoCode] = useState('');
  const [poDate, setPoDate] = useState('');
  const [shipCode, setShipCode] = useState('');
  const [procCode, setProcCode] = useState('');
  // SPI payment context (Step-2 SPI Details recap) — fetched from the linked SPI.
  const [spiPay, setSpiPay] = useState<{ paymentTerm: string; totalInvoice: number; paidAmount: number; balance: number } | null>(null);
  const [expDate, setExpDate] = useState('');
  const [reason, setReason] = useState('');
  const [terms, setTerms] = useState('');
  const [sel, setSel] = useState<SupplierView | null>(null);
  const [products, setProducts] = useState<ProdRow[]>([]);
  const [additions, setAdditions] = useState<ChargeRow[]>([{ amount: '', note: '' }]);
  const [deductions, setDeductions] = useState<ChargeRow[]>([{ amount: '', note: '' }]);
  const [saving, setSaving] = useState(false);
  const [spiLoading, setSpiLoading] = useState(false);

  const dnTypeName = useMemo(() => types.find(t => t.id === dnTypeId)?.name ?? '', [types, dnTypeId]);

  const loadTypes = () => api.get('/p2p/debit-note-types', { params: { status: 'active' } })
    .then(r => setTypes((r.data?.data ?? []) as DnType[]))
    .catch(() => setTypes([]));

  // Initial load — code preview, active types, SPI list. In edit mode, hydrate.
  useEffect(() => {
    loadTypes();
    api.get('/p2p/debit-notes/supplier-purchase-invoices')
      .then(r => setSpis((r.data?.data ?? []) as SpiOption[]))
      .catch(() => setSpis([]));
    if (editId) {
      api.get(`/p2p/debit-notes/${editId}`).then(r => hydrate(r.data?.data)).catch(() => {});
    } else {
      api.get('/p2p/debit-notes/preview-code').then(r => setCode(r.data?.data?.code ?? '—')).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Populate every field from a saved debit note (edit mode).
  const hydrate = (d: any) => {
    if (!d) return;
    setCode(d.no ?? '—');
    setDnTypeId(d.debit_note_type_id ?? null);
    // The saved type may be inactive → make sure it shows in the dropdown.
    if (d.debit_note_type_id && d.type) {
      setTypes(ts => ts.some(t => t.id === d.debit_note_type_id) ? ts : [...ts, { id: d.debit_note_type_id, name: d.type, status: 'active' }]);
    }
    setSpiId(d.supplier_purchase_invoice_id ?? null);
    setSpiCode(d.spi ?? '');
    setSpiDate(d.spiDate ?? '');
    setPoCode(d.po ?? '');
    setPoDate(d.poDate ?? '');
    setShipCode(d.ship ?? '');
    setProcCode(d.proc ?? '');
    setExpDate(d.exp ?? '');
    setReason(d.reason ?? '');
    setTerms(d.terms ?? '');
    setSel({
      code: d.supplier_code, name: d.supplier, type: d.supplier_type, addr: d.address,
      country: d.country, state: d.state, stateCode: d.state_code, city: d.city,
      contact: d.contact_name, desig: d.designation, phone: d.contact_no, email: d.email,
      scrutiny: d.scrutiny_date, gstNo: d.gst_number, gstStatus: d.gst_status,
      filing: d.last_filing_date, remarks: d.gst_remarks,
    });
    setProducts((d.items ?? []).map((it: any) => ({
      product_id: it.product_id, code: it.code ?? '', name: it.name ?? '', hsn: it.hsn ?? '',
      qtyPo: num(it.qtyPo), qtySpi: num(it.qtySpi), debitQty: num(it.debitQty), rate: num(it.rate),
      cgstPct: num(it.cgstPct), sgstPct: num(it.sgstPct), igstPct: num(it.igstPct),
    })));
    const a = (d.additions ?? []).map((c: any) => ({ amount: String(c.amount ?? ''), note: c.note ?? '' }));
    const de = (d.deductions ?? []).map((c: any) => ({ amount: String(c.amount ?? ''), note: c.note ?? '' }));
    setAdditions(a.length ? a : [{ amount: '', note: '' }]);
    setDeductions(de.length ? de : [{ amount: '', note: '' }]);
    // Re-fetch the linked SPI's payment context for the Step-2 recap (not stored on the DN).
    if (d.supplier_purchase_invoice_id) {
      api.get(`/p2p/debit-notes/supplier-purchase-invoices/${d.supplier_purchase_invoice_id}`)
        .then(r => { const s = r.data?.data; if (s) setSpiPay({ paymentTerm: s.payment_term ?? '', totalInvoice: num(s.total_invoice), paidAmount: num(s.paid_amount), balance: num(s.balance) }); })
        .catch(() => {});
    }
  };

  // Picking an SPI → fetch full detail and auto-fill everything.
  const selectSpi = (opt: SpiOption | null) => {
    if (!opt) { setSpiId(null); setSpiCode(''); return; }
    setSpiId(opt.id); setSpiCode(opt.code); setSpiLoading(true);
    api.get(`/p2p/debit-notes/supplier-purchase-invoices/${opt.id}`)
      .then(r => {
        const d = r.data?.data;
        if (!d) return;
        setSpiDate(d.spi_date ?? '');
        setPoCode(d.po_code ?? '');
        setPoDate(d.po_date ?? '');
        setShipCode(d.shipment_code ?? '');
        setProcCode(d.procurement_code ?? '');
        setSel(d.supplier ?? null);
        setSpiPay({ paymentTerm: d.payment_term ?? '', totalInvoice: num(d.total_invoice), paidAmount: num(d.paid_amount), balance: num(d.balance) });
        setProducts((d.items ?? []).map((it: any) => ({
          product_id: it.product_id, code: it.code ?? '', name: it.name ?? '', hsn: it.hsn ?? '',
          qtyPo: num(it.qtyPo), qtySpi: num(it.qtySpi), debitQty: num(it.qtySpi), rate: num(it.rate),
          cgstPct: num(it.cgstPct), sgstPct: num(it.sgstPct), igstPct: num(it.igstPct),
        })));
      })
      .catch(() => toast.error('Could not load SPI', 'Failed to fetch the invoice details.'))
      .finally(() => setSpiLoading(false));
  };

  // ── Derived product amounts + totals ──
  const rowsCalc = products.map(p => {
    const base = p.debitQty * p.rate;
    const cgstA = base * p.cgstPct / 100;
    const sgstA = base * p.sgstPct / 100;
    const igstA = base * p.igstPct / 100;
    return { ...p, base, cgstA, sgstA, igstA, cost: base + cgstA + sgstA + igstA };
  });
  const totProd = rowsCalc.reduce((s, r) => s + r.cost, 0);
  const totCgst = rowsCalc.reduce((s, r) => s + r.cgstA, 0);
  const totSgst = rowsCalc.reduce((s, r) => s + r.sgstA, 0);
  const sumAmt = (rs: ChargeRow[]) => rs.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const addSum = sumAmt(additions);
  const dedSum = sumAmt(deductions);
  const grandTotal = totProd + addSum - dedSum;

  const patchProduct = (i: number, key: keyof ProdRow, v: any) =>
    setProducts(ps => ps.map((r, idx) => idx === i ? { ...r, [key]: (key === 'code' || key === 'name' || key === 'hsn') ? v : num(v) } : r));
  const removeProduct = (i: number) => setProducts(ps => ps.filter((_, idx) => idx !== i));

  // ── Save ──
  const save = async () => {
    if (!spiId) { toast.info('SPI required', 'Select an SPI number first.'); setStep(1); return; }
    setSaving(true);
    const payload = {
      debit_note_type_id: dnTypeId,
      debit_note_type: dnTypeName || null,
      supplier_purchase_invoice_id: spiId,
      debit_note_date: todayISO,
      expected_debit_date: expDate || null,
      reason, terms,
      items: products.map(p => ({
        product_id: p.product_id ?? null, product_code: p.code, product_name: p.name, hsn_code: p.hsn,
        qty_po: p.qtyPo, qty_spi: p.qtySpi, debit_qty: p.debitQty, rate: p.rate,
        cgst_pct: p.cgstPct, sgst_pct: p.sgstPct, igst_pct: p.igstPct,
      })),
      additions: additions.filter(r => r.amount || r.note).map(r => ({ amount: num(r.amount), note: r.note })),
      deductions: deductions.filter(r => r.amount || r.note).map(r => ({ amount: num(r.amount), note: r.note })),
    };
    try {
      if (editId) await api.put(`/p2p/debit-notes/${editId}`, payload);
      else await api.post('/p2p/debit-notes', payload);
      toast.success(editId ? 'Debit note updated' : 'Debit note created');
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save the debit note.');
    } finally { setSaving(false); }
  };

  // Step-2 "SPI Details" auto fields. Everything is fetched from the linked SPI
  // except GRN ID + WAREHOUSE, which aren't captured on the SPI yet (hardcoded).
  const money = (n?: number) => (n === undefined || n === null ? '' : inr(n));
  const spiAutoFields: [string, string][] = [
    ['SPI NUMBER', spiCode], ['SPI DATE', spiDate], ['PO NUMBER', poCode], ['PO DATE', poDate],
    ['GRN ID', spiCode ? GRN_ID : ''], ['WAREHOUSE', spiCode ? WAREHOUSE : ''], ['SUPPLIER NAME', sel?.name ?? ''], ['SUPPLIER GSTIN', sel?.gstNo ?? ''],
    ['PAYMENT TERM', spiPay?.paymentTerm ?? ''], ['TOTAL INVOICE AMOUNT', money(spiPay?.totalInvoice)], ['PAID AMOUNT', money(spiPay?.paidAmount)], ['TOTAL BALANCE AMOUNT', money(spiPay?.balance)],
  ];

  return createPortal(
    <div className="spi-dt-overlay dn-scope">
      <div className="spi-dt">
        {/* Header + stepper share one card (Figma) */}
        <div className="spi-dt-topcard">
          {/* ── Header ── */}
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Debit Note</div>
                <div className="spi-dt-head-sub">{editId ? 'Editing' : 'Draft · not yet issued'}</div>
              </div>
            </div>
            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="SHIPMENT ID" value={shipCode || '—'} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PROCUREMENT ID" value={procCode || '—'} alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="SPI NUMBER" value={spiCode || '—'} mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value={poCode || '—'} alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={sel?.name || '—'} />
            </div>
            <div className="spi-dt-head-r">
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>

          {/* ── Step tabs ── */}
          <div className="spi-dt-steps">
            <div className={`spi-dt-step spi-dt-step--nav ${step === 1 ? 'is-active' : 'is-done'}`} role="button" tabIndex={0} title="Go to Step 1" onClick={() => setStep(1)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(1); } }}>
              <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 01</span>
                {step === 1
                  ? <span className="spi-dt-step-badge">ACTIVE</span>
                  : <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
              </div>
              <div className="spi-dt-step-big">01</div>
              <div className="spi-dt-step-title">Basic Debit Note Details</div>
              <div className="spi-dt-step-desc">Core details that identify this debit note</div>
              <span className="spi-dt-step-ghost">01</span>
            </div>
            <div className={`spi-dt-step spi-dt-step--nav ${step === 2 ? 'is-active' : ''}`} role="button" tabIndex={0} title="Go to Step 2" onClick={() => setStep(2)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(2); } }}>
              <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 02</span>
                {step === 2 && <span className="spi-dt-step-badge">ACTIVE</span>}
              </div>
              <div className="spi-dt-step-big">02</div>
              <div className="spi-dt-step-title">SPI Details &amp; Debit Note Product Details</div>
              <div className="spi-dt-step-desc">Invoice details &amp; returned / adjusted items</div>
              <span className="spi-dt-step-ghost">02</span>
            </div>
          </div>
        </div>

        {/* ── Body (Step 1) ── */}
        {step === 1 && (
        <div className="spi-dt-body">
          {/* Section 1 — Debit Note Details */}
          <div className={`spi-dt-sec ${dnOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setDnOpen(o => !o)}>
              <div className="spi-dt-sec-ico"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Debit Note</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Details</span></div>
                <div className="spi-dt-sec-sub">Core details that identify this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-grid4">
                <Field label="DEBIT NOTE NO."><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={code} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="DEBIT NOTE DATE"><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={todayDisp} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="DEBIT NOTE TYPE">
                  <div className="dn-typewrap">
                    <DnSelect value={dnTypeName} options={types.map(t => t.name)} placeholder="— Select Type —" onChange={v => setDnTypeId(types.find(t => t.name === v)?.id ?? null)} />
                    <button type="button" className="dn-typeadd" title="Manage debit note types" onClick={() => setTypeModalOpen(true)}><IcoPlus size={15} /></button>
                  </div>
                </Field>
                <Field label="EXPECTED DEBIT DATE"><MasterDatePicker value={expDate} onChange={setExpDate} placeholder="Select date" popupClassName="dncr-cal" /></Field>
                <Field label="SPI NUMBER"><DnSelect value={spiCode} options={spis.map(s => s.code)} placeholder="— Select SPI Number —" onChange={v => selectSpi(spis.find(s => s.code === v) ?? null)} /></Field>
                <AutoField label="SPI DATE" value={spiDate} loading={spiLoading} />
                <AutoField label="PO NUMBER" value={poCode} loading={spiLoading} />
                <AutoField label="PO DATE" value={poDate} loading={spiLoading} />
              </div>
            </div>
          </div>

          {/* Section 2 — Supplier */}
          <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Supplier Details</span></div>
                <div className="spi-dt-sec-sub">Auto-filled from the selected SPI — the supplier this debit note is issued to.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              {/* Supplier Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
                  <span className="spi-dt-fields-badge">3 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <AutoField label="SUPPLIER CODE" value={sel?.code} placeholder="— from SPI —" />
                  <AutoField label="COMPANY NAME" value={sel?.name} placeholder="— from SPI —" />
                  <AutoField label="SUPPLIER TYPE" value={sel?.type} placeholder="— from SPI —" />
                </div>
              </div>

              {/* Supplier Legal Status card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head" style={{ cursor: 'pointer' }} onClick={() => setLegalOpen(o => !o)}>
                  <div className="spi-dt-card-title">
                    <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
                    {sel && <span className="spi-dt-legal-badge ok">100% Compliant</span>}
                  </div>
                  <span className="spi-dt-minus">{legalOpen ? '–' : '+'}</span>
                </div>
                {legalOpen && (
                  <div className="spi-dt-legal">
                    <div className="spi-dt-legal-top">
                      <div className="spi-dt-legal-bar"><span className="spi-dt-legal-fill" style={{ width: sel ? '100%' : '0%', background: sel ? 'linear-gradient(90deg,#0e7490,#0891b2 55%,#06b6d4)' : undefined }} /></div>
                      <div className="spi-dt-legal-pct">{sel ? '100%' : '0%'}</div>
                    </div>
                    {sel ? (<>
                      <div className="spi-dt-legal-summary"><strong>18</strong> of <strong>18</strong> documents completed across all 5 parameters</div>
                      <div className="spi-dt-legal-grid">
                        {LEGAL_PARAMS.map(c => (
                          <div key={c.name} className="spi-dt-legal-pcard spi-dt-legal-pcard--ok">
                            <div className="spi-dt-legal-pcard-hd"><span className="spi-dt-legal-pcard-ico"><IcoCheck /></span><span className="spi-dt-legal-pcard-nm">{c.name}</span><span className="spi-dt-legal-pcard-cnt">{c.d} / {c.t}</span></div>
                            <div className="spi-dt-legal-pcard-bar"><div className="spi-dt-legal-pcard-fill" style={{ width: '100%' }} /></div>
                          </div>
                        ))}
                      </div>
                    </>) : (
                      <div className="spi-dt-legal-note">Select an SPI to view legal &amp; compliance status.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Address & Contact Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
                  <span className="spi-dt-fields-badge">9 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <AutoField label="REGISTERED OFFICE ADDRESS" full value={sel?.addr} placeholder="— from SPI —" />
                  <AutoField label="COUNTRY" value={sel?.country} placeholder="— from SPI —" />
                  <AutoField label="STATE" value={sel?.state} placeholder="— from SPI —" />
                  <AutoField label="STATE CODE" value={sel?.stateCode} placeholder="— from SPI —" />
                  <AutoField label="CITY" value={sel?.city} placeholder="— from SPI —" />
                  <AutoField label="CONTACT PERSON NAME" value={sel?.contact} placeholder="— from SPI —" />
                  <AutoField label="DESIGNATION" value={sel?.desig} placeholder="— from SPI —" />
                  <AutoField label="CONTACT NUMBER" value={sel?.phone} placeholder="— from SPI —" />
                  <AutoField label="EMAIL ID" value={sel?.email} placeholder="— from SPI —" />
                </div>
              </div>

              {/* GST Scrutiny Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details</div>
                  <span className="spi-dt-fields-badge">4 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <AutoField label="SCRUTINY DATE" value={sel?.scrutiny} placeholder="— from SPI —" />
                  <AutoField label="GST NUMBER" value={sel?.gstNo} placeholder="— from SPI —" />
                  <AutoField label="GST STATUS" value={sel?.gstStatus} placeholder="— from SPI —" />
                  <AutoField label="LAST FILING DATE" value={sel?.filing} placeholder="— from SPI —" />
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── Body (Step 2) ── */}
        {step === 2 && (
        <div className="spi-dt-body">
          {/* Summary (read-only, collapsed) */}
          <div className={`spi-dt-sec ${sumOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setSumOpen(o => !o)}>
              <div className="spi-dt-sec-ico"><IcoHistory /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Summary</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">What We Did in the Previous Stages</span></div>
                <div className="spi-dt-sec-sub">Read-only summary of all completed stages so far — 1 stage done.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-sumstep">
                <div className="spi-dt-sumstep-hd">
                  <div className="spi-dt-sumstep-hd-l">
                    <span className="spi-dt-sumstep-num">01</span>
                    <span className="spi-dt-sumstep-title">Basic Debit Note Details</span>
                  </div>
                  <span className="spi-dt-sumstep-done"><IcoCheck /> COMPLETED</span>
                </div>
                <div className="spi-dt-sumstep-body">
                  <ROGroup label="Debit Note Details">
                    <RO label="DEBIT NOTE NO." value={code} />
                    <RO label="DEBIT NOTE DATE" value={todayDisp} />
                    <RO label="DEBIT NOTE TYPE" value={np(dnTypeName)} muted={!dnTypeName} />
                    <RO label="EXPECTED DEBIT DATE" value={np(expDate)} muted={!expDate} />
                    <RO label="SPI NUMBER" value={np(spiCode)} muted={!spiCode} />
                    <RO label="SPI DATE" value={np(spiDate)} muted={!spiDate} />
                    <RO label="PO NUMBER" value={np(poCode)} muted={!poCode} />
                    <RO label="PO DATE" value={np(poDate)} muted={!poDate} />
                  </ROGroup>
                  <ROGroup label="Supplier Details">
                    <RO label="SUPPLIER CODE" value={np(sel?.code)} muted={!sel} />
                    <RO label="COMPANY NAME" value={np(sel?.name)} muted={!sel} />
                    <RO label="SUPPLIER TYPE" value={np(sel?.type)} muted={!sel?.type} />
                  </ROGroup>
                  <ROGroup label="Address & Contact Details">
                    <RO label="REGISTERED OFFICE ADDRESS" value={np(sel?.addr)} muted={!sel} full />
                    <RO label="COUNTRY" value={np(sel?.country)} muted={!sel?.country} />
                    <RO label="STATE" value={np(sel?.state)} muted={!sel?.state} />
                    <RO label="STATE CODE" value={np(sel?.stateCode)} muted={!sel} />
                    <RO label="CITY" value={np(sel?.city)} muted={!sel} />
                    <RO label="CONTACT PERSON NAME" value={np(sel?.contact)} muted={!sel} />
                    <RO label="DESIGNATION" value={np(sel?.desig)} muted={!sel} />
                    <RO label="CONTACT NUMBER" value={np(sel?.phone)} muted={!sel} />
                    <RO label="EMAIL ID" value={np(sel?.email)} muted={!sel} />
                  </ROGroup>
                  <ROGroup label="GST Scrutiny Details">
                    <RO label="SCRUTINY DATE" value={np(sel?.scrutiny)} muted={!sel?.scrutiny} />
                    <RO label="GST NUMBER" value={np(sel?.gstNo)} muted={!sel} />
                    <RO label="GST STATUS" value={np(sel?.gstStatus)} muted={!sel?.gstStatus} />
                    <RO label="LAST FILING DATE" value={np(sel?.filing)} muted={!sel?.filing} />
                  </ROGroup>
                </div>
              </div>
            </div>
          </div>

          {/* SPI Details — auto fields */}
          <div className={`spi-dt-sec ${spiOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setSpiOpen(o => !o)}>
              <div className="spi-dt-sec-ico"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier Invoice</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">SPI Details</span></div>
                <div className="spi-dt-sec-sub">Details of the original supplier purchase invoice linked to this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-grid4">
                {spiAutoFields.map(([lbl, val]) => (
                  <Field key={lbl} label={lbl}><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={val || '—'} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                ))}
              </div>
            </div>
          </div>

          {/* Products */}
          <div className={`spi-dt-sec dncr-prodsec ${prodOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-3"><IcoBox /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Product Details</span></div>
                <div className="spi-dt-sec-sub">Returned or adjusted items for this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="dncr-prodmeta">
                <span className="dncr-prodmeta-txt">{products.length} products · from the linked SPI · only <b>Debit Qty</b> is editable · remove a row to exclude it</span>
              </div>
              <div className="spi-dt-mtable-wrap">
                <table className="spi-dt-mtable spi-dt-mtable--fixed">
                  <colgroup>
                    <col style={{ width: '52px' }} /><col style={{ width: '96px' }} /><col style={{ minWidth: '180px' }} />
                    <col style={{ width: '110px' }} /><col style={{ width: '84px' }} /><col style={{ width: '84px' }} /><col style={{ width: '84px' }} /><col style={{ width: '96px' }} />
                    <col style={{ width: '76px' }} /><col style={{ width: '104px' }} /><col style={{ width: '76px' }} /><col style={{ width: '104px' }} /><col style={{ width: '104px' }} /><col style={{ width: '54px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="spi-dt-mc-c">SR NO</th><th>PRODUCT CODE</th><th>PRODUCT NAME (SPI)</th><th className="spi-dt-mc-c">HSN CODE</th>
                      <th className="spi-dt-mc-c">QTY (PO)</th><th className="spi-dt-mc-c">QTY (SPI)</th><th className="spi-dt-mc-c">DEBIT QTY</th><th className="spi-dt-mc-c">PRODUCT RATE</th>
                      <th className="spi-dt-mc-c">CGST(%)</th><th className="spi-dt-mc-c">CGST AMOUNT</th><th className="spi-dt-mc-c">SGST(%)</th><th className="spi-dt-mc-c">SGST AMOUNT</th><th className="spi-dt-mc-c">DEBIT COST</th><th className="spi-dt-mc-c">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsCalc.length === 0 ? (
                      <tr><td colSpan={14} style={{ textAlign: 'center', padding: '28px', color: '#94a3b8', fontWeight: 600 }}>Select an SPI to load its products.</td></tr>
                    ) : rowsCalc.map((p, i) => (
                      <tr key={i}>
                        <td className="spi-dt-mc-c">{i + 1}</td>
                        <td><span className="dn-frz">{p.code || '—'}</span></td>
                        <td><span className="dn-frz dn-frz-l">{p.name || '—'}</span></td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.hsn || '—'}</span></td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.qtyPo}</span></td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.qtySpi}</span></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm dn-editqty" type="number" min={0} value={p.debitQty} onChange={e => patchProduct(i, 'debitQty', e.target.value)} title="Editable" /></td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.rate}</span></td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.cgstPct}</span></td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.cgstA)}</td>
                        <td className="spi-dt-mc-c"><span className="dn-frz">{p.sgstPct}</span></td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.sgstA)}</td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.cost)}</td>
                        <td className="spi-dt-mc-c"><button type="button" className="spi-dt-rowdel" title="Remove product" onClick={() => removeProduct(i)}><IcoX size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Additions / Deductions + totals */}
              <div className="spi-dt-sum">
                <div className="dncr-charges">
                  <ChargeBlock variant="add" label="ADDITIONS (+)" rows={additions} setRows={setAdditions} />
                  <ChargeBlock variant="ded" label="DEDUCTIONS (-)" rows={deductions} setRows={setDeductions} />
                </div>
                <div className="spi-dt-totbox">
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total Debit Cost</span><span className="spi-dt-totrow-v">{inr(totProd)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total CGST Amount</span><span className="spi-dt-totrow-v">{inr(totCgst)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total SGST Amount</span><span className="spi-dt-totrow-v">{inr(totSgst)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Additions (+)</span><span className="spi-dt-totrow-v">{inr(addSum)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Deductions (–)</span><span className="spi-dt-totrow-v">– {inr(dedSum)}</span></div>
                  <div className="spi-dt-totrow spi-dt-totrow-grand"><span className="spi-dt-totrow-k">Grand Total</span><span className="spi-dt-totrow-v">{inr(grandTotal)}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div className={`spi-dt-sec ${reasonOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setReasonOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoChat /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Reason</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Reason</span></div>
                <div className="spi-dt-sec-sub">Reason for raising this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-field spi-dt-field-full"><label className="spi-dt-field-lbl">REASON</label><input className="spi-dt-inp" value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter debit note reason…" /></div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className={`spi-dt-sec ${termsOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setTermsOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-4"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Terms</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Terms &amp; Conditions</span></div>
                <div className="spi-dt-sec-sub">Define the terms &amp; conditions for this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="dncr-terms">
                <label className="dncr-terms-lbl">Terms &amp; Condition</label>
                <textarea className="dncr-terms-ta" value={terms} onChange={e => setTerms(e.target.value)} placeholder="Enter debit note terms & conditions…" />
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── Footer ── */}
        {step === 1 ? (
          <div className="spi-dt-foot">
            <div className="spi-dt-foot-l">
              <div>
                <div className="spi-dt-foot-step">STEP 01 OF 02</div>
                <div className="spi-dt-foot-name">Basic Debit Note Details</div>
              </div>
              <div className="spi-dt-dots"><span className="on" /><span /></div>
            </div>
            <div className="spi-dt-foot-r">
              <button type="button" className="spi-dt-btn-ghost" onClick={onClose}><IcoChevronL /> Cancel</button>
              <button type="button" className="spi-dt-btn-next" onClick={() => setStep(2)}>Save &amp; Next <IcoChevronR /></button>
            </div>
          </div>
        ) : (
          <div className="spi-dt-foot">
            <div className="spi-dt-foot-l">
              <div>
                <div className="spi-dt-foot-step">STEP 02 OF 02</div>
                <div className="spi-dt-foot-name">SPI Details &amp; Debit Note Product Details</div>
              </div>
              <div className="spi-dt-dots"><span className="done" /><span className="on" /></div>
            </div>
            <div className="spi-dt-foot-r">
              <button type="button" className="spi-dt-btn-ghost" onClick={() => setStep(1)}><IcoChevronL /> Back</button>
              <button type="button" className="spi-dt-btn-map" onClick={save} disabled={saving}>{saving ? 'Saving…' : (editId ? 'Update Debit Note' : 'Generate Debit Note')} <IcoChevronR /></button>
            </div>
          </div>
        )}
      </div>

      {typeModalOpen && <DebitNoteTypeModal onClose={() => setTypeModalOpen(false)} onChanged={loadTypes} />}

      <style>{DNCR_CSS}</style>
    </div>,
    document.body,
  );
}

function HeadPill({ icon, label, value, alt, mono }: { icon: ReactNode; label: string; value: string; alt?: boolean; mono?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div className="spi-dt-pill-txt"><div className="spi-dt-pill-lbl">{label}</div><div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`} title={value}>{value}</div></div>
    </div>
  );
}

function Field({ label, children, full, req }: { label: string; children: ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}

/* Read-only AUTO field — shows the (SPI-derived) value locked, or a muted
 * placeholder until an SPI is chosen. */
function AutoField({ label, value, full, placeholder, loading }: { label: string; value?: string | null; full?: boolean; placeholder?: string; loading?: boolean }) {
  const v = value && String(value).trim() !== '' ? String(value) : '';
  return (
    <Field label={label} full={full}>
      <div className="spi-dt-inp-auto">
        <input className="spi-dt-inp" value={loading ? 'Loading…' : (v || placeholder || '—')} title={v || undefined} readOnly />
        <span className="spi-dt-auto"><IcoLock /> AUTO</span>
      </div>
    </Field>
  );
}

// "— Not provided" fallback for the Step-2 read-only recap.
const np = (v?: string | null) => (v && String(v).trim() !== '' ? String(v) : '— Not provided');

/* Read-only recap field + group (Step 2 "What We Did in the Previous Stages"). */
function RO({ label, value, full, muted }: { label: string; value: string; full?: boolean; muted?: boolean }) {
  return <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}><div className="spi-dt-ro-lbl">{label}</div><div className={`spi-dt-ro-val ${muted ? 'is-muted' : ''}`}>{value}</div></div>;
}
function ROGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="spi-dt-rogroup"><div className="spi-dt-rogroup-hd">{label}</div><div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div></div>;
}

/* Additions / Deductions charge block — header (label + "+ Add") stays fixed; the rows live in a
 * scroll container that caps at ~3 rows so the section never grows unbounded (senior-dev layout). */
function ChargeBlock({ variant, label, rows, setRows }: { variant: 'add' | 'ded'; label: string; rows: ChargeRow[]; setRows: Dispatch<SetStateAction<ChargeRow[]>> }) {
  const patch = (i: number, key: 'amount' | 'note', v: string) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: v } : r));
  return (
    <div className="dncr-charge-block">
      <div className="dncr-charge-hd">
        <span className={`dncr-charge-lbl dncr-${variant}`}>— {label}</span>
        <button type="button" className={`dncr-chgbtn dncr-chgbtn-${variant}`} onClick={() => setRows(rs => [...rs, { amount: '', note: '' }])}><IcoPlus size={12} /> Add</button>
      </div>
      <div className="dncr-charge-rows">
        {rows.map((row, i) => (
          <div className="dncr-charge-row" key={i}>
            <div className="dncr-amtwrap"><span className="dncr-cur">₹</span><input className="dncr-amtinp" type="number" placeholder="0.00" value={row.amount} onChange={e => patch(i, 'amount', e.target.value)} /></div>
            <input className="dncr-note" placeholder="Note against this charge…" value={row.note} onChange={e => patch(i, 'note', e.target.value)} />
            <button type="button" className="dncr-rowx" title="Remove" onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)}><IcoX size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* App-style selective dropdown — same portal-popover pattern & .spi-dt-select styling
 * as the SPI wizard's EditSelect, so Debit Note dropdowns match the rest of the app. */
function DnSelect({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(224, Math.max(options.length, 1) * 38 + 10);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.spi-dt-esel-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={btnRef} title={value || undefined} className={`spi-dt-select spi-dt-select-edit ${open ? 'is-open' : ''} ${!value ? 'is-muted' : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{value || placeholder || '— Select —'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="spi-dt-esel-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.length === 0
            ? <div className="spi-dt-esel-opt is-muted" style={{ color: '#94a3b8', cursor: 'default' }}>No options</div>
            : options.map(o => (
              <div key={o} className={`spi-dt-esel-opt ${o === value ? 'is-active' : ''}`} onClick={() => { onChange(o); setOpen(false); }}>{o}</div>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const DNCR_CSS = `
.dn-scope .dncr-placeholder { padding:60px 40px; text-align:center; color:#94a3b8; font-size:13px; font-weight:600; }
/* DEBIT NOTE TYPE dropdown + inline "+" manage button, sitting side by side. */
.dn-scope .dn-typewrap { display:flex; align-items:stretch; gap:7px; }
.dn-scope .dn-typewrap .spi-dt-select { flex:1; min-width:0; }
.dn-scope .dn-typeadd { flex:0 0 auto; width:40px; display:flex; align-items:center; justify-content:center; border:0; border-radius:9px; color:#fff; cursor:pointer; background:linear-gradient(135deg,#06b6d4 0%,#0891b2 50%,#0e7490 100%); box-shadow:0 6px 16px -4px rgba(8,145,178,.5); transition:background .2s,transform .2s,box-shadow .2s; }
.dn-scope .dn-typeadd:hover { background:linear-gradient(135deg,#0891b2 0%,#0e7490 50%,#155e75 100%); transform:translateY(-1.5px); }
[data-bs-theme="dark"] .dn-scope .dn-typeadd { color:#fff; }
/* Figma header: chips grouped on the RIGHT, right next to Close. Only the pills carry the auto
 * margin — Close drops its own auto margin, else the free space splits and leaves a gap between them. */
.dn-scope .spi-dt-pills { margin-left:auto; }
.dn-scope .spi-dt-head-r { margin-left:0; }
/* Close button hover = same as the PO wizard (.cstrip__back-btn): gradient darkens + a small lift
 * (dev's default was only a faint brightness with no colour shift). */
.dn-scope .spi-dt-btn-close { background:linear-gradient(135deg,#06b6d4 0%,#0891b2 50%,#0e7490 100%) !important; transition:background .2s,transform .2s,box-shadow .2s !important; }
.dn-scope .spi-dt-btn-close:hover { background:linear-gradient(135deg,#0891b2 0%,#0e7490 50%,#155e75 100%) !important; transform:translateY(-1.5px) !important; filter:none !important; }
/* Figma "Generate Debit Note" CTA (.cpo-btn--p): 135deg teal gradient + top white sheen + soft shadow. */
.dn-scope .spi-dt-btn-map { background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,0) 50%),linear-gradient(135deg,#0e7490,#0891b2 55%,#06b6d4) !important; box-shadow:0 8px 20px -4px rgba(8,145,178,.5) !important; }
.dn-scope .spi-dt-btn-map:disabled { opacity:.65; cursor:default; }
/* Figma header chips: all icons are ONE uniform teal gradient (dev alternated bright/dark via
 * the --alt variant). Match the list-header icon gradient + a soft shadow. */
.dn-scope .spi-dt-pill-ico,
.dn-scope .spi-dt-pill-ico--alt { background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490) !important; box-shadow:0 3px 9px -1px rgba(8,145,178,.5), inset 0 1px 0 rgba(255,255,255,.3) !important; }
/* Figma-strength drop shadow on the teal header/section/card icons (dev's was too subtle) —
 * bigger soft teal shadow + an inset white top highlight so the icons visibly lift off. */
.dn-scope .spi-dt-head-ico { box-shadow:0 8px 20px -4px rgba(8,145,178,.5), inset 0 1px 0 rgba(255,255,255,.42) !important; }
.dn-scope .spi-dt-sec-ico { box-shadow:0 7px 16px -3px rgba(8,145,178,.45), inset 0 1px 0 rgba(255,255,255,.35) !important; }
.dn-scope .spi-dt-card-ico { box-shadow:0 5px 13px -2px rgba(8,145,178,.42), inset 0 1px 0 rgba(255,255,255,.3) !important; }
/* Dark-mode AUTO badge — the reused SPI style keeps a glaring pale #ecfeff pill
 * in dark mode; recolour to a subtle translucent teal chip with legible text. */
[data-bs-theme="dark"] .dn-scope .spi-dt-auto { background:rgba(34,211,238,.12) !important; color:#67e8f9 !important; border:1px solid rgba(34,211,238,.3); }
/* Figma product table (.cpd-tbl) — dev was using the compact/responsive sizing, so it read
 * smaller than the Figma. Restore the Figma base scale: roomier header/cell padding + bigger font. */
/* Products section body is white (not the cyan #f0fbfd) so the whole table area reads clean white. */
.dn-scope .dncr-prodsec .spi-dt-sec-body { background:#fff; }
.dn-scope .spi-dt-mtable { font-size:12px; background:#fff; }
.dn-scope .spi-dt-mtable-wrap { background:#fff; }
.dn-scope .spi-dt-mtable thead th { padding:9px 12px; }
.dn-scope .spi-dt-mtable tbody td { padding:7px 12px; font-size:12px; }
/* Pure white table — kill the blue zebra + input tint so it reads clean white like the Figma. */
.dn-scope .spi-dt-mtable tbody tr,
.dn-scope .spi-dt-mtable tbody tr:nth-child(even),
.dn-scope .spi-dt-mtable tbody tr:nth-child(odd),
.dn-scope .spi-dt-mtable tbody td { background:#fff !important; }
.dn-scope .spi-dt-mtable tbody tr:hover,
.dn-scope .spi-dt-mtable tbody tr:hover td { background:#f6fdff !important; }
.dn-scope .spi-dt-mtable .spi-dt-minp { padding:6px 8px; font-size:11.5px; background:#fff !important; }
.dn-scope .spi-dt-mtable .spi-dt-minp::placeholder { color:#9fb0bf; }
/* Frozen (read-only) product cells — every column except DEBIT QTY is locked. */
.dn-scope .spi-dt-mtable .dn-frz { display:block; font-size:11.5px; font-weight:600; color:#334155; text-align:center; padding:2px 4px; }
.dn-scope .spi-dt-mtable .dn-frz-l { text-align:left; }
/* DEBIT QTY — the one editable cell; give it a subtle teal highlight so it stands out. */
.dn-scope .spi-dt-mtable .dn-editqty { background:#f0fbfe !important; border-color:#7fd8e8 !important; font-weight:700; color:#0e7490; }
.dn-scope .spi-dt-mtable .dn-editqty:focus { border-color:#22d3ee !important; box-shadow:0 0 0 3px rgba(34,211,238,.15); }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable .dn-frz { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable .dn-editqty { background:rgba(34,211,238,.1) !important; border-color:rgba(34,211,238,.4) !important; color:#67e8f9; }
/* Dark mode — the white product table above is a light-mode intent only; restore
 * a dark surface so the section doesn't render as a glaring white panel. */
[data-bs-theme="dark"] .dn-scope .dncr-prodsec .spi-dt-sec-body { background:#0b1a22; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable,
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable-wrap { background:transparent; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody tr,
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody tr:nth-child(even),
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody tr:nth-child(odd),
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody td { background:transparent !important; color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody tr:hover,
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable tbody tr:hover td { background:rgba(34,211,238,.06) !important; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable .spi-dt-minp { background:#0c1c24 !important; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .spi-dt-mtable .spi-dt-minp::placeholder { color:#64748b; }

/* Products meta row (count + Add Product) */
.dn-scope .dncr-prodmeta { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:-4px 0 5px; }
.dn-scope .dncr-prodmeta-txt { font-size:11.5px; font-weight:600; color:#64748b; line-height:1.2; }
.dn-scope .dncr-addprod { display:inline-flex; align-items:center; gap:5px; padding:7px 13px; border:1.5px solid #cfe3ea; border-radius:9px; background:#fff; color:#0e7490; font-size:12px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s; }
.dn-scope .dncr-addprod:hover { background:#f0fbfe; border-color:#22d3ee; }

/* Additions / Deductions charge blocks (left of the totals panel) */
/* Additions | Deductions side by side (horizontal), not stacked — keeps the section short so it
 * balances against the totals panel instead of towering over it when rows are added. */
.dn-scope .dncr-charges { flex:1; display:flex; flex-direction:row; gap:18px; min-width:0; align-items:flex-start; }
.dn-scope .dncr-charge-block { flex:1 1 0; min-width:0; }
.dn-scope .dncr-charge-hd { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
/* Figma .cpd-sum__hd — 9.5px DM Sans, weight 800, .07em, uppercase, teal for BOTH add & ded
 * (only the "+ Add" button turns amber for deductions, not the label). */
.dn-scope .dncr-charge-lbl { font-size:9.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; }
.dn-scope .dncr-charge-lbl.dncr-add,
.dn-scope .dncr-charge-lbl.dncr-ded { color:#0891b2; }
.dn-scope .dncr-chgbtn { display:inline-flex; align-items:center; gap:4px; padding:4px 11px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; border:1.5px solid transparent; background:#fff; transition:background .15s; }
.dn-scope .dncr-chgbtn-add { color:#0891b2; border-color:#bfe4ec; }
.dn-scope .dncr-chgbtn-add:hover { background:#f0fbfe; }
.dn-scope .dncr-chgbtn-ded { color:#d97706; border-color:#fde3ba; }
.dn-scope .dncr-chgbtn-ded:hover { background:#fffbf2; }
/* Rows scroll internally past ~4 so the block height is capped and the layout never blows up. */
.dn-scope .dncr-charge-rows { display:flex; flex-direction:column; gap:10px; max-height:204px; overflow-y:auto; padding:2px 4px 2px 2px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar { width:7px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-thumb { background:#cfe3ea; border-radius:6px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-thumb:hover { background:#a9d3df; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-track { background:transparent; }
.dn-scope .dncr-charge-row { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.dn-scope .dncr-amtwrap { position:relative; flex:0 0 150px; display:flex; align-items:center; }
.dn-scope .dncr-cur { position:absolute; left:12px; color:#64748b; font-size:13px; font-weight:700; pointer-events:none; }
.dn-scope .dncr-amtinp { width:100%; height:40px; padding:0 12px 0 26px; border:1.5px solid #e3edf2; border-radius:10px; font-size:13px; font-weight:600; color:#0c4a6e; background:#fff; box-sizing:border-box; text-align:right; }
.dn-scope .dncr-note { flex:1; min-width:0; height:40px; padding:0 14px; border:1.5px solid #e3edf2; border-radius:10px; font-size:13px; font-weight:500; color:#0c4a6e; background:#fff; box-sizing:border-box; }
.dn-scope .dncr-amtinp:focus, .dn-scope .dncr-note:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dn-scope .dncr-rowx { flex:0 0 auto; width:34px; height:34px; display:flex; align-items:center; justify-content:center; border:1.5px solid #fecaca; border-radius:9px; background:#fef2f2; color:#dc2626; cursor:pointer; transition:background .15s; }
.dn-scope .dncr-rowx:hover { background:#fee2e2; }
/* Figma Terms block (.cpd-terms) — label 13px/800 + tall textarea (min 272px, radius 14px). */
.dn-scope .dncr-terms { display:flex; flex-direction:column; gap:9px; }
.dn-scope .dncr-terms-lbl { font-size:13px; font-weight:800; color:#1e3a5f; letter-spacing:.01em; }
.dn-scope .dncr-terms-ta { font-family:inherit; font-size:12.5px; font-weight:500; color:#0f172a; padding:14px 15px; border:1.5px solid #d9e2e8; border-radius:14px; background:#fff; min-height:272px; max-height:420px; resize:vertical; width:100%; box-sizing:border-box; line-height:1.6; transition:border-color .15s,box-shadow .15s; }
.dn-scope .dncr-terms-ta:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 4px rgba(34,211,238,.12); }
.dn-scope .dncr-terms-ta::placeholder { color:#9fb0bf; }
[data-bs-theme="dark"] .dn-scope .dncr-terms-lbl { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .dncr-terms-ta { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dncr-prodmeta-txt { color:#94a3b8; }
[data-bs-theme="dark"] .dn-scope .dncr-addprod { background:#0c1c24; border-color:rgba(34,211,238,.25); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .dncr-amtinp, [data-bs-theme="dark"] .dn-scope .dncr-note { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dncr-chgbtn-add, [data-bs-theme="dark"] .dn-scope .dncr-chgbtn-ded { background:#0c1c24; }
/* Remove (X) buttons in dark mode — the charge-row X has no dark style upstream
 * and rendered as a glaring light-pink pill; give both a subtle translucent red. */
[data-bs-theme="dark"] .dn-scope .dncr-rowx { background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35); color:#f87171; }
[data-bs-theme="dark"] .dn-scope .dncr-rowx:hover { background:rgba(239,68,68,.22); border-color:#f87171; }
[data-bs-theme="dark"] .dn-scope .spi-dt-rowdel { background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35); color:#f87171; }
[data-bs-theme="dark"] .dn-scope .spi-dt-rowdel:hover { background:rgba(239,68,68,.22); border-color:#f87171; }

/* Calendar (MasterDatePicker) re-themed TEAL to match the wizard — default is indigo/violet.
 * The popup is portalled to <body>, so these use the .dncr-cal marker (not .dn-scope). */
.dn-scope .master-datepicker-toggle.open { border-color:#0891b2; }
.dn-scope .master-datepicker-icon { color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-title-btn.is-clickable { background:rgba(8,145,178,.08); border-color:rgba(8,145,178,.2); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-title-btn.is-clickable:hover { background:rgba(8,145,178,.16); border-color:rgba(8,145,178,.4); color:#0e7490; }
.master-datepicker-popup.dncr-cal .master-datepicker-nav:hover { background:rgba(8,145,178,.1); color:#0891b2; border-color:rgba(8,145,178,.3); }
.master-datepicker-popup.dncr-cal .master-datepicker-day:hover:not(:disabled):not(.is-selected),
.master-datepicker-popup.dncr-cal .master-datepicker-cell:hover:not(.is-selected) { background:rgba(8,145,178,.1); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-day.is-today,
.master-datepicker-popup.dncr-cal .master-datepicker-cell.is-today { background:rgba(8,145,178,.12); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-day.is-selected,
.master-datepicker-popup.dncr-cal .master-datepicker-cell.is-selected { background:linear-gradient(135deg,#0891b2,#06b6d4); color:#fff; box-shadow:0 3px 8px rgba(8,145,178,.3); }
.master-datepicker-popup.dncr-cal .master-datepicker-footer .today-btn { color:#0891b2; }

/* ── Mobile ─────────────────────────────────────────────────────────────
 * Additions/Deductions sit side by side on wider screens; on phones they'd be
 * too cramped, so stack them and trim the amount box. (The 4-col field grids,
 * charges|totals split, steps and recap already respond via the reused SPI CSS.) */
@media (max-width:640px) {
  .dn-scope .dncr-charges { flex-direction:column; gap:16px; }
  .dn-scope .dncr-amtwrap { flex:0 0 104px; }
  .dn-scope .dncr-charge-hd { flex-wrap:wrap; }
  .dn-scope .dncr-prodmeta { flex-wrap:wrap; gap:6px; }
}
`;

/* ── Inline icons ── */
function IcoDoc({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLines({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>; }
function IcoUser({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IcoX({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoCheck({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoChevronL({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>; }
function IcoChevronR({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function IcoDocSm({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoShield({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IcoPin({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoChevron({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoLock({ size = 11 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function IcoHistory({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>; }
function IcoBox({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoChat({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function IcoPlus({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
