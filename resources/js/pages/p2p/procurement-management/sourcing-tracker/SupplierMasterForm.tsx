import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode, type Ref } from 'react';
import api from '../../../../api';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { useToast } from '../../../../contexts/ToastContext';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../../p2p-master-management/supplier-management/SupplierScopeGate';
import { COUNTRY_CURRENCY, money } from './currency';
import { rateOf, useFormMasters } from './formMasters';
import type { MapRequest, MasterQuote } from './MapSupplierModal';
import { IcoBack, IcoCheck, IcoFlag, IcoGlobe, IcoPlus, IcoUserPlus, IcoX } from './icons';
import './supplier-master-form.css';

/* Map Supplier → Supplier Master → Domestic / International form. Opens after the app's
   Domestic / International gate. Domestic: price in ₹ with GST %; International: price in the
   supplier's currency at an exchange rate, no GST.
   Data: GET /p2p/suppliers?origin=domestic|international (the Supplier Master list for the scope),
   GET /p2p/form-masters (GST rates, currencies + default rates), and the product's mapped
   suppliers (already-mapped ones cannot be picked again). Save hands { supplier_id, price … } to
   the Map Supplier popup, which POSTs it.
   Edit (a mapped Supplier Master supplier): the same form, the supplier picked and locked (no "+"),
   only the price fields editable; the popup saves it with PATCH …/suppliers/{mapping}/price. */

type Supplier = {
  id: string; code: string; name: string; type: string; contact: string;
  country: string; state: string; stateCode: string; city: string; currency: string;
};
type ApiSupplier = {
  id: string | number; code?: string; name?: string; supplierType?: string | null; contact?: string | null;
  country?: string | null; state?: string | null; stateCode?: string | null; city?: string | null; currency?: string | null;
};
const toSupplier = (s: ApiSupplier): Supplier => ({
  id: String(s.id), code: s.code || '', name: s.name || '—', type: s.supplierType || '—', contact: s.contact || '—',
  country: s.country || '', state: s.state || '', stateCode: s.stateCode || '', city: s.city || '', currency: (s.currency || '').toUpperCase(),
});

// The app's Add Supplier wizard (Supplier Master), opened by "+" beside Supplier Name. Large: loaded on demand.
const AddVendorModal = lazyPage(() => import('../../p2p-master-management/supplier-management/AddVendorModal'));

const DEFAULT_GST = 18;

/** Badge tone per type kind, the same three buckets the Supplier list uses (spacing / case ignored):
    Material / Goods = violet, FFD / Transporter = green, any service = gray. */
const typeTone = (type: string): 'violet' | 'green' | 'gray' => {
  const t = type.toLowerCase();
  if (t.includes('logist') || t.includes('transport') || t.includes('ffd') || t.includes('freight')) return 'green';
  if (t.includes('service')) return 'gray';
  return 'violet';
};
const toNum = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const numeric = (v: string) => v.replace(/[^\d.]/g, '');

const Auto = () => <span className="stsm-auto">Auto</span>;
const Req = () => <span className="stsm-req" aria-hidden>*</span>;

/** A locked field filled from the picked supplier (or computed). */
function ReadOnly({ id, label, value, placeholder, calc }: { id: string; label: ReactNode; value: string; placeholder: string; calc?: boolean }) {
  return (
    <div className="stsm-f">
      <label className="stsm-l" htmlFor={id}>{label}<Auto /></label>
      <input id={id} className={`stsm-i ${calc ? 'is-calc' : 'is-ro'}`} value={value} placeholder={placeholder} readOnly tabIndex={-1} />
    </div>
  );
}

