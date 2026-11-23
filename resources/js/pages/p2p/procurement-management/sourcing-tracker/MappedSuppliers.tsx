import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { todayIso, type SourcingTarget } from './data';
import { dmy, initials, inr } from './format';
import { money } from './currency';
import ClipText from './ClipText';
import type { MapEdit } from './MapSupplierModal';
import { usePopup } from './popupHooks';
import type { ReportProduct } from './targetProducts';
import './mapped-suppliers.css';
import { IcoCheck, IcoUserPlus, IcoUsers, IcoX, Svg } from './icons';

/* Mapped Suppliers popup (Figma) — opens from the Supplier Count badge in the Sourcing Target
   Report. Same design as Bulk Sourcing's MappedSuppliersModal, under this module's own .stsv-*
   class names (mapped-suppliers.css). Cards: GET /p2p/sourcing-targets/{id}/products/{product}/suppliers.
   The server masks contact / mobile / email ("••••") for people who may not see them.
   Edit (assignee only) opens the same form the supplier was mapped with: a New Supplier card its
   New Supplier form; a Supplier Master card the Supplier Master form with the supplier locked and
   only its price editable (the supplier's own details are edited in the Supplier Master). */

type Sup = {
  /** The mapping's id (one row per supplier on this product). */
  id: string;
  /** Supplier Master id (source Master) or New Supplier directory id (source New Supplier). */
  supplierId: number | null;
  name: string; segment: string; contact: string; mobile: string; email: string;
  source: 'Master' | 'New Supplier';
  origin: 'domestic' | 'international' | null;
  /** New Supplier not yet in the Supplier Master: show "Convert to Supplier". */
  canConvert: boolean;
  /** A Master supplier that was created by converting a New Supplier. */
  converted: boolean;
  /** The quote stored with the mapping (null price = mapped before pricing existed). */
  quote: Quote;
  /** Unmasked saved values, to open a New Supplier for Edit ('' where the server masked one). */
  raw: { contact: string; mobile: string; email: string; gmaps: string; address: string; stateCode: string; city: string; card: string };
};

/** A mapping's quote, as the API computes it (GST split, totals, ₹ equivalent, vs target). */
type Quote = {
  price: number | null; currency: string; country: string; state: string;
  gstPercentage: number; gstType: 'intra' | 'inter' | 'none' | null; gstAmount: number; total: number;
  exchangeRate: number | null; inrAmount: number | null; validTill: string | null;
  vs: { percent: number; status: 'below' | 'at' | 'above' } | null;
};

type ApiSup = {
  id: string | number; supplier_id?: number | null; name?: string; segment?: string | null;
  contact?: string | null; mobile?: string | null; email?: string | null;
  source?: string; origin?: string | null; canConvert?: boolean; converted?: boolean;
  country?: string | null; state?: string | null; currency?: string | null; price?: number | null;
  gstPercentage?: number | null; gstType?: string | null; gstAmount?: number | null; total?: number | null;
  exchangeRate?: number | null; inrAmount?: number | null; validTill?: string | null;
  vsTarget?: { percent?: number | null; status?: string | null } | null;
  gmaps?: string | null; address?: string | null; state_code?: string | null; city?: string | null; card?: string | null;
};
/** A value the server masked ("••••") is not a real value: an Edit form must not save it back. */
const real = (v?: string | null) => (v && !v.includes('•') ? v.trim() : '');

