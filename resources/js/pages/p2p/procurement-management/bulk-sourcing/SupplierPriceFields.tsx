import { MasterSelect } from '../../../../components/ui/MasterSelect';

/* Supplier price on a sourcing product (Map Supplier / Edit Price).
 *  Domestic      → unit price in ₹ (excl. GST) + GST rate; GST type is set by the server from the state.
 *  International → unit price in the supplier's currency + exchange rate (₹ per unit), no GST.
 * The server recomputes every amount; the summary here is only a preview. */

export type SupplierOrigin = 'domestic' | 'international';
export type PriceDraft = { price: string; gst: string; currency: string; rate: string; validTill: string };
export type PriceMasters = {
  currencies: { code: string; name?: string; symbol?: string | null; exchange_rate?: number | string | null }[];
  gstRates: number[];
};

export const emptyPrice = (): PriceDraft => ({ price: '', gst: '18', currency: '', rate: '', validTill: '' });

const num = (v: string | number | null | undefined) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (cur: string, n: number) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

export const rateOf = (masters: PriceMasters, code: string) => {
  const r = masters.currencies.find(c => c.code === code)?.exchange_rate;
  return r ? String(Number(r)) : '';
};

export function priceErrors(origin: SupplierOrigin, d: PriceDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!(num(d.price) > 0)) e.price = 'Enter the unit price.';
  if (origin === 'international') {
    if (!d.currency) e.currency = 'Pick the currency.';
    if (!(num(d.rate) > 0)) e.rate = 'Enter the exchange rate.';
  }
  if (d.validTill && d.validTill < todayIso()) e.validTill = 'Valid till cannot be in the past.';
  return e;
}

/** Body for POST …/suppliers and PATCH …/suppliers/{id}/price. */
export function pricePayload(origin: SupplierOrigin, d: PriceDraft): Record<string, unknown> {
  const base: Record<string, unknown> = { origin, price: num(d.price), valid_till: d.validTill || null };
  return origin === 'international'
    ? { ...base, currency: d.currency, exchange_rate: num(d.rate) }
    : { ...base, gst_percentage: num(d.gst) };
}

export default function SupplierPriceFields({ origin, value, onChange, masters, targetPrice, errors = {} }: {
  origin: SupplierOrigin; value: PriceDraft; onChange: (d: PriceDraft) => void; masters: PriceMasters;
  targetPrice?: string; errors?: Record<string, string>;
}) {
  const set = (k: keyof PriceDraft, v: string) => onChange({ ...value, [k]: v });
  const intl = origin === 'international';
  const price = num(value.price), rate = num(value.rate), gst = num(value.gst);
  const target = num(targetPrice);
  const unitInr = intl ? price * rate : price;
  const gstAmt = intl ? 0 : Math.round(price * gst) / 100;
  const vs = price > 0 && target > 0 && unitInr > 0 ? ((unitInr - target) / target) * 100 : null;
  const inv = (k: string) => (errors[k] ? { borderColor: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,.12)' } : undefined);
  const err = (k: string) => (errors[k] ? <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 600, marginTop: 4 }}>{errors[k]}</div> : null);
  const gstOpts = (masters.gstRates.length ? masters.gstRates : [0, 5, 12, 18, 28]).map(g => ({ value: String(g), label: `${g}%` }));

  return (
    <div className="snf-section">
      <div className="snf-sec-hdr">
        <div className="snf-sec-icon green-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div>
        <span>{intl ? 'Supplier Price & Currency' : 'Supplier Price & GST'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          {intl ? 'International · no GST' : 'Domestic · ₹ + GST'}{target > 0 ? ` · Target ${inr(target)}` : ''}
        </span>
      </div>
      <div className="snf-row snf-row-4">
        {intl && (
          <div className="snf-field">
            <label className="snf-lbl">Currency <span className="snf-req">*</span></label>
            <MasterSelect value={value.currency} invalid={!!errors.currency} placeholder="Select currency..."
              options={masters.currencies.map(c => ({ value: c.code, label: `${c.code}${c.name ? ' — ' + c.name : ''}` }))}
              onChange={(code) => onChange({ ...value, currency: code, rate: rateOf(masters, code) || value.rate })} />
            {err('currency')}
          </div>
        )}
        <div className="snf-field">
          <label className="snf-lbl">Unit Price {intl ? `(${value.currency || 'currency'})` : '(₹, excl. GST)'} <span className="snf-req">*</span></label>
          <input className="snf-inp" inputMode="decimal" style={inv('price')} value={value.price}
            onChange={e => set('price', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
          {err('price')}
        </div>
        {intl ? (
          <div className="snf-field">
            <label className="snf-lbl">Exchange Rate (₹ per {value.currency || 'unit'}) <span className="snf-req">*</span></label>
            <input className="snf-inp" inputMode="decimal" style={inv('rate')} value={value.rate}
              onChange={e => set('rate', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 83.25" />
            {err('rate')}
          </div>
        ) : (
          <div className="snf-field">
            <label className="snf-lbl">GST Rate <span className="snf-req">*</span></label>
            <MasterSelect value={value.gst} placeholder="GST %" options={gstOpts} onChange={(g) => set('gst', g)} />
          </div>
        )}
        <div className="snf-field">
          <label className="snf-lbl">Price Valid Till</label>
          <input className="snf-inp" type="date" min={todayIso()} style={inv('validTill')} value={value.validTill} onChange={e => set('validTill', e.target.value)} />
          {err('validTill')}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 4, fontSize: 12 }}>
        {(intl
          ? [['Total', price > 0 ? money(value.currency || '', price) : '—'], ['GST', 'No GST'], ['₹ Equivalent', price > 0 && rate > 0 ? inr(unitInr) : '—']]
          : [['GST Amount', price > 0 ? inr(gstAmt) : '—'], ['Price incl. GST', price > 0 ? inr(price + gstAmt) : '—'], ['Unit Price', price > 0 ? inr(price) : '—']]
        ).map(([k, v]) => (
          <div key={k} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: '#64748b', fontWeight: 600, fontSize: 10.5 }}>{k}</div>
            <div style={{ fontWeight: 800, color: '#0f172a' }}>{v}</div>
          </div>
        ))}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ color: '#64748b', fontWeight: 600, fontSize: 10.5 }}>vs Target Price</div>
          <div style={{ fontWeight: 800, color: vs == null ? '#0f172a' : Math.abs(vs) < 0.005 ? '#0f172a' : vs < 0 ? '#059669' : '#dc2626' }}>
            {vs == null ? '—' : Math.abs(vs) < 0.005 ? 'At target' : `${Math.abs(vs).toFixed(2)}% ${vs < 0 ? 'below' : 'above'}`}
          </div>
        </div>
      </div>
    </div>
  );
}
