import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  spiApi, type ProductFlagOption, type PutawayBoard, type PutawayLocations, type PutawayStatus, type SpiBox, type SpiBoxItem,
} from '../spi-api';
import type { ProductLine } from '../invoice-products';
import type { InvoiceDraft } from '../invoice-draft';
import StageSummary from './StageSummary';
import PutawaySelectLocation from './PutawaySelectLocation';
import PutawayConfirmPlacement, { findSpot } from './PutawayConfirmPlacement';
import PutawayScanTask from './PutawayScanTask';
import InspectionProductView from '../../order/physical-inspection/InspectionProductView';
import WorklistPager from '../../../../../components/ui/WorklistPager';
import { PoApiError } from '../../order/api/po-api';

type Disposition = 'ship' | 'inv' | 'damaged' | 'mismatch';

interface PickBox {
  id: number;
  code: string;
  scenario: string;
  scenarioKey: string;
  type: Disposition;
  name: string;
  skus: number;
  qty: number;
  haz: boolean;
  cold: boolean;
  location: string | null;
  status: PutawayStatus;
  destination: string | null;
  taskCode: string | null;
  productNames: string[];
  productCodes: string[];
  condition: string;
  dims: string | null;
  uom: string | null;
  stackable: boolean | null;
  temp: string | null;
  netKg: string | null;
  grossKg: string | null;
}

const SCENARIO_LABEL: Record<string, string> = {
  s1: '1 Product → 1 Box',
  s2: '1 Product → Multiple Boxes',
  s3: 'Multiple Products → 1 Box',
};

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
/** Puts a dialog inside the full-screened element.
 *
 *  In full screen the browser paints ONLY that element's subtree. Every dialog
 *  on this step is a sibling of `.s4-panels`, which is the element that goes
 *  full screen - so all of them opened invisibly behind it. `position: fixed`
 *  does not help: the issue is what gets rendered, not where it is placed.
 *
 *  Outside full screen `host` is null and nothing moves. */
function FsLayer({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  return host ? createPortal(children, host) : <>{children}</>;
}

const IcoWh = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><rect x="9" y="14" width="6" height="7" />
  </svg>
);
const IcoFlag = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);
const IcoShelfSm = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="1.5" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="3" y1="15.5" x2="21" y2="15.5" />
  </svg>
);
const IcoArrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
  </svg>
);
const IcoCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
/** The manual option: a hand placing the box, against the scanner's device. */
const IcoHand = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v9" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-1a2 2 0 1 1 4 0" />
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
            : <span className="s4pk-st s4pk-st--pend" title={b.destination ?? undefined}>
              <i />{b.status === 'awaiting_scan' ? 'Awaiting scan' : b.status === 'draft' ? 'Allocated' : 'Pending'}
            </span>}
        </div>
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

