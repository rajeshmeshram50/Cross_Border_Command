import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { spiApi, type ProductFlagOption, type PutawayLocations, type SpiBox, type SpiBoxItem } from '../spi-api';
import type { ProductLine } from '../invoice-products';
import type { InvoiceDraft } from '../invoice-draft';
import StageSummary from './StageSummary';
import PutawaySelectLocation from './PutawaySelectLocation';
import PutawayConfirmPlacement, { findSpot } from './PutawayConfirmPlacement';
import { DEMO_LOCATIONS, DEMO_MODES } from './putaway-demo';
import WorklistPager from '../../../../../components/ui/WorklistPager';

/* ═══════════════════════════════════════════════════════════════════════════
 * STEP 04 — Temporary Putaway Allocation.
 *
 * Ported from the SPI_With_PO_Flow_2 prototype. This is the FRAME plus the
 * left "Pick a Box" panel: the disposition tab bar, the two-panel shell, the
 * lifecycle rail and the grouped box list. The right pane's four step bodies
 * (Review Box, Select Location, Confirm Placement, Putaway Summary) land in
 * the next piece — its header and rail are here so the layout can be judged
 * against the Figma now.
 *
 * Boxes come from the step that produced them (Step 03) rather than from a
 * fixture, so the counts, grouping and cards are the invoice's real cartons.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The disposition a box is headed for. Drives the tab bar and the stripe. */
type Disposition = 'ship' | 'inv' | 'damaged' | 'mismatch';

/** A box as this step needs it — flattened from SpiBox so the card markup
 *  reads as a card and not as a query. */
interface PickBox {
  id: number;
  code: string;
  scenario: string;
  /** The raw s1/s2/s3 key, for the scenario tab row. */
  scenarioKey: string;
  type: Disposition;
  /** Leading SKU; a mixed carton shows "name  +N more". */
  name: string;
  skus: number;
  qty: number;
  haz: boolean;
  cold: boolean;
  /** Set once the box has been placed; until then the card reads Pending. */
  location: string | null;
  /* ── Review Box details ── */
  condition: string;
  /** "120 × 80 × 60 cm", or null when Step 03 left the dimensions blank. */
  dims: string | null;
  /** The line UOM when every line agrees on one; otherwise "units". */
  uom: string | null;
  /** Null when the box carries no stackable answer at all. */
  stackable: boolean | null;
  /** "2°C to 8°C", or null for no controlled range. */
  temp: string | null;
  /** Step 03's recorded weights; null where it left them blank. */
  netKg: string | null;
  grossKg: string | null;
}

const SCENARIO_LABEL: Record<string, string> = {
  s1: '1 Product → 1 Box',
  s2: '1 Product → Multiple Boxes',
  s3: 'Multiple Products → 1 Box',
};

/* ── Icons. Inline for the same reason the rest of this wizard inlines
 *    them: the sprite would be one more file to keep in step. ── */
const IcoBoxSm = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IcoGrid = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const IcoChevL = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IcoTruck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);
const IcoWarn = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IcoSwap = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const IcoScan = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const IcoExpand = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IcoCollapse = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IcoSnow = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" /><line x1="3.3" y1="7" x2="20.7" y2="17" />
    <line x1="20.7" y1="7" x2="3.3" y2="17" /><polyline points="9.2 4.2 12 7 14.8 4.2" />
    <polyline points="9.2 19.8 12 17 14.8 19.8" />
  </svg>
);
const IcoHazard = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13.5" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IcoPin = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14l-1.5-4.5V7a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v5.5L5 17z" />
  </svg>
);
const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IcoChevR = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IcoUnits = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" />
  </svg>
);
const IcoList = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

/** A box in the Pick-a-Box list. One definition, used both inside the list and
 *  by the pinned block above it, so the two can never drift apart. */
function BoxCard({ b, seq, selected, readOnly, className = '', onPick }: {
  b: PickBox; seq: number; selected: boolean; readOnly: boolean;
  className?: string; onPick: () => void;
}) {
  return (
    <div
      className={`s4-box-card spi4bc s4pk-card s4pk-card--${b.haz ? 'haz' : b.type}`
        + `${selected ? ' is-active' : ''}${b.location ? ' is-putaway' : ''}${b.cold && !b.haz ? ' is-cold' : ''}`
        + `${className ? ` ${className}` : ''}`}
      data-boxid={b.code}
      data-type={b.type}
      onClick={() => { if (!readOnly) onPick(); }}
    >
      <div className="s4pk-card__ico">
        <span>{b.haz ? <IcoHazard /> : b.cold ? <IcoSnow /> : <IcoBoxSm size={16} />}</span>
        <em>{String(seq).padStart(2, '0')}</em>
      </div>
      <div className="s4pk-card__body">
        <div className="s4pk-card__r1">
          <span className="s4pk-card__id">{b.code}</span>
          {b.location
            ? <span className="s4pk-st"><i />Placed</span>
            : <span className="s4pk-st s4pk-st--pend"><i />Pending</span>}
        </div>
        {/* The product name is in the markup but hidden by the prototype's
            latest pass — the scenario line below is what identifies a carton
            at the shelf, and a long SKU name pushed it out of the card. */}
        <div className="s4pk-card__nm">{b.name}</div>
        <div className="s4pk-card__cat">{b.scenario}</div>
        <div className="s4pk-card__meta">
          <span className="s4pk-qty"><IcoUnits />{b.qty} units</span>
          {b.haz && <span className="s4pk-tag s4pk-tag--haz">&#9888; Haz</span>}
          {b.cold && <span className="s4pk-tag s4pk-tag--cold">&#10052; Cold</span>}
          <span className="s4pk-dest">
            {b.type === 'ship' ? 'Dispatch'
              : b.type === 'damaged' ? 'QC Hold'
              : b.type === 'mismatch' ? 'Return'
              : 'Storage'}
          </span>
        </div>
      </div>
      <span className="s4pk-card__go"><IcoChevR /></span>
    </div>
  );
}

/** The sticker's scan code. A real QR, not a drawn strip: the one on the
 *  printed label encodes the box id (PutawayStickerModal), so a scan from this
 *  card has to resolve to the same record or the two codes mean two things. */
function BoxQr({ text, size = 76 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    setFailed(false);
    QRCode.toCanvas(c, text, {
      width: size, margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    }).catch(() => setFailed(true));
  }, [text, size]);
  if (failed) return <span className="s4s-stk__qrfail">No code</span>;
  return <canvas className="s4s-stk__qr" ref={ref} width={size} height={size} />;
}

/** The lines in the selected box, joined back to the invoice for identity.
 *
 *  Step 01 shows these behind View Products rather than in a card of their
 *  own: a mixed carton can hold many, and the two cards beside it are about
 *  the BOX, not its contents. */
interface BoxProduct {
  code: string; name: string; hsn: string;
  batch: string | null; expiry: string | null;
  /** The invoice line's description, or null where it carries none. */
  desc: string | null;
  /** Split from the UOM: the dialog's table gives each its own column. */
  qtyNum: string; uom: string | null;
  /* ── the per-line detail dialog ── */
  /** What Step 03 marked this line as: correct, damaged, mismatched, extra. */
  remark: string;
  haz: boolean; cold: boolean; fragile: boolean;
  /** Null where the line carries no stackable answer at all. */
  stackable: boolean | null;
  /** The seven optional traceability fields, in the order the dialog lists
   *  them. Null where the packer left one blank, which is most of them. */
  advanced: Array<[string, string | null]>;
}

const REMARK_LABEL: Record<string, string> = {
  correct: 'Correct Product',
  damaged: 'Damaged',
  mismatched: 'Mismatched',
  extra: 'Extra',
};

function productsOf(box: SpiBox | undefined, lines: ProductLine[], flagMaster: ProductFlagOption[]): BoxProduct[] {
  const items = Array.isArray(box?.items) ? box!.items : [];
  const dash = (v: unknown) => {
    const t = String(v ?? '').trim();
    return t && t !== '—' ? t : null;
  };
  return items.map(it => {
    const line = lines.find(l => l.spiItemId === it.supplier_invoice_item_id);
    return {
      code: dash(line?.code) ?? '—',
      name: dash(line?.spiName) ?? dash(line?.description) ?? '—',
      hsn: dash(line?.hsn) ?? '—',
      batch: dash(it.batch_no),
      /* Date-cast on the server, so it arrives as a full ISO timestamp. */
      expiry: it.expiry_date ? String(it.expiry_date).slice(0, 10) : null,
      desc: dash(line?.description),
      qtyNum: String(num(it.quantity)),
      uom: dash(line?.uom),
      remark: REMARK_LABEL[String(it.remark ?? '')] ?? 'Not marked',
      haz: isHaz(flagNames([it], flagMaster)),
      cold: isCold(flagNames([it], flagMaster)),
      fragile: isFragile(flagNames([it], flagMaster)),
      stackable: it.is_stackable == null ? null : !!it.is_stackable,
      advanced: [
        ['Serial no.', dash(it.serial_no)],
        ['Lot no.', dash(it.lot_no)],
        ['Batch no.', dash(it.batch_no)],
        ['Cat no.', dash(it.cat_no)],
        ['Mfg date', it.mfg_date ? String(it.mfg_date).slice(0, 10) : null],
        ['Expiry date', it.expiry_date ? String(it.expiry_date).slice(0, 10) : null],
        ['Remarks', dash(it.remark_note)],
      ],
    };
  });
}

const IcoZoom = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16" y2="16" />
    <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);
