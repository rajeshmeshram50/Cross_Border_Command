import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import TradeDocsTable from './TradeDocsTable';
import SupplierEvidenceVaultModal from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Create Purchase Order — choice modal + full-page 4-stage wizard.
 *
 * Faithful React port of the prototype's Create-PO flow (openCreatePO →
 * cpoOpenForm). Frontend-only, static demo data.
 *
 *   Choice modal → With / Without Shipment ID (+ shipment picker)
 *   Stage 1  Link Supplier Details  — PO basics + supplier auto-fill + legal score
 *   Stage 2  PO Product Details     — editable PI-vs-PO table, live tax, charges, missing qty
 *   Stage 3  Terms & Conditions     — free-text terms
 *   Stage 4  Trade Documents        — Zoho-Sign style doc table (select / send)
 *
 * On "Generate Purchase Order" it hands a new PoRow back to the list.
 * Heavy side-integrations (PO Payment, Evidence Vault, real Zoho) are stubbed
 * with toasts, matching the list view's approach.
 * ───────────────────────────────────────────────────────────────────────── */

type PoRow = {
  id?: number; po: string; date: string; type: string; doc: string; ship?: string;
  opp: string; proc: string; cust?: string; supCode: string; supName: string;
  edd: string; status: string; zoho: string;
};

type Shipment = { id: number; code: string; customer: string; consignee?: string | null; opportunity_id?: number | null; opportunity_code?: string | null; proforma_invoice_id?: number | null; pi_number?: string | null };
type Warehouse = { id: number; name: string };
type Currency = { id: number; code: string };
type SupplierOpt = { id: number; code: string; name: string };
type SupplierRec = {
  code: string; type: string; name: string; legal: string; addr: string;
  country: string; state: string; stateCode: string; city: string; contact: string;
  desig: string; phone: string; email: string; scrutiny: string; gstNo: string;
  gstStatus: string; filing: string; remarks: string; web: string;
};