interface BoxProduct {
  code: string; name: string; hsn: string;
  batch: string | null; expiry: string | null;
  desc: string | null;
  qtyNum: string; uom: string | null;
  productId: number | null;
  remark: string;
  haz: boolean; cold: boolean; fragile: boolean;
  stackable: boolean | null;
  extraFlags: string[];
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
      expiry: it.expiry_date ? String(it.expiry_date).slice(0, 10) : null,
      desc: dash(line?.description),
      qtyNum: String(num(it.quantity)),
      uom: dash(line?.uom),
      productId: line?.productId ?? null,
      remark: REMARK_LABEL[String(it.remark ?? '')] ?? 'Not marked',
      haz: isHaz(flagNames([it], flagMaster)),
      cold: isCold(flagNames([it], flagMaster)),
      fragile: isFragile(flagNames([it], flagMaster)),
      stackable: it.is_stackable == null ? null : !!it.is_stackable,
      extraFlags: extraFlagNames([it], flagMaster),
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

function ProductRow({ p, n, onView, onOpenProduct }: {
  p: BoxProduct; n: number; onView: () => void; onOpenProduct: (id: number) => void;
}) {
  const [full, setFull] = useState(false);
  return (
    <div className="s4mx-row">
      <div className="s4mx-tr">
        <span className="s4mx-sr"><i className="s4mx-no">{n}</i></span>
        <span className="s4mx-pc">
          <span className="s4mx-pc__nm">{p.name}</span>
          <span className="s4mx-pc__meta">
            <span className="s4vp-code">{p.code}</span>
          </span>
        </span>
        <span className={`s4mx-dw${full ? ' is-open' : ''}`}>
          <span className="s4mx-ds">{p.desc ?? 'No description recorded'}</span>
          {p.productId != null ? (
            <button type="button" className="s4mx-rm" onClick={() => onOpenProduct(p.productId!)}>
              Read more
            </button>
          ) : p.desc !== null && (
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

const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="s4s-kv">
    <span className="s4s-kv__k">{k}</span>
    <span className="s4s-kv__v">{v}</span>
  </div>
);

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

function flagNames(items: SpiBoxItem[], master: ProductFlagOption[]): string[] {
  const byId = new Map(master.map(f => [f.id, (f.flag_name ?? '').toLowerCase()]));
  return items.flatMap(it => (Array.isArray(it.flags) ? it.flags : []))
    .map(id => byId.get(Number(id)) ?? '')
    .filter(Boolean);
}

const isHaz = (names: string[]) => names.some(f => f.includes('haz'));
const isCold = (names: string[]) => names.some(f => f.includes('cold') || f.includes('chill') || f.includes('frozen'));
const isFragile = (names: string[]) => names.some(f => f.includes('fragile') || f.includes('brittle'));

function extraFlagNames(items: SpiBoxItem[], master: ProductFlagOption[]): string[] {
  const byId = new Map(master.map(f => [f.id, (f.flag_name ?? '').trim()]));
  const known = (n: string) => isHaz([n]) || isCold([n]) || isFragile([n]) || n.includes('stack');
  const out: string[] = [];
  for (const it of items) {
    for (const id of Array.isArray(it.flags) ? it.flags : []) {
      const name = byId.get(Number(id)) ?? '';
      if (!name || known(name.toLowerCase())) continue;
      if (!out.some(o => o.toLowerCase() === name.toLowerCase())) out.push(name);
    }
  }
  return out;
}

function dispositionOf(items: SpiBoxItem[], againstPo: boolean): Disposition {
  const remarks = items.map(it => it.remark ?? 'correct');
  if (remarks.includes('damaged')) return 'damaged';
  if (remarks.includes('mismatched')) return 'mismatch';
  if (remarks.includes('extra')) return 'inv';
  return againstPo ? 'ship' : 'inv';
}

function toPickBoxes(
  boxes: SpiBox[], flagMaster: ProductFlagOption[], lines: ProductLine[], board: PutawayBoard | null, againstPo: boolean,
): PickBox[] {
  const lineOf = new Map(lines.filter(l => l.spiItemId != null).map(l => [l.spiItemId as number, l]));
  const placeOf = new Map((board?.boxes ?? []).map(row => [row.box_id, row]));
  return boxes.map(b => {
    const items = Array.isArray(b.items) ? b.items : [];
    const qty = items.reduce((t, it) => t + num((it as { quantity?: unknown }).quantity), 0);
    const itemLines = items.map(it => lineOf.get(it.supplier_invoice_item_id));
    const names = itemLines.map(l => (l?.spiName || l?.poName || l?.piName || '').trim()).filter(Boolean);
    const codes = itemLines.map(l => (l?.code ?? '').trim()).filter(Boolean);
    const flags = flagNames(items, flagMaster);
    const cond = String(b.condition ?? '').toLowerCase();
    const place = placeOf.get(b.id);
    const status: PutawayStatus = place?.status ?? 'pending';
    const hasRange = b.temp_min_c != null || b.temp_max_c != null;
    return {
      id: b.id,
      code: b.box_code,
      scenario: SCENARIO_LABEL[b.scenario] ?? b.scenario,
      scenarioKey: b.scenario,
      type: dispositionOf(items, againstPo),
      name: names.length > 1 ? `${names[0]}  +${names.length - 1} more` : (names[0] || '—'),
      skus: items.length,
      qty,
      haz: isHaz(flags),
      cold: isCold(flags) || hasRange,
      location: status === 'placed' ? (place?.destination ?? 'Placed') : null,
      status,
      destination: place?.destination ?? null,
      taskCode: place?.task?.task_code ?? null,
      productNames: names,
      productCodes: codes,
      condition: cond || 'perfect',
      dims: dimsOf(b),
      uom: singleUom(items),
      stackable: b.is_stackable == null ? null : !!b.is_stackable,
      temp: tempOf(b),
      netKg: kg(b.net_weight_kg),
      grossKg: kg(b.gross_weight_kg),
    };
  });
}

function kg(v: unknown): string | null {
  const n = num(v);
  return n ? `${Number.isInteger(n) ? n : n.toFixed(2)} kg` : null;
}

function dimsOf(b: SpiBox): string | null {
  const L = num(b.length_cm), W = num(b.width_cm), H = num(b.height_cm);
  if (!L || !W || !H) return null;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return `${n(L)} × ${n(W)} × ${n(H)} cm`;
}

function singleUom(items: SpiBoxItem[]): string | null {
  const set = new Set(items.map(it => String((it as { uom?: unknown }).uom ?? '').trim()).filter(Boolean));
  return set.size === 1 ? [...set][0] : null;
}

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


const PRODUCTS_PER_PAGE = 5;

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
  draft: InvoiceDraft;
  boxes: SpiBox[];
  lines?: ProductLine[];
  flagMaster?: ProductFlagOption[];
  spiId?: number | null;
  warehouse?: string | null;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<'all' | Disposition>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [scn, setScn] = useState<'' | 's1' | 's2' | 's3'>('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [lcStep, setLcStep] = useState(0);
  const panelsRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  useEffect(() => {
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
  const [flag, setFlag] = useState<'' | 'haz' | 'nonhaz' | 'cold'>('');

  const [board, setBoard] = useState<PutawayBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const boxKey = boxes.map(b => `${b.id}:${(b.items ?? []).map(i => i.quantity).join(',')}`).join('|');
  useEffect(() => {
    if (!spiId) return;
    let live = true;
    spiApi.putawayBoard(spiId)
      .then(d => { if (live) { setBoard(d); setBoardError(null); } })
      .catch(e => { if (live) setBoardError(e instanceof Error ? e.message : 'Could not load the putaway status.'); });
    return () => { live = false; };
  }, [spiId, boxKey]);

  const againstPo = !!draft.poNumber;
  const all = useMemo(
    () => toPickBoxes(boxes, flagMaster, lines, board, againstPo),
    [boxes, flagMaster, lines, board, againstPo],
  );
  const zebraOpen = (board?.boxes ?? []).filter(row => row.task).length;

  const counts = useMemo(() => ({
    all: all.length,
    ship: all.filter(b => b.type === 'ship').length,
    damaged: all.filter(b => b.type === 'damaged').length,
    mismatch: all.filter(b => b.type === 'mismatch').length,
    inv: all.filter(b => b.type === 'inv').length,
  }), [all]);

  const scope = all.filter(b =>
    (tab === 'all' || b.type === tab) && (scn === '' || b.scenarioKey === scn));

  const q = query.trim().toLowerCase();
  const shown = all.filter(b =>
    (tab === 'all' || b.type === tab)
    && (scn === '' || b.scenarioKey === scn)
    && (flag === '' || (flag === 'haz' ? b.haz : flag === 'nonhaz' ? !b.haz : b.cold))
    && (!q || [b.code, b.scenario, b.destination ?? '', ...b.productNames, ...b.productCodes]
      .some(v => v.toLowerCase().includes(q))));

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
  const [showProducts, setShowProducts] = useState(false);
  const [prodPage, setProdPage] = useState(1);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [placedAt, setPlacedAt] = useState<string | null>(null);
  /* How the placement gets confirmed. The two answers are not the same event:
     a manual confirmation IS the placement, a Zebra scan only queues one for
     the floor to verify - so the box is not placed until the scan comes back.
     Confirming straight off the button conflated the two. */
  const [methodAsk, setMethodAsk] = useState(false);
  const [methodPick, setMethodPick] = useState<'zebra' | 'manual' | null>(null);
  /* The tick is the consent, not the button. Picking a method only says HOW;
     this says the operator has read what it locks. It resets whenever the
     method changes, because it was given about that method. */
  const [methodOk, setMethodOk] = useState(false);
  /* The raised Zebra task. An object, not a flag: the screen has to name the
     task, and "which one" is the first thing an operator asks about it. */
  const [scanTask, setScanTask] = useState<{ id: string; at: string } | null>(null);
  /* The scan-task dialog is the next piece; the button that opens it is wired
     here so the state it reads already exists. */
  const [scanOpen, setScanOpen] = useState(false);
  /* Set when a Zebra task completes, so the finished screen can say HOW the
     box was placed. A manual confirmation leaves it null. */
  const [placedVia, setPlacedVia] = useState<{ via: string; allocation: string } | null>(null);
  const [productViewId, setProductViewId] = useState<number | null>(null);
  const [modeAsk, setModeAsk] = useState<null | { loading: boolean; rack: number; norack: number; error: string | null }>(null);
  const [modePick, setModePick] = useState<'rack' | 'norack' | null>(null);
  const [putMode, setPutMode] = useState<'rack' | 'norack' | null>(null);
  const [loc, setLoc] = useState<{ loading: boolean; data: PutawayLocations | null; error: string | null }>(
    { loading: false, data: null, error: null });
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
  const box = all.find(b => b.code === selected) ?? null;
  const shownCodes = shown.map(b => b.code).join('|');
  const firstAwaiting = shown.find(b => !b.location)?.code ?? shown[0]?.code ?? null;
  useEffect(() => {
    if (selected && shownCodes.split('|').includes(selected)) return;
    setSelected(firstAwaiting);
  }, [firstAwaiting, selected, shownCodes]);

  useEffect(() => {
    if (lcStep !== 1 || !putMode) return;
    if (!spiId || !box) return;
    let live = true;
    setLoc({ loading: true, data: null, error: null });
    setSpot(null);
    spiApi.putawayLocations(spiId, box.id, putMode)
      .then(d => { if (live) setLoc({ loading: false, data: d, error: null }); })
      .catch(e => { if (live) setLoc({ loading: false, data: null,
        error: e instanceof PoApiError ? e.firstError
          : e instanceof Error ? e.message : 'Could not read the warehouse layout.' }); });
    return () => { live = false; };
  }, [lcStep, putMode, spiId, box?.id]);

  const firstScn = (['s1', 's2', 's3'] as const).find(k =>
    all.some(b => (tab === 'all' || b.type === tab) && b.scenarioKey === k)) ?? '';
  useEffect(() => {
    if (scn !== '' && all.some(b => (tab === 'all' || b.type === tab) && b.scenarioKey === scn)) return;
    setScn(firstScn);
  }, [firstScn, scn, tab, all]);

  return (
    <div className="s4-root">
      <StageSummary draft={draft} upto={3} />

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

      <div className="spi-sub">
        <div className="spi-subtabs" role="tablist" aria-label="Packing scenario">
          {([
            ['s1', 'Scenario 1', SCENARIO_LABEL.s1],
            ['s2', 'Scenario 2', SCENARIO_LABEL.s2],
            ['s3', 'Scenario 3', SCENARIO_LABEL.s3],
          ] as const).map(([k, no, label]) => {
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
        <button
          type="button"
          className="s4ztq-btn s4ztq-btn--row"
          style={{ marginLeft: 'auto' }}
          aria-label="Zebra verification task queue"
        >
          <IcoScan /><span>Zebra tasks</span><b>{zebraOpen}</b>
        </button>
      </div>

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
                    {boardError && <>{' · '}<span className="hz" title={boardError}>status not loaded</span></>}
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
                  {/* Steps 02 and 03 each open with their own teal band that
                      already names the box and carries its state - the "where
                      should this box go?" bar and the route strip. This one
                      above them was the same band twice with the same B-003
                      in it, so it only shows where nothing repeats it. */}
                  {lcStep !== 1 && lcStep !== 2 && (
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
                    <span className="s4h-pend">
                      <i />{box.status === 'placed' ? 'Placed' : box.status === 'awaiting_scan' ? 'Awaiting Zebra scan'
                        : box.status === 'draft' ? 'Location allocated' : 'Awaiting putaway'}
                    </span>
                  </div>
                  )}

                  {lcStep === 1 ? (
                    <PutawaySelectLocation
                      box={{
                        ...box,
                        /* Both from the hero band this bar replaced. */
                        scenario: box.scenario,
                        status: box.status === 'placed' ? 'Placed'
                          : box.status === 'awaiting_scan' ? 'Awaiting Zebra scan'
                          : box.status === 'draft' ? 'Location allocated'
                          : 'Awaiting putaway',
                      }}
                      mode={putMode} state={loc} spot={spot} onSpot={setSpot}
                    />
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
                      qr={<BoxQr text={String(box.id)} size={128} />}
                      onChange={() => setLcStep(1)}
                      scan={scanTask}
                      placedVia={placedVia}
                      warehouseCode={warehouse || null}
                      onMethod={() => { setMethodPick(null); setMethodOk(false); setMethodAsk(true); }}
                      onCancelTask={() => setScanTask(null)}
                      onOpenScanTask={() => setScanOpen(true)}
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
                      <KV k="Supplier / source" v={(draft.legalName || draft.supplier)
                        ? `${draft.legalName || draft.supplier} · SPI Temporary Box Packaging`
                        : <span className="s4s-na">Not Available</span>} />
                    </div>

                  </div>
                  </>)}
                </div>

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
                    disabled={lcStep >= LIFECYCLE.length - 1 || (lcStep === 1 && spot === null)}
                    title={lcStep === 1 && spot === null
                      ? 'Choose a spot first — use the recommended one, or pick a shelf from the tree'
                      : undefined}
                    onClick={() => {
                      if (lcStep !== 0) { setLcStep(n => Math.min(LIFECYCLE.length - 1, n + 1)); return; }
                      setModePick(null);
                      setModeAsk({ loading: true, rack: 0, norack: 0, error: null });
                      if (!spiId || !box) {
                        setModeAsk({ loading: false, rack: 0, norack: 0, error: 'Save the invoice before allocating boxes.' });
                        return;
                      }
                      spiApi.putawayModes(spiId, box.id)
                        .then(m => {
                          setModeAsk({ loading: false, rack: m.rack, norack: m.norack, error: null });
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

      {/* Every dialog on this step, moved as a group into the full-screened
          element when full screen is on. One wrapper rather than six, so a
          dialog added later cannot be forgotten. */}
      <FsLayer host={fs ? panelsRef.current : null}>
      {scanOpen && scanTask && box && findSpot(loc.data, spot) && (() => {
        const sp = findSpot(loc.data, spot)!;
        /* What this box takes off the shelf, which is what the task holds
           against it until the scans come back. */
        const reserved = Math.max(0, Math.round((sp.shelf.used_pct_after - sp.shelf.used_pct) * 10) / 10);
        return (
          <PutawayScanTask
            taskId={scanTask.id}
            createdAt={new Date(scanTask.at).toLocaleString('en-GB',
              { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
              .replace(',', ' ·')}
            box={{ code: box.code, name: box.name }}
            spot={{
              warehouse: warehouse || null,
              zone: sp.zone.code, rack: sp.rack.code,
              shelf: sp.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1'),
              shelfName: sp.shelf.name || `Level ${sp.shelf.level_no}`,
            }}
            reservedPct={reserved}
            onClose={() => setScanOpen(false)}
            onComplete={() => {
              /* Both labels read: the box IS on the shelf now, so this is the
                 moment it becomes placed - not when the task was raised. */
              setPlacedAt(new Date().toISOString());
              setPlacedVia({
                via: 'Using Zebra Device',
                allocation: `TPA-${scanTask.id.slice(3, 11)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
              });
              setScanTask(null);
              setScanOpen(false);
            }}
          />
        );
      })()}

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
                    <span>Product</span>
                    <span>Product Description</span>
                    <span>Quantity</span>
                    <span>UOM</span>
                    <span>View</span>
                  </div>
                  {pageOfProducts.map((pr, n) => (
                    <ProductRow
                      key={`${pr.code}-${n}`}
                      p={pr}
                      n={(prodPage - 1) * PRODUCTS_PER_PAGE + n + 1}
                      onView={() => setDetailIdx((prodPage - 1) * PRODUCTS_PER_PAGE + n)}
                      onOpenProduct={setProductViewId}
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

      {productViewId != null && (
        <InspectionProductView productId={productViewId} onClose={() => setProductViewId(null)} />
      )}

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

      {/* How the placement is confirmed. Same chrome as the storage-type
          chooser above - two options and a footer - because it is the same
          question shape, and a second dialog pattern for it would only be a
          second thing to keep in step. */}
      {methodAsk && box && findSpot(loc.data, spot) && (() => {
      const spotNow = findSpot(loc.data, spot)!;
      return (
        <div
          className="s4qm s4wz-modal s4pm-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-label="Choose putaway confirmation method"
        >
          <div className="s4qm__dlg s4wz__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico"><IcoCheck /></div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Choose Putaway Confirmation Method</div>
                <div className="s4qm__s">
                  {/* The whole address of what is being confirmed, in the
                      order it is read on the floor. */}
                  {[box.code, warehouse, spotNow.zone.code, spotNow.rack.code,
                    spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1')].filter(Boolean).join(' → ')}
                </div>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setMethodAsk(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              <div className="s4wz-opts">
                {([
                  ['zebra', 'Option 01 · Using Zebra Device',
                    'Send the assigned box to the warehouse for physical QR verification using a Zebra handheld device.',
                    'Creates a scan task'],
                  ['manual', 'Option 02 · Manual Confirmation',
                    'Confirm that the box has been physically placed at the assigned location without using a Zebra device.',
                    'Completes now'],
                ] as const).map(([k, title, sub, badge]) => (
                  <button
                    type="button"
                    key={k}
                    className={`s4wz-opt s4pm-opt s4pm-opt--${k}${methodPick === k ? ' is-on' : ''}`}
                    aria-pressed={methodPick === k}
                    onClick={() => { setMethodPick(k); setMethodOk(false); }}
                  >
                    <span className="s4wz-opt__ic">{k === 'zebra' ? <IcoScan /> : <IcoHand />}</span>
                    <span className="s4wz-opt__radio" aria-hidden />
                    <span className="s4wz-opt__t">{title}</span>
                    <span className="s4wz-opt__s">{sub}</span>
                    <span className={`s4pm-badge s4pm-badge--${k}`}>{badge}</span>
                  </button>
                ))}
              </div>

              {/* Everything below answers "confirm WHAT, exactly" - so it only
                  appears once there is a method to confirm. */}
              {methodPick && (() => {
                const shelfCode = spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');
                const addr = [
                  ['Warehouse', warehouse || '—', <IcoWh key="w" />],
                  ['Zone', spotNow.zone.code, <IcoFlag key="z" />],
                  ['Rack', spotNow.rack.code, <IcoList key="r" />],
                  ['Shelf', shelfCode, <IcoShelfSm key="s" />],
                ] as const;
                const chain = <>
                  {addr.map(([, v], i) => (
                    <Fragment key={v + String(i)}>
                      {i > 0 && <i className="s4pm-arr">→</i>}
                      <b>{v}</b>
                    </Fragment>
                  ))}
                </>;
                return (
                  <>
                    {/* From this box, to that shelf. */}
                    <div className="s4pm-route">
                      <div className="s4pm-route__card s4pm-route__card--box">
                        <span className="s4pm-route__ic s4pm-route__ic--box"><IcoBoxSm size={17} /></span>
                        <div>
                          <span className="s4pm-route__k">Box</span>
                          <b className="s4pm-route__v">{box.code}</b>
                        </div>
                      </div>
                      <span className="s4pm-route__go" aria-hidden><IcoArrow /></span>
                      <div className="s4pm-route__card s4pm-route__card--shelf">
                        <span className="s4pm-route__ic s4pm-route__ic--shelf"><IcoShelfSm size={17} /></span>
                        <div>
                          <span className="s4pm-route__k">Final shelf</span>
                          <b className="s4pm-route__v">{shelfCode}</b>
                          <span className="s4pm-route__s">{spotNow.shelf.name || `Level ${spotNow.shelf.level_no}`} · {spotNow.rack.code}</span>
                        </div>
                      </div>
                    </div>

                    <div className="s4pm-addr">
                      <div className="s4pm-addr__k">Putaway address</div>
                      <div className="s4pm-addr__row">
                        {addr.map(([label, value, icon], i) => (
                          <Fragment key={label}>
                            {i > 0 && <span className="s4pm-addr__line" aria-hidden />}
                            <div className={`s4pm-addr__step${i === addr.length - 1 ? ' is-last' : ''}`}>
                              <span className="s4pm-addr__ic">{icon}</span>
                              <span className="s4pm-addr__l">{label}</span>
                              <b className="s4pm-addr__v">{value}</b>
                            </div>
                          </Fragment>
                        ))}
                      </div>
                    </div>

                    {/* The one thing that cannot be taken back, said before the
                        tick rather than after it. */}
                    <div className="s4pm-warn">
                      <span className="s4pm-warn__ic" aria-hidden>!</span>
                      <p>
                        <b>This is final.</b> Once you tick the confirmation, shelf <b>{shelfCode}</b> is
                        locked for <b>{box.code}</b> — it <b>cannot be undone</b> and the box location{' '}
                        <b>cannot be changed</b>.
                      </p>
                    </div>

                    <label className={`s4pm-ok${methodOk ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={methodOk} onChange={e => setMethodOk(e.target.checked)} />
                      <span>
                        I confirm that <b>{box.code}</b> is{' '}
                        <u>{methodPick === 'zebra' ? 'ready to be scanned' : 'already physically placed'}</u> at{' '}
                        {chain}
                        {methodPick === 'zebra' ? ' and should be sent for Zebra verification.' : '.'}
                      </span>
                    </label>
                  </>
                );
              })()}
            </div>

            <div className="s4qm__ft">
              <button type="button" className="s4-btn-back" onClick={() => setMethodAsk(false)}>Cancel</button>
              <button
                type="button"
                className={`s4-btn-next s4pm-go${methodPick ? ` s4pm-go--${methodPick}` : ''}`}
                /* Gated on the tick, not on the pick: the pick says how, the
                   tick says the operator has read what it locks. */
                disabled={!methodPick || !methodOk}
                onClick={() => {
                  /* Manual confirmation IS the placement. A Zebra scan is a
                     task for the floor, so the box stays unplaced until the
                     scan comes back. */
                  if (methodPick === 'manual') { setPlacedAt(new Date().toISOString()); setScanTask(null); }
                  else {
                    const now = new Date();
                    const ymd = now.getFullYear().toString()
                      + String(now.getMonth() + 1).padStart(2, '0')
                      + String(now.getDate()).padStart(2, '0');
                    setScanTask({ id: `ZT-${ymd}-001`, at: now.toISOString() });
                  }
                  setMethodAsk(false);
                }}
              >
                {methodPick === 'zebra' ? <><IcoScan />Submit for Zebra Verification</>
                  : methodPick === 'manual' ? <><IcoCheck />Complete Putaway</>
                  : <>Select a method <IcoChevR /></>}
              </button>
            </div>
          </div>
        </div>
      );
      })()}

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
              ) : (
                <div className="s4wz-opts" aria-busy={modeAsk.loading}>
                  {([
                    ['rack', 'Storage Zone with Rack', 'Place the box on a shelf · Zone › Rack › Shelf',
                      modeAsk.rack, modeAsk.rack === 1 ? 'shelf' : 'shelves'],
                    ['norack', 'Storage Zone without Rack', 'Place the box directly in the zone · no rack or shelf',
                      modeAsk.norack, modeAsk.norack === 1 ? 'zone' : 'zones'],
                  ] as const).map(([k, title, sub, n, unit]) => (
                    <button
                      type="button"
                      key={k}
                      className={`s4wz-opt s4wz-opt--${k}${modePick === k ? ' is-on' : ''}${modeAsk.loading ? ' is-loading' : ''}`}
                      disabled={!modeAsk.loading && n === 0}
                      aria-disabled={modeAsk.loading}
                      aria-pressed={modePick === k}
                      onClick={() => { if (!modeAsk.loading) setModePick(k); }}
                    >
                      <span className="s4wz-opt__ic">{k === 'rack' ? <IcoList /> : <IcoBoxSm size={16} />}</span>
                      <span className="s4wz-opt__radio" aria-hidden />
                      <span className="s4wz-opt__t">{title}</span>
                      {k === 'rack' && !modeAsk.loading && modeAsk.rack > 0 && <span className="s4wz-opt__rec">&#9733; Recommended</span>}
                      <span className="s4wz-opt__s">{sub}</span>
                      {modeAsk.loading ? (
                        <span className="s4wz-opt__n s4wz-opt__n--sk" aria-label="Loading count">
                          <span className="spi-sk-bar" />
                        </span>
                      ) : (
                        <span className="s4wz-opt__n">{n === 0 ? `No ${unit} available` : `${n} ${unit}`}</span>
                      )}
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
                  {[
                    ...([
                      ['Hazardous', detail.haz],
                      ['Cold chain', detail.cold],
                      ['Fragile', detail.fragile],
                      ['Stackable', detail.stackable],
                    ] as Array<[string, boolean | null]>),
                    ...detail.extraFlags.map(n => [n, true] as [string, boolean | null]),
                  ]
                    .sort((a, b) => Number(b[1] === true) - Number(a[1] === true))
                    .map(([k, v]) => (
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
                <div className="s4pd-card__t">Advanced details</div>
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
      </FsLayer>
    </div>
  );
}
