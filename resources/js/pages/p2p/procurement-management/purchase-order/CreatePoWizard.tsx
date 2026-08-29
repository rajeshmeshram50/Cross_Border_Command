import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../components/ui/Tooltip';
import { formatDmy } from '../../../../utils/formatDmy';
import { formatProductCode } from '../../../../utils/formatProductCode';
import TradeDocsTable from './TradeDocsTable';
import PoPaymentModal from './PoPaymentModal';
import SupplierEvidenceVaultModal from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';


type PoRow = {
  id?: number; po: string; date: string; type: string; doc: string; ship?: string;
  opp: string; proc: string; cust?: string; supCode: string; supName: string;
  edd: string; status: string; zoho: string;
};

type Shipment = { id: number; code: string; customer: string; consignee?: string | null; opportunity_id?: number | null; opportunity_code?: string | null; proforma_invoice_id?: number | null; pi_number?: string | null };
type Warehouse = { id: number; name: string; code?: string; type?: string };
type Currency = { id: number; code: string };
type SupplierOpt = { id: number; code: string; name: string; document_type?: 'domestic' | 'international' };
type SupplierRec = {
  code: string; type: string; name: string; legal: string; addr: string;
  country: string; state: string; stateCode: string; city: string; contact: string;
  desig: string; phone: string; email: string; scrutiny: string; gstNo: string;
  gstStatus: string; filing: string; remarks: string; web: string;
  // Onboarded segment names — restricts which products can be picked in Stage 2.
  // Optional: demo records and emptySup() omit it (treated as "no restriction").
  segments?: string[];
};


const SUPPLIER_PLACEHOLDER = '— Select Supplier —';
const CPO_SUPPLIERS: Record<string, SupplierRec> = {
  'Reliance Industries Ltd': { code: 'S-001', type: 'Manufacturer', web: 'https://www.ril.com', name: 'Reliance Industries', legal: 'Reliance Industries Limited', addr: 'Maker Chambers IV, 222 Nariman Point, Mumbai 400021', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Anil Mehta', desig: 'Procurement Head', phone: '+91 98200 11223', email: 'anil.mehta@ril.com', scrutiny: '2026-04-12', gstNo: '27AAACR5055K1Z5', gstStatus: 'Active', filing: '2026-05-20', remarks: 'All invoices cleared. GST filings up to date with no pending scrutiny.' },
  'Tata Steel Ltd': { code: 'S-002', type: 'Manufacturer', web: 'https://www.tatasteel.com', name: 'Tata Steel', legal: 'Tata Steel Limited', addr: 'Bombay House, 24 Homi Mody Street, Fort, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Rakesh Sharma', desig: 'Sr. Manager - Sales', phone: '+91 98330 44556', email: 'rakesh.sharma@tatasteel.com', scrutiny: '2026-03-28', gstNo: '27AAACT2727Q1ZW', gstStatus: 'Active', filing: '2026-05-18', remarks: 'Long-standing supplier. 3 prior invoices, all reconciled.' },
  'Adani Enterprises Ltd': { code: 'S-003', type: 'Trader', web: 'https://www.adanienterprises.com', name: 'Adani Enterprises', legal: 'Adani Enterprises Limited', addr: 'Adani Corporate House, Shantigram, Ahmedabad 382421', country: 'India', state: 'Gujarat', stateCode: '24', city: 'Ahmedabad', contact: 'Priya Desai', desig: 'Key Account Manager', phone: '+91 99250 77889', email: 'priya.desai@adani.com', scrutiny: '2026-05-02', gstNo: '24AABCA1234R1Z8', gstStatus: 'Active', filing: '2026-05-22', remarks: 'New onboarding completed Q1. First two invoices verified.' },
  'Mahindra Logistics Ltd': { code: 'S-004', type: 'Service Provider', web: 'https://www.mahindralogistics.com', name: 'Mahindra Logistics', legal: 'Mahindra Logistics Limited', addr: 'Mahindra Towers, Worli, Mumbai 400018', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Vikram Nair', desig: 'Operations Lead', phone: '+91 98191 22334', email: 'vikram.nair@mahindra.com', scrutiny: '2026-04-19', gstNo: '27AAFCM5678P1ZK', gstStatus: 'Active', filing: '2026-05-15', remarks: 'Transport services supplier. Filing compliant; minor remarks on FY24.' },
  'Larsen & Toubro Ltd': { code: 'S-005', type: 'Manufacturer', web: 'https://www.larsentoubro.com', name: 'Larsen & Toubro', legal: 'Larsen & Toubro Limited', addr: 'L&T House, Ballard Estate, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Sunil Kulkarni', desig: 'Procurement Manager', phone: '+91 98202 55667', email: 'sunil.kulkarni@lnt.com', scrutiny: '2026-03-15', gstNo: '27AAACL0140P1ZL', gstStatus: 'Active', filing: '2026-05-10', remarks: 'Preferred supplier. All historical invoices cleared.' },
};

// (Removed the hardcoded SUP_LEGAL_PARAMS / SUP_LEGAL demo tables — the legal
// status card is now driven solely by the supplier's real Evidence Vault, so it
// never shows dummy rows before a real supplier is selected. See Create-PO QA #1.)

/* Real Supplier Legal Status — the 5 parameters shown in the card are derived
 * from the vendor's Evidence Vault (/segment-uploads/supplier/{id}/vault):
 * Company Due Diligence / Owner KYC / Trade Licenses / Trade Documents from
 * their upload buckets (Verified = done), Agreements from signature status
 * (Signed = done). Same {cards,p,done,tot} shape as the demo SUP_LEGAL calc. */
type LegalCard = { name: string; t: number; d: number; st: 'full' | 'part' | 'none'; pc: number };
type LegalView = { cards: LegalCard[]; p: number; done: number; tot: number };
const LEGAL_DONE = ['Verified', 'Signed', 'Approved'];
type VaultDocRow = { status?: string };
const buildLegalFromVault = (v: Record<string, unknown>): LegalView => {
  const rowsOf = (k: string) => (Array.isArray(v[k]) ? (v[k] as VaultDocRow[]) : []);
  const defs: [string, VaultDocRow[]][] = [
    ['Company Due Diligence', rowsOf('company_dd')],
    ['Owner KYC Documents', rowsOf('owner_kyc')],
    ['Trade Licenses', rowsOf('trade_licenses')],
    ['Trade Documents', rowsOf('trade_documents')],
    ['Agreements', rowsOf('agreements')],
  ];
  let tot = 0, done = 0;
  const cards: LegalCard[] = defs.map(([name, rows]) => {
    const t = rows.length;
    const d = rows.filter(r => LEGAL_DONE.includes(String(r.status))).length;
    tot += t; done += d;
    const st: LegalCard['st'] = t > 0 && d >= t ? 'full' : (d > 0 ? 'part' : 'none');
    return { name, t, d, st, pc: t ? Math.round(d / t * 100) : 0 };
  });
  return { cards, p: tot ? Math.round(done / tot * 100) : 0, done, tot };
};

const PO_PRODUCTS = [
  { code: 'P-002', name: 'Whole Wheat Flour 50kg', hsn: '11010000', qty: 150, price: 220, gst: 5 },
  { code: 'P-003', name: 'GreenBoost Organic Fertilizer', hsn: '31010000', qty: 50, price: 188, gst: 5 },
  { code: 'P-004', name: 'Organic Mango Pulp', hsn: '20079100', qty: 100, price: 75, gst: 12 },
  { code: 'P-005', name: 'Quality Testing Service', hsn: '999899', qty: 1, price: 3200, gst: 18 },
];

/* PO product line — entered by the user (product picked from the product
 * master; qty & rate typed). `PO_PRODUCTS` above doubles as the procurement /
 * PI "expected" list (for the Missing Product Details check) and the product
 * dropdown fallback when the product master fetch fails. */
type PoLine = { id: number; productId: number | null; code: string; piName: string; piQty: string; name: string; qty: string; rate: string; gst: number };
type ProdOpt = { id: number | null; code: string; name: string; price: number; gst: number; segment: string };
/* With-Shipment only: the canonical PI product set for the PO. PO rows may drop
 * below it (user removes a product); those removed PI products can be re-added
 * via the "Product Name (PO)" dropdown on a new Add-Product row. */
type PiRow = { productId: number | null; code: string; piName: string; piQty: string; rate: string; gst: number };
const PRODUCT_FALLBACK: ProdOpt[] = PO_PRODUCTS.map(p => ({ id: null, code: p.code, name: p.name, price: p.price, gst: p.gst, segment: '' }));
const PRODUCT_PLACEHOLDER = '— Select Product —';
const PI_REPICK_PLACEHOLDER = '— Select PI Product —';
// Stable identity for matching a PO row against a PI product: prefer product id,
// then product code, then the PI name.
const piIdent = (x: { productId: number | null; code: string; piName?: string; name?: string }) =>
  x.productId != null ? `#${x.productId}` : (x.code || x.piName || x.name || '');
const piLabel = (p: PiRow) => (p.code ? `${formatProductCode(p.code)} — ${p.piName}` : p.piName);
const blankLine = (id: number): PoLine => ({ id, productId: null, code: '', piName: '', piQty: '', name: '', qty: '', rate: '', gst: 0 });
// Map a /shipments/{id}/pi-products item into the canonical PI product set.
const mapPiRow = (it: Record<string, unknown>): PiRow => ({
  productId: it.product_id != null ? Number(it.product_id) : null,
  code: String(it.code ?? ''),
  piName: String(it.name ?? ''),
  piQty: it.qty != null ? String(num(it.qty)) : '',
  rate: it.rate != null ? String(num(it.rate)) : '',
  gst: num(it.gst),
});
// Seed a PO row from a pi-products item — PO name/qty default to the PI values.
const piItemToLine = (it: Record<string, unknown>, id: number): PoLine => {
  const p = mapPiRow(it);
  return { id, productId: p.productId, code: p.code, piName: p.piName, piQty: p.piQty, name: p.piName, qty: p.piQty, rate: p.rate, gst: p.gst };
};
// Cap a PO quantity at the PI quantity still available to THIS PO — the backend
// serves piQty as (PI total − what other POs already consumed), excluding this
// PO's own lines when editing. So a PO can only ever use the remaining/missing
// quantity, never over-allocate, and Missing Qty can never go negative. The
// Without-Shipment flow has no PI (piQty === '') so it is left uncapped.
/* Quantities, rates and charges accept digits and a single decimal point —
 * nothing else. `type="number"` is deliberately NOT used: min={0} only marks a
 * value invalid, and worse, when the text is un-parseable ("1-111111") the
 * browser keeps it in the DOM while reporting value='' to React, so no
 * onChange sanitiser can clean it up. A text input filtered here is the only
 * way the field can't hold a sign, a '+', an 'e' or two dots. */
const numOnly = (v: string): string => {
  const s = v.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  return dot === -1 ? s : s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
};

/* Trim anything past `max` decimal places as it is typed. Used by the PO
 * quantity fields: the column is decimal(14,4), so the DB would accept more —
 * this is the business rule that a PO quantity is quoted to 2 decimals. Applied
 * on input (rather than rounding at save) so what the user sees is what gets
 * stored, and a stray third digit is simply refused instead of silently
 * changing the number afterwards. */
const capDecimals = (v: string, max = 2): string => {
  const dot = v.indexOf('.');
  return dot === -1 ? v : v.slice(0, dot + 1 + max);
};

const capQty = (v: string, piQty: string): string => {
  if (piQty === '' || v === '') return v;
  const cap = num(piQty);
  return num(v) > cap ? String(cap) : v;
};

// Tax columns — CGST+SGST (intra-state) or a single IGST (inter-state). Shared
// by the products table's header and each body row so the two never drift.
type TaxComputed = { cgstP: number; sgstP: number; igstP: number; cgstA: number; sgstA: number; igstA: number };
const TaxHeadCells = ({ intra, intl }: { intra: boolean; intl?: boolean }) => (intl
  // International supplier → GST doesn't apply, so just one Tax % + Tax Amount
  // pair (like the PI), both 0 — not the CGST/SGST or IGST split.
  ? <><th className="cpd-c">Tax (%)</th><th className="cpd-r">Tax Amount</th></>
  : intra
    ? <><th className="cpd-c">CGST (%)</th><th className="cpd-c">SGST (%)</th><th className="cpd-r">CGST Amount</th><th className="cpd-r">SGST Amount</th></>
    : <><th className="cpd-c">IGST (%)</th><th className="cpd-r">IGST Amount</th></>);

// Turn a raw backend/DB error into a friendly message. A Postgres numeric
// overflow (22003, decimal(14,2) → max ~1 trillion) means a quantity, rate or
// charge is too big — surface that instead of the SQL dump.
const poSaveError = (msg?: string, fallback = 'Please review the form and try again.'): string =>
  (msg && /22003|numeric field overflow|numeric value out of range/i.test(msg))
    ? 'A value is too large to save — a quantity, rate, or charge exceeds the maximum allowed (about 1 trillion). Please reduce the amounts and try again.'
    : (msg || fallback);
const TaxBodyCells = ({ c, intra, intl }: { c: TaxComputed; intra: boolean; intl?: boolean }) => (intl
  ? <><td className="cpd-c">{c.igstP}%</td><td className="cpd-r">{money2(c.igstA)}</td></>
  : intra
    ? <><td className="cpd-c">{c.cgstP}%</td><td className="cpd-c">{c.sgstP}%</td><td className="cpd-r">{money2(c.cgstA)}</td><td className="cpd-r">{money2(c.sgstA)}</td></>
    : <><td className="cpd-c">{c.igstP}%</td><td className="cpd-r">{money2(c.igstA)}</td></>);

const CPO_STAGES = [
  { t: 'PO Link Supplier Details', d: 'Confirm the supplier for this PO' },
  { t: 'PO Product Details', d: 'Add products, quantities & pricing' },
  { t: 'PO Terms & Conditions', d: 'Define payment & delivery terms' },
  { t: 'Post PO Trade Document Management', d: 'Generate, e-sign & track documents' },
];

const PO_TYPES = ['Material / Goods', 'Services', 'FFD / Transporter'];
const DOC_TYPES = ['Domestics', 'International'];
const TRANSPORTS = ['By Road', 'By Sea', 'By Air'];
const DELIVERY_PLACEHOLDER = '— Select Warehouse —';
const WAREHOUSE_FALLBACK = ['Pune Main', 'Mumbai Hub', 'Nashik', 'Nagpur'];
const PAY_TYPES = ['Advanced Payment', 'Full Payment', 'Letter of Credit'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'JPY', 'CNY', 'SGD', 'INR'];
const INCO = ['FOB', 'CIF', 'EXW', 'C&F'];

/* ── helpers ──────────────────────────────────────────────────────────── */
const num = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const money2 = (n: number) => '₹' + (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/* The "no supplier selected" record — EVERY field is blank so the read-only
 * supplier cards render "—" until a supplier is actually picked. Country /
 * State / GST Status used to carry India / Maharashtra / Active here, which
 * read as real supplier data on an empty form (QA #33) — and a supplier from
 * any other state or country would have been contradicted by it. The real
 * values all come from mapDetailToSup once a supplier is chosen. */
const emptySup = (): SupplierRec => ({ code: '', type: '', name: '', legal: '', addr: '', country: '', state: '', stateCode: '', city: '', contact: '', desig: '', phone: '', email: '', scrutiny: '', gstNo: '', gstStatus: '', filing: '', remarks: '', web: '' });

/* ── icons ────────────────────────────────────────────────────────────── */
const Chev = ({ c = 'pof-dd__chev' }: { c?: string }) => (<svg className={c} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>);
const Check = ({ c }: { c?: string }) => (<svg className={c} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>);
const XIco = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
const Spin = ({ s = 14 }: { s?: number }) => (<svg className="pof-spin" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>);
const Skel = ({ w = '70%' }: { w?: number | string }) => <span className="pof-skel" style={{ width: w }} />;
const docHd = (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 12l1.6 1.6L14 10" /><line x1="8" y1="17" x2="16" y2="17" /></svg>);

/* ── Reusable dropdown (pof-dd, fixed panel positioned from anchor) ──────
 * `optMeta` (optional) enriches an option with a leading code and an
 * Own/Third-Party badge — used by the Delivery Location (warehouse) field to
 * render "WH-001: Pune Main  [Own]". */
// `name` overrides the raw option value for display — used by the supplier
// field, whose option VALUE is the unique code (names can duplicate) but which
// still shows the human name via meta.
type DdOptMeta = { code?: string; name?: string; badge?: string; badgeTone?: 'own' | 'third'; disabled?: boolean };
/* An out-of-segment option used to carry a red "Segment not mapped" chip here.
 * It was dropped: in a narrow cell (the Stage-2 product picker) it collided with
 * the segment badge and both ended up clipped mid-word. A frozen option still
 * reads as frozen — `.is-disabled` dims the row and blocks the click — and the
 * click still explains itself with the "Segment not mapped to the supplier"
 * toast, which has room for the full reason. */
const DdOptLabel = ({ o, meta }: { o: string; meta?: DdOptMeta }) => (
  meta ? (
    <span className="pof-dd__optlbl">
      {meta.code && <span className="pof-dd__optcode">{meta.code}:</span>}
      <span className="pof-dd__optname">{meta.name ?? o}</span>
      {meta.badge && <span className={`pof-dd__optbadge pof-dd__optbadge--${meta.badgeTone || 'own'}`}>{meta.badge}</span>}
    </span>
  ) : <span>{o}</span>
);
function Dd({ label, value, options, onChange, onDisabledSelect, req, err, optMeta, searchable, tooltip }: { label?: string; value: string; options: string[]; onChange: (v: string) => void; onDisabledSelect?: (v: string) => void; req?: boolean; err?: string; optMeta?: Record<string, DdOptMeta>; searchable?: boolean; tooltip?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  // Filter by the option's visible text: code + name (from meta) or the raw value.
  const shown = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      const m = optMeta?.[o];
      const text = m ? `${m.code ?? ''} ${m.name ?? o}` : o;
      return text.toLowerCase().includes(q);
    });
  }, [options, query, searchable, optMeta]);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = Math.min(300, shown.length * 38 + (searchable ? 52 : 0) + 12);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, shown.length, searchable]);
  useEffect(() => { if (open && searchable) setTimeout(() => searchRef.current?.focus(), 0); else if (!open) setQuery(''); }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const close = (e?: Event) => { const el = e && e.target instanceof Element ? e.target : null; if (el && el.closest('.pof-dd-pop')) return; setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest?.('.pof-dd-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="pof-f">
      {label && <label>{label}{req && <span className="pof-reqstar"> *</span>}</label>}
      <button type="button" ref={ref} className={`pof-dd ${open ? 'is-open' : ''} ${err ? 'is-error' : ''}`} onClick={() => setOpen(o => !o)}>
        {(() => {
          // Full label reads "S-009: aaaa…" when the option carries code+name
          // meta (supplier field) — else the raw value (product name field).
          const tip = optMeta?.[value] ? `${optMeta[value].code ? optMeta[value].code + ': ' : ''}${optMeta[value].name ?? value}` : value;
          // A placeholder value (e.g. "— Select Supplier —") renders in the light
          // placeholder style, matching the date picker — not the bold chosen-value
          // weight, which read like a real selection (QA #23 / #24).
          const isPh = value.trim().startsWith('—');
          const valCls = `pof-dd__val${isPh ? ' is-placeholder' : ''}`;
          return tooltip
            ? <Tooltip label={tip} disabled={!tip || tip.length <= 30} position="bottom" zIndex={2999999}><span className={valCls}><DdOptLabel o={value} meta={optMeta?.[value]} /></span></Tooltip>
            : <span className={valCls} title={tip}><DdOptLabel o={value} meta={optMeta?.[value]} /></span>;
        })()}
        <Chev />
      </button>
      {err && <div className="pof-err-msg">{err}</div>}
      {open && createPortal(
        <div className="pof-dd-pop pof-dd-pop--portal" style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: 300, overflowY: 'auto' }}>
          {searchable && (
            <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: 8, background: 'inherit', borderBottom: '1px solid rgba(148,163,184,.18)' }} onMouseDown={e => e.stopPropagation()}>
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search supplier…"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.3)', background: 'rgba(148,163,184,.08)', color: 'inherit', fontSize: 12.5, outline: 'none' }} />
            </div>
          )}
          {shown.length === 0
            ? <div className="pof-dd-pop__opt" style={{ opacity: .6, cursor: 'default' }}>No match</div>
            : shown.map(o => {
              const m = optMeta?.[o];
              const dis = !!m?.disabled;
              // Full "code: name — segment" text so the untruncated name is
              // always available on hover (QA #19).
              const full = m
                ? `${m.code ? m.code + ': ' : ''}${m.name ?? o}${m.badge ? ' — ' + m.badge : ''}`
                : o;
              return (
                <div key={o} title={full} className={`pof-dd-pop__opt ${o === value ? 'is-sel' : ''} ${dis ? 'is-disabled' : ''}`} aria-disabled={dis}
                  onClick={() => { if (dis) { onDisabledSelect?.(o); return; } onChange(o); setOpen(false); }}>
                  <DdOptLabel o={o} meta={optMeta?.[o]} /><Check c="pof-dd-pop__ck" />
                </div>
              );
            })}
        </div>,
        document.body
      )}
    </div>
  );
}