const IcoEye = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

/** One line in the Products dialog. View opens the detail dialog rather than
 *  expanding in place - the per-line record has four sections, which is a
 *  dialog's worth of content and not a drawer's. */
function ProductRow({ p, n, onView }: { p: BoxProduct; n: number; onView: () => void }) {
  /* The description is clamped to one line until asked for. Separate from
   * View: a long description is a reason to read, not a reason to open the
   * whole record. */
  const [full, setFull] = useState(false);
  return (
    <div className="s4mx-row">
      <div className="s4mx-tr">
        <span className="s4mx-sr"><i className="s4mx-no">{n}</i></span>
        <span className="s4mx-cd"><span className="s4vp-code">{p.code}</span></span>
        <span className="s4mx-nm"><span className="s4mx-nm__t">{p.name}</span></span>
        <span className={`s4mx-dw${full ? ' is-open' : ''}`}>
          <span className="s4mx-ds">{p.desc ?? 'No description recorded'}</span>
          {p.desc !== null && (
            <button type="button" className="s4mx-rm" onClick={() => setFull(v => !v)}>
              {full ? 'Read less' : 'Read more'}
            </button>
          )}
        </span>
        <span><b>{p.qtyNum}</b></span>
        <span>{p.uom ?? '—'}</span>
        <span>
          <button type="button" className="s4vp-view" onClick={onView}>
            <IcoEye />View
          </button>
        </span>
      </div>
    </div>
  );
}

/** One key/value line inside a detail card. */
const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="s4s-kv">
    <span className="s4s-kv__k">{k}</span>
    <span className="s4s-kv__v">{v}</span>
  </div>
);

/* Step 03 records a condition word; these turn it into the two-part badge the
 * card shows — a verdict and the qualifier under it. */
const CONDITION: Record<string, [string, string]> = {
  perfect:  ['Perfect', 'No damage'],
  minor:    ['Minor wear', 'Usable'],
  major:    ['Damaged', 'Visible damage'],
  severe:   ['Rejected', 'Critical damage'],
  mismatch: ['Mismatch', 'Wrong product'],
};
const condLabel = (c: string) => (CONDITION[c] ?? CONDITION.perfect)[0];
const condNote  = (c: string) => (CONDITION[c] ?? CONDITION.perfect)[1];

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Flag ids carry no meaning on their own - p2p_spi_box_items.flags holds
 *  integers into the product-flag master. Resolving them is what makes a
 *  hazardous carton read as hazardous; testing the id as a string never could,
 *  which is why every box reported "No" regardless of what Step 03 recorded. */
function flagNames(items: SpiBoxItem[], master: ProductFlagOption[]): string[] {
  const byId = new Map(master.map(f => [f.id, (f.flag_name ?? '').toLowerCase()]));
  return items.flatMap(it => (Array.isArray(it.flags) ? it.flags : []))
    .map(id => byId.get(Number(id)) ?? '')
    .filter(Boolean);
}

const isHaz = (names: string[]) => names.some(f => f.includes('haz'));
const isCold = (names: string[]) => names.some(f => f.includes('cold') || f.includes('chill') || f.includes('frozen'));
const isFragile = (names: string[]) => names.some(f => f.includes('fragile') || f.includes('brittle'));

/** SpiBox → PickBox. Kept out of the render so the markup stays readable. */
function toPickBoxes(boxes: SpiBox[], flagMaster: ProductFlagOption[]): PickBox[] {
  return boxes.map(b => {
    const items = Array.isArray(b.items) ? b.items : [];
    const qty = items.reduce((t, it) => t + num((it as { quantity?: unknown }).quantity), 0);
    const names = items
      .map(it => String((it as { product_name?: unknown }).product_name ?? '').trim())
      .filter(Boolean);
    const flags = flagNames(items, flagMaster);
    /* The condition recorded in Step 03 decides the disposition. Anything the
     * packer did not mark is ordinary stock headed for inventory, which is
     * what the "Inventory Stock (Extra Stock)" tab counts. */
    const cond = String(b.condition ?? '').toLowerCase();
    const type: Disposition = cond.includes('damag') || cond.includes('reject') ? 'damaged'
      : cond.includes('mismatch') || cond.includes('return') ? 'mismatch'
      : cond.includes('dispatch') || cond.includes('ship') ? 'ship'
      : 'inv';
    return {
      id: b.id,
      code: b.box_code,
      scenario: SCENARIO_LABEL[b.scenario] ?? b.scenario,
      scenarioKey: b.scenario,
      type,
      name: names.length > 1 ? `${names[0]}  +${names.length - 1} more` : (names[0] || '—'),
      skus: items.length,
      qty,
      haz: isHaz(flags),
      cold: isCold(flags),
      /* Nothing is placed yet — the Select Location step, next piece, is what
         fills this in. */
      location: null,
      condition: cond || 'perfect',
      dims: dimsOf(b),
      uom: singleUom(items),
      /* Absent on boxes saved before the column existed, which is a different
         answer from "no" — the card says Not Available for it. */
      stackable: b.is_stackable == null ? null : !!b.is_stackable,
      temp: tempOf(b),
      netKg: kg(b.net_weight_kg),
      grossKg: kg(b.gross_weight_kg),
    };
  });
}

