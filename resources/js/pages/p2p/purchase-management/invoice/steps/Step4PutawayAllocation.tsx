import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  spiApi, type ProductFlagOption, type PutawayBoard, type PutawayLocations, type PutawayStatus, type SpiBox, type SpiBoxItem,
} from '../spi-api';
import type { ProductLine } from '../invoice-products';
import type { InvoiceDraft } from '../invoice-draft';
import StageSummary from './StageSummary';
import PutawayStageBrief from './PutawayStageBrief';
import PutawayBoxSticker from './PutawayBoxSticker';
import PutawaySelectLocation, { type SelectLocationWarehouse } from './PutawaySelectLocation';
import PutawayReviewBox from './PutawayReviewBox';
import PutawayConfirmPlacement, { findSpot } from './PutawayConfirmPlacement';
import PutawayScanTask from './PutawayScanTask';
import InspectionProductView from '../../order/physical-inspection/InspectionProductView';
import WorklistPager from '../../../../../components/ui/WorklistPager';
import { PoApiError } from '../../order/api/po-api';
import { useToast } from '../../../../../contexts/ToastContext';

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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
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
/** Confirming by hand: a box ticked off. The design uses it for the dialog's
 *  own head and for the manual option — the question and that answer are the
 *  same act, so they carry the same mark. It replaced a hand placing a box,
 *  which read as the moment of carrying rather than the moment of signing. */
/** Cancelling: the task struck out. */
const IcoBan = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><line x1="15.5" y1="8.5" x2="8.5" y2="15.5" />
  </svg>
);
const IcoTickBox = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <polyline points="8 12.5 11 15.5 16.5 9" />
  </svg>
);
const IcoCollapse = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
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

/* The disposition a box belongs to, as the design writes it: a tinted tile, a
   name and a line saying why those boxes are together. */
const GROUPS: Array<{ key: Disposition; title: string; sub: string }> = [
  { key: 'ship',     title: 'Shipment Dispatch Boxes',             sub: 'Correct product — ready for dispatch' },
  { key: 'inv',      title: 'Inventory Stock (Extra Stock) Boxes', sub: 'Extra quantity — staged for storage' },
  { key: 'damaged',  title: 'Damaged / Rejected Boxes',            sub: 'Not accepted — held for QC' },
  { key: 'mismatch', title: 'Mismatch Boxes',                      sub: 'Wrong item — held for return' },
];
/* What the packer marked, read back off the disposition — the pick list does
   not carry the remark itself, and the two are the same fact. */
const REMARK_OF: Record<Disposition, string> = {
  ship: 'Correct Product', inv: 'Extra Quantity',
  damaged: 'Damaged / Rejected', mismatch: 'Mismatched',
};

function BoxCard({ b, selected, readOnly, onPick, onSticker }: {
  b: PickBox; selected: boolean; readOnly: boolean;
  onPick: () => void; onSticker: () => void;
}) {
  const placed = !!b.location;
  return (
    <div
      className={`s4pkc${selected ? ' is-active' : ''}${placed ? ' is-placed' : ''}`}
      data-boxid={b.code}
      onClick={() => { if (!readOnly) onPick(); }}
    >
      {/* The teal head carries the things you identify a carton by: its id,
          its label, and whether it has been put away. */}
      <div className="s4pkc__hd">
        <span className="s4pkc__ico"><IcoBoxSm size={15} /></span>
        <span className="s4pkc__id">{b.code}</span>
        <button
          type="button"
          className="s4pkc__stk"
          onClick={e => { e.stopPropagation(); onSticker(); }}
        >
          <IcoPrintSm /> Sticker
        </button>
        <span className={`s4pkc__st${placed ? ' is-done' : ''}`}>
          {/* "Putaway Completed", the words the pane uses when it finishes —
              "Placed" was a third name for the same state. */}
          <i />{placed ? 'Putaway Completed' : b.status === 'awaiting_scan' ? 'Awaiting scan' : b.status === 'draft' ? 'Allocated' : 'Pending'}
        </span>
      </div>
      <div className="s4pkc__bd">
        <div className="s4pkc__scn">
          <span className="s4pkc__scnno">{(SCENARIO_NO[b.scenarioKey] ?? 'Scenario 01').toUpperCase()}</span>
          <span className="s4pkc__scnt">{b.scenario}</span>
        </div>
        {/* Four figures, divided — the ones a person checks against the carton
            in front of them before committing it to a slot. */}
        <div className="s4pkc__mets">
          <div className="s4pkc__met"><span>Box Qty</span><b>{b.qty} <i>units</i></b></div>
          <div className="s4pkc__met"><span>Dimensions</span><b>{b.dims ?? '—'}</b></div>
          <div className="s4pkc__met"><span>Net Wt.</span><b>{b.netKg ? <>{b.netKg} <i>kg</i></> : '—'}</b></div>
          <div className="s4pkc__met"><span>Gross Wt.</span><b>{b.grossKg ? <>{b.grossKg} <i>kg</i></> : '—'}</b></div>
        </div>
        <div className="s4pkc__chips">
          <span className="s4pkc__chip is-ok"><i />{REMARK_OF[b.type]}</span>
          <span className={`s4pkc__chip${b.condition === 'perfect' ? ' is-ok' : ' is-warn'}`}>
            <i />{CONDITION_LABEL[b.condition] ?? 'Perfect'}
          </span>
          {b.haz || b.cold
            ? <>
              {b.haz && <span className="s4pkc__chip is-haz"><i />Hazardous</span>}
              {b.cold && <span className="s4pkc__chip is-cold"><i />Cold Chain</span>}
            </>
            : <span className="s4pkc__noflag">No flags</span>}
        </div>
      </div>
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
  /** The line's GST rate. The sticker and the review table both print it, and
   *  it is a property of the product rather than of the packing. */
  gst: string | null;
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
      gst: line?.gst == null ? null : String(line.gst),
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

/** The code a placement is read by on the floor: "RC-D02-SH-03" → "SH-03",
 *  and a direct placement is the zone's own code. */
const locCodeOf = (s: ReturnType<typeof findSpot>): string | null =>
  !s ? null
    : s.kind === 'zone' ? s.zone.code
    : s.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');

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

/* The NUMBER, without its unit. Both call sites print "kg" themselves — the
 * pick card as its own <i>, the confirm card through stat()'s third argument —
 * so carrying the unit in here as well is what produced "9 kg kg" on the card.
 * dimsOf() below keeps its "cm" because neither of its call sites adds one. */
function kg(v: unknown): string | null {
  const n = num(v);
  return n ? `${Number.isInteger(n) ? n : n.toFixed(2)}` : null;
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

/* Full names, in the design's order. They were abbreviated — "Dispatch",
   "Damage/Rejected" — and ordered with Inventory last, which put the two
   exception buckets between the two ordinary ones. Dispatch and Inventory are
   where boxes normally go; Damaged and Mismatch are the exceptions, and they
   read better as a pair at the end. */
const TABS: Array<{ key: 'all' | Disposition; label: string; ico: ReactNode }> = [
  { key: 'all',      label: 'All Boxes',                            ico: <IcoBoxSm /> },
  { key: 'ship',     label: 'Shipment Dispatch Boxes',              ico: <IcoTruck /> },
  { key: 'inv',      label: 'Inventory Stock (Extra Stock) Boxes',  ico: <IcoList /> },
  { key: 'damaged',  label: 'Damaged / Rejected Boxes',             ico: <IcoWarn /> },
  { key: 'mismatch', label: 'Mismatch Boxes',                       ico: <IcoSwap /> },
];


const PRODUCTS_PER_PAGE = 5;

/* Labels the Review pane prints verbatim. Kept beside the Disposition type
   they key off, so a new disposition cannot quietly fall through to blank. */
const SECTION_LABEL: Record<Disposition, string> = {
  ship: 'Shipment Dispatch Boxes',
  inv: 'Inventory Stock (Extra Stock) Boxes',
  damaged: 'Damaged / Rejected Boxes',
  mismatch: 'Mismatch Boxes',
};
/* The short form the printed label uses — a sticker has no room for
   "Multiple Products → 1 Box". */
const STICKER_SCENARIO: Record<string, string> = {
  s1: 'S1 — Single', s2: 'S2 — Split', s3: 'S3 — Mixed',
};
const SCENARIO_NO: Record<string, string> = {
  s1: 'Scenario 01', s2: 'Scenario 02', s3: 'Scenario 03',
};
const CONDITION_LABEL: Record<string, string> = {
  perfect: 'Perfect', minor: 'Minor Damage', major: 'Critical Damage', severe: 'Critical Damage',
  Perfect: 'Perfect', 'Minor Damage': 'Minor Damage', 'Critical Damage': 'Critical Damage',
};

/** dd/mm/yyyy from whatever the row carries, or null. */
const packedOnOf = (b: SpiBox | undefined): string | null => {
  const raw = (b as unknown as { created_at?: string | null } | undefined)?.created_at;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** The seven measurements, as strings, with volumetric derived the same way
 *  the packing step derives it (L x W x H / 5000). */
const coreOf = (b: SpiBox | undefined) => {
  const n = (v: unknown): string | null => {
    const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(x) ? String(Math.round(x * 100) / 100) : null;
  };
  const cc = (Number(b?.length_cm) || 0) * (Number(b?.width_cm) || 0) * (Number(b?.height_cm) || 0);
  return {
    length: n(b?.length_cm), width: n(b?.width_cm), height: n(b?.height_cm),
    weight: n(b?.weight_kg), net: n(b?.net_weight_kg), gross: n(b?.gross_weight_kg),
    vol: cc > 0 ? (cc / 5000).toFixed(2) : null,
    unit: 'cm',
  };
};

/** The note the packer left, if any. */
const noteOf = (b: SpiBox | undefined): string | null => {
  const t = String(b?.items?.[0]?.remark_note ?? '').trim();
  return t && t !== '—' ? t : null;
};

/* The three steps the design shows. LIFECYCLE below still drives the pane's
   own headings and its four internal states — including Putaway Summary,
   which is the receipt after the work rather than a step you take — but the
   strip names only the three you actually do. */
const IcoPrintSm = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);
const IcoClock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
  </svg>
);
const IcoTick = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const IcoHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" />
  </svg>
);
const IcoWarehouse = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21V9l9-5 9 5v12" /><path d="M9 21v-7h6v7" />
  </svg>
);
const IcoShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
  </svg>
);
const STEPPER = [
  { no: '01', label: 'Review Box Details',       sub: 'Verify the packed box', ico: <IcoBoxSm size={18} /> },
  { no: '02', label: 'Select Putaway Location',  sub: 'Choose a temporary slot', ico: <IcoPin /> },
  { no: '03', label: 'Confirm Putaway Allocation', sub: 'Lock the placement', ico: <IcoShield /> },
];

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