type Props = {
  scope: SupplierScope;
  /** The target and product being mapped: already-mapped suppliers are greyed out. */
  targetCode: string;
  productId: number;
  productName: string;
  saving: boolean;
  dialogRef: Ref<HTMLDivElement>;
  /** Field messages the server sent back (422), by API field name. */
  serverErrors?: Record<string, string>;
  onClearServerErrors?: () => void;
  /** Tells the parent whether anything was picked or typed (Esc must not lose it). */
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
  onCancel: () => void;
  onSave: (req: MapRequest) => void;
  /** Edit a mapped supplier: it opens picked and locked, with its saved quote in the price fields. */
  edit?: MasterQuote;
};

export default function SupplierMasterForm({
  scope, targetCode, productId, productName, saving, dialogRef, serverErrors = {}, onClearServerErrors, onDirty, onBack, onCancel, onSave, edit,
}: Props) {
  const isEdit = !!edit;
  const intl = scope === 'international';
  const toast = useToast();
  const { masters } = useFormMasters();

  // The Supplier Master list for this scope, and who is already mapped to this product.
  const [pool, setPool] = useState<Supplier[] | null>(null);
  const [mappedIds, setMappedIds] = useState<ReadonlySet<string>>(() => new Set());
  const loadPool = useCallback(() => api.get<{ data: ApiSupplier[] }>('/p2p/suppliers', { params: { origin: scope } })
    .then(r => { const list = (r.data?.data ?? []).map(toSupplier); setPool(list); return list; })
    .catch(() => { setPool([]); toast.error('Suppliers not loaded', 'The Supplier Master list could not be loaded.'); return [] as Supplier[]; }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [scope]);
  useEffect(() => { void loadPool(); }, [loadPool]);
  useEffect(() => {
    api.get<{ data: { supplier_id?: number | null; source?: string }[] }>(`/p2p/sourcing-targets/${encodeURIComponent(targetCode)}/products/${productId}/suppliers`)
      .then(r => setMappedIds(new Set((r.data?.data ?? []).filter(s => s.source !== 'New Supplier' && s.supplier_id != null && String(s.supplier_id) !== edit?.supplierId).map(s => String(s.supplier_id)))))
      .catch(() => {});
  }, [targetCode, productId]);

  const [adding, setAdding] = useState(false);
  const options = useMemo(() => (pool ?? []).map(s => {
    const taken = mappedIds.has(s.id);
    return {
      value: s.id, code: s.code, label: intl ? `${s.name}${s.country ? ` · ${s.country}` : ''}` : s.name,
      selectedLabel: s.code ? `${s.code} · ${s.name}` : s.name,
      // The supplier's type as a badge in the open list (Material / Goods, FFD / Transporter, a service).
      ...(s.type && s.type !== '—' ? { badge: { text: s.type, tone: typeTone(s.type), title: `Supplier Type: ${s.type}`, listOnly: true } } : {}),
      disabled: taken, disabledReason: taken ? 'Already mapped to this product' : undefined,
    };
  }), [pool, intl, mappedIds]);

  const gstRates = useMemo(() => (masters?.gstRates.length ? masters.gstRates : [0, 5, 12, 18, 28]), [masters]);
  const currencyOptions = useMemo(() => (masters?.currencies ?? []).map(c => ({ value: c.code.toUpperCase(), label: c.name ? `${c.code.toUpperCase()} · ${c.name}` : c.code.toUpperCase(), selectedLabel: c.code.toUpperCase() })), [masters]);

  // Edit: the mapped supplier and its saved quote; Add: empty, 18% GST, USD.
  const init = useMemo(() => ({
    id: edit?.supplierId ?? '',
    price: edit?.price != null ? String(edit.price) : '',
    gst: String(edit?.price != null ? edit.gst : DEFAULT_GST),
    cur: edit && edit.currency && edit.currency !== 'INR' ? edit.currency : 'USD',
    fx: edit?.fx != null ? String(edit.fx) : '',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const [id, setId] = useState(init.id);
  const [price, setPrice] = useState(init.price);
  const [gst, setGst] = useState(init.gst);
  const [cur, setCur] = useState(init.cur);
  const [fx, setFx] = useState(init.fx);
  const [tried, setTried] = useState(false);
  // 18% is the default when the GST master has it, otherwise its first rate.
  useEffect(() => {
    if (!masters?.gstRates.length) return;
    setGst(g => (masters.gstRates.includes(Number(g)) ? g : String(masters.gstRates.includes(DEFAULT_GST) ? DEFAULT_GST : masters.gstRates[0])));
  }, [masters]);
  // The default rate arrives with the masters (the user can still change it).
  useEffect(() => { if (masters && !fx) setFx(rateOf(masters, cur)); }, [masters]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sup = pool?.find(s => s.id === id);
  // While the Add Supplier form is open, Esc must not close the Map Supplier popup behind it.
  // Edit: only a changed price field counts.
  const dirty = isEdit ? price !== init.price || gst !== init.gst || cur !== init.cur || fx !== init.fx : !!id || !!price || adding;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { if (Object.keys(serverErrors).length) onClearServerErrors?.(); }, [id, price, gst, cur, fx]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickCurrency = (c: string) => { setCur(c); setFx(rateOf(masters, c)); };
  const pickSupplier = (picked: string, from = pool) => {
    setId(picked);
    const s = from?.find(x => x.id === picked);
    // International: the supplier's own currency (or its country's), with the master's default rate.
    const auto = s && (s.currency && s.currency !== 'INR' ? s.currency : COUNTRY_CURRENCY[s.country]);
    if (intl && auto) pickCurrency(auto);
  };
  // "+" saved a supplier in the Supplier Master: reload the list and select it by the id the Add
  // Supplier form returns (not by name — two suppliers can share one).
  const supplierAdded = async (p: { companyName: string; vendorId?: number | null }) => {
    setAdding(false);
    const list = await loadPool();
    const found = p.vendorId != null ? list.find(s => s.id === String(p.vendorId)) : undefined;
    if (found) {
      pickSupplier(found.id, list);
      toast.success(`${p.companyName} added to Supplier Master`, 'It is now selected in this form.');
    } else {
      // Saved, but not in this list: the wizard's country made it the other origin.
      toast.info(`${p.companyName} saved`, intl ? 'It is not an International supplier, so it is not in this list.' : 'It is not a Domestic supplier, so it is not in this list.');
    }
  };

  const p = toNum(price);
  const gstAmt = p * (Number(gst) / 100);
  const errs = { sup: !id, price: !p, fx: intl && !toNum(fx) };
  const bad = (k: keyof typeof errs) => tried && errs[k];
  const srv = (key: string) => serverErrors[key];
  const err = (k: keyof typeof errs, id: string, apiKey: string) => (bad(k)
    ? <div className="stsm-err" id={id}>This field is required</div>
    : srv(apiKey) ? <div className="stsm-err" id={id}>{srv(apiKey)}</div> : null);

  const save = () => {
    setTried(true);
    if (errs.sup || errs.price || errs.fx || !sup) return;
    const quote = intl
      ? { origin: 'international', price: p, currency: cur, exchange_rate: toNum(fx) }
      // Domestic: the server picks CGST + SGST or IGST from the supplier's state vs ours.
      : { origin: 'domestic', price: p, gst_percentage: Number(gst) };
    onSave({
      supplierName: sup.name,
      // Edit sends the quote only, with the saved Price Valid Till (the API clears one left out).
      body: isEdit ? { ...quote, ...(edit?.validTill ? { valid_till: edit.validTill } : {}) } : { supplier_id: sup.id, ...quote },
    });
  };

  return (
    <div ref={dialogRef} className={`stsm-box${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="stsm-title" aria-busy={saving || undefined}>
      <div className="stsm-hd">
        <div className="stsm-hd__ico"><IcoUserPlus size={18} sw={2.2} /></div>
        <div className="stsm-hd__txt">
          <div className="stsm-hd__t" id="stsm-title">
            {isEdit ? 'Edit Supplier Master' : 'Supplier Master'}
            <span className="stsm-hd__tag">{intl ? <><IcoGlobe size={11} sw={2.4} />International</> : <><IcoFlag size={11} sw={2.4} />Domestic</>}</span>
          </div>
          <div className="stsm-hd__s">
            {isEdit ? `Update this supplier's ${intl ? 'price & exchange rate' : 'price & GST'} for `
              : intl ? 'Link an overseas supplier with its price in foreign currency for ' : 'Link an Indian supplier with price & GST for '}
            <b>{productName}</b>
          </div>
        </div>
        <button type="button" className="stsm-x" aria-label="Close" onClick={onCancel} disabled={saving}><IcoX size={13} sw={2.8} /></button>
      </div>

      <div className="stsm-bd sct-scroller" inert={saving}>
        <div className="stsm-subhd">{intl ? <IcoGlobe size={11} sw={2.4} /> : <IcoFlag size={11} sw={2.4} />}Supplier Details</div>
        <div className="stsm-grid">
          <div className="stsm-f stsm-f--sup">
            <span className="stsm-l" id="stsm-sup-l">
              Supplier Name {isEdit ? <span className="stsm-auto">Locked</span> : <Req />}
              {!isEdit && (
                <button type="button" className="stsm-mini" aria-label="Add new supplier" title="Add new supplier" onClick={() => setAdding(true)}>
                  <IcoPlus size={11} sw={3} />
                </button>
              )}
            </span>
            {/* Edit: the mapped supplier is frozen, drawn like the other locked fields. */}
            {isEdit ? (
              <input className="stsm-i is-ro" aria-labelledby="stsm-sup-l" readOnly tabIndex={-1}
                value={sup ? (sup.code ? `${sup.code} · ${sup.name}` : sup.name) : ''} placeholder={pool === null ? 'Loading supplier…' : '—'} />
            ) : (
            <div className={`stsm-ms${bad('sup') ? ' is-err' : ''}`} aria-labelledby="stsm-sup-l">
              <MasterSelect value={id} options={options} invalid={bad('sup')}
                placeholder={pool === null ? 'Loading suppliers…' : pool.length ? 'Select Supplier Name' : `No ${intl ? 'International' : 'Domestic'} suppliers in the Supplier Master`}
                searchable searchPlaceholder={intl ? 'Search supplier code, name or country' : 'Search supplier code, name'}
                onChange={c => pickSupplier(c)} />
            </div>
            )}
            {err('sup', 'stsm-sup-err', 'supplier_id')}
          </div>
          <ReadOnly id="stsm-code" label="Supplier Code" value={sup?.code ?? ''} placeholder="Auto-fills from supplier" />
          <ReadOnly id="stsm-type" label="Supplier Type" value={sup?.type ?? ''} placeholder="—" />
          {intl ? <>
            <ReadOnly id="stsm-country" label="Country" value={sup?.country ?? ''} placeholder="—" />
            <ReadOnly id="stsm-region" label="City / Region" value={sup ? [sup.city, sup.state].filter(Boolean).join(', ') : ''} placeholder="—" />
          </> : <>
            <ReadOnly id="stsm-state" label="State" value={sup?.state ?? ''} placeholder="—" />
            <ReadOnly id="stsm-gstcode" label="GST State Code" value={sup?.stateCode ?? ''} placeholder="—" />
          </>}
          <ReadOnly id="stsm-contact" label="Contact Person" value={sup?.contact ?? ''} placeholder="—" />
        </div>

        {intl ? (
          <>
            <div className="stsm-subhd"><IcoGlobe size={11} sw={2.4} />Price &amp; Currency <span className="stsm-nogst">No GST — overseas supplier</span></div>
            <div className="stsm-grid stsm-grid--4">
              <div className="stsm-f">
                <span className="stsm-l" id="stsm-cur-l">Currency <Req /></span>
                <div className="stsm-ms" aria-labelledby="stsm-cur-l">
                  <MasterSelect value={cur} options={currencyOptions} searchable={currencyOptions.length > 8} searchPlaceholder="Search currency…"
                    placeholder={masters ? 'Select currency' : 'Loading…'} onChange={pickCurrency} />
                </div>
                {srv('currency') && <div className="stsm-err">{srv('currency')}</div>}
              </div>
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-price">Price ({cur}) <Req /></label>
                <input id="stsm-price" className={`stsm-i stsm-i--key${bad('price') || srv('price') ? ' is-err' : ''}`} inputMode="decimal" placeholder="Price in supplier currency"
                  value={price} onChange={e => setPrice(numeric(e.target.value))}
                  aria-invalid={bad('price')} aria-describedby={bad('price') ? 'stsm-price-err' : undefined} />
                {err('price', 'stsm-price-err', 'price')}
              </div>
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-fx">Exchange Rate (₹ per {cur}) <Req /></label>
                <input id="stsm-fx" className={`stsm-i${bad('fx') || srv('exchange_rate') ? ' is-err' : ''}`} inputMode="decimal"
                  value={fx} onChange={e => setFx(numeric(e.target.value))}
                  aria-invalid={bad('fx')} aria-describedby={bad('fx') ? 'stsm-fx-err' : undefined} />
                {err('fx', 'stsm-fx-err', 'exchange_rate')}
              </div>
              <ReadOnly id="stsm-total" label={`Total Amount (${cur})`} value={p ? money(cur, p) : ''} placeholder="Auto-computed" calc />
            </div>
          </>
        ) : (
          <>
            <div className="stsm-subhd">₹ Price &amp; GST</div>
            <div className="stsm-grid stsm-grid--4">
              <div className="stsm-f">
                <label className="stsm-l" htmlFor="stsm-price">Price (₹) <Req /></label>
                <input id="stsm-price" className={`stsm-i stsm-i--key${bad('price') || srv('price') ? ' is-err' : ''}`} inputMode="decimal" placeholder="Enter unit price"
                  value={price} onChange={e => setPrice(numeric(e.target.value))}
                  aria-invalid={bad('price')} aria-describedby={bad('price') ? 'stsm-price-err' : undefined} />
                {err('price', 'stsm-price-err', 'price')}
              </div>
              <div className="stsm-f">
                <span className="stsm-l" id="stsm-gst-l">GST % <Req /></span>
                <div className="stsm-ms" aria-labelledby="stsm-gst-l">
                  <MasterSelect value={gst} options={gstRates.map(r => ({ value: String(r), label: String(r) }))} onChange={setGst} />
                </div>
              </div>
              <ReadOnly id="stsm-gstamt" label="GST Amount (₹)" value={p ? money('INR', gstAmt) : ''} placeholder="Auto-computed" calc />
              <ReadOnly id="stsm-total" label="Total Amount (₹)" value={p ? money('INR', p + gstAmt) : ''} placeholder="Auto-computed" calc />
            </div>
          </>
        )}
      </div>

      <div className="stsm-ft">
        {!isEdit && <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onBack} disabled={saving}><IcoBack size={12} sw={2.6} />Back</button>}
        <span className="stsm-ft__sp" />
        <button type="button" className="stsm-btn stsm-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="stsm-btn stsm-btn--primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>
          {saving ? <><span className="sct-spin" aria-hidden />{isEdit ? 'Updating…' : 'Saving…'}</> : <><IcoCheck size={13} sw={2.6} />{isEdit ? 'Update' : 'Save'}</>}
        </button>
      </div>

      {adding && (
        <Suspense fallback={null}>
          {/* Opened for the origin already chosen (Supplier Master → Domestic / International), so it
              is not asked again. Mapping products from inside the wizard is off: the mapping is
              being made here. */}
          <AddVendorModal scope={scope} canMapProducts={false} onClose={() => setAdding(false)} onSubmit={p => { void supplierAdded(p); }} />
        </Suspense>
      )}
    </div>
  );
}