/** "45 kg", or null when the weight was never recorded. */
function kg(v: unknown): string | null {
  const n = num(v);
  return n ? `${Number.isInteger(n) ? n : n.toFixed(2)} kg` : null;
}

/** "120 × 80 × 60 cm", or null when Step 03 left any side blank. */
function dimsOf(b: SpiBox): string | null {
  const L = num(b.length_cm), W = num(b.width_cm), H = num(b.height_cm);
  if (!L || !W || !H) return null;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return `${n(L)} × ${n(W)} × ${n(H)} cm`;
}

/** The shared UOM, or null when the lines disagree — summing across different
 *  units would print a number that means nothing. */
function singleUom(items: SpiBoxItem[]): string | null {
  const set = new Set(items.map(it => String((it as { uom?: unknown }).uom ?? '').trim()).filter(Boolean));
  return set.size === 1 ? [...set][0] : null;
}

/** The recorded range, or null for no controlled range. */
function tempOf(b: SpiBox): string | null {
  const lo = b.temp_min_c, hi = b.temp_max_c;
  if (lo == null && hi == null) return null;
  const f = (v: unknown) => `${num(v)}°C`;
  if (lo != null && hi != null) return `${f(lo)} to ${f(hi)}`;
  return lo != null ? `${f(lo)} and above` : `up to ${f(hi)}`;
}

const TABS: Array<{ key: 'all' | Disposition; label: string; ico: ReactNode }> = [
  { key: 'all',      label: 'All',                            ico: <IcoBoxSm /> },
  { key: 'ship',     label: 'Dispatch',                       ico: <IcoTruck /> },
  { key: 'damaged',  label: 'Damage/Rejected',                ico: <IcoWarn /> },
  { key: 'mismatch', label: 'Mismatch',                       ico: <IcoSwap /> },
  { key: 'inv',      label: 'Inventory Stock (Extra Stock)',  ico: <IcoList /> },
];

/** How many lines the Products dialog shows at once. Past this it pages, so a
 *  carton with thirty lines cannot push the table off the screen. */
/* Stage 04 Step 02 is being DESIGNED, not wired. Its two reads come from a
 * static fixture so the full layout always draws - a screen that cannot be
 * seen cannot be reviewed. Flip this to false to put the live calls back; the
 * API functions and their types are untouched. */
const DEMO_DATA = true;

const PRODUCTS_PER_PAGE = 5;

/** The four steps of the right-hand pane. Only the rail ships in this piece. */
const LIFECYCLE = [
  { no: '01', label: 'Review Box',        sub: 'Box details & QR',
    hint: 'Check the box details and QR before choosing where to store it',
    todo: 'Box identification, storage conditions and the carton’s lines.' },
  { no: '02', label: 'Select Location',   sub: 'Shelf or zone',
    hint: 'Choose the zone, rack, shelf and bin this carton goes to',
    todo: 'Zone, rack, shelf and bin pickers, with the suggestions the warehouse returns.' },
  { no: '03', label: 'Confirm Placement', sub: 'Manual or scanner',
    hint: 'Scan the shelf label, or confirm the placement by hand',
    todo: 'Scan the shelf QR to confirm, or record the placement manually.' },
  { no: '04', label: 'Putaway Summary',   sub: 'Placed & recorded',
    hint: 'What was placed, where, and by whom',
    todo: 'The receipt for this carton: where it went, when, and who placed it.' },
];