/* ── Scan Logs ──────────────────────────────────────────────────────────────
   The per-box audit trail, and NOT the Zebra scan task — which is why the
   button that opens it is never disabled. It records the whole run, from
   picking the box to confirming the putaway, so it reads the same whether the
   box went out on a handheld or was confirmed by hand. A box with no task
   still has a history, and a box with no history still has an answer. */
type LogKind = 'pick' | 'zone' | 'loc' | 'method' | 'task' | 'scan' | 'err' | 'done' | 'cancel';
type LogEntry = { k: LogKind; t: string; d: string; time: string };

const hhmmss = () => {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
};

const IcoXSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IcoUserSm = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const IcoCancelSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const LOG_ICO: Record<LogKind, ReactNode> = {
  pick: <IcoBoxSm size={12} />, zone: <IcoGrid />, loc: <IcoPin />,
  method: <IcoCheck />, task: <IcoScan />, scan: <IcoScan />,
  err: <IcoWarn />, done: <IcoTick />, cancel: <IcoCancelSm />,
};

function ScanLogs({ anchor, boxCode, entries, method, task, scans, done, onClose }: {
  anchor: HTMLElement | null;
  boxCode: string | null;
  entries: LogEntry[];
  method: string;
  task: string | null;
  scans: number;
  done: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; height: number } | null>(null);

  /* Hung under the button and run down to the bottom of the panel it belongs
     to, rather than to the bottom of the screen — the list is long and the
     footer below it is not something to cover. */
  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const top = Math.round(r.bottom + 8);
      const panel = anchor.closest('.s4-panel');
      const floor = panel ? panel.getBoundingClientRect().bottom : window.innerHeight;
      setPos({
        top,
        left: Math.max(12, Math.round(r.right - el.offsetWidth)),
        height: Math.max(320, Math.min(window.innerHeight - 16, floor - 8) - top),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, entries.length]);

  useEffect(() => {
    const out = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', out, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', out, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      className="s4lg"
      ref={ref}
      role="dialog"
      aria-label="Scan logs"
      style={pos
        ? { top: pos.top, left: pos.left, height: pos.height, maxHeight: pos.height }
        : { visibility: 'hidden' }}
    >
      <div className="s4lg-hd">
        <span className="s4lg-hd__i"><IcoClock /></span>
        <b>Scan Logs</b>
        {boxCode && <span className="s4lg-box">{boxCode}</span>}
        <button type="button" className="s4lg-x" onClick={onClose} aria-label="Close"><IcoXSm /></button>
      </div>
      {boxCode && (
        <div className="s4lg-chips">
          <span>{method}</span>
          {task && <><span>{task}</span><span>{scans} / 2 scans</span></>}
          <span className={done ? 'ok' : 'pd'}>{done ? 'Putaway Completed' : 'Pending'}</span>
        </div>
      )}
      <div className="s4lg-list">
        {entries.length ? entries.map((e, i) => (
          <div className={`s4lg-it s4lg-it--${e.k}`} key={`${e.time}-${i}`}>
            <span className="s4lg-dot">{LOG_ICO[e.k]}</span>
            <div className="s4lg-tx">
              <div className="s4lg-row"><b>{e.t}</b><time>{e.time}</time></div>
              {e.d && <em>{e.d}</em>}
              <span className="s4lg-by"><IcoUserSm />SPI Putaway Desk</span>
            </div>
          </div>
        )) : (
          <div className="s4lg-empty">
            {boxCode
              ? `No activity recorded for ${boxCode} in this session yet.`
              : 'Pick a box to see its scan logs.'}
          </div>
        )}
      </div>
      <div className="s4lg-note">
        Activity is logged from Pick a Box through Putaway Allocation confirmation.
        User names will come from the signed-in account.
      </div>
    </div>,
    document.body);
}

export default function Step4PutawayAllocation({ draft, boxes, lines = [], flagMaster = [], spiId = null, warehouse, warehouseInfo = null, spiCode = null, readOnly = false }: {
  draft: InvoiceDraft;
  boxes: SpiBox[];
  lines?: ProductLine[];
  flagMaster?: ProductFlagOption[];
  spiId?: number | null;
  warehouse?: string | null;
  /** The same site with its code and town, for Step 02's warehouse card. The
   *  bare name still drives every other mention of it. */
  warehouseInfo?: SelectLocationWarehouse | null;
  /** This invoice's own number, shown on the scan task's header. */
  spiCode?: string | null;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<'all' | Disposition>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  /* Either pane can be folded away, as the design has it. Collapsing the box
     list gives the allocation the whole stage; collapsing the allocation gives
     the list the whole stage, which is what you want when you are scanning
     down thirteen cartons looking for the one in your hands. */
  const [rightOpen, setRightOpen] = useState(true);
  const [lcStep, setLcStep] = useState(0);
  const panelsRef = useRef<HTMLDivElement>(null);
  /* Full View is a takeover of the page, not the browser's own fullscreen.
     It used to call requestFullscreen() on the panels element — which put the
     ONLY way out (this button, which sits on the rail above) outside the
     fullscreened subtree, so nothing on screen said how to leave and Esc was
     the only exit. The design keeps the rail and its Exit Full View in view
     and simply gives the two panels the whole window. */
  const [fs, setFs] = useState(false);
  const toggleFs = () => setFs(v => !v);
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs]);
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

  /* Write a finished putaway back into the board.
   *
   * The box list reads EVERY card's state from the board — is-placed, the
   * status pill, the group counts. Completing a putaway only set this step's
   * own local state, so the card the operator had just finished went on
   * reading Pending in teal until the next fetch, while the pane beside it
   * said Putaway Completed. The green card has always been built; nothing
   * ever turned it on. */
  const markPlaced = (boxId: number, destination: string | null) => {
    setBoard(prev => {
      if (!prev) return prev;
      const was = prev.boxes.find(r => r.box_id === boxId)?.status;
      if (!was || was === 'placed') return prev;
      const dec = (n: number) => Math.max(0, n - 1);
      return {
        counts: {
          ...prev.counts,
          placed: prev.counts.placed + 1,
          remaining: dec(prev.counts.remaining),
          /* Only the bucket it actually came from moves. */
          ...(was === 'awaiting_scan' ? { awaiting_scan: dec(prev.counts.awaiting_scan) }
            : was === 'draft' ? { draft: dec(prev.counts.draft) }
            : { pending: dec(prev.counts.pending) }),
        },
        boxes: prev.boxes.map(r => r.box_id === boxId
          ? {
            ...r,
            status: 'placed' as const,
            destination: destination ?? r.destination,
            assigned_at: new Date().toISOString(),
            /* The task is spent — it must not keep showing as outstanding. */
            task: null,
          }
          : r),
      };
    });
  };

  const againstPo = !!draft.poNumber;
  const all = useMemo(
    () => toPickBoxes(boxes, flagMaster, lines, board, againstPo),
    [boxes, flagMaster, lines, board, againstPo],
  );
  const counts = useMemo(() => ({
    all: all.length,
    ship: all.filter(b => b.type === 'ship').length,
    damaged: all.filter(b => b.type === 'damaged').length,
    mismatch: all.filter(b => b.type === 'mismatch').length,
    inv: all.filter(b => b.type === 'inv').length,
  }), [all]);

  const scope = all.filter(b => tab === 'all' || b.type === tab);

  const shown = all.filter(b =>
    (tab === 'all' || b.type === tab)
    && (flag === '' || (flag === 'haz' ? b.haz : flag === 'nonhaz' ? !b.haz : b.cold)));

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

  const rawBox = useMemo(
    () => boxes.find(b => b.box_code === selected),
    [boxes, selected],
  );
  const products = useMemo(() => productsOf(rawBox, lines, flagMaster), [rawBox, lines, flagMaster]);
  /* Flags are stored per item; a box's flags are the union of its items'. */
  const boxFlagNames = useMemo(
    () => (rawBox ? flagNames(rawBox.items ?? [], flagMaster) : []),
    [rawBox, flagMaster],
  );
  /* "Box 1 of 3" for a split set, read off the saved boxes of the same line —
     the only place that relationship still exists once packing is finished. */
  const modeLabelOf = (b: PickBox): string | null => {
    if (b.scenarioKey === 's3') return 'Mixed Carton';
    if (b.scenarioKey !== 's2') return 'Single Box';
    const itemId = rawBox?.items?.[0]?.supplier_invoice_item_id;
    if (itemId == null) return null;
    const set = boxes
      .filter(x => x.scenario === 's2' && x.items?.[0]?.supplier_invoice_item_id === itemId)
      .map(x => x.box_code)
      .sort((p, q) => p.localeCompare(q, undefined, { numeric: true }));
    const i = set.indexOf(b.code);
    return i >= 0 && set.length > 0 ? `Box ${i + 1} of ${set.length}` : null;
  };
  const [showProducts, setShowProducts] = useState(false);
  const [prodPage, setProdPage] = useState(1);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const toast = useToast();
  const stickerBusy = useRef(false);
  const stickerFailed = (e: unknown) => toast.error('Could not get the sticker',
    e instanceof PoApiError ? e.firstError : 'Please try again.');
  const stickerPdf = async (boxId: number, code: string) => {
    if (stickerBusy.current) return;
    if (!spiId) { toast.warning('Save the invoice first', 'The sticker needs a saved SPI.'); return; }
    stickerBusy.current = true;
    try {
      const blob = await spiApi.stickerPdf(spiId, boxId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(spiCode || 'SPI').replace(/\//g, '-')}-${code}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      stickerFailed(e);
    } finally {
      stickerBusy.current = false;
    }
  };
  const stickerPrint = async (boxId: number) => {
    if (stickerBusy.current) return;
    if (!spiId) { toast.warning('Save the invoice first', 'The sticker needs a saved SPI.'); return; }
    stickerBusy.current = true;
    try {
      await spiApi.printSticker(spiId, boxId);
      window.print();
    } catch (e) {
      stickerFailed(e);
    } finally {
      stickerBusy.current = false;
    }
  };
  const [placedAt, setPlacedAt] = useState<string | null>(null);
  /* How the placement gets confirmed. The two answers are not the same event:
     a manual confirmation IS the placement, a Zebra scan only queues one for
     the floor to verify - so the box is not placed until the scan comes back.
     Confirming straight off the button conflated the two. */
  const [methodAsk, setMethodAsk] = useState(false);
  /* Cancelling a raised Zebra task is not an undo — the task is already in the
     warehouse queue, and the box stays allocated either way. So it asks, and
     the asking offers the way forward rather than only the way out. */
  const [cancelAsk, setCancelAsk] = useState(false);
  const [methodPick, setMethodPick] = useState<'zebra' | 'manual' | null>(null);
  /* The dialog asks WHICH method first and shows what that method commits to
     second. Both on one screen meant it opened already arguing a case for a
     choice the operator had not made yet. */
  const [methodStage, setMethodStage] = useState<'select' | 'detail'>('select');
  /* The reference the detail screen names before it is committed — the task
     number for a Zebra scan, the allocation number for a manual one. Settled
     when the dialog opens so the header can show it, rather than appearing
     only after submit. */
  const methodRef = useMemo(() => {
    const n = new Date();
    const ymd = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
    return { task: `ZT-${ymd}-001`, alloc: `TPA-${ymd}-001` };
  }, [methodAsk]);
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
  /* How many of the task's two QR legs have come back verified, so the logs
     can say "1 / 2 scans" without reaching inside the scan dialog. */
  const [scanSteps, setScanSteps] = useState(0);
  /* The trail, kept per box for the session, and the button that shows it. */
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [logsOpen, setLogsOpen] = useState(false);
  const logBtnRef = useRef<HTMLButtonElement>(null);
  const addLog = (code: string | null | undefined, k: LogKind, t: string, d = '') => {
    if (!code) return;
    setLogs(prev => {
      const list = prev[code] ?? [];
      const last = list[list.length - 1];
      /* Re-picking the shelf you already picked is one entry, not a run of
         identical ones - and it keeps StrictMode's double effects honest. */
      if (last && last.t === t && last.d === d) return prev;
      return { ...prev, [code]: [...list, { k, t, d, time: hhmmss() }] };
    });
  };
  /* "WH-002 → ZN-136 · Ambient Bulk" for a bare zone, or the full
     warehouse → zone → rack → shelf chain where the zone has racks. */
  const spotLabel = (s: ReturnType<typeof findSpot>) => {
    if (!s) return '';
    const wh = warehouseInfo?.code ?? '';
    return s.kind === 'zone'
      ? [wh, s.zone.code].filter(Boolean).join(' → ') + (s.zone.name ? ` · ${s.zone.name}` : '')
      : [wh, s.zone.code, s.rack.code, s.shelf.code].filter(Boolean).join(' → ');
  };

  const detail = detailIdx == null ? null : products[detailIdx] ?? null;
  /* Everything here belongs to the BOX, so all of it resets when the box
     does. scanTask and spot were missing: a Zebra task raised for one box
     followed you to the next, which then showed that task's banner and a
     footer offering "Pick Next Box" instead of letting you work — and the
     chosen location carried over with it. */
  useEffect(() => {
    setShowProducts(false); setProdPage(1); setLcStep(0); setDetailIdx(null);
    setModeAsk(null); setModePick(null); setPutMode(null); setQrOpen(false);
    setPlacedAt(null); setScanTask(null); setSpot(null); setScanOpen(false);
    setScanSteps(0); setLogsOpen(false);
  }, [selected]);
  const pageOfProducts = products.slice((prodPage - 1) * PRODUCTS_PER_PAGE, prodPage * PRODUCTS_PER_PAGE);

  const placed = scope.filter(b => b.location).length;
  const hazCount = scope.filter(b => b.haz).length;
  const coldCount = scope.filter(b => b.cold).length;
  const pct = scope.length ? Math.round((placed / scope.length) * 100) : 0;
  const box = all.find(b => b.code === selected) ?? null;

  /* The trail is written from the state the stage already keeps, so every
     route into a step — the button, the dialog, the banner — is recorded the
     same way, and nothing has to remember to call a logger. */
  useEffect(() => {
    if (!box) return;
    addLog(box.code, 'pick', 'Box picked', [box.code, box.scenario, 'Pick a Box'].filter(Boolean).join(' · '));
  }, [box?.code]);

  useEffect(() => {
    if (!putMode) return;
    addLog(selected, 'zone', 'Storage type chosen',
      putMode === 'norack' ? 'Storage zone without rack' : 'Storage zone with rack');
  }, [putMode, selected]);

  useEffect(() => {
    const s = findSpot(loc.data, spot);
    if (s) addLog(selected, 'loc', 'Location selected', spotLabel(s));
  }, [spot, loc.data, selected]);

  useEffect(() => {
    if (methodStage !== 'detail' || !methodPick) return;
    addLog(selected, 'method', 'Putaway method chosen',
      methodPick === 'zebra' ? 'Option 01 · Using Zebra Device' : 'Option 02 · Manual Confirmation');
  }, [methodStage, methodPick, selected]);

  useEffect(() => {
    if (!scanTask) return;
    addLog(selected, 'task', 'Zebra scan task created',
      [scanTask.id, spotLabel(findSpot(loc.data, spot))].filter(Boolean).join(' · '));
  }, [scanTask?.id, selected]);

  useEffect(() => {
    if (!placedAt) return;
    addLog(selected, 'done', 'Putaway allocation confirmed',
      placedVia
        ? `${placedVia.allocation} · via Zebra task ${placedVia.via}`
        : `${methodRef.alloc} · manual confirmation`);
  }, [placedAt, selected]);
  const shownCodes = shown.map(b => b.code).join('|');
  const firstAwaiting = shown.find(b => !b.location)?.code ?? shown[0]?.code ?? null;
  /* The next box still waiting on a location, looking after the current one
     and wrapping round — so "Pick Next Box" never lands back on the box just
     dealt with, and goes null only when the whole list is done. */
  const nextBoxCode = (() => {
    const i = shown.findIndex(b => b.code === selected);
    const order = i < 0 ? shown : [...shown.slice(i + 1), ...shown.slice(0, i)];
    return order.find(b => !b.location)?.code ?? null;
  })();
  useEffect(() => {
    if (selected && shownCodes.split('|').includes(selected)) return;
    setSelected(firstAwaiting);
  }, [firstAwaiting, selected, shownCodes]);

  /* "Select Putaway Location" asks HOW before it asks WHERE.
     The chooser existed but nothing ever opened it — setModeAsk was only
     called to clear it — so the button jumped straight to the location
     picker with no storage type chosen, and the picker then had nothing to
     fetch. One call gives both counts: the locations endpoint returns
     `modes: { rack, norack }` whichever mode you ask it for. */
  const askStorageMode = () => {
    if (!box) return;
    setModePick(null);
    if (!spiId) {
      setModeAsk({ loading: false, rack: 0, norack: 0, error: 'Save the invoice before allocating a location.' });
      return;
    }
    setModeAsk({ loading: true, rack: 0, norack: 0, error: null });
    /* putawayModes, not putawayLocations: there is an endpoint for exactly
       this question, and asking for the whole layout to read two counts off
       it fetches every zone, rack and shelf to show "41 shelves available". */
    spiApi.putawayModes(spiId, box.id)
      .then(m => {
        setModeAsk({ loading: false, rack: m.rack, norack: m.norack, error: null });
        /* With only one kind of storage configured there is nothing to
           choose, so the choice is made and the dialog just confirms it. */
        if (m.rack > 0 && m.norack === 0) setModePick('rack');
        else if (m.norack > 0 && m.rack === 0) setModePick('norack');
      })
      .catch(e => setModeAsk({
        loading: false, rack: 0, norack: 0,
        error: e instanceof PoApiError ? e.firstError
          : e instanceof Error ? e.message : 'Could not read the warehouse layout.',
      }));
  };

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

  return (
    <div className={`s4-root${fs ? ' is-fullview' : ''}`}>
      {/* Full View is for the work, so the recap above it and the brief that
          explains the stage both stand down — the design shows the tab row
          and the two panels, nothing else. */}
      {!fs && <StageSummary draft={draft} upto={3} />}
      {/* What this stage is for, and in which warehouse — the brief the
          design puts between the recap and the work. */}
      {!fs && <PutawayStageBrief warehouse={warehouse} />}

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
        {/* No Zebra tasks button here. The design does not have one on this
            rail, and the one that was here had no handler — it counted open
            tasks and did nothing when pressed, which is worse than absent.
            Zebra verification is still reached from the method dialog. */}
        {/* On the rail, not in the right panel's head: it expands the whole
            stage, so it belongs with the controls that scope the stage rather
            than with the pane's own title. */}
        <button
          type="button"
          className="s4fs-btn s4fs-btn--rail"
          title={fs ? 'Exit full view' : 'Full view'}
          aria-pressed={fs}
          onClick={toggleFs}
        >
          {fs ? <IcoCollapse /> : <IcoExpand />}
          <span className="s4fs-t">{fs ? 'Exit Full View' : 'Full View'}</span>
        </button>
      </div>

      {/* The Scenario 1 / 2 / 3 sub-tabs are gone. The design has one tab row,
          and the second filtered a list the left panel already groups by
          disposition — two filters over the same boxes, one above the other.
          Zebra tasks moves up to the rail rather than going with them. */}

      <div className={`s4-panels${fs ? ' is-fs' : ''}`} ref={panelsRef}>
        {/* Collapsing is a CLASS, not an inline flex-basis. The inline style
            could not win: .s4-panel--left:not(.is-collapsed) sets a 300px
            min-width, and since the class was never added that selector
            always matched — so the "collapsed" panel stopped at 300px with
            its header and the whole box list still in it, squashed. The
            class also switches on the rail treatment the stylesheet already
            carries: 38px wide, head turned on its side, body hidden, the
            vertical "Pick a Box" label shown. The id picks up the finished
            version of those rules. */}
        <div
          id="s4PanelLeft"
          className={`s4-panel s4-panel--left${leftOpen ? '' : ' is-collapsed'}`}
        >
          <div className="s4-panel__head" onClick={() => setLeftOpen(o => !o)}>
            <div className="s4-panel__head-ico"><IcoBoxSm /></div>
            <div className="s4-panel__head-text">
              {/* No sub-line: the design has the count instead, which is the
                  thing that changes. "Choose the next box to put away" told
                  you what the panel is while the groups below already do. */}
              <div className="s4-panel__head-title">Pick a Box</div>
            </div>
            <span className="s4-panel__head-count">
              {shown.length} Box{shown.length === 1 ? '' : 'es'}
            </span>
            <button
              type="button"
              className="s4-panel__toggle"
              title={leftOpen ? 'Collapse' : 'Expand'}
              /* Folding one pane opens the other. Both closed leaves the stage
                 as two rails against an empty field, with no way back except
                 guessing which rail to click — and nothing on the screen to do
                 the work this step exists for. */
              onClick={e => {
                e.stopPropagation();
                if (leftOpen) setRightOpen(true);
                setLeftOpen(o => !o);
              }}
            >
              <IcoChevL />
            </button>
            <div className="s4-panel__collapsed-label">Pick a Box</div>
          </div>

          <div className="s4-panel__body s4-boxlist">
            {/* Every disposition, every time. A category with nothing in it
                still says so: "no damaged boxes" is an answer, and a list
                whose groups come and go is one you have to re-read. */}
            {GROUPS.map(g => {
              const rows = shown.filter(x => x.type === g.key);
              return (
                <Fragment key={g.key}>
                  <div className={`s4grp s4grp--${g.key}`}>
                    <span className="s4grp__ico">{TABS.find(t => t.key === g.key)?.ico}</span>
                    <span className="s4grp__tx">
                      <span className="s4grp__t">{g.title}</span>
                      <span className="s4grp__s">{g.sub}</span>
                    </span>
                    <span className="s4grp__n">{rows.length}</span>
                  </div>
                  {rows.length === 0
                    ? <div className="s4grp__empty">No boxes in this category</div>
                    : rows.map(bx => (
                      <BoxCard
                        key={bx.id}
                        b={bx}
                        selected={selected === bx.code}
                        readOnly={readOnly}
                        onPick={() => setSelected(bx.code)}
                        onSticker={() => { setSelected(bx.code); setQrOpen(true); }}
                      />
                    ))}
                </Fragment>
              );
            })}

            {shown.length === 0 && (
              <div className="s4pk-none">
                {all.length === 0
                  ? 'No boxes yet — pack cartons in Step 03 first.'
                  : 'No boxes in this view'}
              </div>
            )}
          </div>
        </div>

        <div
          id="s4PanelRight"
          className={`s4-panel s4-panel--right${rightOpen ? '' : ' is-collapsed'}`}
        >
          {/* The head opens the pane only while it is CLOSED. Expanded, it
              holds the Scan Logs button, and a click there must reach that
              button rather than folding the pane under it. */}
          <div className="s4-panel__head" onClick={rightOpen ? undefined : () => setRightOpen(true)}>
            <div className="s4-panel__head-ico"><IcoGrid /></div>
            <div className="s4-panel__head-text">
              {/* "Temporary Putaway Allocation" — the stage's own name, as the
                  step card above says it. "& Rack Allocation" described a
                  mechanism that only applies when the zone HAS racks, and the
                  sub-line repeated what the strip underneath already shows. */}
              <div className="s4-panel__head-title">Temporary Putaway Allocation</div>
            </div>
            {/* Never disabled. It used to open the Zebra scan task, so it had
                to be switched off until one existed — but Scan Logs is the
                box's history, which every box has from the moment it is
                picked, and which answers "what happened to this box?" even
                when the answer is "nothing yet". */}
            <button
              type="button"
              ref={logBtnRef}
              className="s4fs-btn s4-scanlogs"
              title="Scan logs for this box"
              aria-expanded={logsOpen}
              onClick={() => setLogsOpen(o => !o)}
            >
              <IcoClock /> <span className="s4fs-t">Scan Logs</span>
            </button>
            {logsOpen && (
              <ScanLogs
                anchor={logBtnRef.current}
                boxCode={box?.code ?? null}
                entries={box ? logs[box.code] ?? [] : []}
                method={methodPick === 'zebra' || scanTask ? 'Using Zebra Device'
                  : methodPick === 'manual' ? 'Manual Confirmation'
                  : 'Method not chosen'}
                task={scanTask?.id ?? null}
                scans={scanTask ? scanSteps : 0}
                done={placedAt !== null || box?.status === 'placed'}
                onClose={() => setLogsOpen(false)}
              />
            )}
            <button
              type="button"
              className="s4-panel__toggle"
              title={rightOpen ? 'Collapse' : 'Expand'}
              /* Same rule from this side — see the box list's toggle. */
              onClick={e => {
                e.stopPropagation();
                if (rightOpen) setLeftOpen(true);
                setRightOpen(o => !o);
              }}
            >
              <IcoChevR />
            </button>
            {/* Read down the rail once the pane is folded, the way the box
                list's does. */}
            <div className="s4-panel__collapsed-label">Putaway Allocation</div>
          </div>

          {/* The journey, as three cards on a teal band.
              It was four numbered circles joined by rules, which gave Putaway
              Summary — a receipt you read after the work, not a thing you do —
              equal billing with the three real steps. The design shows the
              three, each naming itself and carrying its own state; once the
              box is placed all three read Completed, which is the summary. */}
          <div className="s4bj">
            {STEPPER.map((s, i) => {
              const state = i < lcStep ? 'done' : i === lcStep ? 'active' : 'idle';
              return (
                <Fragment key={s.no}>
                  {i > 0 && (
                    <div className={`s4bj-line${i <= lcStep ? ' is-done' : ''}`}>
                      <span className="s4bj-chev"><IcoChevR /></span>
                    </div>
                  )}
                  <div className={`s4bj-step is-${state}`}>
                    <div className="s4bj-ico">
                      {s.ico}
                      {/* The badge is a bare 1/2/3, not the padded "02" — it
                          is an 18px circle, and two digits crowd it. The
                          zero-padded form belongs in the "Step 02" label. */}
                      <span className="s4bj-num">{state === 'done' ? <IcoTick /> : i + 1}</span>
                    </div>
                    <div className="s4bj-tx">
                      <div className="s4bj-k2">Step {s.no}</div>
                      <div className="s4bj-t">{s.label}</div>
                      <div className="s4bj-s">{s.sub}</div>
                    </div>
                    {state !== 'idle' && (
                      <span className="s4bj-pill">{state === 'done' ? 'Completed' : 'In Progress'}</span>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>

          <div className="s4-panel__body">
            {!box ? (
              <div className="s4pk-none">Pick a box on the left to start its putaway.</div>
            ) : (
              <div className="s4-c2-pane is-visible">
                {/* No "Step 01 · Review Box · Active" bar here.
                    The strip directly above already carries the number, the
                    name and the state — this said all three again, a few
                    pixels lower, in different words. The design has one
                    statement of where you are, and it is the strip. */}
                <div className="s4h">
                  {/* Steps 02 and 03 each open with their own teal band that
                      already names the box and carries its state - the "where
                      should this box go?" bar and the route strip. This one
                      above them was the same band twice with the same B-003
                      in it, so it only shows where nothing repeats it. */}
                  {/* …and not on step 0 either: the Review pane opens with its
                      own Box Details band, so this one repeated the id, the
                      scenario and the status directly above it. */}
                  {lcStep === 3 && (
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
                      warehouse={warehouseInfo ?? (warehouse ? { name: warehouse } : null)}
                    />
                  ) : lcStep === 2 ? (
                    <PutawayConfirmPlacement
                      box={{
                        code: box.code, scenario: box.scenario, skus: box.skus, qty: box.qty,
                        uom: box.uom, dims: box.dims, netKg: box.netKg, grossKg: box.grossKg,
                        /* The same words Step 01's card uses, so a box reads
                           the same on both steps. */
                        scenarioNo: SCENARIO_NO[box.scenarioKey] ?? 'Scenario 01',
                        modeLabel: modeLabelOf(box),
                        sectionKey: box.type === 'damaged' ? 'dmg' : box.type === 'mismatch' ? 'mis' : box.type,
                        sectionLabel: SECTION_LABEL[box.type],
                        packedOn: packedOnOf(rawBox),
                        remark: REMARK_OF[box.type] ?? null,
                        condition: CONDITION_LABEL[box.condition] ?? null,
                        flags: boxFlagNames,
                        products: products.length,
                      }}
                      spot={findSpot(loc.data, spot)}
                      warehouse={warehouse}
                      assigned={placedAt !== null}
                      qr={<BoxQr text={String(box.id)} size={92} />}
                      locQr={<BoxQr text={`${warehouse ?? ''}/${spot ?? ''}`} size={80} />}
                      onSticker={() => setQrOpen(true)}
                      onChange={() => setLcStep(1)}
                      scan={scanTask}
                      placedVia={placedVia}
                      warehouseCode={warehouse || null}
                      onMethod={() => { setMethodPick(null); setMethodOk(false); setMethodStage('select'); setMethodAsk(true); }}
                      onCancelTask={() => setCancelAsk(true)}
                      onOpenScanTask={() => setScanOpen(true)}
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
                  ) : (
                    /* Step 01 — Review Box Details.
                       Was a "Box Identification" grid led by a large sticker
                       preview and a QR: the right thing at the printer, but
                       not what you check with the carton already in hand. The
                       design reviews the box itself — what it is, what it
                       measures, what is inside, what was noted. */
                    <PutawayReviewBox
                      boxId={box.code}
                      sectionKey={box.type === 'damaged' ? 'dmg' : box.type === 'mismatch' ? 'mis' : box.type}
                      sectionLabel={SECTION_LABEL[box.type]}
                      scenarioNo={SCENARIO_NO[box.scenarioKey] ?? 'Scenario 01'}
                      scenarioText={box.scenario}
                      modeLabel={modeLabelOf(box)}
                      packedOn={packedOnOf(rawBox)}
                      done={placedAt !== null || box.status === 'placed'}
                      core={coreOf(rawBox)}
                      remark={products[0]?.remark && products[0].remark !== 'Not marked' ? products[0].remark : null}
                      condition={CONDITION_LABEL[box.condition] ?? null}
                      flags={boxFlagNames}
                      stackable={box.stackable}
                      products={products}
                      totalQty={box.qty}
                      note={noteOf(rawBox)}
                      onSticker={() => setQrOpen(true)}
                      onNext={askStorageMode}
                    />
                  )}
                </div>

                {/* Not on step 01. The Review pane ends with its own
                    "Select Putaway Location", so this footer put a second
                    button for the same move directly beneath it. */}
                {lcStep > 0 && (
                <div className="s4-pane-footer">
                  <button
                    type="button"
                    className="s4-btn-back"
                    disabled={lcStep === 0}
                    onClick={() => setLcStep(n => Math.max(0, n - 1))}
                  >
                    <IcoChevL /> Back
                  </button>
                  {/* Once the box is placed, or out for a Zebra scan, there is
                      nothing further to do to IT — the next move is the next
                      box, which is what the footer offers. Only on the confirm
                      step: on the earlier steps there is still work to do here,
                      and this was replacing the button that does it. */}
                  {lcStep === 2 && (placedAt !== null || scanTask) ? (
                    <button
                      type="button"
                      className="s4-btn-next"
                      disabled={nextBoxCode === null}
                      title={nextBoxCode === null ? 'Every box in this list has been dealt with' : undefined}
                      onClick={() => { if (nextBoxCode) { setSelected(nextBoxCode); setLcStep(0); } }}
                    >
                      Pick Next Box <IcoChevR />
                    </button>
                  ) : (
                  <button
                    type="button"
                    className="s4-btn-next"
                    disabled={lcStep >= LIFECYCLE.length - 1 || (lcStep === 1 && spot === null)}
                    /* The hint has to name what you are actually picking: a
                       direct placement has no tree and no shelf in it. */
                    title={lcStep === 1 && spot === null
                      ? (putMode === 'norack'
                          ? 'Choose a zone first — use the recommended one, or pick one from the list'
                          : 'Choose a spot first — use the recommended one, or pick a shelf from the tree')
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
                  )}
                </div>
                )}
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
        /* What this box takes off the shelf — or off the zone floor, when the
           placement is direct — which is what the task holds against it until
           the scans come back. */
        const held = sp.kind === 'zone' ? sp.zone : sp.shelf;
        const reserved = Math.max(0, Math.round((held.used_pct_after - held.used_pct) * 10) / 10);
        return (
          <PutawayScanTask
            taskId={scanTask.id}
            /* The reference the allocation is locked under once both scans
               pass — the same one the manual route issues, so a box reads the
               same however it was confirmed. */
            allocRef={methodRef.alloc}
            /* The same confirm the awaiting card raises — one question about
               dropping a task, asked the same way from either screen. */
            onCancelTask={() => setCancelAsk(true)}
            spiCode={spiCode}
            createdAt={new Date(scanTask.at).toLocaleString('en-GB',
              { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
              .replace(',', ' ·')}
            box={{ code: box.code, name: box.name }}
            spot={{
              kind: sp.kind,
              warehouse: warehouseInfo?.code || warehouse || null,
              zone: sp.zone.code,
              /* A direct placement has no rack and no shelf to scan: the zone
                 itself is the second QR. */
              rack: sp.kind === 'zone' ? null : sp.rack.code,
              shelf: sp.kind === 'zone'
                ? sp.zone.code
                : sp.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1'),
              shelfName: sp.kind === 'zone'
                ? (sp.zone.name || 'Direct placement')
                : (sp.shelf.name || `Level ${sp.shelf.level_no}`),
            }}
            reservedPct={reserved}
            onClose={() => setScanOpen(false)}
            onScan={(leg, ok) => {
              const what = leg === 'box' ? 'Box QR' : sp.kind === 'zone' ? 'Zone QR' : 'Shelf QR';
              const where = leg === 'box' ? box.code : spotLabel(sp);
              if (ok) {
                setScanSteps(n => Math.min(2, n + 1));
                addLog(box.code, 'scan', `${what} scanned`, `${where} · verified on Zebra handheld`);
              } else {
                addLog(box.code, 'err', `${what} mismatch`, `${where} — rejected`);
              }
            }}
            onComplete={() => {
              /* Both labels read: the box IS on the shelf now, so this is the
                 moment it becomes placed - not when the task was raised. */
              setPlacedAt(new Date().toISOString());
              setPlacedVia({
                via: 'Using Zebra Device',
                allocation: `TPA-${scanTask.id.slice(3, 11)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
              });
              markPlaced(box.id, locCodeOf(sp));
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

      {/* The sticker as it will print, not a bare QR.
          The old dialog showed the code and the box id — enough to scan,
          not enough to check you are labelling the right carton. */}
      {qrOpen && box && (
        <PutawayBoxSticker
          boxId={box.code}
          spiNumber={draft.invoiceNumber || '—'}
          scenario={STICKER_SCENARIO[box.scenarioKey] ?? 'S1 — Single'}
          product={box.name}
          code={box.productCodes[0] ?? '—'}
          mode={SCENARIO_LABEL[box.scenarioKey] ?? box.scenario}
          condition={CONDITION_LABEL[box.condition] ?? 'Perfect'}
          sku={products[0]?.hsn ? `HSN ${products[0].hsn}` : '—'}
          qty={box.qty}
          date={packedOnOf(rawBox) ?? '—'}
          qr={<BoxQr text={String(box.id)} size={96} />}
          onClose={() => setQrOpen(false)}
          onPdf={() => { void stickerPdf(box.id, box.code); }}
          onPrint={() => { void stickerPrint(box.id); }}
        />
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
              <div className="s4qm__hico">
                {methodStage === 'detail' && methodPick === 'zebra' ? <IcoScan />
                  : <IcoTickBox size={18} />}
              </div>
              <div className="s4qm__htx">
                <div className="s4qm__t">
                  {methodStage === 'select' ? 'How do you want to confirm this putaway?'
                    : methodPick === 'zebra' ? 'Create Zebra Putaway Task'
                    : 'Confirm Manual Putaway'}
                </div>
                <div className="s4qm__s">
                  {methodStage === 'select' ? 'Choose the putaway confirmation method for this box.'
                    : methodPick === 'zebra'
                      ? 'Option 01 · Using Zebra Device — submit the task for physical QR verification.'
                      : 'Option 02 · Manual Confirmation — confirm the box is already placed at the selected location.'}
                </div>
              </div>
              {/* The facts the choice is about, as chips — the same header the
                  storage-zone chooser uses. The detail screen adds the
                  reference it is about to issue. */}
              <div className="s4wz-ctx">
                {methodStage === 'detail' && (
                  <span className="s4wz-ctx__i">
                    {methodPick === 'zebra' ? <IcoScan /> : <IcoList />}
                    <span>
                      <em>{methodPick === 'zebra' ? 'Task No.' : 'Allocation No.'}</em>
                      <b>{methodPick === 'zebra' ? methodRef.task : methodRef.alloc}</b>
                    </span>
                  </span>
                )}
                <span className="s4wz-ctx__i"><IcoBoxSm size={13} /><span><em>Box ID</em><b>{box.code}</b></span></span>
                <span className="s4wz-ctx__i">
                  <IcoFlag /><span>
                    <em>{spotNow.kind === 'zone' ? 'Zone' : 'Shelf'}</em>
                    <b>{spotNow.kind === 'zone'
                      ? spotNow.zone.code
                      : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1')}</b>
                  </span>
                </span>
              </div>
              <button type="button" className="s4qm__x" onClick={() => setMethodAsk(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              {/* The cards are the QUESTION. Once it is answered the detail
                  screen replaces them outright — it does not sit underneath
                  them, which is what dev was doing. */}
              {methodStage === 'select' && <>
              <div className="s4wz-lead">Select one putaway method</div>
              <div className="s4wz-opts">
                {([
                  ['zebra', 'rack', 'Option 01', 'Using Zebra Device',
                    'Send the box to the warehouse floor for physical QR verification with a Zebra handheld scanner.',
                    'Creates a scan task', 'Scan-verified · traceable'],
                  ['manual', 'norack', 'Option 02', 'Manual Confirmation',
                    'Confirm the box is already physically placed at the selected location, without a Zebra device.',
                    'Completes instantly', 'No device needed'],
                ] as const).map(([k, variant, num, title, sub, chipA, chipB]) => (
                  <button
                    type="button"
                    key={k}
                    className={`s4wz-opt s4wz-opt--${variant}${methodPick === k ? ' is-on' : ''}`}
                    aria-pressed={methodPick === k}
                    onClick={() => { setMethodPick(k); setMethodOk(false); }}
                  >
                    <span className="s4wz-opt__ic">{k === 'zebra' ? <IcoScan /> : <IcoTickBox size={20} />}</span>
                    <span className="s4wz-opt__tx">
                      <span className="s4wz-opt__ttl">
                        <span className={`s4pm-num s4pm-num--${k}`}>{num}</span>
                        <span className="s4wz-opt__t">{title}</span>
                      </span>
                      <span className="s4wz-opt__s">{sub}</span>
                      <span className="s4wz-opt__chips">
                        <span className="s4wz-opt__n">{chipA}</span>
                        <span className="s4wz-opt__d">{chipB}</span>
                      </span>
                    </span>
                    <span className="s4wz-opt__radio" aria-hidden />
                  </button>
                ))}
              </div>
              </>}

              {/* What the chosen method actually commits to — the address it
                  locks and the fact that it cannot be undone. */}
              {methodStage === 'detail' && (() => {
                /* A floor zone IS the destination — it has no rack and no
                   shelf under it — so the address stops at the zone and says
                   the placement is direct. */
                const shelfCode = spotNow.kind === 'zone'
                  ? spotNow.zone.code
                  : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');
                /* The warehouse's CODE, not its name — the address is read off
                   labels on the floor, and "kuhi" is not written on anything. */
                const whCode = warehouseInfo?.code || warehouse || '—';
                const addr: Array<[string, string, ReactNode]> = spotNow.kind === 'zone'
                  ? [
                      ['Warehouse', whCode, <IcoWh key="w" />],
                      ['Zone', spotNow.zone.code, <IcoFlag key="z" />],
                      ['Placement', 'Direct zone', <IcoShelfSm key="p" />],
                    ]
                  : [
                      ['Warehouse', whCode, <IcoWh key="w" />],
                      ['Zone', spotNow.zone.code, <IcoFlag key="z" />],
                      ['Rack', spotNow.rack.code, <IcoList key="r" />],
                      ['Shelf', shelfCode, <IcoShelfSm key="s" />],
                    ];
                /* The sentence names the PLACE, so it stops at the zone for a
                   direct placement — "Direct zone" is how it gets there, not
                   somewhere the box can be. */
                const chainParts = spotNow.kind === 'zone'
                  ? [whCode, spotNow.zone.code]
                  : [whCode, spotNow.zone.code, spotNow.rack.code, shelfCode];
                const chain = <>
                  {chainParts.map((v, i) => (
                    <Fragment key={v + String(i)}>
                      {i > 0 && <i className="s4pm-arr">→</i>}
                      <b>{v}</b>
                    </Fragment>
                  ))}
                </>;
                /* What the submit actually sets in motion, in order. The
                   dialog used to assert that the placement was final without
                   ever saying what happens between pressing the button and
                   the box being locked. */
                const steps: Array<[string, string]> = methodPick === 'zebra'
                  ? [
                      ['Task created', 'Assigned to the warehouse Zebra queue'],
                      ['Scan Box QR', `Operator scans the ${box.code} sticker`],
                      [`Scan ${spotNow.kind === 'zone' ? 'Zone' : 'Shelf'} QR`, `Operator scans ${shelfCode} at the location`],
                      ['Putaway locked', 'Location confirmed automatically'],
                    ]
                  : [
                      ['Box already placed', `${box.code} is physically at ${shelfCode}`],
                      ['Consent recorded', 'Your confirmation is logged on this SPI'],
                      ['Allocation generated', `${methodRef.alloc} is issued`],
                      ['Putaway completed', `${spotNow.kind === 'zone' ? 'Zone' : 'Shelf'} ${shelfCode} is locked for this box`],
                    ];
                return (
                  <>
                  <div className="s4pm-grid">
                  <div className="s4pm-left">
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
                          <span className="s4pm-route__k">{spotNow.kind === 'zone' ? 'Final zone' : 'Final shelf'}</span>
                          <b className="s4pm-route__v">{shelfCode}</b>
                          {/* Name, level and rack — the three things that tell
                              one SH-01 from another. The level was being
                              dropped whenever the shelf had a name. */}
                          <span className="s4pm-route__s">
                            {spotNow.kind === 'zone'
                              ? `${spotNow.zone.name || 'Unnamed zone'} · direct placement`
                              : [spotNow.shelf.name, `Level ${spotNow.shelf.level_no}`, spotNow.rack.code]
                                  .filter(Boolean).join(' · ')}
                          </span>
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
                  </div>

                  <div className={`s4pm-flow${methodPick === 'manual' ? ' s4pm-flow--m' : ''}`}>
                    <div className="s4pm-addr__k">
                      {methodPick === 'zebra' ? 'What happens next' : 'What happens on confirm'}
                    </div>
                    {steps.map(([t, d], i) => (
                      <div className="s4pm-step" key={t}>
                        <span>{i + 1}</span>
                        <div><b>{t}</b><em>{d}</em></div>
                      </div>
                    ))}
                  </div>
                  </div>

                    {/* The one thing that cannot be taken back, said before the
                        tick rather than after it. */}
                    {/* "shelf" was hard-coded, so a direct placement into a
                        zone was warned about as though it were a shelf. */}
                    <div className="s4pm-warn">
                      <span className="s4pm-warn__ic" aria-hidden>!</span>
                      <p>
                        <b>This is final.</b>{' '}
                        {methodPick === 'zebra' ? (
                          <>Once submitted, {spotNow.kind === 'zone' ? 'zone' : 'shelf'} <b>{shelfCode}</b> is
                          reserved for <b>{box.code}</b> and the box is placed only after both QR scans are
                          received on the Zebra handheld.</>
                        ) : (
                          <>Once confirmed, {spotNow.kind === 'zone' ? 'zone' : 'shelf'} <b>{shelfCode}</b> is
                          locked for <b>{box.code}</b> — it <b>cannot be undone</b> and the box location{' '}
                          <b>cannot be changed</b>. No Zebra scan will be requested.</>
                        )}
                      </p>
                    </div>

                    {/* The sentence the operator is agreeing to, in the method's
                        own words. It is only ever shown once a method is
                        chosen, so there is no "pick one first" wording left. */}
                    {/* Manual carries the green the whole way through — the
                        consent box included, not only once it is ticked. */}
                    <label className={`s4pm-ok s4pm-ok--${methodPick}${methodOk ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={methodOk} onChange={e => setMethodOk(e.target.checked)} />
                      <span>
                        I confirm that <b>{box.code}</b> is{' '}
                        <u>{methodPick === 'zebra' ? 'ready to be scanned' : 'already physically placed'}</u> at{' '}
                        {chain}
                        {methodPick === 'zebra'
                          ? ' and should be sent for Zebra verification.'
                          : ' and I take responsibility for this manual putaway.'}
                      </span>
                    </label>
                  </>
                );
              })()}
            </div>

            <div className="s4qm__ft">
              <button
                type="button"
                className="s4-btn-back"
                onClick={() => (methodStage === 'detail' ? setMethodStage('select') : setMethodAsk(false))}
              >
                {methodStage === 'detail' ? <><IcoChevL />Back</> : 'Cancel'}
              </button>
              {methodStage === 'select' ? (
                <button
                  type="button"
                  className={`s4-btn-next s4pm-go${methodPick ? ` s4pm-go--${methodPick}` : ''}`}
                  disabled={!methodPick}
                  onClick={() => setMethodStage('detail')}
                >
                  {methodPick === 'zebra' ? 'Continue · Create Zebra Task'
                    : methodPick === 'manual' ? 'Continue · Manual Confirmation'
                    : 'Continue'}
                  <IcoChevR />
                </button>
              ) : (<>
              {/* Back steps, Cancel abandons — the detail screen offers both,
                  because by now there are two different ways out. */}
              <button type="button" className="s4-btn-back s4pm-cancel" onClick={() => setMethodAsk(false)}>Cancel</button>
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
                  if (methodPick === 'manual') {
                    setPlacedAt(new Date().toISOString());
                    setScanTask(null);
                    markPlaced(box.id, locCodeOf(spotNow));
                  }
                  /* The same number the header has been showing — not a second
                     one minted at submit. */
                  else setScanTask({ id: methodRef.task, at: new Date().toISOString() });
                  setMethodAsk(false);
                }}
              >
                {methodPick === 'zebra' ? <><IcoScan />Submit for Zebra Verification</>
                  : methodPick === 'manual' ? <><IcoCheck />Confirm Putaway Allocation</>
                  : <>Select a method <IcoChevR /></>}
              </button>
              </>)}
            </div>
          </div>
        </div>
      );
      })()}

      {/* Cancel Zebra Scan Task.
          Three outcomes, not two: keep it, drop it, or drop it and finish the
          putaway by hand. The third is the one most people actually want —
          the handheld is missing, the box is already on the shelf — so it is
          offered as a card rather than hidden behind a second decision. */}
      {cancelAsk && box && scanTask && (() => {
      /* Resolved here, the way the method dialog does it — the allocation is
         what the warning is about, and it has to survive the cancel. */
      const spotNow = findSpot(loc.data, spot);
      const locCode = !spotNow ? null
        : spotNow.kind === 'zone' ? spotNow.zone.code
        : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');
      return (
        <div className="s4qm s4wz-modal s4ct-modal is-open" role="dialog" aria-modal="true"
          aria-label="Cancel Zebra scan task">
          <div className="s4qm__dlg s4wz__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico"><IcoBan size={18} /></div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Cancel Zebra Scan Task?</div>
                <div className="s4qm__s">{scanTask.id} &middot; {scanSteps} / 2 scans received</div>
              </div>
              <div className="s4wz-ctx">
                <span className="s4wz-ctx__i"><IcoBoxSm size={13} /><span><em>Box ID</em><b>{box.code}</b></span></span>
                {spotNow && (
                  <span className="s4wz-ctx__i">
                    <IcoFlag /><span>
                      <em>{spotNow.kind === 'zone' ? 'Zone ID' : 'Shelf ID'}</em>
                      <b>{locCode}</b>
                    </span>
                  </span>
                )}
              </div>
              <button type="button" className="s4qm__x" onClick={() => setCancelAsk(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              {/* What cancelling actually does — and, just as important, what
                  it does NOT do. The allocation survives; only the method
                  goes. Saying so is what stops this reading as "undo". */}
              <div className="s4ct-warn">
                <span className="s4ct-warn__i"><IcoScan /></span>
                <div>
                  <b>This will cancel task {scanTask.id}</b>
                  <ul>
                    <li>The task is removed from the warehouse Zebra queue.</li>
                    <li>
                      {box.code} stays allocated to{' '}
                      <b>{[warehouseInfo?.code || warehouse, locCode].filter(Boolean).join(' › ')}</b>
                      {' '}&mdash; only the confirmation method is reset.
                    </li>
                    <li>The putaway stays pending until it is confirmed by another method.</li>
                  </ul>
                </div>
              </div>

              <div className="s4ct-alt">
                <span className="s4ct-alt__rec">Recommended</span>
                <span className="s4ct-alt__i"><IcoTickBox size={20} /></span>
                <div className="s4ct-alt__tx">
                  <span className="s4pm-num s4pm-num--manual">Option 02</span>
                  <b>Manual Confirmation</b>
                  <p>
                    If the Zebra handheld is unavailable, confirm that {box.code} is already
                    physically placed at {locCode} and complete the putaway now.
                  </p>
                  <div className="s4ct-alt__chips">
                    <span><IcoCheck /> Completes instantly</span>
                    <span><IcoCheck /> No device needed</span>
                    <span><IcoCheck /> Same location</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="s4qm__ft s4ct-ft">
              <button type="button" className="s4-btn-back" onClick={() => setCancelAsk(false)}>
                Keep Task
              </button>
              <button
                type="button"
                className="s4ct-only"
                onClick={() => {
                  addLog(box.code, 'cancel', 'Zebra scan task cancelled',
                    [scanTask.id, 'method cleared'].filter(Boolean).join(' · '));
                  setScanTask(null);
                  setScanSteps(0);
                  setCancelAsk(false);
                }}
              >
                <IcoBan /> Cancel Task Only
              </button>
              <button
                type="button"
                className="s4ct-manual"
                onClick={() => {
                  addLog(box.code, 'cancel', 'Zebra scan task cancelled',
                    [scanTask.id, 'switching to manual'].filter(Boolean).join(' · '));
                  setScanTask(null);
                  setScanSteps(0);
                  setCancelAsk(false);
                  /* Straight to the manual confirmation screen — the point of
                     this route is not to choose again. */
                  setMethodPick('manual');
                  setMethodOk(false);
                  setMethodStage('detail');
                  setMethodAsk(true);
                }}
              >
                Cancel &amp; Continue with Manual <IcoChevR />
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
              <div className="s4qm__hico"><IcoPin /></div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Where do you want to store this box?</div>
                {/* The sub-line says what the choice IS. It printed the box
                    code, which the chip on the right now carries — and a bare
                    id under the question answered nothing. */}
                <div className="s4qm__s">Choose the storage zone type for this box.</div>
              </div>
              {/* Which box, and which warehouse it is going into — the two
                  facts the decision depends on, so neither has to be
                  remembered from the screen behind the dialog. */}
              <div className="s4wz-ctx">
                <span className="s4wz-ctx__i"><IcoPin /><span><em>Box ID</em><b>{box.code}</b></span></span>
                {warehouse && (
                  <span className="s4wz-ctx__i"><IcoWarehouse /><span><em>Warehouse</em><b>{warehouse}</b></span></span>
                )}
              </div>
              <button type="button" className="s4qm__x" onClick={() => setModeAsk(null)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
              <div className="s4wz-lead">
                Choose the storage zone type for Step 02 · {STEPPER[1].label}
              </div>

              {modeAsk.error ? (
                <div className="s4vp-none">{modeAsk.error}</div>
              ) : (
                <div className="s4wz-opts" aria-busy={modeAsk.loading}>
                  {([
                    ['rack', 'Storage Zone with Rack', 'Place the box on a shelf · Zone › Rack › Shelf',
                      modeAsk.rack, modeAsk.rack === 1 ? 'shelf' : 'shelves', 'Organised · traceable'],
                    ['norack', 'Storage Zone without Rack', 'Place the box directly in the zone · no rack or shelf',
                      modeAsk.norack, modeAsk.norack === 1 ? 'zone' : 'zones', 'Bulk · floor staging'],
                  ] as const).map(([k, title, sub, n, unit, trait]) => (
                    <button
                      type="button"
                      key={k}
                      className={`s4wz-opt s4wz-opt--${k}${modePick === k ? ' is-on' : ''}${modeAsk.loading ? ' is-loading' : ''}`}
                      /* Not disabled on a zero count.
                         A warehouse with no open zones today may have one by
                         the time the box is carried over, and the count is
                         read once when the dialog opens. Blocking the choice
                         on a number that old leaves the only route forward
                         greyed out with no way to say otherwise — the chip
                         already says "No zones available", which is the
                         warning without being the wall. */
                      aria-disabled={modeAsk.loading}
                      aria-pressed={modePick === k}
                      onClick={() => { if (!modeAsk.loading) setModePick(k); }}
                    >
                      {/* Icon beside the text, not above it, and the radio at
                          the far edge — the design reads left to right:
                          what it is, what it means, is it chosen. */}
                      <span className="s4wz-opt__ic">{k === 'rack' ? <IcoList /> : <IcoHome />}</span>
                      <span className="s4wz-opt__tx">
                        {/* No "Recommended" pill. Neither kind of storage is
                            the right answer in general — it depends on the
                            box, and the two cards already say what each one
                            is for. The counts underneath are the fact that
                            decides it. */}
                        <span className="s4wz-opt__ttl">
                          <span className="s4wz-opt__t">{title}</span>
                        </span>
                        <span className="s4wz-opt__s">{sub}</span>
                        <span className="s4wz-opt__chips">
                          {modeAsk.loading ? (
                            <span className="s4wz-opt__n s4wz-opt__n--sk" aria-label="Loading count">
                              <span className="spi-sk-bar" />
                            </span>
                          ) : (
                            <span className={`s4wz-opt__n${n === 0 ? ' is-none' : ''}`}>
                              {n === 0 ? `No ${unit} available` : `${n} ${unit} available`}
                            </span>
                          )}
                          {/* What this kind of storage is LIKE — the count says
                              whether you can use it, this says why you would. */}
                          <span className="s4wz-opt__d">{trait}</span>
                        </span>
                      </span>
                      <span className="s4wz-opt__radio" aria-hidden />
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
                Continue to Select Location <IcoChevR />
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