const Field = ({ label, value, onChange, ph, type, full }: { label: string; value: string; onChange: (v: string) => void; ph?: string; type?: string; full?: boolean }) => (
  <div className={`pof-f ${full ? 'pof-f--full' : ''}`}>
    <label>{label}</label>
    <input className="pof-in" type={type || 'text'} value={value} placeholder={ph} onChange={e => onChange(e.target.value)} />
  </div>
);
const DateField = ({ label, value, onChange, full, minDate, req, err }: { label: string; value: string; onChange: (v: string) => void; full?: boolean; minDate?: string; req?: boolean; err?: string }) => (
  <div className={`pof-f ${full ? 'pof-f--full' : ''}`}>
    <label>{label}{req && <span className="pof-reqstar"> *</span>}</label>
    <MasterDatePicker value={value} onChange={onChange} placeholder="Select date" minDate={minDate} invalid={!!err} />
    {err && <div className="pof-err-msg">{err}</div>}
  </div>
);
/* Read-only display cell — auto-filled supplier details are not editable. */
// GST scrutiny is "old" when the last scrutiny date is older than this many months.
const SCRUTINY_STALE_MONTHS = 3;
const isScrutinyOld = (iso?: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - SCRUTINY_STALE_MONTHS);
  return d < cutoff;
};
// Our home GST state — intra-state supply (CGST+SGST) vs inter-state (IGST).
const HOME_STATE_CODE = '27';
const isIntraState = (stateCode?: string) => (stateCode || HOME_STATE_CODE) === HOME_STATE_CODE;
const ReadField = ({ label, value, full, loading }: { label: string; value: string; full?: boolean; loading?: boolean }) => (
  <div className={`pof-f ${full ? 'pof-f--full' : ''}`}>
    <label>{label}</label>
    {loading
      ? <div className="pof-ro pof-ro--skel"><Skel w="72%" /></div>
      : <Tooltip label={value} disabled={!value || value.length <= 30} position="bottom" zIndex={2999999}><div className="pof-ro">{value || '—'}</div></Tooltip>}
  </div>
);
const Frozen = ({ label, value, req }: { label: string; value: string; req?: boolean }) => (
  <div className="pof-f"><label>{label}{req && <span className="pof-reqstar"> *</span>}</label>
    <div className="pof-frozen" title="Auto-generated — not editable">
      <span className="pof-frozen__val">{value}</span>
      <span className="pof-frozen__tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> Auto</span>
    </div>
  </div>
);
const Toggle = ({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) => (
  <div className="pof-f"><label>{label}</label>
    <div className={`pof-toggle ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} tabIndex={0} onClick={onToggle} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}>
      <span className="pof-toggle__sw"><span className="pof-toggle__knob" /></span>
      <span className="pof-toggle__txt">{on ? 'Yes' : 'No'}</span>
    </div>
  </div>
);

/* Collapsible section card (bref-box) */
function Box({ label, title, sub, ico, extra, children, defaultOpen = true }: { label: string; title: string; sub: string; ico: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bref-box bref-box--teal ${open ? '' : 'is-collapsed'}`}>
      <div className="bref-box__header" onClick={() => setOpen(o => !o)}>
        <div className="bref-box__header-ico">{ico}</div>
        <div className="bref-box__header-mid">
          <div className="bref-box__header-row">
            <div className="bref-box__header-label">{label}</div>
            <div className="bref-box__header-sep" />
            <div className="bref-box__header-title">{title}</div>
          </div>
          <div className="bref-box__header-sub">{sub}</div>
        </div>
        {extra}
        <div className="bref-box__header-right"><Tooltip label={open ? 'Collapse section' : 'Expand section'} themed zIndex={2999999}><div className="bref-box__toggle"><Chev c="" /></div></Tooltip></div>
      </div>
      <div className="bref-box__body bref-box__body--cpo"><div style={{ padding: 14 }}>{children}</div></div>
    </div>
  );
}

// Read-only lock (applied to stages 1–3 once TDS is deducted for the PO).
const RO_STYLE: React.CSSProperties = { pointerEvents: 'none', opacity: 0.92 };
const LockNote = () => (
  <div className="cpo-locknote">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    <span><strong>This purchase order is read-only.</strong> You can review all details, but editing is disabled.</span>
  </div>
);

const userIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
const pinIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
const fileIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>);
const boxIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>);
const linesIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="11" y2="18" /></svg>);
// Reference-pill icon by label — supplier code = lines, supplier name = person,
// state code = map pin, everything else = document.
const refIcoFor = (label: string) => label.includes('Supplier Name') || label.includes('Customer') || label.includes('Consignee')
  ? userIco : label.includes('State Code') ? pinIco : label.includes('Supplier Code') ? linesIco : fileIco;

const mapDetailToSup = (s: Record<string, unknown>): SupplierRec => ({
  code: String(s.code ?? ''), type: String(s.type ?? ''), name: String(s.name ?? ''), legal: String(s.name ?? ''),
  addr: String(s.addr ?? ''), country: String(s.country ?? ''), state: String(s.state ?? ''), stateCode: String(s.stateCode ?? ''),
  city: String(s.city ?? ''), contact: String(s.contact ?? ''), desig: String(s.desig ?? ''), phone: String(s.phone ?? ''),
  email: String(s.email ?? ''), scrutiny: String(s.scrutiny ?? ''), gstNo: String(s.gstNo ?? ''), gstStatus: String(s.gstStatus ?? ''),
  filing: String(s.filing ?? ''), remarks: String(s.remarks ?? ''), web: '',
  segments: Array.isArray(s.segments) ? (s.segments as unknown[]).map(String).filter(Boolean) : [],
});

/* `onClose` reports the PO id when one was actually persisted during this
 * session. The PO is created on leaving stage 3, so closing from stage 4 with
 * the X leaves a real PO behind that the list would otherwise not know about
 * until a manual refresh (QA #47). */