export default function Step4PutawayAllocation({ draft, boxes, lines = [], flagMaster = [], spiId = null, warehouse, readOnly = false }: {
  /** Carried only so the read-only summary strip can report stages 1-3. */
  draft: InvoiceDraft;
  /** The cartons Step 03 produced. */
  boxes: SpiBox[];
  /** The invoice lines, for product identity: a box item carries only its
   *  supplier_invoice_item_id, so code / name / HSN have to be joined back. */
  lines?: ProductLine[];
  /** The product-flag master, for turning a box item's flag ids into names. */
  flagMaster?: ProductFlagOption[];
  /** The saved invoice, for asking the server where a box may go. Null on an
   *  invoice that has not been saved yet, where there is nothing to ask about. */
  spiId?: number | null;
  /** Printed on the sticker band. */
  warehouse?: string | null;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<'all' | Disposition>('all');
  /* Null means "not chosen yet", and an effect below settles it on the first
   * box still awaiting putaway. The step's whole job is to place boxes one
   * after another, so opening on an empty right pane asks the user to do a
   * click whose answer is never in doubt. */
  const [selected, setSelected] = useState<string | null>(null);
  /* Scenario is a THIRD filter, next to disposition and flag. It answers how
   * the carton was packed, which is what decides the handling at the shelf.
   * '' only ever lasts until the effect below settles it: the row has no "All"
   * tab, so leaving it empty would show a strip with nothing selected. */
  const [scn, setScn] = useState<'' | 's1' | 's2' | 's3'>('');
  const [leftOpen, setLeftOpen] = useState(true);
  /* Which of the four pane steps is current. Only Review Box exists so far, so
   * this is 0 until Select Location lands; it drives the rail's done/active/
   * pending states rather than the rail hard-coding step one. */
  const [lcStep, setLcStep] = useState(0);
  /* Full screen is the real Fullscreen API on the panels element, not a CSS
   * imitation: that is what the prototype does, and it is the only way the
   * browser's own Esc gets the user back out. */
  const panelsRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    /* Driven by the event, never by the click, because Esc and the browser's
     * own exit leave the element without telling the click handler. */
    const sync = () => setFs(document.fullscreenElement === panelsRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFs = () => {
    const el = panelsRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  };
  const [query, setQuery] = useState('');
  /* The chip row filters by handling FLAG, independently of the tab row above
   * it, which filters by disposition. Two different questions — "what kind of
   * stock is this" and "does it need special handling" — so they compose
   * rather than override each other. '' is no flag filter. */
  const [flag, setFlag] = useState<'' | 'haz' | 'nonhaz' | 'cold'>('');

  const all = useMemo(() => toPickBoxes(boxes, flagMaster), [boxes, flagMaster]);

  const counts = useMemo(() => ({
    all: all.length,
    ship: all.filter(b => b.type === 'ship').length,
    damaged: all.filter(b => b.type === 'damaged').length,
    mismatch: all.filter(b => b.type === 'mismatch').length,
    inv: all.filter(b => b.type === 'inv').length,
  }), [all]);

  /* What the progress block and the chip counts report: the disposition tab
   * narrowed by the scenario. The flag chip and the search sit UNDER those
   * numbers and narrow only the list, so they must not feed back into them. */
  const scope = all.filter(b =>
    (tab === 'all' || b.type === tab) && (scn === '' || b.scenarioKey === scn));

  const q = query.trim().toLowerCase();
  const shown = all.filter(b =>
    (tab === 'all' || b.type === tab)
    && (scn === '' || b.scenarioKey === scn)
    && (flag === '' || (flag === 'haz' ? b.haz : flag === 'nonhaz' ? !b.haz : b.cold))
    && (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)));

  /* The list reshapes around the disposition tab, because the question
   * changes with it. On ordinary stock the useful split is progress — what is
   * still owed against what is away. On the exception tabs it is the KIND of
   * exception, since those two piles are handled by different people.
   *
   * Empty sections stay on screen reading "None" rather than disappearing:
   * on a QC tab, "no damaged boxes" is the answer the user came for, and a
   * vanished heading looks like a page that failed to load. */
  const exceptionView = tab === 'damaged' || tab === 'mismatch';
  const group = exceptionView
    ? { cls: 'qc', icon: '🔧', title: 'QC Hold', sub: 'Flagged in Stage 03 — quarantine before putaway' }
    : tab === 'ship'
      ? { cls: 'dispatch', icon: '🚚', title: 'Dispatch', sub: 'Staged to ship — not entering storage' }
      : { cls: 'extra', icon: '📦', title: 'Inventory Storage', sub: 'Inbound — staged for temporary putaway' };

  const sections: Array<{ cls: string; label: string; rows: PickBox[] }> = exceptionView
    ? [
        { cls: 'damaged',  label: 'Damaged / Rejected',    rows: shown.filter(b => b.type === 'damaged') },
        { cls: 'mismatch', label: 'Miss-Matched / Return', rows: shown.filter(b => b.type === 'mismatch') },
      ]
    : [
        { cls: 'await',  label: 'Awaiting Putaway', rows: shown.filter(b => !b.location) },
        { cls: 'stored', label: 'Stored',           rows: shown.filter(b => !!b.location) },
      ].filter(s => s.rows.length > 0);

  const products = useMemo(
    () => productsOf(boxes.find(b => b.box_code === selected), lines, flagMaster),
    [boxes, selected, lines, flagMaster],
  );
  /* Closed again whenever the pane moves to another box - what was open
   * described the previous carton. */
  const [showProducts, setShowProducts] = useState(false);
  const [prodPage, setProdPage] = useState(1);
  /* The line whose detail dialog is open, by its index in products - an index
   * rather than the object so a refetch cannot leave a stale copy on screen. */
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  /* The sticker's code, opened large enough to scan off the screen. */
  const [qrOpen, setQrOpen] = useState(false);
  /* When this box's placement was committed. Null until Step 03 confirms it,
   * and reset with the rest when the pane moves to another carton. */
  const [placedAt, setPlacedAt] = useState<string | null>(null);
  /* Step 01 -> Step 02 asks WHERE first: on a shelf, or straight into a zone.
   * The two are different trees, so the answer has to come before the picker
   * can be drawn at all. Null means the chooser is closed. */
  const [modeAsk, setModeAsk] = useState<null | { loading: boolean; rack: number; norack: number; error: string | null }>(null);
  const [modePick, setModePick] = useState<'rack' | 'norack' | null>(null);
  /** Which tree Step 02 will draw, once chosen. */
  const [putMode, setPutMode] = useState<'rack' | 'norack' | null>(null);
  /* Step 02's own payload: the tree AND the engine's pick, in one call. */
  const [loc, setLoc] = useState<{ loading: boolean; data: PutawayLocations | null; error: string | null }>(
    { loading: false, data: null, error: null });
  /** The shelf the operator has settled on. Null until they choose. */
  const [spot, setSpot] = useState<number | null>(null);

  const detail = detailIdx == null ? null : products[detailIdx] ?? null;
  useEffect(() => {
    setShowProducts(false); setProdPage(1); setLcStep(0); setDetailIdx(null);
    setModeAsk(null); setModePick(null); setPutMode(null); setQrOpen(false); setPlacedAt(null);
  }, [selected]);
  const pageOfProducts = products.slice((prodPage - 1) * PRODUCTS_PER_PAGE, prodPage * PRODUCTS_PER_PAGE);

  const placed = scope.filter(b => b.location).length;
  const hazCount = scope.filter(b => b.haz).length;
  const coldCount = scope.filter(b => b.cold).length;
  const pct = scope.length ? Math.round((placed / scope.length) * 100) : 0;
  /* The box the right pane is working on. Nothing is auto-selected: the step
   * opens asking which box to put away, which is the question it exists to
   * answer. */
  const box = all.find(b => b.code === selected) ?? null;
  /* Open on the first box still owed, and recover if the chosen one leaves
   * the list (a filter changed, or it was placed). Depends on the codes
   * rather than the array so re-renders do not fight the user's pick. */
  const shownCodes = shown.map(b => b.code).join('|');
  const firstAwaiting = shown.find(b => !b.location)?.code ?? shown[0]?.code ?? null;
  useEffect(() => {
    if (selected && shownCodes.split('|').includes(selected)) return;
    setSelected(firstAwaiting);
  }, [firstAwaiting, selected, shownCodes]);

  useEffect(() => {
    if (lcStep !== 1 || !putMode) return;
    if (DEMO_DATA) { setLoc({ loading: false, data: DEMO_LOCATIONS, error: null }); setSpot(null); return; }
    if (!spiId || !box) return;
    let live = true;
    setLoc({ loading: true, data: null, error: null });
    setSpot(null);
    spiApi.putawayLocations(spiId, box.id, putMode)
      .then(d => { if (live) setLoc({ loading: false, data: d, error: null }); })
      .catch(e => { if (live) setLoc({ loading: false, data: null,
        error: e instanceof Error ? e.message : 'Could not read the warehouse layout.' }); });
    return () => { live = false; };
  }, [lcStep, putMode, spiId, box?.id]);

  /* The scenario row has no "All", so exactly one tab must be live. Settle on
   * the first scenario that actually holds boxes in the current disposition
   * tab, and move off a scenario the tab has emptied — otherwise switching to
   * Dispatch could leave a lit tab over an empty list. */
  const firstScn = (['s1', 's2', 's3'] as const).find(k =>
    all.some(b => (tab === 'all' || b.type === tab) && b.scenarioKey === k)) ?? '';
  useEffect(() => {
    if (scn !== '' && all.some(b => (tab === 'all' || b.type === tab) && b.scenarioKey === scn)) return;
    setScn(firstScn);
  }, [firstScn, scn, tab, all]);

  return (
    <div className="s4-root">
      {/* The same read-only recap the earlier steps carry, so arriving at the
          last step does not lose the thread of what came before. Three stages
          are behind us here, against Step 03's two. */}
      <StageSummary draft={draft} upto={3} />

      {/* ── Disposition tabs ──
          The app's own underline tabs (.spi-subtab, from p2p-common.css),
          the same ones the SPI list view uses, rather than the prototype's
          per-tab coloured pills. Two tab languages on one screen read as two
          different products; the list view is the house reference and this is
          the same module. */}
      {/* The SPI list view's own two-row pattern, reused rather than
          re-drawn: a segmented control on top (.spi-seg) and the quieter
          underline row beneath (.spi-subtab). Both come from
          p2p-common.css, which this form already loads. */}
      <div className="spi-segrow">
        <div className="spi-seg" role="tablist" aria-label="Box disposition">
          {TABS.map(t => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="spi-seg-ico">{t.ico}</span>
              {t.label}
              <span className="spi-seg-c">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Scenario row. Same filter idea as the tabs above, on the other
             axis: how the carton was packed. The Zebra chip rides the end of
             this row, where the prototype puts it. ── */}
      {/* The scenario row is the underline style, as the Figma has it — a
          second, quieter filter under the pills, laid straight on the page.
          .spi-subtabs brings its own baseline rule, which is all an underline
          row needs; a card around it added a second frame saying nothing. */}
      <div className="spi-sub">
        <div className="spi-subtabs" role="tablist" aria-label="Packing scenario">
          {/* Three scenarios, no "All": one is always selected, which is what
              gives the row its active state. The disposition row above is
              where "everything" lives; this row answers which packing shape
              you are working through, and a packer works through one shape at
              a time. */}
          {([
            ['s1', 'Scenario 1', SCENARIO_LABEL.s1],
            ['s2', 'Scenario 2', SCENARIO_LABEL.s2],
            ['s3', 'Scenario 3', SCENARIO_LABEL.s3],
          ] as const).map(([k, no, label]) => {
            /* Counted within the disposition tab, not across every box: the
               two rows read as one filter narrowing down, so a scenario
               showing 4 while its tab holds none would be the row above
               contradicting the row below. */
            const inTab = all.filter(b => tab === 'all' || b.type === tab);
            const n = inTab.filter(b => b.scenarioKey === k).length;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={scn === k}
                className={`spi-subtab ${scn === k ? 'is-active' : ''}`}
                onClick={() => setScn(k)}
              >
                <IcoBoxSm /> {`${no}: ${label}`}
                <span className="spi-subtab-c">{n}</span>
              </button>
            );
          })}
        </div>
        {/* Verification tasks queued for a Zebra scanner. The queue itself is
            a later piece; the count is honest at zero until then. */}
        <button
          type="button"
          className="s4ztq-btn s4ztq-btn--row"
          style={{ marginLeft: 'auto' }}
          aria-label="Zebra verification task queue"
        >
          <IcoScan /><span>Zebra tasks</span><b>0</b>
        </button>
      </div>

      {/* ── The two panels ── */}
      <div className={`s4-panels${fs ? ' is-fs' : ''}`} ref={panelsRef}>
        <div className="s4-panel s4-panel--left" style={leftOpen ? undefined : { flex: '0 0 52px' }}>
          <div className="s4-panel__head" onClick={() => setLeftOpen(o => !o)}>
            <div className="s4-panel__head-ico"><IcoBoxSm /></div>
            <div className="s4-panel__head-text">
              <div className="s4-panel__head-title">Pick a Box</div>
              <div className="s4-panel__head-sub">Choose the next box to put away</div>
            </div>
            <button
              type="button"
              className="s4-panel__toggle"
              title={leftOpen ? 'Collapse' : 'Expand'}
              onClick={e => { e.stopPropagation(); setLeftOpen(o => !o); }}
            >
              <IcoChevL />
            </button>
            <div className="s4-panel__collapsed-label">Pick a Box</div>
          </div>

          <div className="s4-panel__body s4-boxlist">
            {/* One teal card, as the Figma has it: progress, then the search,
                then the handling chips. The separate Filters button is gone -
                it only toggled a chip row that costs less to leave on screen
                than to hide behind a click. */}
            <div className="s4pk-top">
              <div className="s4pk-prog">
                <div
                  className={`s4pk-ring${`${placed}/${scope.length}`.length > 5 ? ' is-long' : ''}`}
                  style={{ ['--p' as string]: pct }}
                  role="img"
                  aria-label={`${placed} of ${scope.length} boxes placed`}
                >
                  <div><b>{placed}/{scope.length}</b><span>placed</span></div>
                </div>
                <div className="s4pk-prog__tx">
                  <div className="s4pk-prog__t">Putaway progress</div>
                  <div className="s4pk-prog__s">
                    <span className="pd">{scope.length - placed} not allocated</span>{' · '}
                    <span className="dn">{placed} placed</span>
                    {hazCount > 0 && <>{' · '}<span className="hz">{hazCount} hazardous</span></>}
                  </div>
                  <div className="s4pk-bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
              <div className="s4pk-search">
                <IcoSearch />
                <input
                  type="text"
                  placeholder="Search box ID or product…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              {/* Three handling flags, no "All". These are toggles, not a tab
                  row - clicking the lit one clears it, and "none lit" is the
                  resting state, so the row reads correctly with nothing on. */}
              <div className="s4pk-flags" role="group" aria-label="Handling filter">
                {([
                  ['haz',    'HAZ',        '⚠', hazCount],
                  ['nonhaz', 'NON-HAZ',    null, scope.length - hazCount],
                  ['cold',   'COLD CHAIN', '❄', coldCount],
                ] as const).map(([k, label, glyph, n]) => (
                  <button
                    key={k}
                    type="button"
                    className={`s4pk-fl s4pk-fl--${k === 'haz' ? 'haz' : k === 'cold' ? 'cold' : 'non'}${flag === k ? ' is-on' : ''}`}
                    aria-pressed={flag === k}
                    onClick={() => setFlag(f => (f === k ? '' : k))}
                  >
                    {glyph ? `${glyph} ${label}` : label} <b>{n}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className={`s4-grp-hdr s4-grp-hdr--${group.cls}`}>
              <div className="s4-grp-hdr__icon">{group.icon}</div>
              <div className="s4-grp-hdr__text">
                <div className="s4-grp-hdr__title">{group.title}</div>
                <div className="s4-grp-hdr__sub">{group.sub}</div>
              </div>
              <div className="s4-grp-hdr__count">{shown.length}</div>
            </div>

            {sections.map(sec => {
              /* The pinned card IS this box's row, not a second copy of it -
                 it sat above the section before and the box then appeared
                 twice, once pinned and once in the list under it. */
              const pinnedHere = box && sec.rows.some(b => b.code === box.code) ? box : null;
              const rows = pinnedHere ? sec.rows.filter(b => b.code !== pinnedHere.code) : sec.rows;
              const seqOf = (b: PickBox) => sec.rows.findIndex(r => r.code === b.code) + 1;
              return (
                <Fragment key={sec.cls}>
                  <div className={`s4-sec-hdr s4pk-sec s4pk-sec--${sec.cls}${sec.rows.length ? '' : ' is-empty'}`}>
                    <span className="s4pk-sec__dot" />
                    <span className="s4pk-sec__t">{sec.label}</span>
                    <span className="s4pk-sec__line" />
                    <span className="s4pk-sec__n">{sec.rows.length || 'None'}</span>
                  </div>

                  {/* The box the right pane is about, kept at the top of its
                      own section so it stays in view while the rest scrolls. */}
                  {pinnedHere && (
                    <div className="s4pin">
                      <div className="s4pin__hd">
                        <span className="s4pin__ic"><IcoPin /></span>
                        Pinned
                        <span className="s4pin__st">
                          Working on · Step {LIFECYCLE[lcStep].no} · {LIFECYCLE[lcStep].label}
                        </span>
                      </div>
                      <BoxCard
                        b={pinnedHere}
                        seq={seqOf(pinnedHere)}
                        selected
                        readOnly={readOnly}
                        className="s4pin__card"
                        onPick={() => {}}
                      />
                    </div>
                  )}

                  {rows.map(b => (
                    <BoxCard
                      key={b.id}
                      b={b}
                      seq={seqOf(b)}
                      selected={selected === b.code}
                      readOnly={readOnly}
                      onPick={() => setSelected(b.code)}
                    />
                  ))}
                </Fragment>
              );
            })}

            {shown.length === 0 && (
              <div className="s4pk-none">
                {all.length === 0
                  ? 'No boxes yet — pack cartons in Step 03 first.'
                  : query.trim()
                    ? 'No boxes match your search'
                    : 'No boxes in this view'}
              </div>
            )}
          </div>
        </div>

        {/* ── Right pane: header + lifecycle rail. Step bodies: next piece. ── */}
        <div className="s4-panel s4-panel--right">
          <div className="s4-panel__head">
            <div className="s4-panel__head-ico"><IcoGrid /></div>
            <div className="s4-panel__head-text">
              <div className="s4-panel__head-title">Temporary Putaway &amp; Rack Allocation</div>
              <div className="s4-panel__head-sub">Step-by-step placement workflow</div>
            </div>
            <button
              type="button"
              className="s4fs-btn"
              title={fs ? 'Exit full screen' : 'Full screen'}
              aria-pressed={fs}
              onClick={toggleFs}
            >
              {fs ? <IcoCollapse /> : <IcoExpand />}
              <span className="s4fs-t">{fs ? 'Exit full screen' : 'Full screen'}</span>
            </button>
            <span className="s4-panel__head-count">4 Steps</span>
          </div>

          <div className="s4-lifecycle">
            {LIFECYCLE.map((s, i) => {
              /* Every state rule in the CSS keys off data-state; the old
                 is-active class matched none of them, which is why each circle
                 rendered identically. Only Review Box is built, so nothing is
                 done yet - a green tick here would be a claim the step cannot
                 back up. */
              const state = i < lcStep ? 'done' : i === lcStep ? 'active' : 'pending';
              return (
                <Fragment key={s.no}>
                  <div className="s4-lc-step" data-state={state}>
                    <div className="s4-lc-step-num">Step {s.no}</div>
                    <div className="s4-lc-circle">{state === 'done' ? '✓' : s.no}</div>
                    <div className="s4-lc-texts">
                      <div className="s4-lc-label">{s.label}</div>
                      <div className="s4-lc-sub">{s.sub}</div>
                    </div>
                  </div>
                  {i < LIFECYCLE.length - 1
                    && <div className={`s4-lc-connector${i < lcStep ? ' is-done' : ''}`} />}
                </Fragment>
              );
            })}
          </div>

          <div className="s4-panel__body">
            {!box ? (
              <div className="s4pk-none">Pick a box on the left to start its putaway.</div>
            ) : (
              <div className="s4-c2-pane is-visible">
                {/* Step bar — which step this is, what it is for, and its state */}
                <div className="s4-pane-top">
                  <div className="s4-pane-top__left">
                    <span className="s4-pane-top__badge">Step {LIFECYCLE[lcStep].no}</span>
                    <div className="s4-pane-top__divider" />
                    <span className="s4-pane-top__title">{LIFECYCLE[lcStep].label}</span>
                    <div className="s4-pane-top__dot" />
                    <span className="s4-pane-top__sub">{LIFECYCLE[lcStep].hint}</span>
                  </div>
                  <span className="s4-pane-status s4-pane-status--active">Active</span>
                </div>

                <div className="s4h">
                  {/* Hero — the box being worked on */}
                  <div className="s4h-hero">
                    <div className="s4h-hero__id">
                      <div className="s4h-hero__ico"><IcoBoxSm size={21} /></div>
                      <div className="s4h-hero__txt">
                        <div className="s4h-hero__row">
                          <span className="s4h-chip">{box.code}</span>
                        </div>
                        <div className="s4h-hero__name">{box.name}</div>
                        <div className="s4h-hero__cat">
                          <span className="s4h-hero__sub">{box.scenario}</span>
                        </div>
                      </div>
                    </div>
                    {/* A sibling of the identity block, not a member of the
                        code's row: it is the status of the whole band, so it
                        centres against the band rather than against one line
                        of text inside it. */}
                    <span className="s4h-pend"><i />Awaiting putaway</span>
                  </div>

                  {lcStep === 1 ? (
                    <PutawaySelectLocation box={box} mode={putMode} state={loc} spot={spot} onSpot={setSpot} />
                  ) : lcStep === 2 ? (
                    <PutawayConfirmPlacement
                      box={{
                        code: box.code, scenario: box.scenario, skus: box.skus, qty: box.qty,
                        uom: box.uom, dims: box.dims, netKg: box.netKg, grossKg: box.grossKg,
                        condition: box.condition, products: products.length,
                      }}
                      spot={findSpot(loc.data, spot)}
                      warehouse={warehouse}
                      assigned={placedAt !== null}
                      qr={<BoxQr text={String(box.id)} size={150} />}
                      onChange={() => setLcStep(1)}
                      onMethod={() => setPlacedAt(new Date().toISOString())}
                      onViewProducts={() => setShowProducts(true)}
                    />
                  ) : lcStep > 0 ? (
                    <div className="s4-step-todo">
                      <b>{LIFECYCLE[lcStep].label}</b>
                      <span>{LIFECYCLE[lcStep].todo}</span>
                      {lcStep === 1 && putMode && (
                        <span className="s4-step-todo__pick">
                          Chosen: {putMode === 'rack'
                            ? 'Storage zone with rack — Zone › Rack › Shelf'
                            : 'Storage zone without rack — straight into the zone'}
                        </span>
                      )}
                    </div>
                  ) : (<>
                  {/* The two detail cards. The prototype builds three and then
                      remixes them: Box Identification goes two-column with the
                      sticker beside its rows, the Product & Physical card is
                      dropped (its lines live behind View Products), and
                      Storage & Warehouse is renumbered 03 → 02. This is that
                      end state, built directly. */}
                  <div className="s4s-grid s4s-grid--more">
                    <div className="s4s-card s4s-card--id">
                      <div className="s4s-hd">
                        <span className="s4s-hd__n">01</span>
                        <span className="s4s-hd__t">Box Identification</span>
                        <span className="s4s-hd__x" />
                      </div>
                      <div className="s4id2">
                        <div className="s4id2__l">
                          <div className="s4s-stk">
                            <div className="s4s-stk__band">
                              <span>TEMPORARY PUTAWAY</span>
                              <span>{warehouse || '—'}</span>
                            </div>
                            <div className="s4s-stk__body">
                              <div>
                                <div className="s4s-stk__id">{box.code}</div>
                                <div className="s4s-stk__qrwrap">
                                  <BoxQr text={String(box.id)} />
                                  <button
                                    type="button"
                                    className="s4s-stk__zoom"
                                    onClick={() => setQrOpen(true)}
                                    aria-label="Open the box QR code"
                                    title="Open the box QR code"
                                  >
                                    <IcoZoom />
                                  </button>
                                </div>
                                <div className="s4s-stk__code">{box.code}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="s4id2__r">
                          <KV k="Box Condition" v={<span className="s4bc s4bc--ok"><b>{condLabel(box.condition)}</b><i>{condNote(box.condition)}</i></span>} />
                          <KV k="Packaging scenario" v={box.scenario} />
                          <KV k="Total products in box" v={`${box.skus} Product${box.skus === 1 ? '' : 's'}`} />
                          <KV k="Total quantity in box" v={`${box.qty} ${box.uom || 'units'}`} />
                          <KV k="Dimensions (L×W×H)" v={box.dims || <span className="s4s-na">Not Available</span>} />
                          <KV k="Net weight" v={box.netKg || <span className="s4s-na">Not Available</span>} />
                          <KV k="Gross weight" v={box.grossKg || <span className="s4s-na">Not Available</span>} />
                          {/* The contents open in a dialog rather than a card
                              of their own: the cards beside it describe the
                              BOX, and a mixed carton can hold many lines. */}
                          <button
                            type="button"
                            className="s4vp-btn"
                            aria-haspopup="dialog"
                            onClick={() => setShowProducts(true)}
                          >
                            <IcoList />
                            View Products
                            <span className="s4vp-n">{products.length}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="s4s-card s4s-card--store">
                      <div className="s4s-hd">
                        <span className="s4s-hd__n">02</span>
                        <span className="s4s-hd__t">Storage &amp; Warehouse</span>
                      </div>
                      <KV k="Cold chain required" v={box.cold
                        ? <span className="s4s-pill s4s-pill--cold">❄ Yes</span>
                        : <span className="s4s-pill s4s-pill--pend">No</span>} />
                      <KV k="Temperature range" v={<span className="s4tu-val">{box.temp || 'No controlled range'}</span>} />
                      <KV k="Hazardous" v={box.haz
                        ? <span className="s4s-pill s4s-pill--bad">⚠ Yes</span>
                        : <span className="s4s-pill s4s-pill--pend">No</span>} />
                      <KV k="Stackable" v={box.stackable === null
                        ? <span className="s4s-na">Not Available</span>
                        : box.stackable
                          ? <span className="s4s-pill s4s-pill--ok">Yes</span>
                          : <span className="s4s-pill s4s-pill--bad">No</span>} />
                      <KV k="Warehouse" v={warehouse || <span className="s4s-na">Not Available</span>} />
                      {/* Where the carton came from: the supplier on the
                          invoice, and the step that packed it. */}
                      <KV k="Supplier / source" v={(draft.legalName || draft.supplier)
                        ? `${draft.legalName || draft.supplier} · SPI Temporary Box Packaging`
                        : <span className="s4s-na">Not Available</span>} />
                    </div>

                  </div>
                  </>)}
                </div>

                {/* The pane's own step navigation. The wizard's footer below
                    moves between STAGES; this moves between the four steps of
                    this one, which is the only control that reaches them in
                    full screen, where the wizard footer is off the screen. */}
                <div className="s4-pane-footer">
                  <button
                    type="button"
                    className="s4-btn-back"
                    disabled={lcStep === 0}
                    onClick={() => setLcStep(n => Math.max(0, n - 1))}
                  >
                    <IcoChevL /> Back
                  </button>
                  <button
                    type="button"
                    className="s4-btn-next"
                    /* Step 02 cannot be left without an answer: the step exists
                       to choose a spot, from the recommendation or from the
                       tree, and the two write the same value. */
                    disabled={lcStep >= LIFECYCLE.length - 1 || (lcStep === 1 && spot === null)}
                    title={lcStep === 1 && spot === null
                      ? 'Choose a spot first — use the recommended one, or pick a shelf from the tree'
                      : undefined}
                    onClick={() => {
                      if (lcStep !== 0) { setLcStep(n => Math.min(LIFECYCLE.length - 1, n + 1)); return; }
                      /* Step 02 draws one of two different trees, so which one
                         has to be settled before it can be drawn at all. */
                      setModePick(null);
                      if (DEMO_DATA) {
                        setModeAsk({ loading: false, ...DEMO_MODES, error: null });
                        return;
                      }
                      setModeAsk({ loading: true, rack: 0, norack: 0, error: null });
                      if (!spiId || !box) {
                        setModeAsk({ loading: false, rack: 0, norack: 0, error: 'Save the invoice before allocating boxes.' });
                        return;
                      }
                      spiApi.putawayModes(spiId, box.id)
                        .then(m => {
                          setModeAsk({ loading: false, rack: m.rack, norack: m.norack, error: null });
                          /* Pre-select the only workable answer rather than
                             making the user click the one option they have. */
                          if (m.rack > 0 && m.norack === 0) setModePick('rack');
                          else if (m.norack > 0 && m.rack === 0) setModePick('norack');
                        })
                        .catch(e => setModeAsk({
                          loading: false, rack: 0, norack: 0,
                          error: e instanceof Error ? e.message : 'Could not read the warehouse layout.',
                        }));
                    }}
                  >
                    {lcStep >= LIFECYCLE.length - 1
                      ? 'Putaway complete'
                      : `Next: ${LIFECYCLE[lcStep + 1].label}`}
                    <IcoChevR />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── "Products in this Box" ── Lifted from the prototype: the shell is
             the shared .s4qm dialog, .s4vp-modal carries its own treatment.
             Kept inside .s4-root so the scoped CSS reaches it; it is
             position:fixed, so being nested costs it nothing. */}
      {showProducts && box && (
        <div
          className="s4qm s4vp-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-label="Products in this box"
        >
          <div className="s4qm__dlg s4vp__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico"><IcoBoxSm /></div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Products in this Box</div>
                <div className="s4qm__s">{box.code} · {box.scenario}</div>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setShowProducts(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              <div className="s4vp-sum">
                <div className="s4vp-st s4vp-st--a">
                  <span className="s4vp-st__ic"><IcoBoxSm /></span>
                  <div><span>Total products in box</span><b>{products.length}</b></div>
                </div>
                <div className="s4vp-st s4vp-st--b">
                  <span className="s4vp-st__ic"><IcoSwap /></span>
                  <div><span>Box scenario</span><b>{box.scenario}</b></div>
                </div>
                <div className="s4vp-st s4vp-st--c">
                  <span className="s4vp-st__ic"><IcoUnits /></span>
                  <div><span>Total quantity in box</span><b>{box.qty} {box.uom || 'units'}</b></div>
                </div>
              </div>

              {products.length ? (
                <div className="s4mx-tbl">
                  <div className="s4mx-tr s4mx-tr--hd">
                    <span>Sr. No.</span>
                    <span>Product Code</span>
                    <span>Product Name</span>
                    <span>Product Description</span>
                    <span>Quantity</span>
                    <span>UOM</span>
                    <span>View</span>
                  </div>
                  {pageOfProducts.map((pr, n) => (
                    <ProductRow
                      key={`${pr.code}-${n}`}
                      p={pr}
                      /* Numbered across the whole box, not within the page, so
                         row 6 reads as the sixth line and not as the first. */
                      n={(prodPage - 1) * PRODUCTS_PER_PAGE + n + 1}
                      onView={() => setDetailIdx((prodPage - 1) * PRODUCTS_PER_PAGE + n)}
                    />
                  ))}
                </div>
              ) : (
                <div className="s4vp-none">This box has no lines against it.</div>
              )}

              {products.length > PRODUCTS_PER_PAGE && (
                <WorklistPager
                  className="s4vp-pager"
                  total={products.length}
                  page={prodPage}
                  pageSize={PRODUCTS_PER_PAGE}
                  onPage={setProdPage}
                />
              )}

              <div className="s4vp-hint">Click View on a product line to see its details</div>
            </div>
          </div>
        </div>
      )}

      {/* ── The box's code, large ── A sticker printed at 76px cannot be
             scanned off a screen; this is the same payload at a size a
             handset can read, with what it identifies spelled out. */}
      {qrOpen && box && (
        <div
          className="s4qm s4qm-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-label="Box QR code"
        >
          <div className="s4qm__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico"><IcoScan /></div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Box QR Code</div>
                <div className="s4qm__s">Temporary putaway box identification</div>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setQrOpen(false)} aria-label="Close">&times;</button>
            </div>

            <div className="s4qm__bd">
              <div className="s4qm__qr"><BoxQr text={String(box.id)} size={200} /></div>
              <div className="s4qm__id">{box.code}</div>
              {/* The sticker encodes the box id, not its code - the same value
                  the printed label carries, so both resolve to one record. */}
              <div className="s4qm__pl">Encoded value · <b>{box.id}</b></div>

              <div className="s4qm__kvs">
                <div className="s4qm__kv"><span>Product</span><b>{box.name}</b></div>
                <div className="s4qm__kv"><span>Box type</span><b>{box.type === 'ship' ? 'Dispatch' : box.type === 'damaged' ? 'QC hold' : box.type === 'mismatch' ? 'Return' : 'Inventory'}</b></div>
              </div>
            </div>

            <div className="s4qm__ft">
              <button type="button" className="s4-btn-back" onClick={() => setQrOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Where does this box go? ── Asked on the way from Step 01 to Step
             02, because the two answers draw different pickers: a shelf under
             Zone > Rack > Shelf, or the zone floor itself. The counts come
             from the server, which knows which places this box actually fits
             - a cold-chain carton cannot go just anywhere. */}
      {modeAsk && box && (
        <div
          className="s4qm s4wz-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-label="Where do you want to store this box?"
        >
          <div className="s4qm__dlg s4wz__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico">?</div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Where do you want to store this box?</div>
                <div className="s4qm__s">{box.code}</div>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setModeAsk(null)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              <div className="s4wz-lead">
                Choose the storage zone type for Step 02 · {LIFECYCLE[1].label}
              </div>

              {modeAsk.error ? (
                <div className="s4vp-none">{modeAsk.error}</div>
              ) : modeAsk.loading ? (
                <div className="s4vp-none">Reading the warehouse layout…</div>
              ) : (
                <div className="s4wz-opts">
                  {([
                    ['rack', 'Storage Zone with Rack', 'Place the box on a shelf · Zone › Rack › Shelf',
                      modeAsk.rack, modeAsk.rack === 1 ? 'shelf' : 'shelves'],
                    ['norack', 'Storage Zone without Rack', 'Place the box directly in the zone · no rack or shelf',
                      modeAsk.norack, modeAsk.norack === 1 ? 'zone' : 'zones'],
                  ] as const).map(([k, title, sub, n, unit]) => (
                    <button
                      type="button"
                      key={k}
                      className={`s4wz-opt s4wz-opt--${k}${modePick === k ? ' is-on' : ''}`}
                      /* Nowhere to put it is a reason to grey the card, not to
                         hide it: "no racks are set up" is the answer. */
                      disabled={n === 0}
                      aria-pressed={modePick === k}
                      onClick={() => setModePick(k)}
                    >
                      <span className="s4wz-opt__ic">{k === 'rack' ? <IcoList /> : <IcoBoxSm size={16} />}</span>
                      <span className="s4wz-opt__radio" aria-hidden />
                      <span className="s4wz-opt__t">{title}</span>
                      {/* Shelving is the normal path, so it carries the badge
                          whenever it is actually available. */}
                      {k === 'rack' && modeAsk.rack > 0 && <span className="s4wz-opt__rec">&#9733; Recommended</span>}
                      <span className="s4wz-opt__s">{sub}</span>
                      <span className="s4wz-opt__n">{n === 0 ? `No ${unit} available` : `${n} ${unit}`}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="s4qm__ft">
              <button type="button" className="s4-btn-back" onClick={() => setModeAsk(null)}>Cancel</button>
              <button
                type="button"
                className="s4-btn-next"
                disabled={!modePick}
                onClick={() => { setPutMode(modePick); setModeAsk(null); setLcStep(1); }}
              >
                Continue to {LIFECYCLE[1].label} <IcoChevR />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── One line's full record ── Opens over the Products dialog rather
             than replacing it, so closing this returns to the list the user
             was reading rather than to the card. */}
      {detail && box && (
        <div
          className="s4qm s4pd-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-label="Product details"
        >
          <div className="s4qm__dlg s4pd__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico"><IcoBoxSm size={18} /></div>
              <div className="s4qm__htx">
                <div className="s4pd__eyebrow">Product details · {box.code}</div>
                <div className="s4qm__t">{detail.name}</div>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setDetailIdx(null)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              <div className="s4pd-sum">
                <div className="s4pd-st s4pd-st--a">
                  <span className="s4pd-st__k"><i className="s4pd-st__ic">&lt;/&gt;</i>Product code</span>
                  <b className="s4pd-st__code">{detail.code}</b>
                </div>
                <div className="s4pd-st s4pd-st--b">
                  <span className="s4pd-st__k"><i className="s4pd-st__ic"><IcoUnits /></i>Quantity</span>
                  <b>{detail.qtyNum} {detail.uom ?? 'units'}</b>
                </div>
                <div className="s4pd-st s4pd-st--c">
                  <span className="s4pd-st__k"><i className="s4pd-st__ic">#</i>HSN code</span>
                  <b>{detail.hsn === '—' ? <em className="s4pd-na">Not available</em> : detail.hsn}</b>
                </div>
                <div className="s4pd-st s4pd-st--d">
                  <span className="s4pd-st__k"><i className="s4pd-st__ic">&#10003;</i>Remark</span>
                  <b><span className={`s4pd-rm${detail.remark === 'Correct Product' ? ' is-ok' : ''}`}>{detail.remark}</span></b>
                </div>
              </div>

              <section className="s4pd-card">
                <div className="s4pd-card__t">Handling &amp; storage flags</div>
                <div className="s4pd-flgs">
                  {([
                    ['Hazardous', detail.haz],
                    ['Cold chain', detail.cold],
                    ['Fragile', detail.fragile],
                    ['Stackable', detail.stackable],
                  ] as const).map(([k, v]) => (
                    <div className={`s4pd-flg${v === true ? ' is-on' : ''}`} key={k}>
                      <i className="s4pd-flg__ic" aria-hidden />
                      <div>
                        <b>{k}</b>
                        <span>{v === null ? 'Not recorded' : v ? 'Yes' : 'No'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="s4pd-card">
                <div className="s4pd-card__t">
                  Advanced details
                  {/* The packer fills these at the bench and usually fills
                      none, so the count says so plainly instead of leaving
                      seven identical empty boxes to be read one by one. */}
                  <span className="s4pd-cap">
                    <i><b style={{ width: `${Math.round(detail.advanced.filter(([, v]) => v).length / detail.advanced.length * 100)}%` }} /></i>
                    {detail.advanced.filter(([, v]) => v).length} of {detail.advanced.length} captured
                  </span>
                </div>
                <div className="s4pd-fields">
                  {detail.advanced.map(([k, v], i) => (
                    <div
                      className={`s4pd-f${v ? '' : ' is-empty'}${k === 'Remarks' ? ' s4pd-f--wide' : ''}`}
                      key={`${k}-${i}`}
                    >
                      <span>{k}</span>
                      <b>{v ?? 'Not entered'}</b>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