const SUPPLIER_PLACEHOLDER = '— Select Supplier —';
const CPO_SUPPLIERS: Record<string, SupplierRec> = {
  'Reliance Industries Ltd': { code: 'S-001', type: 'Manufacturer', web: 'https://www.ril.com', name: 'Reliance Industries', legal: 'Reliance Industries Limited', addr: 'Maker Chambers IV, 222 Nariman Point, Mumbai 400021', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Anil Mehta', desig: 'Procurement Head', phone: '+91 98200 11223', email: 'anil.mehta@ril.com', scrutiny: '2026-04-12', gstNo: '27AAACR5055K1Z5', gstStatus: 'Active', filing: '2026-05-20', remarks: 'All invoices cleared. GST filings up to date with no pending scrutiny.' },
  'Tata Steel Ltd': { code: 'S-002', type: 'Manufacturer', web: 'https://www.tatasteel.com', name: 'Tata Steel', legal: 'Tata Steel Limited', addr: 'Bombay House, 24 Homi Mody Street, Fort, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Rakesh Sharma', desig: 'Sr. Manager - Sales', phone: '+91 98330 44556', email: 'rakesh.sharma@tatasteel.com', scrutiny: '2026-03-28', gstNo: '27AAACT2727Q1ZW', gstStatus: 'Active', filing: '2026-05-18', remarks: 'Long-standing supplier. 3 prior invoices, all reconciled.' },
  'Adani Enterprises Ltd': { code: 'S-003', type: 'Trader', web: 'https://www.adanienterprises.com', name: 'Adani Enterprises', legal: 'Adani Enterprises Limited', addr: 'Adani Corporate House, Shantigram, Ahmedabad 382421', country: 'India', state: 'Gujarat', stateCode: '24', city: 'Ahmedabad', contact: 'Priya Desai', desig: 'Key Account Manager', phone: '+91 99250 77889', email: 'priya.desai@adani.com', scrutiny: '2026-05-02', gstNo: '24AABCA1234R1Z8', gstStatus: 'Active', filing: '2026-05-22', remarks: 'New onboarding completed Q1. First two invoices verified.' },
  'Mahindra Logistics Ltd': { code: 'S-004', type: 'Service Provider', web: 'https://www.mahindralogistics.com', name: 'Mahindra Logistics', legal: 'Mahindra Logistics Limited', addr: 'Mahindra Towers, Worli, Mumbai 400018', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Vikram Nair', desig: 'Operations Lead', phone: '+91 98191 22334', email: 'vikram.nair@mahindra.com', scrutiny: '2026-04-19', gstNo: '27AAFCM5678P1ZK', gstStatus: 'Active', filing: '2026-05-15', remarks: 'Transport services supplier. Filing compliant; minor remarks on FY24.' },
  'Larsen & Toubro Ltd': { code: 'S-005', type: 'Manufacturer', web: 'https://www.larsentoubro.com', name: 'Larsen & Toubro', legal: 'Larsen & Toubro Limited', addr: 'L&T House, Ballard Estate, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Sunil Kulkarni', desig: 'Procurement Manager', phone: '+91 98202 55667', email: 'sunil.kulkarni@lnt.com', scrutiny: '2026-03-15', gstNo: '27AAACL0140P1ZL', gstStatus: 'Active', filing: '2026-05-10', remarks: 'Preferred supplier. All historical invoices cleared.' },
};

const SUP_LEGAL_PARAMS = [
  { name: 'Company Due Diligence', docs: ['Certificate of Incorporation', 'MOA & AOA', 'GST Registration Certificate', 'PAN Card'] },
  { name: 'Owner KYC Documents', docs: ['Director / Owner PAN', 'Aadhaar / ID Proof', 'Address Proof', 'Passport-size Photograph'] },
  { name: 'Trade Licenses', docs: ['Import-Export Code (IEC)', 'Factory / Trade License', 'Udyam (MSME) Certificate'] },
  { name: 'Trade Documents', docs: ['Product Catalogue', 'ISO / Quality Certificate', 'Test Report / COA', 'Cancelled Cheque / Bank Proof'] },
  { name: 'Agreements', docs: ['Non-Disclosure Agreement', 'Supply Agreement (MSA)', 'Rate / Price Contract'] },
];
const SUP_LEGAL: Record<string, number[]> = {
  'Reliance Industries Ltd': [4, 4, 3, 4, 3],
  'Tata Steel Ltd': [4, 4, 3, 4, 3],
  'Adani Enterprises Ltd': [4, 4, 3, 2, 3],
  'Mahindra Logistics Ltd': [4, 4, 3, 4, 3],
  'Larsen & Toubro Ltd': [4, 3, 1, 4, 2],
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
type ProdOpt = { id: number | null; code: string; name: string; price: number; gst: number };
const PRODUCT_FALLBACK: ProdOpt[] = PO_PRODUCTS.map(p => ({ id: null, code: p.code, name: p.name, price: p.price, gst: p.gst }));
const PRODUCT_PLACEHOLDER = '— Select Product —';
const blankLine = (id: number): PoLine => ({ id, productId: null, code: '', piName: '', piQty: '', name: '', qty: '', rate: '', gst: 0 });

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

const emptySup = (): SupplierRec => ({ code: '', type: '', name: '', legal: '', addr: '', country: 'India', state: 'Maharashtra', stateCode: '', city: '', contact: '', desig: '', phone: '', email: '', scrutiny: '', gstNo: '', gstStatus: 'Active', filing: '', remarks: '', web: '' });

/* ── icons ────────────────────────────────────────────────────────────── */
const Chev = ({ c = 'pof-dd__chev' }: { c?: string }) => (<svg className={c} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>);
const Check = ({ c }: { c?: string }) => (<svg className={c} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>);
const XIco = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
const docHd = (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 12l1.6 1.6L14 10" /><line x1="8" y1="17" x2="16" y2="17" /></svg>);

/* ── Reusable dropdown (pof-dd, fixed panel positioned from anchor) ────── */
function Dd({ label, value, options, onChange }: { label?: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = Math.min(264, options.length * 38 + 12);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);
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
      {label && <label>{label}</label>}
      <button type="button" ref={ref} className={`pof-dd ${open ? 'is-open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="pof-dd__val">{value}</span><Chev />
      </button>
      {open && createPortal(
        <div className="pof-dd-pop pof-dd-pop--portal" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map(o => (
            <div key={o} className={`pof-dd-pop__opt ${o === value ? 'is-sel' : ''}`} onClick={() => { onChange(o); setOpen(false); }}>
              <span>{o}</span><Check c="pof-dd-pop__ck" />
            </div>
          ))}
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
const DateField = ({ label, value, onChange, full }: { label: string; value: string; onChange: (v: string) => void; full?: boolean }) => (
  <div className={`pof-f ${full ? 'pof-f--full' : ''}`}>
    <label>{label}</label>
    <MasterDatePicker value={value} onChange={onChange} placeholder="Select date" />
  </div>
);
/* Read-only display cell — auto-filled supplier details are not editable. */
const RO_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const roDate = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${String(d.getDate()).padStart(2, '0')}-${RO_MONTHS[d.getMonth()]}-${d.getFullYear()}`; };
const ReadField = ({ label, value, full }: { label: string; value: string; full?: boolean }) => (
  <div className={`pof-f ${full ? 'pof-f--full' : ''}`}>
    <label>{label}</label>
    <div className="pof-ro" title={value || undefined}>{value || '—'}</div>
  </div>
);
const Frozen = ({ label, value }: { label: string; value: string }) => (
  <div className="pof-f"><label>{label}</label>
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
        <div className="bref-box__header-right"><div className="bref-box__toggle"><Chev c="" /></div></div>
      </div>
      <div className="bref-box__body bref-box__body--cpo"><div style={{ padding: 14 }}>{children}</div></div>
    </div>
  );
}

const userIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
const pinIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
const fileIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>);
const boxIco = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>);

const mapDetailToSup = (s: Record<string, unknown>): SupplierRec => ({
  code: String(s.code ?? ''), type: String(s.type ?? ''), name: String(s.name ?? ''), legal: String(s.name ?? ''),
  addr: String(s.addr ?? ''), country: String(s.country ?? ''), state: String(s.state ?? ''), stateCode: String(s.stateCode ?? ''),
  city: String(s.city ?? ''), contact: String(s.contact ?? ''), desig: String(s.desig ?? ''), phone: String(s.phone ?? ''),
  email: String(s.email ?? ''), scrutiny: String(s.scrutiny ?? ''), gstNo: String(s.gstNo ?? ''), gstStatus: String(s.gstStatus ?? ''),
  filing: String(s.filing ?? ''), remarks: String(s.remarks ?? ''), web: '',
});

export default function CreatePoWizard({ editRow, onClose, onSaved }: { editRow: PoRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!editRow;
  const editId = editRow?.id ?? null;

  const [phase, setPhase] = useState<'choice' | 'form'>(isEdit ? 'form' : 'choice');
  const [choiceOpen, setChoiceOpen] = useState(true);

  // Choice
  const [poMode, setPoMode] = useState<'with' | 'without' | null>(isEdit ? (editRow!.ship ? 'with' : 'without') : null);
  const [shipId, setShipId] = useState<string | null>(editRow?.ship || null);
  const [shipmentDbId, setShipmentDbId] = useState<number | null>(null);
  const [shipCustomer, setShipCustomer] = useState<string>(editRow?.cust || '');
  const [shipErr, setShipErr] = useState(false);
  const [saving, setSaving] = useState(false);

  // Wizard
  const [stage, setStage] = useState(1);
  const [vaultOpen, setVaultOpen] = useState(false);
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
    api.get('/master/warehouse_master').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const w = arr.map((x: Record<string, unknown>) => ({ id: Number(x.id), name: String(x.wh_name ?? x.name ?? '') })).filter((x: Warehouse) => x.name && x.id);
      if (!cancelled && w.length) setWarehouses(w);
    }).catch(() => {});
    api.get('/master/currencies').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const c = arr.filter((x: { status?: string }) => (x.status ?? 'Active') === 'Active')
        .map((x: Record<string, unknown>) => ({ id: Number(x.id), code: String(x.code ?? '') })).filter((x: Currency) => x.code && x.id);
      if (!cancelled && c.length) setCurrencies(c);
    }).catch(() => {});
    api.get('/products').then(r => {
      const arr = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      const opts: ProdOpt[] = arr.map((p: Record<string, unknown>) => {
        const base = num(p.base_price ?? p.price ?? 0);
        const gstAmt = num(p.gst_amount ?? 0);
        return {
          id: p.id != null ? Number(p.id) : null,
          name: String(p.name ?? p.product_name ?? p.title ?? ''),
          code: String(p.product_code ?? p.code ?? p.sku ?? ''),
          price: num(p.total_price ?? p.base_price ?? p.price ?? p.rate ?? 0),
          gst: base > 0 && gstAmt > 0 ? Math.round((gstAmt / base) * 100) : num(p.gst ?? p.gst_rate ?? 0),
        };
      }).filter((o: ProdOpt) => o.name);
      if (!cancelled && opts.length) setProdOpts(opts);
    }).catch(() => {});
    api.get('/p2p/purchase-orders/suppliers').then(r => { if (!cancelled) setSuppliers((r.data?.data ?? []) as SupplierOpt[]); }).catch(() => {});
    api.get('/p2p/purchase-orders/shipments').then(r => { if (!cancelled) setShipments((r.data?.data ?? []) as Shipment[]); }).catch(() => {});
    if (!isEdit) api.get('/p2p/purchase-orders/preview-code').then(r => { if (!cancelled) setPoCode(r.data?.data?.code || ''); }).catch(() => {});
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
    edd: editRow?.edd || '',
    deliveryLoc: '',
    payType: PAY_TYPES[0],
    inspection: false,
    currency: CURRENCIES[0], exRate: '', inco: INCO[0], portLoad: '', portDischarge: '', finalDest: '', origin: '',
  });
  const setPoF = (k: keyof typeof po, v: string | boolean) => setPo(p => ({ ...p, [k]: v }));

  // Stage 1 — supplier (selecting fetches full detail to auto-fill the form)
  const [supName, setSupName] = useState(SUPPLIER_PLACEHOLDER);
  const [sup, setSup] = useState<SupplierRec>(emptySup());
  const supplierNames = suppliers.length ? suppliers.map(s => s.name) : Object.keys(CPO_SUPPLIERS);
  const pickSupplier = (name: string) => {
    setSupName(name);
    const s = suppliers.find(x => x.name === name);
    if (s) {
      setVendorId(s.id);
      api.get(`/p2p/purchase-orders/suppliers/${s.id}`).then(r => {
        const d = r.data?.data; if (d) { setSup(mapDetailToSup(d)); toast.success(`Supplier details auto-fetched — ${d.name}`); }
      }).catch(() => toast.error('Failed to load supplier'));
    } else if (CPO_SUPPLIERS[name]) { setSup({ ...CPO_SUPPLIERS[name] }); setVendorId(null); }
    else { setSup(emptySup()); setVendorId(null); }
  };

  // Stage 2 — products
  const lineId = useRef(1);
  const [rows, setRows] = useState<PoLine[]>(() => [blankLine(1)]);
  const [charges, setCharges] = useState({ ship: '', pack: '', other: '' });
  const setLine = (id: number, patch: Partial<PoLine>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const addLine = () => setRows(rs => [...rs, blankLine(++lineId.current)]);
  const removeLine = (id: number) => setRows(rs => rs.filter(r => r.id !== id));
  const pickProduct = (id: number, name: string) => {
    const opt = prodOpts.find(o => o.name === name);
    if (opt) setLine(id, { productId: opt.id, code: opt.code, name: opt.name, rate: String(opt.price), gst: opt.gst });
    else setLine(id, { productId: null, code: '', name: '', rate: '', gst: 0 });
  };

  // ── Edit mode: load the full PO detail and prefill every stage ──
  useEffect(() => {
    if (!isEdit || !editId) return;
    api.get(`/p2p/purchase-orders/${editId}`).then(r => {
      const d = r.data?.data; if (!d) return;
      setPo(p => ({
        ...p, poType: d.type || p.poType, docType: d.doc || p.docType, transport: d.mode_of_transport || p.transport,
        edd: d.edd || '', deliveryLoc: d.delivery_location || '', payType: d.payment_type || p.payType,
        inspection: !!d.physical_inspection, currency: d.currency_code || p.currency,
        exRate: d.exchange_rate != null ? String(d.exchange_rate) : '', inco: d.inco_term || p.inco,
        portLoad: d.port_of_loading || '', portDischarge: d.port_of_discharge || '', finalDest: d.final_destination || '', origin: d.country_of_origin || '',
      }));
      setWarehouseId(d.warehouse_id ?? null);
      setCurrencyId(d.currency_id ?? null);
      setVendorId(d.vendor_id ?? null);
      setShipmentDbId(d.shipment_order_id ?? null);
      setShipId(d.ship ?? null);
      setShipCustomer(d.cust ?? '');
      setTerms(d.terms || '');
      setCharges({ ship: d.shipping_charges ? String(d.shipping_charges) : '', pack: d.packaging_charges ? String(d.packaging_charges) : '', other: d.other_charges ? String(d.other_charges) : '' });
      if (Array.isArray(d.items) && d.items.length) {
        let id = 0;
        setRows(d.items.map((it: Record<string, unknown>) => ({
          id: ++id, productId: it.product_id != null ? Number(it.product_id) : null, code: String(it.code ?? ''),
          piName: String(it.piName ?? ''), piQty: it.piQty != null ? String(it.piQty) : '',
          name: String(it.name ?? ''), qty: it.qty != null ? String(it.qty) : '', rate: it.rate != null ? String(it.rate) : '', gst: num(it.gst),
        })));
        lineId.current = d.items.length;
      }
      if (d.vendor_id) api.get(`/p2p/purchase-orders/suppliers/${d.vendor_id}`).then(sr => {
        const s = sr.data?.data; if (s) { setSup(mapDetailToSup(s)); setSupName(s.name); }
      }).catch(() => {});
    }).catch(() => toast.error('Failed to load purchase order'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editId]);

  // Stage 3 — terms
  const [terms, setTerms] = useState('');

  // Stage 4 — trade docs

  // GST + cost computation
  const gstRate = (r: PoLine) => { const sc = sup.stateCode || '27'; if (sc === '27') return { cgst: 9, sgst: 9 }; const h = num(r.gst) / 2; return { cgst: h, sgst: h }; };
  const compute = (r: PoLine) => { const g = gstRate(r); const base = num(r.qty) * num(r.rate); const cgstA = base * g.cgst / 100, sgstA = base * g.sgst / 100; return { cgstP: g.cgst, sgstP: g.sgst, base, cgstA, sgstA, cost: base + cgstA + sgstA, miss: r.piQty === '' ? 0 : num(r.piQty) - num(r.qty) }; };
  const summary = useMemo(() => {
    let prod = 0, cg = 0, sg = 0;
    rows.forEach(r => { const c = compute(r); prod += c.cost; cg += c.cgstA; sg += c.sgstA; });
    const ship = num(charges.ship), pack = num(charges.pack), other = num(charges.other);
    const addl = ship + pack + other;
    return { prod, cgst: cg, sgst: sg, addl, grand: prod + addl };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, charges, sup.stateCode]);
  // Missing Product Details — per PI-linked row, the PI qty not covered by the PO
  // qty (With-Shipment only; there's no PI in the Without-Shipment flow).
  const missing = useMemo(() => rows
    .filter(r => r.piQty !== '')
    .map(r => ({ code: r.code, piName: r.piName, piQty: num(r.piQty), poName: r.name || '—', miss: num(r.piQty) - num(r.qty) }))
    .filter(m => m.miss > 0), [rows]);

  const todayDisp = useMemo(() => { const d = new Date(); const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return `${dd}/${mm}/${d.getFullYear()}`; }, []);

  const confirmChoice = () => {
    if (!poMode) return;
    if (poMode === 'with' && !shipmentDbId) { setShipErr(true); return; }
    if (poMode === 'with' && shipmentDbId) {
      // Seed Stage 2 from the shipment's PI products.
      api.get(`/p2p/purchase-orders/shipments/${shipmentDbId}/pi-products`).then(r => {
        const items = (r.data?.data ?? []) as Array<Record<string, unknown>>;
        if (items.length) {
          let id = 0;
          setRows(items.map(it => ({
            id: ++id, productId: it.product_id != null ? Number(it.product_id) : null, code: String(it.code ?? ''),
            piName: String(it.name ?? ''), piQty: it.qty != null ? String(it.qty) : '',
            name: String(it.name ?? ''), qty: it.qty != null ? String(it.qty) : '', rate: it.rate != null ? String(it.rate) : '', gst: num(it.gst),
          })));
          lineId.current = items.length;
        } else { lineId.current = 1; setRows([blankLine(1)]); }
      }).catch(() => { lineId.current = 1; setRows([blankLine(1)]); });
    } else { lineId.current = 1; setRows([blankLine(1)]); }
    setChoiceOpen(false);
    setTimeout(() => setPhase('form'), 180);
  };
  const backToChoice = () => { setPhase('choice'); setChoiceOpen(true); };

  const legal = SUP_LEGAL[supName];
  const legalCalc = useMemo(() => {
    if (!legal) return null;
    let tot = 0, done = 0;
    const cards = SUP_LEGAL_PARAMS.map((pm, i) => {
      const t = pm.docs.length, d = Math.max(0, Math.min(legal[i] || 0, t));
      tot += t; done += d;
      const st = d >= t ? 'full' : (d > 0 ? 'part' : 'none');
      return { name: pm.name, t, d, st, pc: t ? Math.round(d / t * 100) : 0 };
    });
    const p = tot ? Math.round(done / tot * 100) : 0;
    return { cards, p, done, tot };
  }, [legal]);

  const withShip = poMode === 'with';

  const generate = () => {
    if (saving) return;
    const items = rows
      .filter(r => r.name || r.qty || r.piName)
      .map(r => ({
        product_id: r.productId, product_code: r.code || null,
        pi_product_name: r.piName || null, pi_quantity: r.piQty === '' ? null : num(r.piQty),
        product_name: r.name || null, quantity: num(r.qty), rate: num(r.rate), gst_pct: num(r.gst),
      }));
    const payload = {
      po_type: po.poType, document_type: po.docType, mode_of_transport: po.transport,
      po_date: new Date().toISOString().slice(0, 10), expected_delivery_date: po.edd || null,
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
    setSaving(true);
    const req = isEdit && editId
      ? api.put(`/p2p/purchase-orders/${editId}`, payload)
      : api.post('/p2p/purchase-orders', payload);
    req.then(() => {
      toast.success(isEdit ? 'Purchase Order updated successfully' : 'Purchase Order created successfully');
      onSaved();
    }).catch((e: { response?: { data?: { message?: string } } }) => {
      toast.error('Save failed', e?.response?.data?.message ?? 'Please review the form and try again.');
    }).finally(() => setSaving(false));
  };

  const next = () => {
    if (stage === 3) toast.success('Purchase Order submitted successfully');
    if (stage < 4) setStage(s => s + 1);
    else generate();
  };
  const back = () => { if (stage > 1) setStage(s => s - 1); else backToChoice(); };

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
        <div className={`cpo-ov ${choiceOpen ? 'is-open' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="cpo-modal">
            <div className="cpo-hd">
              <div className="cpo-hd__ico">{docHd}</div>
              <div className="cpo-hd__mid"><div className="cpo-hd__t">Create Purchase Order</div><div className="cpo-hd__s">Choose how to link this PO to your procurement workflow.</div></div>
              <button type="button" className="cpo-hd__x" onClick={onClose} aria-label="Close"><XIco /></button>
            </div>
            <div className="cpo-bd">
              <div className="cpo-sec">Link to procurement workflow</div>
              {opt('with', 'With Shipment ID', 'Recommended', 'ok', '3-way match & complete audit trail.', (
                <div className="cpo-reveal">
                  <label className="cpo-lbl">Select Shipment ID <span className="cpo-req">*</span></label>
                  <ShipDd shipments={shipments} value={shipmentDbId} onPick={s => { setShipmentDbId(s.id); setShipId(s.code); setShipCustomer(s.customer || ''); setShipErr(false); }} />
                  {shipErr && <div className="cpo-err"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> Please select a Shipment ID to continue.</div>}
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
                  <button type="button" className="cpo-btn cpo-btn--g" onClick={onClose}>Cancel</button>
                  <button type="button" className="cpo-btn cpo-btn--p" disabled={!poMode} onClick={confirmChoice}>Confirm & Continue <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
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
      <div className="pom-cpoform" style={{ display: vaultOpen ? 'none' : undefined }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflowX: 'auto' }}>
                  {refPills.map((p, i) => (
                    <div key={i} className="cpd-ref__pill">
                      <div className={`cpd-ref__ico ${i % 2 ? 'cpd-ref__ico--alt' : ''}`}>{fileIco}</div>
                      <div className="cpd-ref__txt"><div className="cpd-ref__l">{p.l}</div><div className={`cpd-ref__v ${p.mono ? 'cpd-ref__v--mono' : ''}`}>{p.v || '—'}</div></div>
                    </div>
                  ))}
                </div>
                <span className="cstrip__divider" />
                <button type="button" className="cpo-paysum-btn" onClick={() => toast.info('PO Payment', 'Coming in a later phase')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg> PO Payment</button>
                <span className="cstrip__divider" />
                <button type="button" className="cstrip__back-btn" onClick={onClose}><span className="cstrip__back-btn-sheen" /><XIco /> Close</button>
              </div>
            </div>
            <div className="p2pj-steps-row">
              <div className="p2pj-stages-grid">
                {CPO_STAGES.map((s, i) => {
                  const n = i + 1;
                  const cls = n === stage ? 'p2sc-active' : (n < stage ? 'p2sc-done' : '');
                  const nn = (n < 10 ? '0' : '') + n;
                  return (
                    <div key={n} className={`p2sc ${cls}`} onClick={() => setStage(n)}>
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
              {stage > 1 && <PrevSummary stage={stage} po={po} sup={sup} supName={supName} rows={rows} compute={compute} summary={summary} charges={charges} terms={terms} shipId={shipId} poMode={poMode} shipCustomer={shipCustomer} todayDisp={todayDisp} legalText={legalCalc ? (legalCalc.p === 100 ? '100% Compliant' : `${legalCalc.p}% · Needs Review`) : ''} />}

              {stage === 1 && (
                <div className="pof-wrap" style={{ gap: 13 }}>
                  <Box label="Purchase Order" title="Basic Purchase Order Details" sub="Core details that identify this purchase order." ico={fileIco}>
                    <div className="pof-grid pof-grid--4">
                      {isEdit ? (<>
                        <ReadField label="PO Type" value={po.poType} />
                        <ReadField label="Document Type" value={po.docType} />
                        <ReadField label="Mode of Transport" value={po.transport} />
                        <ReadField label="PO Date" value={todayDisp} />
                        <ReadField label="Expected Delivery Date" value={po.edd ? roDate(po.edd) : ''} />
                        <ReadField label="Delivery Location" value={po.deliveryLoc} />
                        <ReadField label="Payment Type" value={po.payType} />
                        <ReadField label="Physical Inspection Required" value={po.inspection ? 'Yes' : 'No'} />
                        {po.docType === 'International' && (<>
                          <ReadField label="Currency" value={po.currency} />
                          <ReadField label="Exchange Rate" value={po.exRate} />
                          <ReadField label="INCO Term" value={po.inco} />
                          <ReadField label="Port of Loading" value={po.portLoad} />
                          <ReadField label="Port of Discharge" value={po.portDischarge} />
                          <ReadField label="Final Destination" value={po.finalDest} />
                          <ReadField label="Country of Origin" value={po.origin} />
                        </>)}
                      </>) : (<>
                        <Dd label="PO Type" value={po.poType} options={PO_TYPES} onChange={v => setPoF('poType', v)} />
                        <Dd label="Document Type" value={po.docType} options={DOC_TYPES} onChange={v => setPoF('docType', v)} />
                        <Dd label="Mode of Transport" value={po.transport} options={TRANSPORTS} onChange={v => setPoF('transport', v)} />
                        <Frozen label="PO Date" value={todayDisp} />
                        <DateField label="Expected Delivery Date" value={po.edd} onChange={v => setPoF('edd', v)} />
                        <Dd label="Delivery Location" value={po.deliveryLoc || DELIVERY_PLACEHOLDER} options={[DELIVERY_PLACEHOLDER, ...(warehouses.length ? warehouses.map(w => w.name) : WAREHOUSE_FALLBACK)]} onChange={v => { setPoF('deliveryLoc', v === DELIVERY_PLACEHOLDER ? '' : v); setWarehouseId(warehouses.find(w => w.name === v)?.id ?? null); }} />
                        <Dd label="Payment Type" value={po.payType} options={PAY_TYPES} onChange={v => setPoF('payType', v)} />
                        <Toggle label="Physical Inspection Required" on={po.inspection} onToggle={() => setPoF('inspection', !po.inspection)} />
                        {po.docType === 'International' && (<>
                          <Dd label="Currency" value={po.currency} options={currencies.length ? currencies.map(c => c.code) : CURRENCIES} onChange={v => { setPoF('currency', v); setCurrencyId(currencies.find(c => c.code === v)?.id ?? null); }} />
                          <Field label="Exchange Rate" value={po.exRate} onChange={v => setPoF('exRate', v)} ph="e.g. 83.25" />
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
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{userIco}</div><div className="pof-sub__t">Supplier Details</div><span className="pof-sub__n">4 Fields</span></div>
                        <div className="pof-sub__bd"><div className="pof-grid pof-grid--4">
                          {isEdit
                            ? <ReadField label="Select Supplier" value={supName !== SUPPLIER_PLACEHOLDER ? supName : (sup.name || '')} />
                            : <Dd label="Select Supplier" value={supName} options={[SUPPLIER_PLACEHOLDER, ...supplierNames]} onChange={pickSupplier} />}
                          <ReadField label="Supplier Code" value={sup.code} />
                          <ReadField label="Company Name" value={sup.name} />
                          <ReadField label="Supplier Type" value={sup.type} />
                        </div></div>
                      </div>

                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg></div><div className="pof-sub__t">Supplier Legal Status</div><span className={`splegal-badge ${legalCalc ? (legalCalc.p === 100 ? 'ok' : 'warn') : ''}`}>{legalCalc ? (legalCalc.p === 100 ? '100% Compliant' : `${legalCalc.p}% · Needs Review`) : '—'}</span><button type="button" className="cptd-vault-btn" style={{ marginLeft: 'auto' }} onClick={() => setVaultOpen(true)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg><span>Supplier Legal Status</span></button></div>
                        <div className="pof-sub__bd">
                          <div className="splegal"><div className="splegal-bar"><div className="splegal-fill" style={{ width: `${legalCalc?.p || 0}%`, background: legalCalc ? (legalCalc.p === 100 ? 'linear-gradient(90deg,#0e7490,#0891b2 55%,#06b6d4)' : legalCalc.p >= 60 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#dc2626,#ef4444)') : undefined }} /></div><div className="splegal-pct">{legalCalc?.p || 0}%</div></div>
                          {legalCalc ? (<>
                            <div className="splegal-summary"><strong>{legalCalc.done}</strong> of <strong>{legalCalc.tot}</strong> documents completed across all 5 parameters</div>
                            <div className="splegal-grid">
                              {legalCalc.cards.map(c => (
                                <div key={c.name} className={`splegal-card splegal-card--${c.st}`}>
                                  <div className="splegal-card__hd"><span className="splegal-card__ico"><Check /></span><span className="splegal-card__nm">{c.name}</span><span className="splegal-card__cnt">{c.d} / {c.t}</span></div>
                                  <div className="splegal-card__bar"><div className="splegal-card__fill" style={{ width: `${c.pc}%` }} /></div>
                                </div>
                              ))}
                            </div>
                          </>) : <div className="splegal-empty">Select a supplier to view legal &amp; compliance status.</div>}
                        </div>
                      </div>

                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{pinIco}</div><div className="pof-sub__t">Address &amp; Contact Details</div><span className="pof-sub__n">9 Fields</span></div>
                        <div className="pof-sub__bd"><div className="pof-grid pof-grid--4">
                          <ReadField label="Registered Office Address" value={sup.addr} full />
                          <ReadField label="Country" value={sup.country} />
                          <ReadField label="State" value={sup.state} />
                          <ReadField label="State Code" value={sup.stateCode} />
                          <ReadField label="City" value={sup.city} />
                          <ReadField label="Contact Person Name" value={sup.contact} />
                          <ReadField label="Designation" value={sup.desig} />
                          <ReadField label="Contact Number" value={sup.phone} />
                          <ReadField label="Email ID" value={sup.email} />
                        </div></div>
                      </div>

                      <div className="pof-sub">
                        <div className="pof-sub__hd"><div className="pof-sub__ico">{fileIco}</div><div className="pof-sub__t">GST Scrutiny Details</div><span className="pof-sub__n">5 Fields</span></div>
                        <div className="pof-sub__bd"><div className="pof-grid pof-grid--4">
                          <ReadField label="Scrutiny Date" value={roDate(sup.scrutiny)} />
                          <ReadField label="GST Number" value={sup.gstNo} />
                          <ReadField label="GST Status" value={sup.gstStatus} />
                          <ReadField label="Last Filing Date" value={roDate(sup.filing)} />
                          <ReadField label="Prev. Invoice / Remarks" value={sup.remarks} full />
                        </div></div>
                      </div>
                    </div>
                  </Box>
                </div>
              )}

              {stage === 2 && (<>
                <Box label="Products" title="Product Details" sub={withShip ? 'PI vs PO product mapping with live tax & cost computation' : 'Add PO products with live tax & cost computation'} ico={boxIco}
                  extra={<div className="cpd-ref">
                    {[{ l: 'Supplier Code', v: sup.code || 'S-001', mono: true }, { l: 'Supplier Name', v: sup.name || 'AgroSource Materials Pvt Ltd', mono: false }, { l: 'State Code', v: sup.stateCode || '27', mono: true }, { l: 'PI Number', v: 'PI/2025-26/001', mono: true }].map((f, i, arr) => (
                      <span key={f.l} style={{ display: 'contents' }}>
                        <div className="cpd-ref__pill"><div className={`cpd-ref__ico ${i % 2 ? 'cpd-ref__ico--alt' : ''}`}>{fileIco}</div><div className="cpd-ref__txt"><div className="cpd-ref__l">{f.l}</div><div className={`cpd-ref__v ${f.mono ? 'cpd-ref__v--mono' : ''}`}>{f.v}</div></div></div>
                        {i < arr.length - 1 && <div className="cpd-ref__dots"><span /><span /><span /></div>}
                      </span>
                    ))}
                  </div>}>
                  <div className="cpd-scroll">
                    <table className={`cpd-tbl ${withShip ? '' : 'cpd-tbl--po'}`}>
                      <thead><tr>
                        {withShip ? (<>
                          <th className="cpd-c">Sr. No</th><th>Product Code</th><th>Product Name (PI)</th><th className="cpd-c">Quantity (PI)</th>
                          <th>Product Name (PO)</th><th className="cpd-c">Quantity (PO)</th><th className="cpd-c">Missing Qty</th><th>Product Rate</th>
                          <th className="cpd-c">CGST (%)</th><th className="cpd-c">SGST (%)</th><th className="cpd-r">CGST Amount</th><th className="cpd-r">SGST Amount</th><th className="cpd-r">Product Cost</th><th className="cpd-c"> </th>
                        </>) : (<>
                          <th className="cpd-c">Sr. No</th><th>Product Name (PO)</th><th className="cpd-c">Quantity (PO)</th><th>Product Rate</th>
                          <th className="cpd-c">CGST (%)</th><th className="cpd-c">SGST (%)</th><th className="cpd-r">CGST Amount</th><th className="cpd-r">SGST Amount</th><th className="cpd-r">Product Cost</th><th className="cpd-c"> </th>
                        </>)}
                      </tr></thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={withShip ? 14 : 10} style={{ padding: '24px', textAlign: 'center', color: '#9fb2c0', fontWeight: 600 }}>No products added — click “Add Product” below to start.</td></tr>
                        ) : rows.map((r, i) => {
                          const c = compute(r);
                          return withShip ? (
                            <tr key={r.id}>
                              <td className="cpd-c">{i + 1}</td>
                              <td className="cpd-c"><span className="cpd-code">{r.code || '—'}</span></td>
                              <td className="cpd-name">{r.piName || '—'}</td>
                              <td className="cpd-c">{r.piQty || 0}</td>
                              <td><input className="cpd-in cpd-in--name" value={r.name} onChange={e => setLine(r.id, { name: e.target.value })} /></td>
                              <td><input className="cpd-in cpd-in--num" type="number" min={0} value={r.qty} onChange={e => setLine(r.id, { qty: e.target.value })} /></td>
                              <td className={`cpd-c cpd-miss ${c.miss > 0 ? 'is-short' : (c.miss < 0 ? 'is-over' : '')}`}>{c.miss}</td>
                              <td><input className="cpd-in cpd-in--num" type="number" min={0} step="0.01" value={r.rate} onChange={e => setLine(r.id, { rate: e.target.value })} /></td>
                              <td className="cpd-c">{c.cgstP}%</td>
                              <td className="cpd-c">{c.sgstP}%</td>
                              <td className="cpd-r">{money2(c.cgstA)}</td>
                              <td className="cpd-r">{money2(c.sgstA)}</td>
                              <td className="cpd-r cpd-cost">{money2(c.cost)}</td>
                              <td className="cpd-c"><button type="button" className="cpd-del" title="Remove product" onClick={() => removeLine(r.id)}>✕</button></td>
                            </tr>
                          ) : (
                            <tr key={r.id}>
                              <td className="cpd-c">{i + 1}</td>
                              <td className="cpd-prodcell"><Dd value={r.name || PRODUCT_PLACEHOLDER} options={[PRODUCT_PLACEHOLDER, ...prodOpts.map(o => o.name)]} onChange={name => pickProduct(r.id, name)} /></td>
                              <td><input className="cpd-in cpd-in--num" type="number" min={0} value={r.qty} onChange={e => setLine(r.id, { qty: e.target.value })} /></td>
                              <td><input className="cpd-in cpd-in--num" type="number" min={0} step="0.01" value={r.rate} onChange={e => setLine(r.id, { rate: e.target.value })} /></td>
                              <td className="cpd-c">{c.cgstP}%</td>
                              <td className="cpd-c">{c.sgstP}%</td>
                              <td className="cpd-r">{money2(c.cgstA)}</td>
                              <td className="cpd-r">{money2(c.sgstA)}</td>
                              <td className="cpd-r cpd-cost">{money2(c.cost)}</td>
                              <td className="cpd-c"><button type="button" className="cpd-del" title="Remove product" onClick={() => removeLine(r.id)}>✕</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="cpd-addtr"><td colSpan={withShip ? 14 : 10}>
                          <button type="button" className="cpd-add-btn" onClick={addLine}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add Product</button>
                        </td></tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="cpd-sum">
                    <div className="cpd-sum__charges">
                      <div className="cpd-sum__hd">Additional Charges</div>
                      <div className="cpd-chg-grid">
                        {([['Shipping Charges', 'ship'], ['Packaging Charges', 'pack'], ['Other Charges', 'other']] as const).map(([lbl, key]) => (
                          <div className="cpd-chg-f" key={key}><label>{lbl}</label><div className="cpd-chg-inwrap"><span className="cpd-chg-cur">₹</span><input className="cpd-chg-in" type="number" min={0} step="0.01" placeholder="0.00" value={charges[key]} onChange={e => setCharges(c => ({ ...c, [key]: e.target.value }))} /></div></div>
                        ))}
                      </div>
                    </div>
                    <div className="cpd-totbox">
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Total Product Cost</div><div className="cpd-totrow__v">{money2(summary.prod)}</div></div>
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Total CGST Amount</div><div className="cpd-totrow__v">{money2(summary.cgst)}</div></div>
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Total SGST Amount</div><div className="cpd-totrow__v">{money2(summary.sgst)}</div></div>
                      <div className="cpd-totrow"><div className="cpd-totrow__k">Additional Charges</div><div className="cpd-totrow__v">{money2(summary.addl)}</div></div>
                      <div className="cpd-totrow cpd-totrow--grand"><div className="cpd-totrow__k">Grand Total</div><div className="cpd-totrow__v">{money2(summary.grand)}</div></div>
                    </div>
                  </div>
                  <div className="cpd-saverow">
                    <button type="button" className="cpd-save-btn" onClick={() => { setShowMissing(true); toast.success('Product details saved'); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                      Save Details
                    </button>
                  </div>
                </Box>
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
                        <tr key={m.code}><td className="cpd-c">{idx + 1}</td><td className="cpd-c"><span className="cpd-code">{m.code}</span></td><td className="cpd-name">{m.piName}</td><td className="cpd-c">{m.piQty}</td><td>{m.poName}</td><td className="cpd-c" style={{ color: '#dc2626', fontWeight: 800 }}>{m.miss}</td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </Box>
              </>)}

              {stage === 3 && (
                <Box label="Terms" title="PO Terms & Conditions" sub="Define the terms & conditions for this purchase order" ico={fileIco}>
                  <div className="cpd-terms">
                    <label className="cpd-terms__lbl" htmlFor="cpoTermsTA">Terms &amp; Condition</label>
                    <textarea id="cpoTermsTA" className="cpd-terms__ta" placeholder="Enter purchase order terms & conditions…" value={terms} onChange={e => setTerms(e.target.value)} />
                  </div>
                </Box>
              )}

              {stage === 4 && (
                <Box label="Documents" title="Post PO Trade Document Management" sub="Generate, e-sign & track documents via Zoho Sign" ico={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
                  extra={<button type="button" className="cptd-vault-btn" onClick={e => { e.stopPropagation(); setVaultOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg><span>Supplier Legal Status</span></button>}>
                  <TradeDocsTable po={poCode || undefined} supplierId={vendorId} />
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
            <button className={`p2pj-fbtn ${stage === 3 ? 'p2pj-fbtn--submit' : 'p2pj-fbtn--primary'}`} onClick={next}>
              {stage === 3 ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Submit PO &amp; Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)
                : stage === 4 ? (<>{isEdit ? 'Update Purchase Order' : 'Generate Purchase Order'} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)
                  : (<>Save &amp; Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></>)}
            </button>
          </div>
        </div>
      </div>

      <SupplierEvidenceVaultModal
        open={vaultOpen}
        supplier={{ id: sup.code || 'S-001', company: sup.name || (supName !== SUPPLIER_PLACEHOLDER ? supName : 'Supplier'), country: sup.country || 'India', risk: 'Compliant' }}
        onClose={() => setVaultOpen(false)}
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
  compute: (r: PoLine) => any; summary: { prod: number; cgst: number; sgst: number; addl: number; grand: number };
  charges: { ship: string; pack: string; other: string }; terms: string;
  shipId: string | null; poMode: 'with' | 'without' | null; shipCustomer: string; todayDisp: string; legalText: string;
}) {
  const { stage, po, sup, supName, rows, compute, summary, charges, terms, shipId, poMode, shipCustomer, todayDisp, legalText } = props;
  const F = ({ l, v, full }: { l: string; v: string; full?: boolean }) => (
    <div className={`cposum-f ${full ? 'cposum-f--full' : ''}`}><div className="cposum-f__l">{l}</div><div className={`cposum-f__v ${!v ? 'is-empty' : ''}`}>{v || '— Not provided'}</div></div>
  );
  const stages: React.ReactNode[] = [];

  if (stage > 1) stages.push(
    <div className="cposum-stage" key="s1">
      <div className="cposum-stage__hd"><div className="cposum-stage__num">01</div><div className="cposum-stage__t">PO Link Supplier Details</div><div className="cposum-stage__done"><Check /> Completed</div></div>
      <div className="cposum-stage__bd">
        <div><div className="cposum-grp__t">Basic Purchase Order Details</div><div className="cposum-grid">
          <F l="PO Type" v={po.poType} /><F l="Document Type" v={po.docType} /><F l="Mode of Transport" v={po.transport} /><F l="PO Date" v={todayDisp} />
          <F l="Expected Delivery Date" v={po.edd ? roDate(po.edd) : ''} /><F l="Delivery Location" v={po.deliveryLoc} /><F l="Payment Type" v={po.payType} /><F l="Physical Inspection Required" v={po.inspection ? 'Yes' : 'No'} />
          {poMode === 'with' && <F l="Shipment ID" v={shipId || ''} />}
          {poMode === 'with' && <F l="Customer Name" v={shipCustomer} />}
          {po.docType === 'International' && <><F l="Currency" v={po.currency} /><F l="Exchange Rate" v={po.exRate} /><F l="INCO Term" v={po.inco} /><F l="Port of Loading" v={po.portLoad} /><F l="Port of Discharge" v={po.portDischarge} /><F l="Final Destination" v={po.finalDest} /><F l="Country of Origin" v={po.origin} /></>}
        </div></div>
        <div><div className="cposum-grp__t">Supplier Details</div><div className="cposum-grid">
          <F l="Select Supplier" v={supName !== SUPPLIER_PLACEHOLDER ? supName : ''} /><F l="Supplier Code" v={sup.code} /><F l="Company Name" v={sup.name} /><F l="Supplier Type" v={sup.type} />
        </div></div>
        <div><div className="cposum-grp__t">Supplier Legal Status</div><div className="cposum-grid">
          <F l="Compliance" v={legalText} />
        </div></div>
        <div><div className="cposum-grp__t">Address &amp; Contact Details</div><div className="cposum-grid">
          <F l="Registered Office Address" v={sup.addr} full /><F l="Country" v={sup.country} /><F l="State" v={sup.state} /><F l="State Code" v={sup.stateCode} />
          <F l="City" v={sup.city} /><F l="Contact Person Name" v={sup.contact} /><F l="Designation" v={sup.desig} /><F l="Contact Number" v={sup.phone} /><F l="Email ID" v={sup.email} />
        </div></div>
        <div><div className="cposum-grp__t">GST Scrutiny Details</div><div className="cposum-grid">
          <F l="Scrutiny Date" v={roDate(sup.scrutiny)} /><F l="GST Number" v={sup.gstNo} /><F l="GST Status" v={sup.gstStatus} /><F l="Last Filing Date" v={roDate(sup.filing)} />
          <F l="Prev. Invoice / Remarks" v={sup.remarks} full />
        </div></div>
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
              <tbody>{rows.map((r, i) => { const c = compute(r); return <tr key={r.id}><td className="cpd-c">{i + 1}</td><td className="cpd-c"><span className="cpd-code">{r.code || '—'}</span></td><td className="cpd-name">{r.name || '—'}</td><td className="cpd-c">{r.qty || 0}</td><td className="cpd-r">{money2(num(r.rate))}</td><td className="cpd-r cpd-cost">{money2(c.cost)}</td></tr>; })}</tbody>
            </table>
          </div>
        </div>
        <div><div className="cposum-grp__t">Cost Summary</div><div className="cposum-grid">
          <F l="Total Product Cost" v={money2(summary.prod)} /><F l="Total CGST Amount" v={money2(summary.cgst)} /><F l="Total SGST Amount" v={money2(summary.sgst)} /><F l="Additional Charges" v={money2(summary.addl)} /><F l="Grand Total" v={money2(summary.grand)} />
        </div></div>
      </div>
    </div>
  );
  if (stage > 3) stages.push(
    <div className="cposum-stage" key="s3">
      <div className="cposum-stage__hd"><div className="cposum-stage__num">03</div><div className="cposum-stage__t">PO Terms &amp; Conditions</div><div className="cposum-stage__done"><Check /> Completed</div></div>
      <div className="cposum-stage__bd"><div><div className="cposum-grp__t">Terms &amp; Conditions</div><div className="cposum-grid"><F l="Terms &amp; Condition" v={terms} full /></div></div></div>
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