const dash = (v?: string | null) => (v && String(v).trim() ? String(v) : '—');
const toSup = (r: ApiSup): Sup => ({
  id: String(r.id),
  supplierId: r.supplier_id ?? null,
  name: r.name || '—',
  segment: r.segment?.trim() || '',
  contact: dash(r.contact), mobile: dash(r.mobile), email: dash(r.email),
  source: r.source === 'New Supplier' ? 'New Supplier' : 'Master',
  origin: r.origin === 'international' ? 'international' : r.origin === 'domestic' ? 'domestic' : null,
  canConvert: !!r.canConvert,
  converted: !!r.converted,
  raw: {
    contact: real(r.contact), mobile: real(r.mobile), email: real(r.email), gmaps: real(r.gmaps), address: real(r.address),
    stateCode: real(r.state_code), city: real(r.city), card: real(r.card),
  },
  quote: {
    price: r.price ?? null,
    currency: (r.currency || 'INR').toUpperCase(),
    country: r.country || '', state: r.state || '',
    gstPercentage: r.gstPercentage ?? 0,
    gstType: r.gstType === 'intra' || r.gstType === 'inter' || r.gstType === 'none' ? r.gstType : null,
    gstAmount: r.gstAmount ?? 0, total: r.total ?? 0,
    exchangeRate: r.exchangeRate ?? null, inrAmount: r.inrAmount ?? null, validTill: r.validTill ?? null,
    vs: r.vsTarget && r.vsTarget.percent != null && r.vsTarget.status
      ? { percent: Number(r.vsTarget.percent), status: r.vsTarget.status === 'below' ? 'below' : r.vsTarget.status === 'above' ? 'above' : 'at' }
      : null,
  },
});

/** "₹37,881.00" — the Figma's rupee amounts (two decimals, Indian grouping, no space). */
const rupee = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The quote's "vs target" line, from the server's comparison of the ₹ unit price with the target. */
function VsTarget({ vs }: { vs: Quote['vs'] }) {
  if (!vs) return null;
  if (vs.status === 'at' || Math.abs(vs.percent) < 0.005) return <em className="stsv-vs eq">At target</em>;
  return vs.status === 'below'
    ? <em className="stsv-vs ok">{Math.abs(vs.percent).toFixed(2)}% below target</em>
    : <em className="stsv-vs hi">{Math.abs(vs.percent).toFixed(2)}% above target</em>;
}