export default function CreatePoWizard({ editRow, viewOnly = false, onClose, onSaved }: { editRow: PoRow | null; viewOnly?: boolean; onClose: (savedId?: number | null) => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!editRow;
  const editId = editRow?.id ?? null;
  // The PO's persisted id. In edit mode it's known up-front; for a new PO it's
  // populated when the PO is CREATED on leaving stage 3 (so stage 4's document /
  // e-sign features have a real id to work against).
  const [savedPoId, setSavedPoId] = useState<number | null>(editRow?.id ?? null);

  const [phase, setPhase] = useState<'choice' | 'form'>(isEdit ? 'form' : 'choice');
  const [choiceOpen, setChoiceOpen] = useState(true);

  // Choice
  const [poMode, setPoMode] = useState<'with' | 'without' | null>(isEdit ? (editRow!.ship ? 'with' : 'without') : null);
  const [shipId, setShipId] = useState<string | null>(editRow?.ship || null);
  const [shipmentDbId, setShipmentDbId] = useState<number | null>(null);
  const [shipCustomer, setShipCustomer] = useState<string>(editRow?.cust || '');
  /* Blocking message under the Shipment ID picker — either "pick one" or the
     "this shipment's PI is already fully ordered" case (see confirmChoice). */
  const [shipErr, setShipErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);   // choice-modal "Confirm & Continue" fetch
  const [supLoading, setSupLoading] = useState(false);    // supplier detail + legal fetch after select
  const [savingDetails, setSavingDetails] = useState(false); // stage-2 "Save Details" click feedback
  // Product Details read-only ("view") toggle — flips the whole stage-2 table
  // into a non-editable view (also forced on once TDS is deducted for the PO).
  const [poView, setPoView] = useState(viewOnly);
  // Once TDS is deducted for this PO, stages 1–3 are locked read-only (edit →
  // view); only the last stage's actions (send-for-sign / view / download) work.
  // Loaded from the PO detail's `tds_cut` flag in edit mode.
  const [tdsLocked, setTdsLocked] = useState(false);
  // Whole-wizard read-only: opened as view-only (e.g. a PO that already has an
  // SPI mapped / is synced / signed), OR once its TDS has been deducted.
  /* Set once this PO is out for e-signature (reported by the stage-4 table).
   * From that point the backend refuses every update, so the wizard drops into
   * the same read-only mode the list uses when it opens an already-sent PO —
   * rather than offering a save that can only fail (QA #49). */
  const [signLocked, setSignLocked] = useState(false);
  // Read-only for any reason the PO's CONTENT is frozen (opened view-only, or
  // frozen mid-session by a signature send).
  const roMode = viewOnly || signLocked;
  const locked = roMode || tdsLocked;
  // Stage-1 data-load shimmer: the lookup masters (dropdowns) load on mount and,
  // when editing, the PO detail loads too. Show a shimmer over the Stage-1 fields
  // (supplier + the rest) until both settle so the form fills in instead of
  // flashing empty/default values.
  const [mastersLoading, setMastersLoading] = useState(true);
  const [editLoading, setEditLoading] = useState<boolean>(!!editRow);

  // Wizard
  const [stage, setStage] = useState(1);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [signActive, setSignActive] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  // ── Lookup data fetched from the backend (demo fallback so the UI never blanks) ──
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [prodOpts, setProdOpts] = useState<ProdOpt[]>(PRODUCT_FALLBACK);
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [currencyId, setCurrencyId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [poCode, setPoCode] = useState<string>(editRow?.po || '');

  useEffect(() => {
    let cancelled = false;
    const pW = api.get('/master/warehouse_master').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const w = arr.map((x: Record<string, unknown>) => ({ id: Number(x.id), name: String(x.wh_name ?? x.name ?? ''), code: String(x.wh_id ?? x.code ?? ''), type: String(x.wh_type ?? '') })).filter((x: Warehouse) => x.name && x.id);
      if (!cancelled && w.length) setWarehouses(w);
    }).catch(() => {});
    const pC = api.get('/master/currencies').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const c = arr.filter((x: { status?: string }) => (x.status ?? 'Active') === 'Active')
        .map((x: Record<string, unknown>) => ({ id: Number(x.id), code: String(x.code ?? '') })).filter((x: Currency) => x.code && x.id);
      if (!cancelled && c.length) setCurrencies(c);
    }).catch(() => {});
    const pP = api.get('/products').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const opts: ProdOpt[] = arr.map((p: Record<string, unknown>) => {
        const base = num(p.base_price ?? p.price ?? 0);
        const gstAmt = num(p.gst_amount ?? 0);
        // GST% priority: the product's GstPercentage master (relation) → a scalar
        // gst/gst_rate → derived from gst_amount ÷ base_price. The relation is the
        // real source (/products eager-loads gstPercentage); the amount/base
        // derivation only kicks in for older rows that stored no percentage.
        const relPct = num((p.gstPercentage as { percentage?: unknown } | undefined)?.percentage
          ?? (p.gst_percentage as { percentage?: unknown } | undefined)?.percentage ?? 0);
        const scalarPct = num(p.gst ?? p.gst_rate ?? 0);
        const derivedPct = base > 0 && gstAmt > 0 ? Math.round((gstAmt / base) * 100) : 0;
        return {
          id: p.id != null ? Number(p.id) : null,
          name: String(p.name ?? p.product_name ?? p.title ?? ''),
          code: String(p.product_code ?? p.code ?? p.sku ?? ''),
          price: num(p.total_price ?? p.base_price ?? p.price ?? p.rate ?? 0),
          gst: relPct > 0 ? relPct : (scalarPct > 0 ? scalarPct : derivedPct),
          // Segment NAME (from /products eager-loaded `segment`) — drives the
          // Stage-2 supplier-segment product filter + the dropdown badge.
          segment: String((p.segment as { name?: unknown } | undefined)?.name ?? p.segment_name ?? ''),
        };
      }).filter((o: ProdOpt) => o.name);
      if (!cancelled && opts.length) setProdOpts(opts);
    }).catch(() => {});
    const pS = api.get('/p2p/purchase-orders/suppliers').then(r => { if (!cancelled) setSuppliers((r.data?.data ?? []) as SupplierOpt[]); }).catch(() => {});
    api.get('/p2p/purchase-orders/shipments').then(r => { if (!cancelled) setShipments((r.data?.data ?? []) as Shipment[]); }).catch(() => {});
    if (!isEdit) api.get('/p2p/purchase-orders/preview-code').then(r => { if (!cancelled) setPoCode(r.data?.data?.code || ''); }).catch(() => {});
    // Drop the Stage-1 shimmer once the dropdown masters have settled.
    Promise.allSettled([pW, pC, pP, pS]).then(() => { if (!cancelled) setMastersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Tag <body> so the portalled MasterDatePicker popup lifts above the wizard.
  useEffect(() => {
    document.body.classList.add('pom-dp');
    return () => document.body.classList.remove('pom-dp');
  }, []);

  // Stage 1 — PO details
  const [po, setPo] = useState({
    poType: editRow?.type || PO_TYPES[0],
    docType: editRow?.doc === 'International' ? 'International' : 'Domestics',
    transport: TRANSPORTS[0],
    // PO Date is set once at creation and never edited — preserve the saved
    // value when editing (blank for a new PO → defaults to today on save/display).
    poDate: editRow?.date || '',
    edd: editRow?.edd || '',
    deliveryLoc: '',
    payType: PAY_TYPES[0],
    inspection: false,
    currency: CURRENCIES[0], exRate: '', inco: INCO[0], portLoad: '', portDischarge: '', finalDest: '', origin: '',
  });
  // Stage 1 inline validation errors, keyed by field. Cleared as the user fixes each.
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrs(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  const setPoF = (k: keyof typeof po, v: string | boolean) => { setPo(p => ({ ...p, [k]: v })); clearErr(k); };

  // Stage 1 — supplier (selecting fetches full detail to auto-fill the form)
  const [supName, setSupName] = useState(SUPPLIER_PLACEHOLDER);
  // The dropdown is keyed by the UNIQUE supplier code (not name) because
  // supplier names can duplicate ("test", "SBI" …); keying by name collapsed
  // duplicates to a single row (React key collision) and always resolved to
  // the first match. `supSel` holds the selected code (or placeholder); the
  // demo fallback path stores the demo name here instead.
  const [supSel, setSupSel] = useState(SUPPLIER_PLACEHOLDER);
  const [sup, setSup] = useState<SupplierRec>(emptySup());
  // Real per-vendor legal status (from the Evidence Vault); null → fall back to
  // the demo SUP_LEGAL calc for the built-in demo suppliers.
  const [supLegal, setSupLegal] = useState<LegalView | null>(null);
  // Real suppliers → option value = unique code (names can duplicate); demo
  // fallback → value = name. Sorted by the numeric part of the code DESCENDING
  // so the newest supplier (highest code) shows first — S-019, S-018 … S-001.
  const supplierOpts = suppliers.length
    ? suppliers.filter(s => s.code).slice()
        .sort((a, b) => (parseInt(b.code.replace(/\D/g, ''), 10) || 0) - (parseInt(a.code.replace(/\D/g, ''), 10) || 0))
        .map(s => s.code)
    : Object.keys(CPO_SUPPLIERS);
  // Keyed by CODE (the option value); `name` drives the visible label so
  // duplicate-named suppliers still read as "S-011: test", "S-019: test".
  // Each supplier carries a DOM / INT badge (its Document Type, from its country).
  // Any supplier is selectable — picking one DRIVES the PO's Document Type (see
  // pickSupplier), so the two always stay in sync.
  const supMeta = useMemo(() => {
    const m: Record<string, DdOptMeta> = {};
    suppliers.forEach(s => {
      if (!s.code) return;
      const dt = s.document_type ?? 'domestic';
      m[s.code] = {
        code: s.code,
        name: s.name || s.code,
        badge: dt === 'international' ? 'INT' : 'DOM',
        badgeTone: dt === 'international' ? 'third' : 'own',
      };
    });
    return m;
  }, [suppliers]);
  // Pull a vendor's real 5-parameter compliance breakdown for the legal-status card.
  // `silent` keeps the current figures on screen while re-fetching (used after the
  // user uploads inside the Evidence Vault) instead of flashing the skeleton — and
  // leaves them untouched if that refresh fails.
  const loadSupplierLegal = (vendorId: number, silent = false) => {
    if (!silent) setSupLegal(null);
    api.get(`/segment-uploads/supplier/${vendorId}/vault`).then(r => {
      const v = r.data?.data; if (v) setSupLegal(buildLegalFromVault(v));
    }).catch(() => { if (!silent) setSupLegal(null); });
  };
  // `val` is the supplier CODE for real suppliers, or the demo name for the
  // built-in fallback. Resolve by code first (unique), then demo name.
  const pickSupplier = (val: string) => {
    setSupSel(val);
    if (val !== SUPPLIER_PLACEHOLDER) clearErr('supplier');
    const s = suppliers.find(x => x.code === val);
    if (s) {
      setSupName(s.name);
      setVendorId(s.id);
      // The supplier drives the PO's Document Type: a Domestic (India) supplier
      // makes it "Domestics", an international one makes it "International".
      const supDoc = s.document_type === 'international' ? 'International' : 'Domestics';
      if (po.docType !== supDoc) {
        setPoF('docType', supDoc);
        clearErr('docType');
        toast.info('Document Type updated', `Set to ${supDoc} to match ${s.code}.`);
      }
      setSupLoading(true);
      loadSupplierLegal(s.id);
      api.get(`/p2p/purchase-orders/suppliers/${s.id}`).then(r => {
        const d = r.data?.data;
        if (d) {
          setSup(mapDetailToSup(d));
          toast.success(`Supplier details auto-fetched — ${d.name}`);
          if (isScrutinyOld(d.scrutiny)) toast.warning('GST scrutiny date is old', `It is more than ${SCRUTINY_STALE_MONTHS} months old — do the scrutiny for this supplier.`);
        }
      }).catch(() => toast.error('Failed to load supplier')).finally(() => setSupLoading(false));
    } else if (CPO_SUPPLIERS[val]) { setSupName(val); setSup({ ...CPO_SUPPLIERS[val] }); setVendorId(null); setSupLegal(null); }
    else { setSupName(SUPPLIER_PLACEHOLDER); setSup(emptySup()); setVendorId(null); setSupLegal(null); }
  };

  // Stage 2 — products
  const lineId = useRef(1);
  const [rows, setRows] = useState<PoLine[]>(() => [blankLine(1)]);
  // With-Shipment: the full PI product set this PO was seeded from.
  const [piSet, setPiSet] = useState<PiRow[]>([]);
  const [charges, setCharges] = useState({ ship: '', pack: '', other: '' });
  const setLine = (id: number, patch: Partial<PoLine>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const addLine = () => setRows(rs => [...rs, blankLine(++lineId.current)]);
  const removeLine = (id: number) => setRows(rs => rs.filter(r => r.id !== id));
  const pickProduct = (id: number, name: string) => {
    const opt = prodOpts.find(o => o.name === name);
    if (opt) {
      // A product may appear on a PO only once — block re-selecting one that
      // is already on another row (the dropdown also hides used products, this
      // is the defensive backstop).
      if (rows.some(r => r.id !== id && r.productId === opt.id)) {
        toast.warning('Already added', `“${opt.name}” is already on this PO. Each product can be added only once.`);
        return;
      }
      // Segment gate (defensive backstop — the dropdown already freezes these):
      // the supplier can only be ordered products in its own segment(s).
      if (prodDisabled(opt)) {
        toast.error('Segment not mapped to the supplier', `“${opt.name}”${opt.segment ? ` (${opt.segment})` : ''} isn't in this supplier's segment — map the supplier to this segment first.`);
        return;
      }
      setLine(id, { productId: opt.id, code: opt.code, name: opt.name, rate: String(opt.price), gst: opt.gst });
    } else setLine(id, { productId: null, code: '', name: '', rate: '', gst: 0 });
  };
  // Re-add a previously-removed PI product into a blank Add-Product row (With-Shipment).
  const reAddPi = (id: number, label: string) => {
    const p = piSet.find(x => piLabel(x) === label);
    if (!p) { setLine(id, blankLine(id)); return; }
    // Defensive backstop — a PI product outside the supplier's segment can't be
    // re-added (the dropdown already freezes it).
    if (piDisabled(p)) {
      const seg = piSegOf(p);
      toast.error('Segment not mapped to the supplier', `“${label}”${seg ? ` (${seg})` : ''} isn't in this supplier's segment — map the supplier to this segment first.`);
      return;
    }
    setLine(id, { productId: p.productId, code: p.code, piName: p.piName, piQty: p.piQty, name: p.piName, qty: p.piQty, rate: p.rate, gst: p.gst });
  };

  // GST always comes from the PRODUCT master (Product Management), not the PI/PO
  // item — a PI product carries no GST of its own, so the CGST/SGST columns would
  // read 0%. Once the product master (prodOpts) is loaded, reconcile every row's
  // gst from its product (by id, falling back to code). Runs on any change to the
  // rows or the master and only writes when a gst actually differs, so it
  // converges without looping regardless of which loads first.
  useEffect(() => {
    if (!prodOpts.length) return;
    setRows(rs => {
      let changed = false;
      const next = rs.map(r => {
        if (r.productId == null && !r.code) return r;
        const opt = prodOpts.find(o => (r.productId != null && o.id === r.productId) || (!!o.code && o.code === r.code));
        if (opt && opt.gst !== r.gst) { changed = true; return { ...r, gst: opt.gst }; }
        return r;
      });
      return changed ? next : rs;
    });
  }, [prodOpts, rows]);

  // ── Edit mode: load the full PO detail and prefill every stage ──
  useEffect(() => {
    if (!isEdit || !editId) return;
    api.get(`/p2p/purchase-orders/${editId}`).then(r => {
      const d = r.data?.data; if (!d) return;
      // TDS deducted → lock the whole PO into read-only view (stages 1–3).
      if (d.tds_cut) { setTdsLocked(true); setPoView(true); }
      setPo(p => ({
        ...p, poType: d.type || p.poType, docType: d.doc || p.docType, transport: d.mode_of_transport || p.transport,
        poDate: d.date || d.po_date || p.poDate || '',
        edd: d.edd || '', deliveryLoc: d.delivery_location || '', payType: d.payment_type || p.payType,
        inspection: !!d.physical_inspection, currency: d.currency_code || p.currency,
        exRate: d.exchange_rate != null ? String(d.exchange_rate) : '', inco: d.inco_term || p.inco,
        portLoad: d.port_of_loading || '', portDischarge: d.port_of_discharge || '', finalDest: d.final_destination || '', origin: d.country_of_origin || '',
      }));
      setWarehouseId(d.warehouse_id ?? null);
      setCurrencyId(d.currency_id ?? null);
      setVendorId(d.vendor_id ?? null);
      setShipmentDbId(d.shipment_order_id ?? null);
    
      if (d.shipment_order_id) {
        api.get(`/p2p/purchase-orders/shipments/${d.shipment_order_id}/pi-products`, { params: { exclude_po: editId } })
          .then(pr => {
            const piRows = ((pr.data?.data ?? []) as Array<Record<string, unknown>>).map(mapPiRow);
            setPiSet(piRows);
            setRows(rs => rs.map(r => {
              const p = piRows.find(x => piIdent(x) === piIdent(r));
              return p ? { ...r, piQty: p.piQty } : r;
            }));
          })
          .catch(() => {});
      }
      setShipId(d.ship ?? null);
      setShipCustomer(d.cust ?? '');
      setTerms(d.terms || '');
      setCharges({ ship: d.shipping_charges ? String(d.shipping_charges) : '', pack: d.packaging_charges ? String(d.packaging_charges) : '', other: d.other_charges ? String(d.other_charges) : '' });
      if (Array.isArray(d.items) && d.items.length) {
        let id = 0;
        setRows(d.items.map((it: Record<string, unknown>) => ({
          id: ++id, productId: it.product_id != null ? Number(it.product_id) : null, code: String(it.code ?? ''),
          piName: String(it.piName ?? ''), piQty: it.piQty != null ? String(num(it.piQty)) : '',
          name: String(it.name ?? ''), qty: it.qty != null ? String(num(it.qty)) : '', rate: it.rate != null ? String(num(it.rate)) : '', gst: num(it.gst),
        })));
        lineId.current = d.items.length;
      }
      // Editing/viewing an existing PO — the products are already loaded, so the
      // Missing Product Details are known up front. Reveal them immediately
      // instead of waiting for a re-save (the `missing` memo recomputes from the
      // rows we just set).
      setShowMissing(true);
      if (d.vendor_id) {
        loadSupplierLegal(d.vendor_id);
        api.get(`/p2p/purchase-orders/suppliers/${d.vendor_id}`).then(sr => {
          const s = sr.data?.data; if (s) { setSup(mapDetailToSup(s)); setSupName(s.name); if (s.code) setSupSel(s.code); }
        }).catch(() => {});
      }
    }).catch(() => toast.error('Failed to load purchase order'))
      .finally(() => setEditLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editId]);

  // Stage 3 — terms
  const [terms, setTerms] = useState('');

  // Stage 4 — trade docs

  // GST + cost computation.
  // Tax is driven by the PRODUCT's GST % (r.gst), split by place of supply:
  //   • Intra-state (supplier state code = 27, our home state) → CGST + SGST,
  //     each = gst/2 (e.g. 10% GST → 5% CGST + 5% SGST).
  //   • Inter-state (any other state code) → a single IGST = the full gst %.
  const intra = isIntraState(sup.stateCode);
  // GST is an Indian tax — it does NOT apply to an international supplier. For an
  // International PO every product's tax %/amount is forced to 0 (the columns still
  // show, just at 0). Domestic keeps the product's real GST rate.
  const isIntlPo = po.docType === 'International';
  const compute = (r: PoLine) => {
    const gst = isIntlPo ? 0 : num(r.gst);
    const base = num(r.qty) * num(r.rate);
    const cgstP = intra ? gst / 2 : 0;
    const sgstP = intra ? gst / 2 : 0;
    const igstP = intra ? 0 : gst;
    const cgstA = base * cgstP / 100, sgstA = base * sgstP / 100, igstA = base * igstP / 100;
    // Product Cost is the line's TAXABLE value — quantity × rate, GST EXCLUDED.
    // The tax sits in its own %/amount columns and in the Total CGST/SGST/IGST
    // lines, so the totals stack reads without double-counting:
    //   Total Product Cost + tax + Additional Charges = Grand Total
    // (the same pre-tax "Sub Total" convention the PO PDF and the PI already use).
    return { cgstP, sgstP, igstP, base, cgstA, sgstA, igstA, cost: base, miss: r.piQty === '' ? 0 : Math.max(0, num(r.piQty) - num(r.qty)) };
  };
  const summary = useMemo(() => {
    let prod = 0, cg = 0, sg = 0, ig = 0;
    rows.forEach(r => { const c = compute(r); prod += c.cost; cg += c.cgstA; sg += c.sgstA; ig += c.igstA; });
    const ship = num(charges.ship), pack = num(charges.pack), other = num(charges.other);
    const addl = ship + pack + other;
    // `prod` is now pre-tax, so the tax has to be added back here — Grand Total
    // itself is unchanged (and still matches the saved PO's grand_total).
    return { prod, cgst: cg, sgst: sg, igst: ig, addl, grand: prod + cg + sg + ig + addl };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, charges, sup.stateCode]);
  // Stage-1 shimmer while the dropdown masters (and, when editing, the PO
  // detail) are still loading — so the fields fill in rather than flash.
  const stage1Loading = mastersLoading || editLoading;
  // Missing Product Details — per PI-linked row, the PI qty not covered by the PO
  // qty (With-Shipment only; there's no PI in the Without-Shipment flow).
  const missing = useMemo(() => rows
    .filter(r => r.piQty !== '')
    .map(r => ({ code: r.code, piName: r.piName, piQty: num(r.piQty), poName: r.name || '—', miss: Math.max(0, num(r.piQty) - num(r.qty)) }))
    .filter(m => m.miss > 0), [rows]);

  const todayDisp = useMemo(() => { const d = new Date(); const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return `${dd}/${mm}/${d.getFullYear()}`; }, []);
  // Local (not UTC) yyyy-mm-dd — used to block past Expected Delivery Dates.
  const todayIso = useMemo(() => { const d = new Date(); const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return `${d.getFullYear()}-${mm}-${dd}`; }, []);

  const confirmChoice = () => {
    if (!poMode || confirming) return;
    if (poMode === 'with' && !shipmentDbId) { setShipErr('Please select a Shipment ID to continue.'); return; }
    // Transition into the wizard once seeding is done (so the button spinner
    // stays visible while the PI products are being fetched).
    const proceed = () => { setConfirming(false); setChoiceOpen(false); setTimeout(() => setPhase('form'), 180); };
    if (poMode === 'with' && shipmentDbId) {
      setConfirming(true);
      // Seed Stage 2 from the shipment's PI products.
      api.get(`/p2p/purchase-orders/shipments/${shipmentDbId}/pi-products`).then(r => {
        const items = (r.data?.data ?? []) as Array<Record<string, unknown>>;
        const meta = r.data?.meta as { fully_ordered?: boolean; pi_item_count?: number } | undefined;
        /* Every PI product on this shipment is already covered by earlier POs
         * (e.g. 4 PI products split across 2 POs) — there is nothing left to
         * order, so say so at the picker instead of dropping the user into a
         * product table whose only option is an empty "— Select PI Product —". */
        if (meta?.fully_ordered) {
          setShipErr(`All ${meta.pi_item_count} PI product(s) on this shipment are already covered by existing purchase orders — there is no remaining quantity to order. Edit an existing PO, or pick another Shipment ID.`);
          setConfirming(false);
          return;
        }
        setPiSet(items.map(mapPiRow));
        if (items.length) {
          setRows(items.map((it, i) => piItemToLine(it, i + 1)));
          lineId.current = items.length;
        } else { lineId.current = 1; setRows([blankLine(1)]); }
        proceed();
      }).catch(() => { lineId.current = 1; setRows([blankLine(1)]); proceed(); });
    } else { lineId.current = 1; setRows([blankLine(1)]); proceed(); }
  };
  const backToChoice = () => { setPhase('choice'); setChoiceOpen(true); };
  // Stable identity — the stage-4 table calls this from an effect.
  const onPoLocked = useCallback(() => { setSignLocked(true); setPoView(true); }, []);

  // Supplier Legal Status is driven ONLY by the selected supplier's real
  // Evidence Vault (loadSupplierLegal → supLegal). No demo/hardcoded fallback:
  // with no supplier selected — or a supplier with no vault — the card shows
  // its empty "Select a supplier" state instead of dummy rows (Create-PO QA #1).
  const legalView = supLegal;

  // The "Supplier Legal Status" button is enabled once a supplier is present —
  // a real vendor id (create-flow pick or edit-load) OR a loaded supplier name
  // (edit / view mode). Only the create flow with NO supplier chosen keeps it
  // disabled (Create-PO QA #1). Broader than `vendorId` alone so an edit/view
  // PO whose vendor detail is still resolving never wrongly greys the button.
  const supplierChosen = vendorId != null || supName !== SUPPLIER_PLACEHOLDER;

  // Stage-2 product picker is restricted to products whose segment matches one
  // of the SELECTED supplier's onboarded segments (QA #16) — the rest are frozen
  // out of the dropdown. When the supplier has no known segments, don't
  // over-filter (show all) so the flow is never blocked.
  const supplierSegs = useMemo(
    () => new Set((sup.segments ?? []).map(s => s.trim().toLowerCase()).filter(Boolean)),
    [sup.segments],
  );
  const gateBySegment = supplierSegs.size > 0;
  // Whether a product is OUT of the supplier's segment(s). When gating, a product
  // with no segment, or a segment the supplier doesn't hold, is frozen.
  const prodDisabled = useCallback(
    (o: ProdOpt) => gateBySegment && !(o.segment && supplierSegs.has(o.segment.trim().toLowerCase())),
    [gateBySegment, supplierSegs],
  );
  // Show ALL products; the ones outside the supplier's segment are shown but
  // FROZEN (disabled + a toast on click) rather than hidden — so the user sees
  // them and learns why they can't be picked (QA: PO / SPI segment gating).
  const prodMeta = useMemo(() => {
    const m: Record<string, DdOptMeta> = {};
    // Codes go through formatProductCode so the picker reads P-021, matching the
    // Product master and this table's own Product Code column (the raw DB code is
    // 2-digit: P-21).
    prodOpts.forEach(o => { m[o.name] = { code: formatProductCode(o.code) || undefined, badge: o.segment || undefined, disabled: prodDisabled(o) }; });
    return m;
  }, [prodOpts, prodDisabled]);
  // Resolve a PI row's product segment from the product master (PI rows carry no
  // segment of their own), so the With-Shipment PI re-pick dropdown can freeze a
  // PI product that isn't in the supplier's segment — same gate as the free picker.
  const piSegOf = useCallback((p: PiRow): string => {
    const opt = prodOpts.find(o => (p.productId != null && o.id === p.productId) || (!!o.code && !!p.code && o.code === p.code));
    return opt?.segment ?? '';
  }, [prodOpts]);
  const piDisabled = useCallback((p: PiRow): boolean => {
    const seg = piSegOf(p);
    return gateBySegment && !(seg && supplierSegs.has(seg.trim().toLowerCase()));
  }, [piSegOf, gateBySegment, supplierSegs]);
  const piMeta = useMemo(() => {
    const m: Record<string, DdOptMeta> = {};
    piSet.forEach(p => { const seg = piSegOf(p); m[piLabel(p)] = { badge: seg || undefined, disabled: piDisabled(p) }; });
    return m;
  }, [piSet, piSegOf, piDisabled]);

  // Segment cross-check: a PI/PO product whose segment isn't one the SELECTED
  // supplier deals in is flagged red + surfaced in a warning note, so the buyer
  // either removes it or maps the supplier to that segment. Resolved from the
  // product master (prodOpts already carries each product's segment). Skipped
  // when the supplier has no known segments (nothing to compare) or a product's
  // segment can't be resolved.
  const segMismatchIds = useMemo(() => {
    const ids = new Set<number>();
    if (supplierSegs.size === 0) return ids;
    rows.forEach(r => {
      const opt = prodOpts.find(o => (r.productId != null && o.id === r.productId) || (!!o.code && !!r.code && o.code === r.code));
      const seg = (opt?.segment ?? '').trim().toLowerCase();
      if (seg && !supplierSegs.has(seg)) ids.add(r.id);
    });
    return ids;
  }, [rows, prodOpts, supplierSegs]);
  const mismatchNames = useMemo(
    () => rows.filter(r => segMismatchIds.has(r.id)).map(r => formatProductCode(r.code) || r.name || '—'),
    [rows, segMismatchIds],
  );

  // Supplier GST scrutiny is "old" when its last scrutiny date is more than 3
  // months ago — surfaced as a warning so the buyer re-runs scrutiny before
  // raising the PO.
  const scrutinyOld = useMemo(() => isScrutinyOld(sup.scrutiny), [sup.scrutiny]);

  // Delivery Location dropdown metadata — code + Own/Third-Party badge per
  // warehouse name (the option value). Keyed by name to match the Dd options.
  const whMeta = useMemo(() => {
    const m: Record<string, DdOptMeta> = {};
    warehouses.forEach(w => {
      const third = /third/i.test(w.type || '');
      m[w.name] = { code: w.code || undefined, badge: third ? 'Third Party' : 'Own', badgeTone: third ? 'third' : 'own' };
    });
    return m;
  }, [warehouses]);

  // Select Supplier dropdown labels — "S-001: Reliance Industries" (code : name).

  const withShip = poMode === 'with';
  // Stage-2 products table column count (for full-width colSpan cells) — depends
  // on the layout (with/without shipment) and the tax split (CGST+SGST vs IGST).
  // International = 2 tax columns (Tax %, Tax Amount), same count as inter-state.
  const taxCols = isIntlPo ? 2 : (intra ? 4 : 2);
  const colCount = (withShip ? 10 : 7) + taxCols;

  // With-Shipment product rules: rows are constrained to the PI product set.
  //  • removedPi        — PI products not currently on a linked row (available to re-add)
  //  • pendingBlankRows — blank Add-Product rows still awaiting a PI selection
  //  • canAddProduct    — With-Shipment: only when a removed PI product isn't already
  //                       being re-added by a pending blank row. Without-Shipment: always.
  const removedPi = useMemo(() => {
    if (!withShip || !piSet.length) return [] as PiRow[];
    const present = new Set(rows.filter(r => r.productId != null || r.code || r.piName).map(piIdent));
    return piSet.filter(p => !present.has(piIdent(p)));
  }, [withShip, piSet, rows]);
  const pendingBlankRows = withShip ? rows.filter(r => r.productId == null && !r.code && !r.piName).length : 0;
  const canAddProduct = withShip ? removedPi.length > pendingBlankRows : true;

  // Build the API payload from the current form state — shared by save
  // (store/update) and the unsaved PDF preview.
  const buildPayload = () => {
    const items = rows
      .filter(r => r.name || r.qty || r.piName)
      .map(r => ({
        product_id: r.productId, product_code: r.code || null,
        pi_product_name: r.piName || null, pi_quantity: r.piQty === '' ? null : num(r.piQty),
        product_name: r.name || null, quantity: num(r.qty), rate: num(r.rate), gst_pct: isIntlPo ? 0 : num(r.gst),
      }));
    return {
      code: poCode || null,
      po_type: po.poType, document_type: po.docType, mode_of_transport: po.transport,
      po_date: po.poDate || todayIso, expected_delivery_date: po.edd || null,
      warehouse_id: warehouseId, delivery_location: po.deliveryLoc || null,
      payment_type: po.payType, physical_inspection: po.inspection,
      currency_id: po.docType === 'International' ? currencyId : null,
      currency_code: po.docType === 'International' ? po.currency : null,
      exchange_rate: po.exRate ? num(po.exRate) : null, inco_term: po.docType === 'International' ? po.inco : null,
      port_of_loading: po.portLoad || null, port_of_discharge: po.portDischarge || null,
      final_destination: po.finalDest || null, country_of_origin: po.origin || null,
      vendor_id: vendorId, shipment_order_id: withShip ? shipmentDbId : null,
      terms: terms || null, shipping_charges: num(charges.ship), packaging_charges: num(charges.pack), other_charges: num(charges.other),
      items,
    };
  };

  // Create (first save) or update (subsequent saves) the PO and return its id.
  // The PO is created when leaving stage 3, then updated by the final Generate.
  const persistPo = async (): Promise<number | null> => {
    const payload = buildPayload();
    if (savedPoId) {
      await api.put(`/p2p/purchase-orders/${savedPoId}`, payload);
      return savedPoId;
    }
    const res = await api.post('/p2p/purchase-orders', payload);
    const newId = (res.data?.data?.id ?? null) as number | null;
    if (newId) setSavedPoId(newId);
    // Adopt the server-allocated code (the earlier preview code can drift if
    // another PO was created since) so the header + PO document row match.
    const savedCode = res.data?.data?.po as string | undefined;
    if (savedCode) setPoCode(savedCode);
    return newId;
  };

  const generate = () => {
    if (saving) return;
    if (!validateHasProducts()) return;
    if (!validateSegments()) return;
    if (!validateLineFields()) return;
    // Expected Delivery Date can't be earlier than today — but only for a NEW
    // PO. An existing PO being edited may legitimately have a past delivery
    // date, so we don't block the edit on it.
    if (!isEdit && po.edd && po.edd < todayIso) {
      toast.error('Invalid Expected Delivery Date', 'It cannot be earlier than today.');
      return;
    }
    setSaving(true);
    persistPo()
      .then(() => {
        toast.success(isEdit ? 'Purchase Order updated successfully' : 'Purchase Order created successfully');
        onSaved();
      })
      .catch((e: { response?: { data?: { message?: string } } }) => {
        toast.error('Save failed', poSaveError(e?.response?.data?.message));
      })
      .finally(() => setSaving(false));
  };

  // Stage 1 mandatory fields — all must be filled before leaving stage 1.
  const validateStage1 = (): boolean => {
    const e: Record<string, string> = {};
    if (supSel === SUPPLIER_PLACEHOLDER) e.supplier = 'Please select a supplier.';
    if (!po.poType) e.poType = 'PO Type is required.';
    if (!po.docType) e.docType = 'Document Type is required.';
    if (!po.transport) e.transport = 'Mode of Transport is required.';
    if (!po.edd) e.edd = 'Expected Delivery Date is required.';
    else if (!isEdit && po.edd < todayIso) e.edd = 'It cannot be earlier than today.';
    if (!po.deliveryLoc) e.deliveryLoc = 'Delivery Location is required.';
    setErrs(e);
    if (Object.keys(e).length) {
      toast.error('Required fields missing', 'Please complete the highlighted fields.');
      scrollToFirstError();
      return false;
    }
    // GST scrutiny must be current (≤ 3 months) before advancing to Stage 2 —
    // domestic only, since GST/scrutiny don't apply to an international PO (QA #25).
    if (!isIntlPo && scrutinyOld) {
      toast.error('GST scrutiny overdue', `This supplier's GST scrutiny is more than ${SCRUTINY_STALE_MONTHS} months old — re-run the scrutiny for this supplier before moving to Stage 2.`);
      document.querySelector('.pof-scrutiny-warn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    // GST must be ACTIVE and filings current for a domestic supplier — block the PO
    // when the supplier's GST is Inactive or its last filing is stale (QA #12).
    if (!isIntlPo && (sup.gstStatus || '').trim().toLowerCase() === 'inactive') {
      toast.error('GST inactive', "This supplier's GST status is Inactive — you can't raise a domestic PO until the GST is active again. Update the supplier's GST status first.");
      document.querySelector('.pof-scrutiny-warn, .pof-sub')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (!isIntlPo && isScrutinyOld(sup.filing)) {
      toast.error('GST filing overdue', `This supplier's last GST filing (${sup.filing ? formatDmy(sup.filing) : 'not recorded'}) is more than ${SCRUTINY_STALE_MONTHS} months old — update the filing before raising the PO.`);
      document.querySelector('.pof-scrutiny-warn, .pof-sub')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  };

  // At least one real product must be on the list before Stage 2 can be saved
  // or advanced — an empty product list can't become a PO (QA #18). A row
  // counts once it has a product (name / PI name / product id); a blank starter
  // row or a qty typed with no product doesn't.
  const validateHasProducts = (): boolean => {
    const has = rows.some(r => !!(r.name || r.piName || r.productId != null));
    if (!has) {
      toast.error('No products added', 'Add at least one product to the list before saving.');
      return false;
    }
    return true;
  };

  /* Product Name (PO), Quantity (PO) and Rate are mandatory on every product
   * row that will be persisted. buildPayload keeps any row with a name / qty /
   * PI name and sends `product_name: r.name || null`, `quantity: num(r.qty)`,
   * `rate: num(r.rate)` — so a cleared field used to save as null/0 rather than
   * being rejected (QA #65 with shipment, #66 without, #73 name + rate; one
   * table, so one gate covers all three).
   *
   * With-shipment rows arrive prefilled from the PI and the without-shipment
   * picker fills name + rate on select, so this only ever fires on a field the
   * user actually cleared. Quantity must be > 0 (a line for nothing is not a
   * line); rate only has to be entered, since a zero-rate line is legitimate. */
  const incompleteLines = (): string[] => rows
    .filter(r => r.name || r.qty || r.piName)   // exactly what buildPayload persists
    .map(r => {
      const missing: string[] = [];
      if (!r.name.trim())  missing.push('Product Name');
      if (num(r.qty) <= 0) missing.push('Quantity (PO)');
      if (!r.rate.trim())  missing.push('Rate');
      if (missing.length === 0) return null;
      const label = formatProductCode(r.code) || r.name || r.piName || 'Unnamed product';
      return `${label} (${missing.join(', ')})`;
    })
    .filter((x): x is string => x !== null);
  const validateLineFields = (): boolean => {
    const bad = incompleteLines();
    if (bad.length === 0) return true;
    toast.error(
      'Product details are incomplete',
      `Product Name, Quantity (PO) and Rate are required on every product row — fill in ${bad.join('; ')}.`,
    );
    return false;
  };

  // A PO can't be saved/submitted while any product's segment differs from the
  // supplier's segment — the buyer must remove the product or map the supplier
  // to that segment first. Gates Save Details, Save & Next, and the final
  // Generate/Submit so the red-flagged rows can never slip through.
  const validateSegments = (): boolean => {
    if (segMismatchIds.size === 0) return true;
    toast.error(
      'Segment mismatch',
      `${mismatchNames.join(', ')} ${mismatchNames.length > 1 ? 'do not' : 'does not'} match the supplier’s segment${(sup.segments ?? []).length ? ` (${(sup.segments ?? []).join(', ')})` : ''}. Remove the highlighted product${mismatchNames.length > 1 ? 's' : ''}, or map the supplier to that segment before continuing.`,
    );
    return false;
  };

  // The money columns are decimal(14,2) — they cap just under ₹1 trillion. Catch
  // an overflow HERE (grand total, any charge, any line cost) so the user gets a
  // clear toast at the stage instead of a raw DB "numeric out of range" at save.
  const AMOUNT_MAX = 1e12; // 10^12 — a decimal(14,2) value must stay below this
  const validateAmounts = (): boolean => {
    const vals = [
      summary.grand, summary.prod, summary.cgst, summary.sgst, summary.igst, summary.addl,
      num(charges.ship), num(charges.pack), num(charges.other),
      ...rows.map(r => compute(r).cost),
    ];
    if (vals.some(v => Math.abs(v) >= AMOUNT_MAX)) {
      toast.error('Amount too large', 'PO amount cannot be more than 1 trillion.');
      return false;
    }
    return true;
  };

  // After a validation fail, scroll the first highlighted field into view so
  // the user lands on what needs fixing (mirrors SpiDetail). The 60ms delay
  // lets React paint the is-error / .invalid classes before we query the DOM.
  const scrollToFirstError = () => {
    setTimeout(() => {
      const el = document.querySelector('.pom .pof-dd.is-error, .pom .master-datepicker-wrap.invalid');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  const next = () => {
    // Read-only: page through the stages to review, never persist/generate. On
    // the LAST stage there is nothing further to review, so the button closes the
    // wizard and hands the user back to the PO list — it used to sit there
    // disabled, leaving the footer with no way out but the header X.
    if (roMode) { if (stage < 4) setStage(s => s + 1); else onClose(savedPoId); return; }
    if (stage === 1 && !validateStage1()) return;
    // Product stage (and any later persist) needs at least one product AND no
    // segment mismatch before it can be left.
    if (stage >= 2 && !validateHasProducts()) return;
    if (stage >= 2 && !validateSegments()) return;
    if (stage >= 2 && !validateLineFields()) return;
    if (stage >= 2 && !validateAmounts()) return;
    // Stage 2 must be "saved" (Save Details) before advancing so the buyer has
    // reviewed the missing-quantity check. Edit/view auto-reveals it, so only a
    // fresh create is actually gated here (QA #11).
    // WITH-SHIPMENT ONLY: without a shipment there are no PI quantities to fall
    // short of, so there is no Missing Product Details card to review and no
    // Save Details button to press — gating on it would dead-end the stage
    // (QA #38).
    if (stage === 2 && withShip && !showMissing) {
      toast.warning('Review product details', 'Click “Save Details” to check missing product quantities before continuing to the next stage.');
      return;
    }
    // Persist the PO when leaving stage 3 (before entering stage 4) so the
    // documents / e-sign stage has a real PO id — its preview, individual
    // "Send for Sign", and bundling the PO into a trade-doc signature request
    // all need the PO to exist. Only advances once the save succeeds.
    if (stage === 3) {
      if (saving) return;
      if (!isEdit && po.edd && po.edd < todayIso) {
        toast.error('Invalid Expected Delivery Date', 'It cannot be earlier than today.');
        return;
      }
      setSaving(true);
      persistPo()
        .then(() => { toast.success(savedPoId ? 'Purchase Order saved' : 'Purchase Order created'); setStage(4); })
        .catch((e: { response?: { data?: { message?: string } } }) => {
          toast.error('Save failed', poSaveError(e?.response?.data?.message));
        })
        .finally(() => setSaving(false));
      return;
    }
    if (stage < 4) setStage(s => s + 1);
    else generate();
  };
  const back = () => { if (stage > 1) setStage(s => s - 1); else backToChoice(); };

  // While creating, the stepper may only jump back to a stage already passed — moving
  // forward has to go through Save & Next so each stage is validated and the PO persisted.
  // Editing / view-only work on a PO that already exists, so any stage is reachable.
  //
  // While an edit is still hydrating (editLoading), NO stage is reachable via the
  // stepper: jumping to Step 4 before the supplier + rest of the form have loaded
  // let stale/empty data through and triggered false "select a supplier" style
  // validations downstream (QA #13). The lock lifts the moment the fetch settles.
  const canJumpTo = (n: number) => !editLoading && (isEdit || viewOnly || n <= stage);

  /* ── Trade docs helpers ── */
  /* ═══════════════════ CHOICE MODAL ═══════════════════ */
  if (phase === 'choice') {
    const opt = (mode: 'with' | 'without', title: string, badge: string, badgeCls: string, desc: string, sub: React.ReactNode) => (
      <div className="cpo-optwrap">
        <button type="button" className={`cpo-opt cpo-opt--${mode} ${poMode === mode ? 'is-on' : ''}`} onClick={() => setPoMode(mode)}>
          <span className="cpo-opt__ico">{mode === 'with'
            ? (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>)
            : (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>)}
          </span>
          <span className="cpo-opt__body">
            <span className="cpo-opt__top"><span className="cpo-opt__title">{title}</span><span className={`cpo-opt__badge cpo-opt__badge--${badgeCls}`}>{badge}</span></span>
            <span className="cpo-opt__desc">{desc}</span>
          </span>
          <span className="cpo-opt__rad"><Check /></span>
        </button>
        {poMode === mode && <div className="cpo-sub is-shown">{sub}</div>}
      </div>
    );
    return (
      <div className="pom">
        <div className={`cpo-ov ${choiceOpen ? 'is-open' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(savedPoId); }}>
          <div className="cpo-modal">
            <div className="cpo-hd">
              <div className="cpo-hd__ico">{docHd}</div>
              <div className="cpo-hd__mid"><div className="cpo-hd__t">Create Purchase Order</div><div className="cpo-hd__s">Choose how to link this PO to your procurement workflow.</div></div>
              <Tooltip label="Close" themed zIndex={2999999}><button type="button" className="cpo-hd__x" onClick={() => onClose(savedPoId)} aria-label="Close"><XIco /></button></Tooltip>
            </div>
            <div className="cpo-bd">
              <div className="cpo-sec">Link to procurement workflow</div>
              {opt('with', 'With Shipment ID', 'Recommended', 'ok', '3-way match & complete audit trail.', (
                <div className="cpo-reveal">
                  <label className="cpo-lbl"><svg className="cpo-lbl-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg> Select Shipment ID <span className="cpo-req">*</span></label>
                  <ShipDd shipments={shipments} value={shipmentDbId} onPick={s => { setShipmentDbId(s.id); setShipId(s.code); setShipCustomer(s.customer || ''); setShipErr(null); }} />
                  {shipErr && <div className="cpo-err"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> {shipErr}</div>}
                </div>
              ))}
              {opt('without', 'Without Shipment ID', 'Standalone', 'warn', 'Create a PO not linked to any shipment.', (
                <div className="cpo-reveal">
                  <div className="cpo-note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span><b>Standalone purchase order</b> — won't be linked to any shipment. Proceed directly to the PO form.</span></div>
                </div>
              ))}
              <div className="cpo-ft">
                <span className="cpo-ft__note"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> All POs are audit-tracked</span>
                <div className="cpo-ft__b">
                  <button type="button" className="cpo-btn cpo-btn--g" onClick={() => onClose(savedPoId)}>Cancel</button>
                  <button type="button" className="cpo-btn cpo-btn--p" disabled={!poMode || confirming} onClick={confirmChoice}>{confirming ? <><Spin s={13} /> Loading…</> : <>Confirm & Continue <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════ FULL-PAGE FORM ═══════════════════ */
  const selShip = shipments.find(s => s.id === shipmentDbId) || null;
  const refPills = [
    { l: 'PO Number', v: poCode || editRow?.po || '—', mono: true },
    { l: 'Shipment ID', v: withShip ? (shipId || '—') : '—', mono: true },
    { l: 'Opportunity ID', v: (withShip ? selShip?.opportunity_code : editRow?.opp) || '—', mono: true },
    { l: 'PI Number', v: (withShip ? selShip?.pi_number : null) || '—', mono: true },
    { l: 'Customer Name', v: (withShip ? shipCustomer : editRow?.cust) || '—', mono: false },
    { l: 'Consignee Name', v: (withShip ? selShip?.consignee : null) || '—', mono: false },
  ];

  return (
    <div className="pom">
      <div className="pom-cpoform" style={{ display: (vaultOpen || signActive) ? 'none' : undefined }}>
        {/* header */}
        <div className="p2pj-nav">
          <div className="p2pj-headerstrip">
            <div className="cstrip cstrip--teal">
              <span className="cstrip__glow" /><span className="cstrip__sheen" />
              <div className="cstrip__left">
                <div className="cstrip__avatar-wrap"><div className="cstrip__avatar">{docHd}</div><span className="cstrip__online-dot" /></div>
                <div><div className="cstrip__title">Purchase Order</div><div className="cstrip__sub">{isEdit ? `Editing ${editRow!.po}` : 'Draft · not yet issued'}</div></div>
              </div>
              <div className="cstrip__right">
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8, gap: 7, minWidth: 0, justifyContent: 'flex-end' }}>
                  {refPills.map((p, i) => (
                    <span key={i} style={{ display: 'contents' }}>
                      <div className="cpd-ref__pill">
                        <div className={`cpd-ref__ico ${i % 2 ? 'cpd-ref__ico--alt' : ''}`}>{refIcoFor(p.l)}</div>
                        <div className="cpd-ref__txt"><div className="cpd-ref__l">{p.l}</div><div className={`cpd-ref__v ${p.mono ? 'cpd-ref__v--mono' : ''}`}>{p.v || '—'}</div></div>
                      </div>
                      {i < refPills.length - 1 && <div className="cpd-ref__dots"><span /><span /><span /></div>}
                    </span>
                  ))}
                </div>
                <span className="cstrip__divider" />
                <button type="button" className="cpo-paysum-btn" onClick={() => savedPoId ? setPayOpen(true) : toast.warning('Save the PO first', 'Create or save this purchase order before recording a payment.')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg> PO Payment</button>
                <span className="cstrip__divider" />
                <button type="button" className="cstrip__back-btn" onClick={() => onClose(savedPoId)}><span className="cstrip__back-btn-sheen" /><XIco /> Close</button>
              </div>
            </div>
            <div className="p2pj-steps-row">
              <div className="p2pj-stages-grid">
                {CPO_STAGES.map((s, i) => {
                  const n = i + 1;
                  const stepLocked = !canJumpTo(n);
                  const cls = `${n === stage ? 'p2sc-active' : (n < stage ? 'p2sc-done' : '')}${stepLocked ? ' p2sc-locked' : ''}`;
                  const nn = (n < 10 ? '0' : '') + n;
                  return (
                    <div key={n} className={`p2sc ${cls}`} onClick={() => { if (!stepLocked) setStage(n); }}>
                      <div className="p2sc-pill">Active</div>
                      <div className="p2sc-done-pill"><Check /> Done</div>
                      <div className="p2sc-step">Step {nn}</div><div className="p2sc-num">{nn}</div>
                      <div className="p2sc-title">{s.t}</div><div className="p2sc-desc">{s.d}</div>
                      <div className="p2sc-ghost">{nn}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* body */}
        <div className="p2pj-body">
          <div className="p2pj-detail-wrap">
            <div className="pof-wrap">
              {stage > 1 && <PrevSummary stage={stage} po={po} sup={sup} supName={supName} rows={rows} compute={compute} summary={summary} charges={charges} terms={terms} todayDisp={todayDisp} legalText={legalView ? `${legalView.p}% ${legalView.p === 100 ? 'Compliant' : '· Needs Review'} — ${legalView.done} of ${legalView.tot} documents completed across all 5 parameters` : ''} />}

              {/* Stage-1 shimmer — shown until the dropdown masters (and, in
                  edit mode, the PO detail) load, so supplier + the rest fill in
                  instead of flashing empty/default values. */}
              {stage === 1 && stage1Loading && (
                <div className="pof-wrap" style={{ gap: 13 }}>
                  <Box label="Purchase Order" title="Basic Purchase Order Details" sub="Core details that identify this purchase order." ico={fileIco}>
                    <div className="pof-grid pof-grid--4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="pof-f">
                          <label><Skel w="55%" /></label>
                          <div className="pof-ro pof-ro--skel"><Skel w="85%" /></div>
                        </div>
                      ))}
                    </div>
                  </Box>
                  <Box label="Supplier" title="Supplier Details" sub="Fetched from the selected supplier's master." ico={userIco}>
                    <div className="pof-grid pof-grid--4">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="pof-f">
                          <label><Skel w="55%" /></label>
                          <div className="pof-ro pof-ro--skel"><Skel w="85%" /></div>
                        </div>
                      ))}
                    </div>
                  </Box>
                </div>
              )}

              {stage === 1 && !stage1Loading && locked && <LockNote />}
              {stage === 1 && !stage1Loading && (
                <div className="pof-wrap" style={{ gap: 13, ...(locked ? RO_STYLE : {}) }}>
                  <Box label="Purchase Order" title="Basic Purchase Order Details" sub="Core details that identify this purchase order." ico={fileIco}>
                    <div className="pof-grid pof-grid--4">
                      {(<>
                        <Dd label="PO Type" req err={errs.poType} value={po.poType} options={PO_TYPES} onChange={v => { if (v !== PO_TYPES[0]) { toast.info('Coming soon', `${v} PO type is currently in development. Only ${PO_TYPES[0]} is available.`); return; } setPoF('poType', v); }} />
                        {/* Document Type is fixed once the PO exists — it defines the
                            PO's domestic/international nature (tax, GST, currency) and
                            is tied to the chosen supplier, so it's read-only in edit. */}
                        {isEdit
                          ? <ReadField label="Document Type" value={po.docType} />
                          : <Dd label="Document Type" req err={errs.docType} value={po.docType} options={DOC_TYPES} onChange={v => {
                              setPoF('docType', v);
                              // If the already-selected supplier no longer matches the new
                              // Document Type, clear it so a mismatch can't slip through.
                              const newDoc = v === 'International' ? 'international' : 'domestic';
                              const s = suppliers.find(x => x.code === supSel);
                              if (s && (s.document_type ?? 'domestic') !== newDoc) {
                                pickSupplier(SUPPLIER_PLACEHOLDER);
                                toast.warning('Supplier cleared', `${s.code} is a ${s.document_type === 'international' ? 'International' : 'Domestic'} supplier — it doesn’t match the ${v} document type. Please select a matching supplier.`);
                              }
                            }} />}
                        <Dd label="Mode of Transport" req err={errs.transport} value={po.transport} options={TRANSPORTS} onChange={v => setPoF('transport', v)} />
                        <Frozen label="PO Date" req value={po.poDate ? formatDmy(po.poDate) : todayDisp} />
                        <DateField label="Expected Delivery Date" req err={errs.edd} value={po.edd} onChange={v => setPoF('edd', v)} minDate={isEdit ? undefined : todayIso} />
                        <Dd label="Delivery Location" req err={errs.deliveryLoc} optMeta={whMeta} value={po.deliveryLoc || DELIVERY_PLACEHOLDER} options={[DELIVERY_PLACEHOLDER, ...(warehouses.length ? warehouses.map(w => w.name) : WAREHOUSE_FALLBACK)]} onChange={v => { setPoF('deliveryLoc', v === DELIVERY_PLACEHOLDER ? '' : v); setWarehouseId(warehouses.find(w => w.name === v)?.id ?? null); }} />
                        {/* Mandatory like its neighbours — the PO always carries a
                            payment type. There is no validateStage1 check because the
                            field CANNOT be empty: it defaults to PAY_TYPES[0] and the
                            dropdown has no blank placeholder, so a check would be dead
                            code. Same reasoning as PO Date, which is auto-filled and
                            still shows the star (QA #52). */}
                        <Dd label="Payment Type" req value={po.payType} options={PAY_TYPES} onChange={v => setPoF('payType', v)} />
                        <Toggle label="Physical Inspection Required" on={po.inspection} onToggle={() => setPoF('inspection', !po.inspection)} />
                        {po.docType === 'International' && (<>
                          <Dd label="Currency" value={po.currency} options={currencies.length ? currencies.map(c => c.code) : CURRENCIES} onChange={v => { setPoF('currency', v); setCurrencyId(currencies.find(c => c.code === v)?.id ?? null); }} />
                          {/* Exchange Rate — integer only (digits, no decimal). */}
                          <Field label="Exchange Rate" value={po.exRate} onChange={v => setPoF('exRate', v.replace(/[^0-9]/g, ''))} ph="e.g. 83" />
                          <Dd label="INCO Term" value={po.inco} options={INCO} onChange={v => setPoF('inco', v)} />
                          <Field label="Port of Loading" value={po.portLoad} onChange={v => setPoF('portLoad', v)} ph="e.g. Nhava Sheva" />
                          <Field label="Port of Discharge" value={po.portDischarge} onChange={v => setPoF('portDischarge', v)} ph="e.g. Jebel Ali" />
                          <Field label="Final Destination" value={po.finalDest} onChange={v => setPoF('finalDest', v)} ph="Enter final destination" />
                          <Field label="Country of Origin" value={po.origin} onChange={v => setPoF('origin', v)} ph="e.g. India" />
                        </>)}
                      </>)}
                    </div>
                  </Box>

                  <Box label="Supplier" title="Basic Supplier Details" sub="Primary information about the supplier this PO is issued to." ico={userIco}>
                    <div className="pof-subs">
                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{userIco}</div><div className="pof-sub__t">Supplier Details</div><span className="pof-sub__n">4 Fields</span>{supLoading && <span className="pof-sub__loading"><Spin s={12} /> Fetching…</span>}</div>
                        <div className="pof-sub__bd"><div className="pof-grid pof-grid--4">
                          {isEdit
                            ? <ReadField label="Select Supplier" value={supName !== SUPPLIER_PLACEHOLDER ? supName : (sup.name || '')} />
                            : <Dd label="Select Supplier" req searchable tooltip err={errs.supplier} optMeta={supMeta} value={supSel} options={supplierOpts} onChange={pickSupplier} />}
                          <ReadField label="Supplier Code" value={sup.code} loading={supLoading} />
                          <ReadField label="Company Name" value={sup.name} loading={supLoading} />
                          <ReadField label="Supplier Type" value={sup.type} loading={supLoading} />
                        </div></div>
                      </div>

                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg></div><div className="pof-sub__t">Supplier Legal Status</div><span className={`splegal-badge ${legalView ? (legalView.p === 100 ? 'ok' : 'warn') : ''}`}>{legalView ? (legalView.p === 100 ? '100% Compliant' : `${legalView.p}% · Needs Review`) : '—'}</span><button type="button" className="cptd-vault-btn" disabled={!supplierChosen} title={supplierChosen ? 'View supplier legal status' : 'Select a supplier first'} style={{ marginLeft: 'auto', ...(!supplierChosen ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} onClick={() => { if (!supplierChosen) return; setVaultOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg><span>Supplier Legal Status</span></button></div>
                        <div className="pof-sub__bd">
                          <div className="splegal"><div className="splegal-bar"><div className="splegal-fill" style={{ width: `${legalView?.p || 0}%`, background: legalView ? (legalView.p === 100 ? 'linear-gradient(90deg,#0e7490,#0891b2 55%,#06b6d4)' : legalView.p >= 60 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#dc2626,#ef4444)') : undefined }} /></div><div className="splegal-pct">{legalView?.p || 0}%</div></div>
                          {legalView ? (<>
                            <div className="splegal-summary"><strong>{legalView.done}</strong> of <strong>{legalView.tot}</strong> documents completed across all 5 parameters</div>
                            <div className="splegal-grid">
                              {legalView.cards.map(c => (
                                <div key={c.name} className={`splegal-card splegal-card--${c.st}`}>
                                  <div className="splegal-card__hd"><span className="splegal-card__ico"><Check /></span><span className="splegal-card__nm">{c.name}</span><span className="splegal-card__cnt">{c.d} / {c.t}</span></div>
                                  <div className="splegal-card__bar"><div className="splegal-card__fill" style={{ width: `${c.pc}%` }} /></div>
                                </div>
                              ))}
                            </div>
                          </>) : supLoading ? (
                            <div className="splegal-grid">
                              {[0, 1, 2, 3, 4].map(i => (
                                <div key={i} className="splegal-card splegal-card--none">
                                  <div className="splegal-card__hd"><Skel w="60%" /><Skel w="28px" /></div>
                                  <div className="splegal-card__bar"><div className="splegal-card__fill pof-skel" style={{ width: '40%' }} /></div>
                                </div>
                              ))}
                            </div>
                          ) : <div className="splegal-empty">Select a supplier to view legal &amp; compliance status.</div>}
                        </div>
                      </div>

                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{pinIco}</div><div className="pof-sub__t">Address &amp; Contact Details</div><span className="pof-sub__n">9 Fields</span></div>
                        <div className="pof-sub__bd"><div className="pof-grid pof-grid--4">
                          <ReadField label="Registered Office Address" value={sup.addr} full loading={supLoading} />
                          <ReadField label="Country" value={sup.country} loading={supLoading} />
                          <ReadField label="State" value={sup.state} loading={supLoading} />
                          <ReadField label="State Code" value={sup.stateCode} loading={supLoading} />
                          <ReadField label="City" value={sup.city} loading={supLoading} />
                          <ReadField label="Contact Person Name" value={sup.contact} loading={supLoading} />
                          <ReadField label="Designation" value={sup.desig} loading={supLoading} />
                          <ReadField label="Contact Number" value={sup.phone} loading={supLoading} />
                          <ReadField label="Email ID" value={sup.email} loading={supLoading} />
                        </div></div>
                      </div>

                      {/* GST is an Indian construct — hide GST Scrutiny for an
                          international supplier (Document Type = International). */}
                      {po.docType !== 'International' && (
                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{fileIco}</div><div className="pof-sub__t">GST Scrutiny Details</div><span className="pof-sub__n">5 Fields</span>{!supLoading && scrutinyOld && <span className="pof-scrutiny-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> Scrutiny Overdue</span>}</div>
                        <div className="pof-sub__bd">
                          {!supLoading && scrutinyOld && <div className="pof-scrutiny-warn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span><b>GST scrutiny date is old</b> (more than {SCRUTINY_STALE_MONTHS} months). Please do the scrutiny for this supplier before raising the PO.</span></div>}
                          <div className="pof-grid pof-grid--4">
                          <ReadField label="Scrutiny Date" value={formatDmy(sup.scrutiny)} loading={supLoading} />
                          <ReadField label="GST Number" value={sup.gstNo} loading={supLoading} />
                          <ReadField label="GST Status" value={sup.gstStatus} loading={supLoading} />
                          <ReadField label="Last Filing Date" value={formatDmy(sup.filing)} loading={supLoading} />
                          <ReadField label="Prev. Invoice / Remarks" value={sup.remarks} full loading={supLoading} />
                        </div></div>
                      </div>
                      )}
                    </div>
                  </Box>
                </div>
              )}

              {stage === 2 && (<>
                {locked && <LockNote />}
                <Box label="Products" title="Product Details" sub={withShip ? 'PI vs PO product mapping with live tax & cost computation' : 'Add PO products with live tax & cost computation'} ico={boxIco}
                  extra={
                    <div className="cpd-ref">
                    {[{ l: 'Supplier Code', v: sup.code || 'S-001', mono: true }, { l: 'Supplier Name', v: sup.name || 'AgroSource Materials Pvt Ltd', mono: false }, { l: 'State Code', v: sup.stateCode || '27', mono: true }, { l: 'PI Number', v: (withShip ? selShip?.pi_number : null) || '—', mono: true }].map((f, i, arr) => (
                      <span key={f.l} style={{ display: 'contents' }}>
                        <div className="cpd-ref__pill"><div className={`cpd-ref__ico ${i % 2 ? 'cpd-ref__ico--alt' : ''}`}>{refIcoFor(f.l)}</div><div className="cpd-ref__txt"><div className="cpd-ref__l">{f.l}</div><div className={`cpd-ref__v ${f.mono ? 'cpd-ref__v--mono' : ''}`}>{f.v.length > 30 ? <Tooltip label={f.v} position="bottom" zIndex={2999999}><span>{`${f.v.slice(0, 30)}…`}</span></Tooltip> : f.v}</div></div></div>
                        {i < arr.length - 1 && <div className="cpd-ref__dots"><span /><span /><span /></div>}
                      </span>
                    ))}
                    </div>
                  }>
                  {mismatchNames.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 15px', margin: '0 0 12px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12.5, lineHeight: 1.45 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      <span>
                        <strong>Segment mismatch — {mismatchNames.join(', ')}</strong>{' '}
                        {mismatchNames.length > 1 ? 'do not' : 'does not'} match this supplier’s segment{(sup.segments ?? []).length ? ` (${(sup.segments ?? []).join(', ')})` : ''}. Remove the highlighted product{mismatchNames.length > 1 ? 's' : ''}, or map the supplier to that segment.
                      </span>
                    </div>
                  )}
                  <div className={`cpd-scroll ${poView ? 'cpd-scroll--ro' : ''}`}>
                    <table className={`cpd-tbl ${withShip ? '' : 'cpd-tbl--po'}`}>
                      {/* Fixed column widths keep the table STABLE while editing
                          Qty / Rate. The derived cells (Product Cost, tax amounts,
                          Missing Qty) change digit-width as the numbers grow, and
                          under table-layout:auto that reflowed EVERY column on each
                          keystroke — the visible "shake" (QA #4). Numeric/derived
                          columns get explicit widths; the two Product Name columns
                          stay auto (undefined) so they flex to fill the row. Column
                          count/order mirrors the thead + TaxHeadCells below. */}
                      {(() => {
                        // International renders 2 tax columns (Tax %, Tax Amount) — same
                        // as inter-state — even when intra is true, so match the colgroup
                        // to the ACTUAL columns or the widths shift and leave a gap.
                        const tax = (!isIntlPo && intra) ? [76, 76, 116, 116] : [76, 116];
                        const widths: (number | undefined)[] = withShip
                          ? [48, 110, undefined, 90, undefined, 96, 96, 100, ...tax, 124, 46]
                          : [48, 110, undefined, 96, 100, ...tax, 124, 46];
                        return (
                          <colgroup>
                            {widths.map((w, i) => <col key={i} style={w != null ? { width: w } : undefined} />)}
                          </colgroup>
                        );
                      })()}
                      <thead><tr>
                        {withShip ? (<>
                          <th className="cpd-c">Sr. No</th><th>Product Code</th><th>Product Name (PI)</th><th className="cpd-c">Quantity (PI)</th>
                          <th>Product Name (PO)</th><th className="cpd-c">Quantity (PO)</th><th className="cpd-c">Missing Qty</th><th>Product Rate</th>
                          <TaxHeadCells intra={intra} intl={isIntlPo} />
                          <th className="cpd-r">Product Cost</th><th className="cpd-c"> </th>
                        </>) : (<>
                          <th className="cpd-c">Sr. No</th><th>Product Code</th><th>Product Name (PO)</th><th className="cpd-c">Quantity (PO)</th><th>Product Rate</th>
                          <TaxHeadCells intra={intra} intl={isIntlPo} />
                          <th className="cpd-r">Product Cost</th><th className="cpd-c"> </th>
                        </>)}
                      </tr></thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={colCount} style={{ padding: '24px', textAlign: 'center', color: '#9fb2c0', fontWeight: 600 }}>No products added — click “Add Product” below to start.</td></tr>
                        ) : rows.map((r, i) => {
                          const c = compute(r);
                          const mismatch = segMismatchIds.has(r.id);
                          const mismatchRowStyle = mismatch ? { background: 'rgba(239,68,68,.07)', boxShadow: 'inset 3px 0 0 #dc2626' } : undefined;
                          return withShip ? (
                            <tr key={r.id} style={mismatchRowStyle} title={mismatch ? 'Product segment does not match the supplier segment' : undefined}>
                              <td className="cpd-c">{i + 1}</td>
                              <td className="cpd-c"><span className="cpd-code" style={mismatch ? { color: '#dc2626' } : undefined}>{formatProductCode(r.code) || '—'}</span></td>
                              <td className="cpd-name">{(r.productId == null && !r.code && !r.piName)
                                ? <div className="cpd-prodcell"><Dd value={PI_REPICK_PLACEHOLDER} optMeta={piMeta} options={[PI_REPICK_PLACEHOLDER, ...removedPi.map(piLabel)]} onChange={label => { if (label !== PI_REPICK_PLACEHOLDER) reAddPi(r.id, label); }} onDisabledSelect={(label) => { const p = piSet.find(x => piLabel(x) === label); const seg = p ? piSegOf(p) : ''; toast.error('Segment not mapped to the supplier', `“${label}”${seg ? ` (${seg})` : ''} isn't in this supplier's segment — map the supplier to this segment first.`); }} /></div>
                                : <Tooltip label={r.piName} disabled={!r.piName} zIndex={2999999}><span className="cpd-name__txt">{r.piName || '—'}</span></Tooltip>}</td>
                              <td className="cpd-c">{r.piQty || 0}</td>
                              <td><input className="cpd-in cpd-in--name" disabled={poView || mismatch} value={r.name} onChange={e => setLine(r.id, { name: e.target.value })} /></td>
                              <td><input className="cpd-in cpd-in--num" disabled={poView || mismatch} type="text" inputMode="decimal" value={r.qty} onChange={e => setLine(r.id, { qty: capQty(capDecimals(numOnly(e.target.value)), r.piQty) })} /></td>
                              <td className={`cpd-c cpd-miss ${c.miss > 0 ? 'is-short' : ''}`}>{c.miss}</td>
                              <td><input className="cpd-in cpd-in--num" disabled={poView || mismatch} type="text" inputMode="decimal" value={r.rate} onChange={e => setLine(r.id, { rate: numOnly(e.target.value) })} /></td>
                              <TaxBodyCells c={c} intra={intra} intl={isIntlPo} />
                              <td className="cpd-r cpd-cost">{money2(c.cost)}</td>
                              <td className="cpd-c">{!poView && <Tooltip label="Remove product" themed zIndex={2999999}><button type="button" className="cpd-del" onClick={() => removeLine(r.id)}>✕</button></Tooltip>}</td>
                            </tr>
                          ) : (
                            <tr key={r.id} style={mismatchRowStyle} title={mismatch ? 'Product segment does not match the supplier segment' : undefined}>
                              <td className="cpd-c">{i + 1}</td>
                              <td className="cpd-c"><span className="cpd-code" style={mismatch ? { color: '#dc2626' } : undefined}>{formatProductCode(r.code) || '—'}</span></td>
                              <td className="cpd-prodcell"><Dd tooltip value={r.name || PRODUCT_PLACEHOLDER} optMeta={prodMeta} options={[PRODUCT_PLACEHOLDER, ...prodOpts.filter(o => o.id === r.productId || !rows.some(x => x.id !== r.id && x.productId === o.id)).map(o => o.name)]} onChange={poView ? () => {} : name => pickProduct(r.id, name)} onDisabledSelect={(name) => { const o = prodOpts.find(x => x.name === name); toast.error('Segment not mapped to the supplier', `“${name}”${o?.segment ? ` (${o.segment})` : ''} isn't in this supplier's segment — map the supplier to this segment first.`); }} /></td>
                              <td><input className="cpd-in cpd-in--num" disabled={poView || mismatch} type="text" inputMode="decimal" value={r.qty} onChange={e => setLine(r.id, { qty: capDecimals(numOnly(e.target.value)) })} /></td>
                              <td><input className="cpd-in cpd-in--num" disabled={poView || mismatch} type="text" inputMode="decimal" value={r.rate} onChange={e => setLine(r.id, { rate: numOnly(e.target.value) })} /></td>
                              <TaxBodyCells c={c} intra={intra} intl={isIntlPo} />
                              <td className="cpd-r cpd-cost">{money2(c.cost)}</td>
                              <td className="cpd-c">{!poView && <Tooltip label="Remove product" themed zIndex={2999999}><button type="button" className="cpd-del" onClick={() => removeLine(r.id)}>✕</button></Tooltip>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {canAddProduct && !poView && (
                        <tfoot>
                          <tr className="cpd-addtr"><td colSpan={colCount}>
                            <button type="button" className="cpd-add-btn" onClick={addLine}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add Product</button>
                          </td></tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <div className="cpd-sum">
                    <div className="cpd-sum__charges">
                      <div className="cpd-sum__hd">Additional Charges</div>
                      <div className="cpd-chg-grid">
                        {([['Shipping Charges', 'ship'], ['Packaging Charges', 'pack'], ['Other Charges', 'other']] as const).map(([lbl, key]) => (
                          <div className="cpd-chg-f" key={key}><label>{lbl}</label><div className="cpd-chg-inwrap"><span className="cpd-chg-cur">₹</span><input className="cpd-chg-in" disabled={poView} type="text" inputMode="decimal" placeholder="0.00" value={charges[key]} onChange={e => setCharges(c => ({ ...c, [key]: numOnly(e.target.value) }))} /></div></div>
                        ))}
                      </div>
                    </div>
                    <div className="cpd-totbox">
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Total Product Cost</div><div className="cpd-totrow__v">{money2(summary.prod)}</div></div>
                      {isIntlPo ? (
                        <div className="cpd-totrow"><div className="cpd-totrow__k">Total Tax Amount</div><div className="cpd-totrow__v">{money2(summary.igst)}</div></div>
                      ) : intra ? (<>
                        <div className="cpd-totrow"><div className="cpd-totrow__k">Total CGST Amount</div><div className="cpd-totrow__v">{money2(summary.cgst)}</div></div>
                        <div className="cpd-totrow"><div className="cpd-totrow__k">Total SGST Amount</div><div className="cpd-totrow__v">{money2(summary.sgst)}</div></div>
                      </>) : (
                        <div className="cpd-totrow"><div className="cpd-totrow__k">Total IGST Amount</div><div className="cpd-totrow__v">{money2(summary.igst)}</div></div>
                      )}
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Additional Charges</div><div className="cpd-totrow__v">{money2(summary.addl)}</div></div>
                      <div className="cpd-totrow cpd-totrow--grand"><div className="cpd-totrow__k">Grand Total</div><div className="cpd-totrow__v">{money2(summary.grand)}</div></div>
                    </div>
                  </div>
                  {/* Save Details exists to run the missing-quantity check against
                      the PI — so it is a WITH-SHIPMENT control only. In the
                      Without-Shipment flow there is no PI to compare against, so
                      the button had nothing to reveal and (on a fresh PO, where
                      savedPoId is still null until stage 3) nothing to persist
                      either: it just toasted "saved" and looked broken (QA #38).
                      Those product rows are persisted by Submit PO & Next on
                      leaving stage 3, exactly as before. */}
                  {withShip && (
                  <div className="cpd-saverow">
                    {/* Save Details used to just wait 500ms and toast "saved"
                        without calling the API, so edited rows/charges stayed
                        client-side only and PO Payment (which reads the summary
                        from the server) kept showing the OLD stored totals.
                        Now it really persists, so PO Payment reflects the edit.
                        Flow is otherwise unchanged: save → then reveal Missing
                        Product Details. */}
                    <button type="button" className="cpd-save-btn" disabled={savingDetails || poView} onClick={async () => {
                      if (savingDetails || poView) return;
                      if (!validateHasProducts()) return;
                      if (!validateSegments()) return;
                      if (!validateLineFields()) return;
                      if (!validateAmounts()) return;
                      setSavingDetails(true);
                      try {
                        // Only an existing PO can be written to — a new one is
                        // created on leaving stage 3.
                        if (savedPoId) await persistPo();
                        setShowMissing(true);
                        toast.success('Product details saved');
                      } catch (e: any) {
                        toast.error('Save failed', poSaveError(e?.response?.data?.message, 'Could not save the product details.'));
                      } finally {
                        setSavingDetails(false);
                      }
                    }}>
                      {savingDetails
                        ? <><Spin s={15} /> Saving…</>
                        : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Save Details</>}
                    </button>
                  </div>
                  )}
                </Box>
                {withShip && (
                <Box label="Products" title="Missing Product Details" sub="PI quantities not fully covered by the purchase order" ico={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
                  extra={showMissing ? <span className={`cpd-misscount ${missing.length === 0 ? 'is-zero' : ''}`}>{missing.length} Missing</span> : undefined}>
                  {!showMissing ? (
                    <div className="cpd-miss-empty"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Click <b>&nbsp;Save Details&nbsp;</b> above to check missing product quantities.</div>
                  ) : missing.length === 0 ? (
                    <div className="cpd-miss-empty"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg> No missing quantities — every PO quantity meets the PI quantity.</div>
                  ) : (
                    <div className="cpd-scroll"><table className="cpd-tbl">
                      <thead><tr><th className="cpd-c">Sr. No</th><th>Product Code</th><th>Product Name (PI)</th><th className="cpd-c">Quantity (PI)</th><th>Product Name (PO)</th><th className="cpd-c">Missing Qty</th></tr></thead>
                      <tbody>{missing.map((m, idx) => (
                        <tr key={m.code}><td className="cpd-c">{idx + 1}</td><td className="cpd-c"><span className="cpd-code">{formatProductCode(m.code) || '—'}</span></td><td className="cpd-name"><Tooltip label={m.piName} disabled={!m.piName}><span className="cpd-name__txt">{m.piName}</span></Tooltip></td><td className="cpd-c">{m.piQty}</td><td><Tooltip label={m.poName} disabled={!m.poName || m.poName === '—'}><span className="cpd-name__txt">{m.poName}</span></Tooltip></td><td className="cpd-c" style={{ color: '#dc2626', fontWeight: 800 }}>{m.miss}</td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </Box>
                )}
              </>)}

              {stage === 3 && locked && <LockNote />}
              {stage === 3 && (
                <div style={locked ? RO_STYLE : undefined}>
                <Box label="Terms" title="PO Terms & Conditions" sub="Define the terms & conditions for this purchase order" ico={fileIco}>
                  <div className="cpd-terms">
                    <label className="cpd-terms__lbl" htmlFor="cpoTermsTA">Terms &amp; Condition</label>
                    <textarea id="cpoTermsTA" className="cpd-terms__ta" disabled={poView} maxLength={10000} placeholder="Enter purchase order terms & conditions…" value={terms} onChange={e => setTerms(e.target.value)} />
                    <div className="cpd-terms__count" style={{ marginTop: 6, textAlign: 'right', fontSize: 11, fontWeight: 600, color: terms.length >= 10000 ? '#dc2626' : '#64748b' }}>
                      {terms.length} / 10000 characters
                    </div>
                  </div>
                </Box>
                </div>
              )}

              {stage === 4 && (
                <Box label="Documents" title="Post PO Trade Document Management" sub="Generate, e-sign & track documents via Zoho Sign" ico={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
                  extra={<button type="button" className="cptd-vault-btn" onClick={e => { e.stopPropagation(); setVaultOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg><span>Supplier Legal Status</span></button>}>
                  <TradeDocsTable po={poCode || undefined} poId={savedPoId} supplierId={vendorId} productIds={rows.map(r => r.productId).filter((x): x is number => x != null)} buildPreview={buildPayload} onSignActive={setSignActive} onPoLocked={onPoLocked} />
                </Box>
              )}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="p2pj-footer">
          <div className="p2pj-footer__info">
            <div className="p2pj-footer__step">Step {(stage < 10 ? '0' : '') + stage} of 04</div>
            <div className="p2pj-footer__title">{CPO_STAGES[stage - 1].t}</div>
          </div>
          <div className="p2pj-footer__dots">{[1, 2, 3, 4].map(i => <div key={i} className={`p2pj-fdot ${i < stage ? 'is-done' : (i === stage ? 'is-active' : '')}`} />)}</div>
          <div className="p2pj-footer__btns">
            <button className="p2pj-fbtn p2pj-fbtn--ghost" onClick={back}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg> {stage === 1 ? 'Change Link' : 'Back'}</button>
            {/* Also disabled while the wizard is still hydrating. Opening an
                existing PO shows the Stage-1 shimmer, but the footer stayed
                live — clicking Save & Next then advanced the stage (and ran
                stage-1 validation) against half-loaded data (QA #71). This is
                the same rule canJumpTo already applies to the stepper; both
                loading flags settle via allSettled/finally, so the button can
                never be stranded. */}
            <button className={`p2pj-fbtn ${!roMode && stage === 3 ? 'p2pj-fbtn--submit' : 'p2pj-fbtn--primary'}`} disabled={saving || stage1Loading} onClick={next}>
              {saving ? (<><Spin s={14} /> {stage === 4 ? (isEdit ? 'Updating…' : 'Generating…') : 'Please wait…'}</>)
                : roMode ? (stage === 4 ? (<><XIco /> Close</>) : (<>Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>))
                : stage === 3 ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Submit PO &amp; Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)
                : stage === 4 ? (<>{isEdit ? 'Update Purchase Order' : 'Generate Purchase Order'} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)
                  : (<>Save &amp; Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)}
            </button>
          </div>
        </div>
      </div>

      <SupplierEvidenceVaultModal
        open={vaultOpen}
        supplier={{
          id: sup.code || 'S-001',
          db_id: vendorId ?? undefined,          // real vendor id → live vault fetch
          company: sup.name || (supName !== SUPPLIER_PLACEHOLDER ? supName : 'Supplier'),
          country: sup.country || 'India',
          contact: sup.contact || undefined,
          contactCity: sup.city || undefined,
          email: sup.email && sup.email !== '—' ? sup.email : undefined,
          risk: 'Compliant',
        }}
        /* A document uploaded inside the vault changes the very numbers this
           form's Supplier Legal Status card shows, so re-read them the moment
           the vault refreshes — previously the card kept the pre-upload
           percentage until the page was reloaded. */
        onVaultChange={() => { if (vendorId != null) loadSupplierLegal(vendorId, true); }}
        onClose={() => setVaultOpen(false)}
      />

      {/* Payment Summary Against PO — opens for the saved PO id (header button). */}
      <PoPaymentModal
        open={payOpen}
        poId={savedPoId}
        onClose={() => setPayOpen(false)}
        /* TDS is computed from the PO's amounts and can only be cut once, so
           the moment it's cut those amounts must stop moving. Without this the
           form stayed editable until the next reload — you could cut TDS, then
           edit a rate/qty/charge and leave the stored tds_amount computed from
           figures that no longer exist. */
        onTdsCut={() => { setTdsLocked(true); setPoView(true); }}
      />
    </div>
  );
}

/* ── Shipment picker (mpv-dd) for the choice modal ────────────────────── */
function ShipDd({ shipments, value, onPick }: { shipments: Shipment[]; value: number | null; onPick: (s: Shipment) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const trigRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const sel = shipments.find(s => s.id === value) || null;
  useLayoutEffect(() => {
    if (!open || !trigRef.current) return;
    const r = trigRef.current.getBoundingClientRect();
    setPos({ left: r.left, width: r.width, top: r.bottom + 7 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as HTMLElement; if (ref.current && !ref.current.contains(t) && !t.closest?.('.mpv-dd-panel')) setOpen(false); };
    const onScroll = (e: Event) => { const el = e.target instanceof Element ? e.target : null; if (el && el.closest('.mpv-dd-panel')) return; setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [open]);
  return (
    <div className={`mpv-dd ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" ref={trigRef} className="mpv-dd-trigger" onClick={() => setOpen(o => !o)}>
        {sel ? <span className="mpv-dd-val"><span className="mpv-dd-code">{sel.code}</span><span className="mpv-dd-nm">{sel.customer}</span></span>
          : <span className="mpv-dd-val ph">Select Shipment ID…</span>}
        <span className="mpv-dd-arr"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></span>
      </button>
      {open && (
        <div className="mpv-dd-panel" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {shipments.length === 0 && <div className="mpv-dd-opt"><span className="mpv-dd-opt__main"><span className="mpv-dd-opt__name" style={{ color: '#94a3b8' }}>No shipments available</span></span></div>}
          {shipments.map(s => (
            <div key={s.id} className={`mpv-dd-opt ${s.id === value ? 'sel' : ''}`} onClick={() => { onPick(s); setOpen(false); }}>
              <span className="mpv-dd-opt__code">{s.code}</span>
              <div className="mpv-dd-opt__main"><div className="mpv-dd-opt__name">{s.customer}</div></div>
              <span className="mpv-dd-opt__tick"><Check /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Previous-stage read-only summary ─────────────────────────────────── */
function PrevSummary(props: {
  stage: number; po: any; sup: SupplierRec; supName: string; rows: PoLine[];
  compute: (r: PoLine) => any; summary: { prod: number; cgst: number; sgst: number; igst: number; addl: number; grand: number };
  charges: { ship: string; pack: string; other: string }; terms: string;
  todayDisp: string; legalText: string;
}) {
  const { stage, po, sup, supName, rows, compute, summary, charges, terms, todayDisp, legalText } = props;
  const F = ({ l, v, full, pre }: { l: string; v: string; full?: boolean; pre?: boolean }) => (
    <div className={`cposum-f ${full ? 'cposum-f--full' : ''}`}><div className="cposum-f__l">{l}</div><div className={`cposum-f__v ${!v ? 'is-empty' : ''}`} style={pre ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : undefined}>{v || '— Not provided'}</div></div>
  );
  const stages: React.ReactNode[] = [];

  if (stage > 1) stages.push(
    <div className="cposum-stage" key="s1">
      <div className="cposum-stage__hd"><div className="cposum-stage__num">01</div><div className="cposum-stage__t">PO Link Supplier Details</div><div className="cposum-stage__done"><Check /> Completed</div></div>
      <div className="cposum-stage__bd">
        <div><div className="cposum-grp__t">Basic Purchase Order Details</div><div className="cposum-grid">
          <F l="PO Type" v={po.poType} /><F l="Document Type" v={po.docType} /><F l="Mode of Transport" v={po.transport} /><F l="PO Date" v={po.poDate ? formatDmy(po.poDate) : todayDisp} />
          <F l="Expected Delivery Date" v={po.edd ? formatDmy(po.edd) : ''} /><F l="Delivery Location" v={po.deliveryLoc} /><F l="Payment Type" v={po.payType} /><F l="Physical Inspection Required" v={po.inspection ? 'Yes' : 'No'} />
          {po.docType === 'International' &&<><F l="Currency" v={po.currency} /><F l="Exchange Rate" v={po.exRate} /><F l="INCO Term" v={po.inco} /><F l="Port of Loading" v={po.portLoad} /><F l="Port of Discharge" v={po.portDischarge} /><F l="Final Destination" v={po.finalDest} /><F l="Country of Origin" v={po.origin} /></>}
        </div></div>
        <div><div className="cposum-grp__t">Supplier Details</div><div className="cposum-grid">
          <F l="Select Supplier" v={supName !== SUPPLIER_PLACEHOLDER ? supName : ''} /><F l="Supplier Code" v={sup.code} /><F l="Company Name" v={sup.name} /><F l="Supplier Type" v={sup.type} />
        </div></div>
        <div><div className="cposum-grp__t">Supplier Legal Status</div><div className="cposum-grid">
          <F l="Compliance" v={legalText} full />
        </div></div>
        <div><div className="cposum-grp__t">Address &amp; Contact Details</div><div className="cposum-grid">
          <F l="Registered Office Address" v={sup.addr} full /><F l="Country" v={sup.country} /><F l="State" v={sup.state} /><F l="State Code" v={sup.stateCode} />
          <F l="City" v={sup.city} /><F l="Contact Person Name" v={sup.contact} /><F l="Designation" v={sup.desig} /><F l="Contact Number" v={sup.phone} /><F l="Email ID" v={sup.email} />
        </div></div>
        {po.docType !== 'International' && (
        <div><div className="cposum-grp__t">GST Scrutiny Details</div><div className="cposum-grid">
          <F l="Scrutiny Date" v={formatDmy(sup.scrutiny)} /><F l="GST Number" v={sup.gstNo} /><F l="GST Status" v={sup.gstStatus} /><F l="Last Filing Date" v={formatDmy(sup.filing)} />
          <F l="Prev. Invoice / Remarks" v={sup.remarks} full />
        </div></div>
        )}
      </div>
    </div>
  );
  if (stage > 2) stages.push(
    <div className="cposum-stage" key="s2">
      <div className="cposum-stage__hd"><div className="cposum-stage__num">02</div><div className="cposum-stage__t">PO Product Details</div><div className="cposum-stage__done"><Check /> Completed</div></div>
      <div className="cposum-stage__bd">
        <div><div className="cposum-grp__t">Product Details</div>
          <div style={{ overflowX: 'auto', border: '1px solid #e8eff3', borderRadius: 10 }}>
            <table className="cpd-tbl"><thead><tr><th className="cpd-c">Sr</th><th>Code</th><th>Product (PO)</th><th className="cpd-c">Qty</th><th>Rate</th><th className="cpd-r">Cost</th></tr></thead>
              <tbody>{rows.map((r, i) => { const c = compute(r); return <tr key={r.id}><td className="cpd-c">{i + 1}</td><td className="cpd-c"><span className="cpd-code">{formatProductCode(r.code) || '—'}</span></td><td className="cpd-name"><Tooltip label={r.name} disabled={!r.name}><span className="cpd-name__txt">{r.name || '—'}</span></Tooltip></td><td className="cpd-c">{r.qty || 0}</td><td className="cpd-r">{money2(num(r.rate))}</td><td className="cpd-r cpd-cost">{money2(c.cost)}</td></tr>; })}</tbody>
            </table>
          </div>
        </div>
        <div><div className="cposum-grp__t">Cost Summary</div><div className="cposum-grid">
          <F l="Total Product Cost" v={money2(summary.prod)} />
          {po.docType === 'International'
            ? <F l="Total Tax Amount" v={money2(summary.igst)} />
            : isIntraState(sup.stateCode)
              ? <><F l="Total CGST Amount" v={money2(summary.cgst)} /><F l="Total SGST Amount" v={money2(summary.sgst)} /></>
              : <F l="Total IGST Amount" v={money2(summary.igst)} />}
          <F l="Additional Charges" v={money2(summary.addl)} /><F l="Grand Total" v={money2(summary.grand)} />
        </div></div>
      </div>
    </div>
  );
  if (stage > 3) stages.push(
    <div className="cposum-stage" key="s3">
      <div className="cposum-stage__hd"><div className="cposum-stage__num">03</div><div className="cposum-stage__t">PO Terms &amp; Conditions</div><div className="cposum-stage__done"><Check /> Completed</div></div>
      <div className="cposum-stage__bd"><div><div className="cposum-grp__t">Terms &amp; Conditions</div><div className="cposum-grid"><F l="Terms &amp; Condition" v={terms} full pre /></div></div></div>
    </div>
  );

  const done = stage - 1;
  const historyIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>);
  return (
    <Box label="Summary" title="What We Did in the Previous Stages" sub={`Read-only summary of all completed stages so far — ${done} stage${done > 1 ? 's' : ''} done.`} ico={historyIco} defaultOpen={false}>
      <div className="cposum__bd">{stages}</div>
    </Box>
  );
}