/** The price row under a supplier card's contacts (Figma "Mapped Suppliers popup — price row"). */
function PriceRow({ q, origin }: { q: Quote; origin: Sup['origin'] }) {
  if (q.price == null) {
    return <div className="stsv-price stsv-price--none"><span>Price &amp; GST not mapped for this supplier</span></div>;
  }
  if (origin === 'international') {
    return (
      <div className="stsv-price">
        <div className="stsv-price-k"><span>Origin</span><b className="stsv-txt">International</b>{q.country && <small>{q.country}</small>}</div>
        <div className="stsv-price-k"><span>Unit Price</span><b>{money(q.currency, q.price)}</b></div>
        <div className="stsv-price-k"><span>Exchange Rate</span><b>₹{(q.exchangeRate ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</b><small>per {q.currency}</small></div>
        <div className="stsv-price-k"><span>GST</span><b className="stsv-txt">No GST</b><small>Overseas supplier</small></div>
        <div className="stsv-price-k tot"><span>INR Equivalent</span><b>{rupee(q.inrAmount ?? 0)}</b><VsTarget vs={q.vs} /></div>
      </div>
    );
  }
  const half = q.gstPercentage / 2;
  const split = q.gstType === 'intra' ? `CGST ${half}% + SGST ${half}%` : `IGST ${q.gstPercentage}%`;
  return (
    <div className="stsv-price">
      <div className="stsv-price-k"><span>Unit Price</span><b>{rupee(q.price)}</b></div>
      <div className="stsv-price-k"><span>GST</span><b>{q.gstPercentage}%</b><small>{split}</small></div>
      <div className="stsv-price-k"><span>GST Amount</span><b>{rupee(q.gstAmount)}</b></div>
      <div className="stsv-price-k tot"><span>Price incl. GST</span><b>{rupee(q.total)}</b><VsTarget vs={q.vs} /></div>
      {q.validTill && <div className="stsv-price-k"><span>Valid Till</span><b>{dmy(q.validTill)}</b></div>}
    </div>
  );
}

const IcoType = () => <Svg size={9} sw={2.5}><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></Svg>;
const CONTACT_ICONS: Record<'user' | 'phone' | 'mail', ReactNode> = {
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
};

/** A New Supplier's key (its directory id): a conversion applies to every product it is mapped on. */
export const supKey = (supplierId: number | null, mappingId: string) => (supplierId != null ? `new-${supplierId}` : `map-${mappingId}`);

type Props = {
  row: SourcingTarget;
  product: ReportProduct;
  onClose: () => void;
  /** Add Supplier opens the Map Supplier Directory popup for this product. */
  onAddSupplier: () => void;
  /** Convert to Supplier on a New Supplier card (CS-2222): opens Supplier Management's Add Supplier
      form for this New Supplier (its directory id). */
  onConvert?: (supplierId: number, name: string) => void;
  /** Converted in this session (supKey), before the list is loaded again: the button is gone. */
  converted?: ReadonlySet<string>;
  /** Only the target's assignee maps suppliers: Add Supplier is off for anyone else. */
  canMap: boolean;
  /** Edit a mapped New Supplier (its details and quote) — the assignee only. */
  onEdit?: (edit: MapEdit) => void;
  /** Bumped by the page after a save, so this list re-reads while it stays open. */
  refreshKey?: number;
};

/** A mapped New Supplier's saved values, as the New Supplier form holds them. */
const editOf = (s: Sup): MapEdit => {
  const intl = s.origin === 'international';
  const q = s.quote;
  return {
    mappingId: s.id,
    scope: intl ? 'international' : 'domestic',
    card: s.raw.card,
    values: {
      coName: s.name, contact: s.raw.contact, segment: s.segment, email: s.raw.email, gmaps: s.raw.gmaps,
      // A domestic mobile is kept as its 10 digits (the form's own rule); an overseas one as typed.
      mobile: intl ? s.raw.mobile : s.raw.mobile.replace(/\D/g, '').slice(-10),
      addr: s.raw.address, country: intl ? q.country : 'India', state: q.state, stateCode: s.raw.stateCode, city: s.raw.city,
      price: q.price != null ? String(q.price) : '', gst: String(q.gstPercentage || 18),
      gstType: q.gstType === 'intra' ? 'intra' : 'inter', validTill: q.validTill ?? '',
      ...(intl ? { cur: q.currency, fx: q.exchangeRate != null ? String(q.exchangeRate) : '' } : {}),
    },
  };
};

/** A mapped Supplier Master supplier, for its Edit: the supplier stays, only the quote changes. */
const masterEditOf = (s: Sup): MapEdit => {
  const q = s.quote;
  const intl = (s.origin ?? (q.country && q.country !== 'India' ? 'international' : 'domestic')) === 'international';
  return {
    mappingId: s.id,
    scope: intl ? 'international' : 'domestic',
    values: {},
    card: '',
    master: {
      supplierId: s.supplierId != null ? String(s.supplierId) : '',
      price: q.price, gst: q.gstPercentage, currency: q.currency, fx: q.exchangeRate, validTill: q.validTill,
    },
  };
};

export default function MappedSuppliers({ row, product, onClose, onAddSupplier, onConvert, converted, canMap, onEdit, refreshKey }: Props) {
  const segment = product.segment && product.segment !== '—' ? product.segment : '';
  const [loaded, setLoaded] = useState<Sup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.get<{ data: ApiSup[] }>(`/p2p/sourcing-targets/${encodeURIComponent(row.code)}/products/${product.id}/suppliers`)
      .then(r => { if (alive) setLoaded((r.data?.data ?? []).map(toSup)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // refreshKey: Edit price now opens ON TOP of this list rather than
    // replacing it, so the saved row has to be re-read while it stays open.
  }, [row.code, product.id, retry, refreshKey]);
  const loading = loaded === null && !failed;
  const suppliers: Sup[] = (loaded ?? []).map(s => (
    s.source === 'New Supplier' && converted?.has(supKey(s.supplierId, s.id)) ? { ...s, source: 'Master' as const, canConvert: false, converted: true } : s));
  // Until the cards arrive the header keeps the report's count.
  const count = loaded ? suppliers.length : product.suppliers;
  const source = product.source === 'Product Master' ? 'Product Master' : 'Manual Entry';

  // Scroll lock, Esc (this is the top popup, so the report behind stays open) and focus.
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose });

  return createPortal(
    // A click on the backdrop does nothing: only ×, Close or Esc closes the popup.
    <div className="stsv-overlay">
      <div ref={dialogRef} className="stsv-box" role="dialog" aria-modal="true" aria-label="Mapped Suppliers">
        <div className="stsv-header">
          <div className="stsv-hbar" />
          <div className="stsv-htop">
            <div className="stsv-hicon-wrap"><IcoUsers size={20} sw={2.1} /></div>
            <div className="stsv-htitle-block">
              <div className="stsv-htitle-row"><span className="stsv-htitle">Mapped Suppliers</span><span className="stsv-hpill"><IcoType />{row.code}</span></div>
              <div className="stsv-hsub">Sourcing Reference &nbsp;·&nbsp; {source} &nbsp;·&nbsp; Generated {dmy(todayIso())}</div>
            </div>
            <button type="button" className="stsv-close" aria-label="Close" onClick={onClose}><IcoX size={13} sw={2.8} /></button>
          </div>
          {/* Six tiles in a row: a long label or value ends in "…", and the full text shows in the
              app tooltip — only when it is really cut (FitTip). */}
          <div className="stsv-refs">
            {([
              ['Sourcing ID', row.code, 'cyan'],
              ['Product Code', product.code || '—', 'cyan'],
              ['Product Name', product.name, ''],
              ...(segment ? [['Segment', segment, '']] as const : []),
              ['Target Price', inr(product.targetPrice), 'amber'],
              ['Suppliers Mapped', `${count} Supplier${count !== 1 ? 's' : ''}`, 'green'],
            ] as const).map(([lbl, val, tone]) => (
              <div className="stsv-ref" key={lbl}>
                <FitTip label={lbl}><div className="stsv-ref-lbl">{lbl}</div></FitTip>
                <FitTip label={val}><div className={`stsv-ref-val${tone ? ` ${tone}` : ''}`}>{val}</div></FitTip>
              </div>
            ))}
          </div>
        </div>

        <div className="stsv-body sct-scroller">
          <div className="stsv-sec-hdr">
            <div className="stsv-sec-title"><div className="stsv-sec-title-icon"><IcoUsers size={13} sw={2.1} /></div><span className="stsv-sec-label">Supplier List</span></div>
            <span className="stsv-count-badge"><IcoCheck size={10} sw={2.5} />{count} Mapped</span>
          </div>
          <div className="stsv-cards">
            {loading || (failed && !loaded) ? (
              <div className="stsv-empty">
                {loading
                  ? <div className="stsv-empty-sub"><span className="sct-spin sct-spin--dark" aria-hidden />Loading the mapped suppliers…</div>
                  : <><div className="stsv-empty-title">Couldn’t load the suppliers</div><button type="button" className="str-retry" onClick={() => setRetry(n => n + 1)}>Retry</button></>}
              </div>
            ) : suppliers.length === 0 ? (
              <div className="stsv-empty">
                <div className="stsv-empty-icon"><IcoUserPlus size={24} sw={2.3} /></div>
                <div className="stsv-empty-title">No Suppliers Mapped</div>
                <div className="stsv-empty-sub">Click "Add Supplier" to map suppliers for this product.</div>
              </div>
            ) : suppliers.map((s, i) => (
              <div className="stsv-card" key={s.id}>
                <div className="stsv-card-top">
                  <div className="stsv-card-idx">{i + 1}</div>
                  <div className="stsv-card-av">{initials(s.name)}</div>
                  <div className="stsv-card-info">
                    <FitTip label={s.name}><div className="stsv-card-name">{s.name}</div></FitTip>
                    <div className="stsv-card-tags">
                      {/* The API sends no supplier code, so the first tag is the origin. */}
                      {s.origin && <span className="stsv-card-tag id">{s.origin === 'international' ? 'International' : 'Domestic'}</span>}
                      {(s.segment || segment) && <ClipText text={s.segment || segment} className="stsv-card-tag seg" />}
                      <span className="stsv-card-tag src">{s.source}</span>
                    </div>
                  </div>
                  {/* Edit + Convert sit together on the right (CS-2308): the Tooltip wraps Edit in its own
                      element, so Edit's own margin never reached the card edge and Convert was pushed
                      far away from it. One group, pinned right, 8px apart. */}
                  <div className="stsv-card-acts">
                  {/* Edit (assignee only): a New Supplier's details and quote; a Supplier Master mapping's
                      quote only, in the Supplier Master form (its details are edited in the Supplier Master). */}
                  {canMap && onEdit && (s.source === 'New Supplier' ? (
                    <Tooltip label="Edit supplier & quote">
                      <button type="button" className="stsv-card-edit-btn" aria-label={`Edit ${s.name}`} onClick={() => onEdit(editOf(s))}>
                        <Svg sw={2.3} size={13}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip label="Edit price">
                      <button type="button" className="stsv-card-edit-btn" aria-label={`Edit the price of ${s.name}`} onClick={() => onEdit(masterEditOf(s))}>
                        <Svg sw={2.3} size={13}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
                      </button>
                    </Tooltip>
                  ))}
                  {/* Only on New Supplier cards — never on Master ones (V-T23); gone once converted (V-T46). */}
                  {s.canConvert && onConvert && s.supplierId != null && (
                    <button type="button" className="stsv-card-convert-btn" onClick={() => onConvert(s.supplierId as number, s.name)}>
                      <Svg sw={2.3} size={12}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></Svg>
                      Convert to Supplier
                    </button>
                  )}
                  {/* Where the button was: a New Supplier now in the Master reads "Converted". */}
                  {s.converted && (
                    <span className="stsv-card-converted" title="This New Supplier is now in the Supplier Master">
                      <Svg sw={2.6} size={12}><polyline points="20 6 9 17 4 12" /></Svg>
                      Converted
                    </span>
                  )}
                </div>
                <div className="stsv-card-contacts">
                  {([['Contact Person', s.contact, 'user'], ['Mobile', s.mobile, 'phone'], ['Email', s.email, 'mail']] as const).map(([lbl, val, ico]) => (
                    <div className="stsv-contact-item" key={lbl}>
                      <div className="stsv-contact-ico"><Svg size={12} sw={2.2}>{CONTACT_ICONS[ico]}</Svg></div>
                      <div className="stsv-contact-text"><div className="stsv-contact-lbl">{lbl}</div><Tooltip label={val}><div className="stsv-contact-val">{val}</div></Tooltip></div>
                    </div>
                  ))}
                </div>
                <PriceRow q={s.quote} origin={s.origin} />
              </div>
            ))}
          </div>
        </div>

        <div className="stsv-footer">
          {(() => {
            const note = loading ? 'Loading…' : count ? `${count} supplier${count !== 1 ? 's' : ''} mapped to ${product.name}` : 'No suppliers mapped yet';
            return <FitTip label={note}><span className="stsv-footer-note">{note}</span></FitTip>;
          })()}
          <div className="stsv-footer-actions">
            <button type="button" className="stsv-close-btn" onClick={onClose}>Close</button>
            {canMap ? (
              <button type="button" className="stsv-footer-btn" onClick={onAddSupplier}><IcoUserPlus size={13} sw={2.3} />Add Supplier</button>
            ) : (
              <Tooltip label="Only the creator or the assignee maps suppliers to this target">
                <span className="sct-frozen-wrap">
                  <button type="button" className="stsv-footer-btn" disabled style={{ opacity: .5, cursor: 'not-allowed' }}><IcoUserPlus size={13} sw={2.3} />Add Supplier</button>
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
