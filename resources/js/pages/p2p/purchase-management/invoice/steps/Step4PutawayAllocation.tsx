import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  putId, spiApi, taskScansDone, type ProductFlagOption, type PutawayAssignBody, type PutawayBoard, type PutawayLocations, type PutawayStatus, type SpiBox, type SpiBoxItem,
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

const GROUPS: Array<{ key: Disposition; title: string; sub: string }> = [
  { key: 'ship',     title: 'Shipment Dispatch Boxes',             sub: 'Correct product — ready for dispatch' },
  { key: 'inv',      title: 'Inventory Stock (Extra Stock) Boxes', sub: 'Extra quantity — staged for storage' },
  { key: 'damaged',  title: 'Damaged / Rejected Boxes',            sub: 'Not accepted — held for QC' },
  { key: 'mismatch', title: 'Mismatch Boxes',                      sub: 'Wrong item — held for return' },
];
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
      onClick={() => onPick()}
    >
      <div className="s4pkc__hd">
        <span className="s4pkc__ico"><IcoBoxSm size={15} /></span>
        <span className="s4pkc__id">{putId(b.code)}</span>
        <button
          type="button"
          className="s4pkc__stk"
          onClick={e => { e.stopPropagation(); onSticker(); }}
        >
          <IcoPrintSm /> Sticker
        </button>
        <span className={`s4pkc__st${placed ? ' is-done' : ''}`}>
          <i />{placed ? 'Putaway Completed' : b.status === 'awaiting_scan' ? 'Awaiting scan' : b.status === 'draft' ? 'Allocated' : 'Pending'}
        </span>
      </div>
      <div className="s4pkc__bd">
        <div className="s4pkc__scn">
          <span className="s4pkc__scnno">{(SCENARIO_NO[b.scenarioKey] ?? 'Scenario 01').toUpperCase()}</span>
          <span className="s4pkc__scnt">{b.scenario}</span>
        </div>
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

function BoxQr({ text, size = 76, bare = false }: { text: string; size?: number; bare?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    setFailed(false);
    const dpr = Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
    QRCode.toCanvas(c, text, {
      width: size * dpr,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0c2c3a', light: '#ffffff' },
    }).then(() => {
      c.style.width = `${size}px`;
      c.style.height = `${size}px`;
    }).catch(() => setFailed(true));
  }, [text, size]);
  if (failed) return <span className="s4s-stk__qrfail">No code</span>;
  return (
    <canvas
      className={bare ? 's4-qrc' : 's4s-stk__qr'} ref={ref}
      width={size} height={size} style={{ width: size, height: size }}
    />
  );
}

interface BoxProduct {
  code: string; name: string; hsn: string;
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
      uom: dash(it.uom) ?? dash(line?.uom),
      productId: line?.productId ?? null,
      remark: REMARK_LABEL[String(it.remark ?? '')] ?? 'Not marked',
      haz: behavioursOf([it], flagMaster).has('hazardous'),
      cold: behavioursOf([it], flagMaster).has('cold_chain'),
      fragile: behavioursOf([it], flagMaster).has('fragile'),
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

const NAME_BEHAVIOUR: Record<string, string> = { hazardous: 'hazardous', 'cold chain': 'cold_chain', fragile: 'fragile' };
function behavioursOf(items: SpiBoxItem[], master: ProductFlagOption[]): Set<string> {
  const byId = new Map(master.map(f => [f.id, f]));
  const out = new Set<string>();
  for (const it of items) {
    for (const id of Array.isArray(it.flags) ? it.flags : []) {
      const f = byId.get(Number(id));
      if (!f) continue;
      const b = f.behaviour !== undefined ? f.behaviour : NAME_BEHAVIOUR[(f.flag_name ?? '').trim().toLowerCase()];
      if (b) out.add(b);
    }
  }
  return out;
}

function extraFlagNames(items: SpiBoxItem[], master: ProductFlagOption[]): string[] {
  const byId = new Map(master.map(f => [f.id, f]));
  const out: string[] = [];
  for (const it of items) {
    for (const id of Array.isArray(it.flags) ? it.flags : []) {
      const f = byId.get(Number(id));
      const name = (f?.flag_name ?? '').trim();
      const behaviour = f?.behaviour !== undefined ? f?.behaviour : NAME_BEHAVIOUR[name.toLowerCase()];
      if (!name || behaviour || name.toLowerCase().includes('stack')) continue;
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
      haz: behavioursOf(items, flagMaster).has('hazardous'),
      cold: behavioursOf(items, flagMaster).has('cold_chain') || hasRange,
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

const TABS: Array<{ key: 'all' | Disposition; label: string; ico: ReactNode }> = [
  { key: 'all',      label: 'All Boxes',                            ico: <IcoBoxSm /> },
  { key: 'ship',     label: 'Shipment Dispatch Boxes',              ico: <IcoTruck /> },
  { key: 'inv',      label: 'Inventory Stock (Extra Stock) Boxes',  ico: <IcoList /> },
  { key: 'damaged',  label: 'Damaged / Rejected Boxes',             ico: <IcoWarn /> },
  { key: 'mismatch', label: 'Mismatch Boxes',                       ico: <IcoSwap /> },
];

const PRODUCTS_PER_PAGE = 5;

const SECTION_LABEL: Record<Disposition, string> = {
  ship: 'Shipment Dispatch Boxes',
  inv: 'Inventory Stock (Extra Stock) Boxes',
  damaged: 'Damaged / Rejected Boxes',
  mismatch: 'Mismatch Boxes',
};
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

const packedOnOf = (b: SpiBox | undefined): string | null => {
  const raw = (b as unknown as { created_at?: string | null } | undefined)?.created_at;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

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

const noteOf = (b: SpiBox | undefined): string | null => {
  const t = String(b?.items?.[0]?.remark_note ?? '')
    .split(' · ').filter(p => !p.trim().startsWith('Cold chain')).join(' · ').trim();
  return t && t !== '—' ? t : null;
};

const IcoPrintSm = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);
const IcoLog = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <polyline points="3 3 3 8 8 8" />
    <polyline points="12 7 12 12 15 14" />
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

export interface ZebraTaskRow {
  code: string;
  taskId: string | null;
  createdAt: string | null;
  scenario: string;
  qty: number;
  legs: number;
  legKind: 'Zone' | 'Shelf';
  loc: Array<{ label: string; code: string; name?: string; tag?: string }>;
  live: boolean;
}

function ZebraOpenTasks({ tasks, spiCode, poNumber, supplier, wh, onOpenTask, onCancelTask, onClose }: {
  tasks: ZebraTaskRow[];
  spiCode: string | null;
  poNumber: string | null;
  supplier: string | null;
  wh: { id?: string | null; name?: string | null; own?: boolean } | null;
  onOpenTask: (code: string) => void;
  onCancelTask: (code: string) => void;
  onClose: () => void;
}) {
  const boxDone = tasks.filter(t => t.legs >= 1).length;
  const locDone = tasks.filter(t => t.legs >= 2).length;
  const notStarted = tasks.filter(t => t.legs === 0).length;

  const [busy, setBusy] = useState<{ kind: 'open' | 'cancel'; code: string } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const run = (kind: 'open' | 'cancel', code: string, go: () => void) => {
    if (busy) return;
    setBusy({ kind, code });
    timer.current = window.setTimeout(() => { onClose(); go(); }, 280);
  };

  const CUT = 35;
  const ref = (ico: React.ReactNode, label: string, value: string, mono?: boolean, tag?: React.ReactNode) => {
    const long = value.length > CUT;
    return (
      <span className="s4zv-ref" title={long ? value : undefined}>
        <span className="s4zv-ref__i">{ico}</span>
        <span>
          <span className="s4zv-ref__l">{label}</span>
          <span className={`s4zv-ref__v${mono ? ' mono' : ''}`}>
            {long ? `${value.slice(0, CUT).trimEnd()}…` : value}{tag}
          </span>
        </span>
      </span>
    );
  };

  const kpi = (tone: '' | 'g' | 'a', ico: React.ReactNode, label: string, value: number, sub: string) => (
    <div className={`s4zv-kpi${tone ? ' ' + tone : ''}`}>
      <span className="s4zv-kpi__wm" aria-hidden>{ico}</span>
      <span className="s4zv-kpi__i">{ico}</span>
      <div>
        <div className="s4zv-kpi__l">{label}</div>
        <div className="s4zv-kpi__v">{value}<em>{sub}</em></div>
      </div>
    </div>
  );

  return createPortal(
    <div className="s4zv-ov" role="presentation">
      <div className="s4zv" role="dialog" aria-modal="true" aria-label="Zebra Open Tasks">
        <div className="s4zv-hd">
          <div className="s4zv-top">
            <span className="s4zv-ico"><IcoZvZebra /></span>
            <div className="s4zv-ttl">
              <b>Zebra Open Tasks</b>
              <span>Putaway scan tasks waiting on the warehouse floor for physical QR verification</span>
            </div>
            <div className="s4zv-r">
              <span className="s4zv-live"><i />{tasks.length} open task{tasks.length === 1 ? '' : 's'}</span>
              <button type="button" className="s4zv-x" onClick={onClose} aria-label="Close"><IcoXSm /></button>
            </div>
          </div>
          <div className="s4zv-refs">
            {ref(<IcoList />, 'Invoice No', spiCode || '—', true)}
            {ref(<IcoList />, 'PO Number', poNumber || 'Direct SPI', true)}
            {ref(<IcoUserSm />, 'Supplier', supplier || '—')}
            {wh?.name && ref(<IcoWh />, 'Warehouse', `${wh.id ? wh.id + ' · ' : ''}${wh.name}`, false,
              <span className="s4zv-ref__tag">{wh.own === false ? 'Third Party' : 'Own'}</span>)}
            {ref(<IcoGrid />, 'Stage', '04 · Temporary Putaway Allocation')}
          </div>
        </div>

        <div className="s4zv-body">
          <div className="s4zv-kpis">
            {kpi('',  <IcoZvZebra />, 'Open Zebra Tasks',    tasks.length, tasks.length === 1 ? 'task' : 'tasks')}
            {kpi('g', <IcoZvBox />,   'Box QR Scanned',      boxDone,      `of ${tasks.length}`)}
            {kpi('g', <IcoZvPin />,   'Location QR Scanned', locDone,      `of ${tasks.length}`)}
            {kpi('a', <IcoZvClock />, 'Not Started',         notStarted,   'awaiting operator')}
          </div>

          {tasks.length ? (
            <div className="s4zv-tblwrap">
              <table className="s4zv-tbl">
                <thead><tr>
                  <th>Sr.</th><th>Zebra Task ID</th><th>Putaway Box ID</th>
                  <th>Selected Location ID</th><th>Scan Status</th>
                  <th>Actions</th>
                </tr></thead>
                <tbody>
                  {tasks.map((t, i) => (
                    <tr key={t.code}>
                      <td><span className="s4zv-sr">{i + 1}</span></td>
                      <td>
                        <div className="s4zv-c">
                          <span className="s4zv-id">{t.taskId ?? '—'}</span>
                          {t.createdAt && <small>Created {t.createdAt}</small>}
                        </div>
                      </td>
                      <td>
                        <div className="s4zv-c">
                          <span className="s4zv-id box">{putId(t.code)}</span>
                          {(() => {
                            const line = `${t.scenario}${t.qty ? ` · ${t.qty} units` : ''}`;
                            return <small title={line.length > 34 ? line : undefined}>
                              {line.length > 34 ? `${line.slice(0, 34).trimEnd()}…` : line}
                            </small>;
                          })()}
                        </div>
                      </td>
                      <td>
                        {t.loc.length ? (
                          <div className="s4zv-loc">
                            {t.loc.map(l => (
                              <div className="s4zv-loc__r" key={l.label}>
                                <span className="s4zv-loc__l">{l.label}</span>
                                <span className="s4zv-loc__v">
                                  <span className="s4zv-loc__c">{l.code}</span>
                                  {l.name && (
                                    <span className="s4zv-loc__n" title={l.name.length > 28 ? l.name : undefined}>
                                      {l.name}
                                    </span>
                                  )}
                                  {l.tag && <span className="s4zv-loc__tag">{l.tag}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : <span className="s4zv-dash">—</span>}
                      </td>
                      <td>
                        <div className="s4zv-prog">
                          <span className="s4zv-st">
                            <i />{t.legs ? `Scanning · ${t.legs}/2` : 'Awaiting scan · 0/2'}
                          </span>
                          <div className="s4zv-prog__bar"><b style={{ width: `${t.legs * 50}%` }} /></div>
                          <div className="s4zv-legs">
                            <span className={`s4zv-sc${t.legs >= 1 ? ' ok' : ''}`}>{t.legs >= 1 ? '✓' : '○'} Box QR</span>
                            <span className={`s4zv-sc${t.legs >= 2 ? ' ok' : ''}`}>{t.legs >= 2 ? '✓' : '○'} {t.legKind} QR</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="s4zv-acts">
                          <button type="button" className="s4zv-btn s4zv-btn--open"
                            disabled={busy !== null}
                            aria-busy={busy?.kind === 'open' && busy.code === t.code}
                            title="Open this scan task"
                            onClick={() => run('open', t.code, () => onOpenTask(t.code))}>
                            {busy?.kind === 'open' && busy.code === t.code
                              ? <><span className="s4zv-spin" aria-hidden />Opening…</>
                              : <><span><IcoPlay /></span>Open Task</>}
                          </button>
                          <button type="button" className="s4zv-btn s4zv-btn--cancel"
                            disabled={busy !== null || t.legs > 0}
                            aria-busy={busy?.kind === 'cancel' && busy.code === t.code}
                            title={t.legs > 0 ? 'Scanning has started on the Zebra device — the task can no longer be cancelled' : 'Cancel this scan task'}
                            onClick={() => run('cancel', t.code, () => onCancelTask(t.code))}>
                            {busy?.kind === 'cancel' && busy.code === t.code
                              ? <><span className="s4zv-spin" aria-hidden />Cancelling…</>
                              : <><span><IcoXSm /></span>Cancel Task</>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="s4zv-empty">
              <div className="s4zv-empty__i"><IcoZvZebra /></div>
              <b>No open Zebra tasks</b>
              <span>Boxes sent for Zebra verification appear here until the operator scans the Box QR and the location QR.</span>
            </div>
          )}
        </div>

        <div className="s4zv-ft">
          <span className="s4zv-ft__n">
            A box is placed only after the operator scans its Box QR and the location QR on the Zebra device.
            Cancel a task to switch the box to manual confirmation.
          </span>
          <button type="button" className="s4zv-ft__b" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const zvSvg = (d: React.ReactNode, strokeWidth = 2.1) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);

const IcoZvZebra = () => zvSvg(<>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <line x1="7" y1="8" x2="7" y2="16" /><line x1="12" y1="8" x2="12" y2="16" />
  <line x1="17" y1="8" x2="17" y2="16" />
</>);

const IcoZvBox = () => zvSvg(<>
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
  <line x1="12" y1="22.08" x2="12" y2="12" />
</>);

const IcoZvPin = () => zvSvg(<>
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
  <circle cx="12" cy="10" r="3" />
</>, 2.2);

const IcoZvClock = () => zvSvg(<>
  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
</>, 2.2);

const IcoPlay = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
  </svg>
);

function taskStamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

function zebraTaskId(i: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ZT-${ymd}-${String(i + 1).padStart(3, '0')}`;
}

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

  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const top = Math.round(r.bottom + 8);
      const scope: ParentNode = anchor.closest('.s4-root') ?? document;
      const stop = anchor.closest('.s4-panel') ?? scope.querySelector('.s4-panels');
      const floor = stop ? stop.getBoundingClientRect().bottom : window.innerHeight;
      const limit = Math.min(window.innerHeight - 12, floor - 8);
      setPos({
        top,
        left: Math.max(12, Math.round(r.right - el.offsetWidth)),
        height: Math.max(220, limit - top),
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [onClose]);

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
        <span className="s4lg-hd__i"><IcoLog size={15} /></span>
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

export default function Step4PutawayAllocation({ draft, boxes, lines = [], flagMaster = [], spiId = null, warehouse, warehouseInfo = null, spiCode = null, readOnly = false, direct = false, onProgress, onLoadBox }: {
  draft: InvoiceDraft;
  boxes: SpiBox[];
  lines?: ProductLine[];
  flagMaster?: ProductFlagOption[];
  spiId?: number | null;
  warehouse?: string | null;
  warehouseInfo?: SelectLocationWarehouse | null;
  spiCode?: string | null;
  readOnly?: boolean;
  /** No purchase order behind this invoice — passed to the stage summary. */
  direct?: boolean;
  onProgress?: (placed: number, total: number) => void;
  onLoadBox?: (boxId: number) => Promise<SpiBox | null>;
}) {
  const [tab, setTab] = useState<'all' | Disposition>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [lcStep, setLcStep] = useState(0);
  const panelsRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const toggleFs = () => setFs(v => !v);
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs]);
  const [flag, setFlag] = useState<'' | 'haz' | 'nonhaz' | 'cold'>('');

  const [boardTick, setBoardTick] = useState(0);
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
  }, [spiId, boxKey, boardTick]);

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
            task: null,
          }
          : r),
      };
    });
  };

  useEffect(() => {
    if (board) onProgress?.(board.counts.placed, board.counts.total);
  }, [board?.counts.placed, board?.counts.total]);

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
  const boxFlagNames = useMemo(
    () => (rawBox ? flagNames(rawBox.items ?? [], flagMaster) : []),
    [rawBox, flagMaster],
  );
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
  /** Which box's sticker is open - its own state, so a card's Sticker button
   *  opens it straight away without switching the selected box first. */
  const [qrFor, setQrFor] = useState<string | null>(null);
  const toast = useToast();
  const stickerBusy = useRef(false);
  const [stickerBusyKind, setStickerBusyKind] = useState<'pdf' | 'print' | null>(null);
  const stickerFailed = (e: unknown) => toast.error('Could not get the sticker',
    e instanceof PoApiError ? e.firstError : 'Please try again.');
  const stickerPdf = async (boxId: number, code: string) => {
    if (stickerBusy.current) return;
    if (!spiId) { toast.warning('Save the invoice first', 'The sticker needs a saved SPI.'); return; }
    stickerBusy.current = true;
    setStickerBusyKind('pdf');
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
      setStickerBusyKind(null);
    }
  };
  const stickerPrint = async (boxId: number) => {
    if (stickerBusy.current) return;
    if (!spiId) { toast.warning('Save the invoice first', 'The sticker needs a saved SPI.'); return; }
    stickerBusy.current = true;
    setStickerBusyKind('print');
    try {
      await spiApi.printSticker(spiId, boxId);
      window.print();
    } catch (e) {
      stickerFailed(e);
    } finally {
      stickerBusy.current = false;
      setStickerBusyKind(null);
    }
  };
  const [placedAt, setPlacedAt] = useState<string | null>(null);
  const [methodAsk, setMethodAsk] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [methodPick, setMethodPick] = useState<'zebra' | 'manual' | null>(null);
  const [methodStage, setMethodStage] = useState<'select' | 'detail'>('select');
  const methodRef = useMemo(() => {
    const n = new Date();
    const ymd = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
    return { task: `ZT-${ymd}-001`, alloc: `TPA-${ymd}-001` };
  }, [methodAsk]);
  const [methodOk, setMethodOk] = useState(false);
  const [scanTask, setScanTask] = useState<{ id: string; at: string; apiId: number } | null>(null);
  const [methodBusy, setMethodBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelWhich, setCancelWhich] = useState<'only' | 'manual' | null>(null);
  const scanDoneRef = useRef(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [zebraOpen, setZebraOpen] = useState(false);
  /* True only between the click and the frame that shows the dialog. The
     button had no state at all, so a slow frame looked like a dead control. */
  const [zebraOpening, setZebraOpening] = useState(false);
  /* The board refresh is kicked off once the dialog is ON SCREEN, not in the
     click that opens it. Queued in that click it put a parent-wide state
     change and a fetch into the same render the dialog had to come up in;
     useEffect runs after paint, so the dialog shows first and refreshes behind
     itself. Clearing the opening mark here means the spinner lasts exactly as
     long as that frame does — invisible when it is quick. */
  useEffect(() => {
    setZebraOpening(false);
    if (zebraOpen) setBoardTick(t => t + 1);
  }, [zebraOpen]);
  const [placedVia, setPlacedVia] = useState<{ via: string; allocation: string } | null>(null);
  const [productViewId, setProductViewId] = useState<number | null>(null);
  const [modeAsk, setModeAsk] = useState<null | { loading: boolean; rack: number; norack: number; error: string | null }>(null);
  const [modePick, setModePick] = useState<'rack' | 'norack' | null>(null);
  const [putMode, setPutMode] = useState<'rack' | 'norack' | null>(null);
  const [loc, setLoc] = useState<{ loading: boolean; data: PutawayLocations | null; error: string | null }>(
    { loading: false, data: null, error: null });
  const [spot, setSpot] = useState<number | null>(null);
  const [assigned, setAssigned] = useState<{ boxId: number; spot: number; putawayId: number } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [locTick, setLocTick] = useState(0);
  const [scanSteps, setScanSteps] = useState(0);
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [logsOpen, setLogsOpen] = useState(false);
  const logBtnRef = useRef<HTMLButtonElement>(null);
  const addLog = (code: string | null | undefined, k: LogKind, t: string, d = '') => {
    if (!code) return;
    setLogs(prev => {
      const list = prev[code] ?? [];
      const last = list[list.length - 1];
      if (last && last.t === t && last.d === d) return prev;
      return { ...prev, [code]: [...list, { k, t, d, time: hhmmss() }] };
    });
  };
  const spotLabel = (s: ReturnType<typeof findSpot>) => {
    if (!s) return '';
    const wh = warehouseInfo?.code ?? '';
    return s.kind === 'zone'
      ? [wh, s.zone.code].filter(Boolean).join(' → ') + (s.zone.name ? ` · ${s.zone.name}` : '')
      : [wh, s.zone.code, s.rack.code, s.shelf.code].filter(Boolean).join(' → ');
  };

  const detail = detailIdx == null ? null : products[detailIdx] ?? null;
  useEffect(() => {
    setShowProducts(false); setProdPage(1); setLcStep(0); setDetailIdx(null);
    setModeAsk(null); setModePick(null); setPutMode(null);
    setPlacedAt(null); setScanTask(null); setSpot(null); setScanOpen(false);
    setScanSteps(0); setLogsOpen(false); setAssigned(null); setAssigning(false);
  }, [selected]);
  const pageOfProducts = products.slice((prodPage - 1) * PRODUCTS_PER_PAGE, prodPage * PRODUCTS_PER_PAGE);

  const placed = scope.filter(b => b.location).length;
  const hazCount = scope.filter(b => b.haz).length;
  const coldCount = scope.filter(b => b.cold).length;
  const pct = scope.length ? Math.round((placed / scope.length) * 100) : 0;
  const box = all.find(b => b.code === selected) ?? null;
  useEffect(() => {
    if (!box || !onLoadBox) return;
    void onLoadBox(box.id);
  }, [box?.id]);

  const qrBox = qrFor ? all.find(b => b.code === qrFor) ?? null : null;
  const qrRaw = useMemo(() => (qrFor ? boxes.find(b => b.box_code === qrFor) : undefined), [boxes, qrFor]);
  const qrHsn = useMemo(() => productsOf(qrRaw, lines, flagMaster)[0]?.hsn, [qrRaw, lines, flagMaster]);
  /* The sticker's box may not be the selected one, so load its detail too. */
  useEffect(() => {
    if (!qrBox || !onLoadBox || qrBox.id === box?.id) return;
    void onLoadBox(qrBox.id);
  }, [qrBox?.id]);
  const boxLocked = readOnly || placedAt !== null || box?.status === 'placed' || scanTask !== null || box?.status === 'awaiting_scan';

  const zebraTasks = useMemo(() => {
    const open = all.filter(b => b.status === 'awaiting_scan');
    if (scanTask && box && !open.some(b => b.code === box.code)) return [box, ...open];
    return open;
  }, [all, scanTask, box]);

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
  const nextBoxCode = (() => {
    const i = shown.findIndex(b => b.code === selected);
    const order = i < 0 ? shown : [...shown.slice(i + 1), ...shown.slice(0, i)];
    return order.find(b => !b.location)?.code ?? null;
  })();
  useEffect(() => {
    if (selected && shownCodes.split('|').includes(selected)) return;
    setSelected(firstAwaiting);
  }, [firstAwaiting, selected, shownCodes]);

  const askStorageMode = () => {
    if (!box || boxLocked) return;
    setModePick(null);
    if (!spiId) {
      setModeAsk({ loading: false, rack: 0, norack: 0, error: 'Save the invoice before allocating a location.' });
      return;
    }
    setModeAsk({ loading: true, rack: 0, norack: 0, error: null });
    spiApi.putawayModes(spiId, box.id)
      .then(m => {
        setModeAsk({ loading: false, rack: m.rack, norack: m.norack, error: null });
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
    if (boxLocked && loc.data) return;
    let live = true;
    setLoc({ loading: true, data: null, error: null });
    setSpot(null);
    spiApi.putawayLocations(spiId, box.id, putMode)
      .then(d => { if (live) setLoc({ loading: false, data: d, error: null }); })
      .catch(e => { if (live) setLoc({ loading: false, data: null,
        error: e instanceof PoApiError ? e.firstError
          : e instanceof Error ? e.message : 'Could not read the warehouse layout.' }); });
    return () => { live = false; };
  }, [lcStep, putMode, spiId, box?.id, locTick]);

  const assignSpot = async () => {
    if (boxLocked) return;
    if (!spiId || !box || !putMode || spot === null || assigning) return;
    if (assigned && assigned.boxId === box.id && assigned.spot === spot) { setLcStep(2); return; }
    const sp = findSpot(loc.data, spot);
    if (!sp) { toast.warning('Choose a location', 'That location is no longer in the list. Pick it again.'); return; }
    const body: PutawayAssignBody = sp.kind === 'shelf'
      ? {
          box_id: box.id, mode: 'rack', zone_id: sp.zone.id, rack_id: sp.rack.id, shelf_id: sp.shelf.id,
          suggested_shelf_id: loc.data?.recommended?.id ?? null,
        }
      : { box_id: box.id, mode: 'norack', zone_id: sp.zone.id };
    setAssigning(true);
    try {
      const row = await spiApi.putawayAssign(spiId, body);
      setAssigned({ boxId: box.id, spot, putawayId: row.id });
      toast.success(`${putId(box.code)} allocated`, row.destination ? `Reserved at ${row.destination}.` : 'The location is reserved for this box.');
      setBoardTick(t => t + 1);
      setLcStep(2);
    } catch (e) {
      const msg = e instanceof PoApiError ? e.firstError : 'Please try again.';
      if (e instanceof PoApiError && e.status === 409) {
        toast.warning('Location taken', msg);
        setLocTick(t => t + 1);
      } else {
        toast.error('Could not allocate the box', msg);
      }
    } finally {
      setAssigning(false);
    }
  };

  const putawayIdOf = (boxId: number): number | null =>
    (assigned && assigned.boxId === boxId ? assigned.putawayId : null)
      ?? board?.boxes.find(r => r.box_id === boxId)?.putaway_id ?? null;

  const apiError = (e: unknown) => (e instanceof PoApiError ? e.firstError : 'Please try again.');

  const confirmManual = async () => {
    if (!spiId || !box || methodBusy || readOnly) return false;
    const rowId = putawayIdOf(box.id);
    if (!rowId) { toast.warning('Allocate the box first', 'Choose a location in Step 02 and press Next.'); return false; }
    setMethodBusy(true);
    try {
      await spiApi.putawayConfirmManual(spiId, rowId);
      setPlacedAt(new Date().toISOString());
      setPlacedVia(null);
      setScanTask(null);
      markPlaced(box.id, locCodeOf(findSpot(loc.data, spot)));
      setBoardTick(t => t + 1);
      toast.success(`${putId(box.code)} put away`, 'The placement is confirmed and the location is locked to this box.');
      return true;
    } catch (e) {
      toast.error('Could not confirm the putaway', apiError(e));
      return false;
    } finally {
      setMethodBusy(false);
    }
  };

  const raiseScanTask = async () => {
    if (!spiId || !box || methodBusy || readOnly) return false;
    const rowId = putawayIdOf(box.id);
    if (!rowId) { toast.warning('Allocate the box first', 'Choose a location in Step 02 and press Next.'); return false; }
    setMethodBusy(true);
    try {
      const task = await spiApi.putawayScanTask(spiId, rowId);
      scanDoneRef.current = false;
      setScanSteps(taskScansDone(task));
      setScanTask({ id: task.task_code, at: task.issued_at ?? new Date().toISOString(), apiId: task.id });
      setBoardTick(t => t + 1);
      toast.success(`Task ${task.task_code} raised`, `${putId(box.code)} is waiting for the Zebra handheld to scan it.`);
      return true;
    } catch (e) {
      toast.error('Could not raise the Zebra task', apiError(e));
      return false;
    } finally {
      setMethodBusy(false);
    }
  };

  const cancelScanTask = async (which: 'only' | 'manual'): Promise<boolean> => {
    if (!scanTask || cancelBusy || readOnly) return false;
    if (scanSteps > 0) {
      toast.warning('Scanning has started', 'The Zebra device has already scanned this box — the task can no longer be cancelled.');
      setCancelAsk(false);
      return false;
    }
    setCancelBusy(true);
    setCancelWhich(which);
    try {
      await spiApi.putawayCancelTask(scanTask.apiId, 'Cancelled from the SPI form');
      setBoardTick(t => t + 1);
      return true;
    } catch (e) {
      toast.error('Could not cancel the task', apiError(e));
      return false;
    } finally {
      setCancelBusy(false);
      setCancelWhich(null);
    }
  };

  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!spiId || !box || !board || restoredFor.current === box.code) return;
    const br = board.boxes.find(r => r.box_id === box.id);
    if (!br) return;
    restoredFor.current = box.code;
    if (br.status === 'pending' || !br.putaway_id) return;
    let live = true;
    const boxId = box.id;
    spiApi.putawayRows(spiId)
      .then(async rows => {
        const row = rows.find(r => r.box_id === boxId);
        if (!live || !row || !row.zone_id) return;
        const mode: 'rack' | 'norack' = row.shelf_id ? 'rack' : 'norack';
        const place = row.shelf_id ?? row.zone_id;
        const data = await spiApi.putawayLocations(spiId, boxId, mode);
        if (!live) return;
        setPutMode(mode);
        setLoc({ loading: false, data, error: null });
        setSpot(place);
        setAssigned({ boxId, spot: place, putawayId: row.id });
        if (br.task) {
          scanDoneRef.current = false;
          setScanSteps(Math.min(2, br.task.scans.done));
          setScanTask({ id: br.task.task_code, at: row.assigned_at ?? new Date().toISOString(), apiId: br.task.id });
        }
        if (br.status === 'placed') {
          setPlacedAt(row.confirmed_at ?? new Date().toISOString());
          setPlacedVia(row.verify_method === 'manual' ? null : { via: 'Using Zebra Device', allocation: putId(box.code) });
        }
        setLcStep(2);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [spiId, box?.code, board]);

  const pendingTask = useRef<{ code: string; kind: 'open' | 'cancel' } | null>(null);
  const taskAction = (code: string, kind: 'open' | 'cancel') => {
    if (readOnly && kind === 'cancel') return;
    if (box && box.code === code && scanTask) {
      if (kind === 'open') setScanOpen(true); else setCancelAsk(true);
      return;
    }
    pendingTask.current = { code, kind };
    setSelected(code);
  };
  useEffect(() => {
    const p = pendingTask.current;
    if (!p || !box || box.code !== p.code || !scanTask || !loc.data) return;
    pendingTask.current = null;
    if (p.kind === 'open') setScanOpen(true); else setCancelAsk(true);
  }, [box?.code, scanTask?.apiId, loc.data]);

  const finishFromTask = (code: string) => {
    if (!box || scanDoneRef.current) return;
    scanDoneRef.current = true;
    setScanSteps(2);
    setPlacedAt(new Date().toISOString());
    setPlacedVia({ via: 'Using Zebra Device', allocation: code });
    markPlaced(box.id, locCodeOf(findSpot(loc.data, spot)));
    setBoardTick(t => t + 1);
    setScanTask(null);
    setScanOpen(false);
    toast.success(`${putId(box.code)} put away`, `Both scans came back on task ${code}.`);
  };

  const scanOpenRef = useRef(scanOpen);
  scanOpenRef.current = scanOpen;
  useEffect(() => {
    if (!scanTask) return;
    let live = true;
    let busy = false;
    let timer: number | null = null;
    const schedule = () => {
      if (!live) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(poll, scanOpenRef.current ? 5000 : 15000);
    };
    const poll = () => {
      if (!live) return;
      if (document.hidden || busy) { schedule(); return; }
      busy = true;
      spiApi.putawayTask(scanTask.apiId)
        .then(t => {
          if (!live) return;
          setScanSteps(taskScansDone(t));
          if (t.status === 'scanned') finishFromTask(t.task_code);
          else if (t.status === 'cancelled' || t.status === 'expired' || t.status === 'failed') {
            setScanTask(null);
            setScanOpen(false);
            setScanSteps(0);
            setBoardTick(n => n + 1);
            toast.warning(`Task ${t.task_code} ${t.status}`,
              t.failed_reason || 'The box is still allocated — confirm it again, by hand or with a new task.');
          }
        })
        .catch(() => {})
        .finally(() => { busy = false; schedule(); });
    };
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    poll();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scanTask?.apiId]);

  useEffect(() => {
    if (!scanTask || !scanOpen) return;
    void spiApi.putawayTask(scanTask.apiId)
      .then(t => setScanSteps(taskScansDone(t)))
      .catch(() => {});
  }, [scanOpen]);

  return (
    <div className={`s4-root${fs ? ' is-fullview' : ''}`}>
      {!fs && <StageSummary draft={draft} upto={3} direct={direct} boxes={boxes} />}
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
        <div className="s4b-tools">
          <button
            type="button"
            className="s4fs-btn s4b-toolbtn"
            title="Zebra scan tasks waiting on the warehouse floor"
            aria-haspopup="dialog"
            aria-expanded={zebraOpen}
            aria-busy={zebraOpening}
            onClick={() => { setLogsOpen(false); setZebraOpening(true); setZebraOpen(true); }}
          >
            {/* The glyph slot carries the mark, as the dialog's own buttons do
                — the button keeps its colour, since a faded control that is
                also spinning reads as broken rather than busy. */}
            {zebraOpening ? <span className="s4ct-spin" aria-hidden /> : <IcoScan />}
            <span className="s4fs-t">Zebra Open Tasks</span>
            <span className="s4fs-c">{zebraTasks.length}</span>
          </button>
          <button
            type="button"
            ref={logBtnRef}
            className="s4fs-btn s4b-toolbtn s4-scanlogs"
            title="Scan logs for this box"
            aria-expanded={logsOpen}
            onClick={() => { setZebraOpen(false); setLogsOpen(o => !o); }}
          >
            <IcoLog size={14} />
            <span className="s4fs-t">Scan Logs</span>
          </button>
          <button
            type="button"
            className="s4fs-btn s4b-toolbtn"
            title={fs ? 'Exit full view' : 'Full view'}
            aria-pressed={fs}
            onClick={toggleFs}
          >
            {fs ? <IcoCollapse /> : <IcoExpand />}
            <span className="s4fs-t">{fs ? 'Exit Full View' : 'Full View'}</span>
          </button>
        </div>
      </div>

      <div className={`s4-panels${fs ? ' is-fs' : ''}`} ref={panelsRef}>
        <div
          id="s4PanelLeft"
          className={`s4-panel s4-panel--left${leftOpen ? '' : ' is-collapsed'}`}
        >
          <div className="s4-panel__head" onClick={() => setLeftOpen(o => !o)}>
            <div className="s4-panel__head-ico"><IcoBoxSm /></div>
            <div className="s4-panel__head-text">
              <div className="s4-panel__head-title">Pick a Box</div>
            </div>
            <span className="s4-panel__head-count">
              {shown.length} Box{shown.length === 1 ? '' : 'es'}
            </span>
            <button
              type="button"
              className="s4-panel__toggle"
              title={leftOpen ? 'Collapse' : 'Expand'}
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
                        onSticker={() => setQrFor(bx.code)}
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
          <div className="s4-panel__head" onClick={rightOpen ? undefined : () => setRightOpen(true)}>
            <div className="s4-panel__head-ico"><IcoGrid /></div>
            <div className="s4-panel__head-text">
              <div className="s4-panel__head-title">Temporary Putaway Allocation</div>
            </div>
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
              onClick={e => {
                e.stopPropagation();
                if (rightOpen) setLeftOpen(true);
                setRightOpen(o => !o);
              }}
            >
              <IcoChevR />
            </button>
            <div className="s4-panel__collapsed-label">Putaway Allocation</div>
          </div>

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
                <div className="s4h">
                  {lcStep === 3 && (
                  <div className="s4h-hero">
                    <div className="s4h-hero__id">
                      <div className="s4h-hero__ico"><IcoBoxSm size={21} /></div>
                      <div className="s4h-hero__txt">
                        <div className="s4h-hero__row">
                          <span className="s4h-chip">{putId(box.code)}</span>
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
                        scenario: box.scenario,
                        status: box.status === 'placed' ? 'Placed'
                          : box.status === 'awaiting_scan' ? 'Awaiting Zebra scan'
                          : box.status === 'draft' ? 'Location allocated'
                          : 'Awaiting putaway',
                      }}
                      mode={putMode} state={loc} spot={spot} onSpot={boxLocked ? () => {} : setSpot}
                      warehouse={warehouseInfo ?? (warehouse ? { name: warehouse } : null)}
                    />
                  ) : lcStep === 2 ? (
                    <PutawayConfirmPlacement
                      box={{
                        code: box.code, scenario: box.scenario, skus: box.skus, qty: box.qty,
                        uom: box.uom, dims: box.dims, netKg: box.netKg, grossKg: box.grossKg,
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
                      qr={<BoxQr text={box.code} size={92} bare />}
                      locQr={<BoxQr text={`${warehouse ?? ''}/${spot ?? ''}`} size={80} bare />}
                      onSticker={() => box && setQrFor(box.code)}
                      onChange={() => { if (!boxLocked) setLcStep(1); }}
                      scan={scanTask}
                      scansDone={scanSteps}
                      readOnly={readOnly}
                      placedVia={placedVia}
                      warehouseCode={warehouse || null}
                      onMethod={() => { if (readOnly) return; setMethodPick(null); setMethodOk(false); setMethodStage('select'); setMethodAsk(true); }}
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
                      onSticker={() => box && setQrFor(box.code)}
                      onNext={boxLocked ? () => setLcStep(2) : askStorageMode}
                      nextDisabled={readOnly && box.status === 'pending'}
                    />
                  )}
                </div>

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
                    disabled={lcStep >= LIFECYCLE.length - 1 || (lcStep === 1 && (spot === null || assigning))}
                    title={lcStep === 1 && spot === null
                      ? (putMode === 'norack'
                          ? 'Choose a zone first — use the recommended one, or pick one from the list'
                          : 'Choose a spot first — use the recommended one, or pick a shelf from the tree')
                      : undefined}
                    onClick={() => {
                      if (lcStep === 1) { if (boxLocked) setLcStep(2); else void assignSpot(); return; }
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

      <FsLayer host={fs ? panelsRef.current : null}>
      {scanOpen && scanTask && box && findSpot(loc.data, spot) && (() => {
        const sp = findSpot(loc.data, spot)!;
        const held = sp.kind === 'zone' ? sp.zone : sp.shelf;
        const reserved = Math.max(0, Math.round((held.used_pct_after - held.used_pct) * 10) / 10);
        return (
          <PutawayScanTask
            taskId={scanTask.id}
            allocRef={methodRef.alloc}
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
              rack: sp.kind === 'zone' ? null : sp.rack.code,
              shelf: sp.kind === 'zone'
                ? sp.zone.code
                : sp.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1'),
              shelfName: sp.kind === 'zone'
                ? (sp.zone.name || 'Direct placement')
                : (sp.shelf.name || `Level ${sp.shelf.level_no}`),
            }}
            reservedPct={reserved}
            serverScans={scanSteps}
            onClose={() => setScanOpen(false)}
            onScan={(leg, ok) => {
              const what = leg === 'box' ? 'Box QR' : sp.kind === 'zone' ? 'Zone QR' : 'Shelf QR';
              const where = leg === 'box' ? box.code : spotLabel(sp);
              if (ok) {
                addLog(box.code, 'scan', `${what} scanned`, `${where} · verified on Zebra handheld`);
              } else {
                addLog(box.code, 'err', `${what} mismatch`, `${where} — rejected`);
              }
            }}
            onComplete={() => {
              spiApi.putawayTask(scanTask.apiId)
                .then(t => {
                  if (t.status === 'scanned') finishFromTask(t.task_code);
                  else toast.info('Waiting for the handheld',
                    'Prototype scans are not saved. The box is placed once the Zebra device scans both labels.');
                })
                .catch(e => toast.error('Could not read the task', apiError(e)));
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
                <div className="s4qm__s">{putId(box.code)} · {box.scenario}</div>
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

      {zebraOpen && (
        <ZebraOpenTasks
          tasks={zebraTasks.map((b): ZebraTaskRow => {
            const live = !!(scanTask && box && b.code === box.code);
            const s = live ? findSpot(loc.data, spot) : null;
            const rows: ZebraTaskRow['loc'] = [];
            if (s) {
              if (warehouseInfo?.code) {
                rows.push({ label: 'Warehouse', code: warehouseInfo.code, name: warehouseInfo.name,
                  tag: warehouseInfo.own === false ? 'Third Party' : 'Own' });
              }
              if (s.zone?.code) rows.push({ label: 'Zone', code: s.zone.code, name: s.zone.name ?? undefined });
              if (s.kind !== 'zone') {
                if (s.rack?.code)  rows.push({ label: 'Rack',  code: s.rack.code,  name: s.rack.name ?? undefined });
                if (s.shelf?.code) rows.push({ label: 'Shelf', code: s.shelf.code, name: s.shelf.name ?? undefined });
              }
            } else if (b.destination) {
              const parts = b.destination.split(/\s*[/→]\s*/).filter(Boolean);
              const labels = ['Warehouse', 'Zone', 'Rack', 'Shelf'];
              parts.forEach((code, i) => rows.push({ label: labels[i] ?? 'Level', code }));
            }
            return {
              code: b.code,
              taskId: live ? scanTask!.id : (b.taskCode ?? null),
              createdAt: taskStamp(live ? scanTask!.at : null),
              scenario: b.scenario,
              qty: b.qty,
              legs: live ? scanSteps : Math.min(2, board?.boxes.find(r => r.box_code === b.code)?.task?.scans.done ?? 0),
              legKind: s?.kind === 'zone' ? 'Zone' : 'Shelf',
              loc: rows,
              live,
            };
          })}
          onOpenTask={code => taskAction(code, 'open')}
          onCancelTask={code => taskAction(code, 'cancel')}
          spiCode={spiCode}
          poNumber={draft.poNumber || null}
          supplier={draft.supplier || null}
          wh={warehouseInfo
            ? { id: warehouseInfo.code, name: warehouseInfo.name, own: warehouseInfo.own !== false }
            : (warehouse ? { name: warehouse } : null)}
          onClose={() => setZebraOpen(false)}
        />
      )}

      {qrBox && (
        <PutawayBoxSticker
          boxId={qrBox.code}
          spiNumber={draft.invoiceNumber || '—'}
          scenario={STICKER_SCENARIO[qrBox.scenarioKey] ?? 'S1 — Single'}
          product={qrBox.name}
          code={qrBox.productCodes[0] ?? '—'}
          mode={SCENARIO_LABEL[qrBox.scenarioKey] ?? qrBox.scenario}
          condition={CONDITION_LABEL[qrBox.condition] ?? 'Perfect'}
          sku={qrHsn ? `HSN ${qrHsn}` : '—'}
          qty={qrBox.qty}
          date={packedOnOf(qrRaw) ?? '—'}
          qr={<BoxQr text={qrBox.code} size={96} />}
          onClose={() => setQrFor(null)}
          onPdf={() => { void stickerPdf(qrBox.id, qrBox.code); }}
          onPrint={() => { void stickerPrint(qrBox.id); }}
          busy={stickerBusyKind}
        />
      )}

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
                <span className="s4wz-ctx__i"><IcoBoxSm size={13} /><span><em>Box ID</em><b>{putId(box.code)}</b></span></span>
                <span className="s4wz-ctx__i">
                  <IcoFlag /><span>
                    <em>{spotNow.kind === 'zone' ? 'Zone' : 'Shelf'}</em>
                    <b>{spotNow.kind === 'zone'
                      ? spotNow.zone.code
                      : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1')}</b>
                  </span>
                </span>
              </div>
              <button type="button" className="s4qm__x" disabled={methodBusy} onClick={() => setMethodAsk(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="s4qm__bd">
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

              {methodStage === 'detail' && (() => {
                const shelfCode = spotNow.kind === 'zone'
                  ? spotNow.zone.code
                  : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');
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
                const steps: Array<[string, string]> = methodPick === 'zebra'
                  ? [
                      ['Task created', 'Assigned to the warehouse Zebra queue'],
                      ['Scan Box QR', `Operator scans the ${putId(box.code)} sticker`],
                      [`Scan ${spotNow.kind === 'zone' ? 'Zone' : 'Shelf'} QR`, `Operator scans ${shelfCode} at the location`],
                      ['Putaway locked', 'Location confirmed automatically'],
                    ]
                  : [
                      ['Box already placed', `${putId(box.code)} is physically at ${shelfCode}`],
                      ['Consent recorded', 'Your confirmation is logged on this SPI'],
                      ['Allocation generated', `${methodRef.alloc} is issued`],
                      ['Putaway completed', `${spotNow.kind === 'zone' ? 'Zone' : 'Shelf'} ${shelfCode} is locked for this box`],
                    ];
                return (
                  <>
                  <div className="s4pm-grid">
                  <div className="s4pm-left">
                    <div className="s4pm-route">
                      <div className="s4pm-route__card s4pm-route__card--box">
                        <span className="s4pm-route__ic s4pm-route__ic--box"><IcoBoxSm size={17} /></span>
                        <div>
                          <span className="s4pm-route__k">Box</span>
                          <b className="s4pm-route__v">{putId(box.code)}</b>
                        </div>
                      </div>
                      <span className="s4pm-route__go" aria-hidden><IcoArrow /></span>
                      <div className="s4pm-route__card s4pm-route__card--shelf">
                        <span className="s4pm-route__ic s4pm-route__ic--shelf"><IcoShelfSm size={17} /></span>
                        <div>
                          <span className="s4pm-route__k">{spotNow.kind === 'zone' ? 'Final zone' : 'Final shelf'}</span>
                          <b className="s4pm-route__v">{shelfCode}</b>
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

                    <div className="s4pm-warn">
                      <span className="s4pm-warn__ic" aria-hidden>!</span>
                      <p>
                        <b>This is final.</b>{' '}
                        {methodPick === 'zebra' ? (
                          <>Once submitted, {spotNow.kind === 'zone' ? 'zone' : 'shelf'} <b>{shelfCode}</b> is
                          reserved for <b>{putId(box.code)}</b> and the box is placed only after both QR scans are
                          received on the Zebra handheld.</>
                        ) : (
                          <>Once confirmed, {spotNow.kind === 'zone' ? 'zone' : 'shelf'} <b>{shelfCode}</b> is
                          locked for <b>{putId(box.code)}</b> — it <b>cannot be undone</b> and the box location{' '}
                          <b>cannot be changed</b>. No Zebra scan will be requested.</>
                        )}
                      </p>
                    </div>

                    <label className={`s4pm-ok s4pm-ok--${methodPick}${methodOk ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={methodOk} disabled={methodBusy} onChange={e => setMethodOk(e.target.checked)} />
                      <span>
                        I confirm that <b>{putId(box.code)}</b> is{' '}
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
                disabled={methodBusy}
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
              <button type="button" className="s4-btn-back s4pm-cancel" disabled={methodBusy} onClick={() => setMethodAsk(false)}>Cancel</button>
              <button
                type="button"
                className={`s4-btn-next s4pm-go${methodPick ? ` s4pm-go--${methodPick}` : ''}`}
                disabled={!methodPick || !methodOk || methodBusy}
                aria-busy={methodBusy}
                onClick={async () => {
                  const ok = methodPick === 'manual' ? await confirmManual() : await raiseScanTask();
                  if (ok) setMethodAsk(false);
                }}
              >
                {methodBusy ? <><span className="spi-btn-spin" aria-hidden />Saving…</>
                  : methodPick === 'zebra' ? <><IcoScan />Submit for Zebra Verification</>
                  : methodPick === 'manual' ? <><IcoCheck />Confirm Putaway Allocation</>
                  : <>Select a method <IcoChevR /></>}
              </button>
              </>)}
            </div>
          </div>
        </div>
      );
      })()}

      {cancelAsk && box && scanTask && (() => {
      const spotNow = findSpot(loc.data, spot);
      const locCode = !spotNow ? null
        : spotNow.kind === 'zone' ? spotNow.zone.code
        : spotNow.shelf.code.replace(/^.*?-(SH-\d+)$/, '$1');
      return (
        <div className="s4qm s4wz-modal s4ct-modal is-open" role="dialog" aria-modal="true"
          aria-label="Cancel Zebra scan task">
          <div className="s4qm__dlg s4wz__dlg">
            <div className="s4qm__hd">
              <div className="s4qm__hico">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="s4qm__htx">
                <div className="s4qm__t">Cancel Zebra Scan Task?</div>
                <div className="s4qm__s">{scanTask.id} &middot; {scanSteps} / 2 scans received</div>
              </div>
              <div className="s4wz-ctx">
                <span className="s4wz-ctx__i"><IcoBoxSm size={13} /><span><em>Box ID</em><b>{putId(box.code)}</b></span></span>
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
              <div className="s4ct-warn">
                <span className="s4ct-warn__i"><IcoZvZebra /></span>
                <div>
                  <b>This will cancel task {scanTask.id}</b>
                  <ul>
                    <li>The task is removed from the warehouse Zebra queue.</li>
                    <li>
                      {putId(box.code)} stays allocated to{' '}
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
                    If the Zebra handheld is unavailable, confirm that {putId(box.code)} is already
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
                disabled={cancelBusy}
                aria-busy={cancelWhich === 'only'}
                onClick={async () => {
                  if (!(await cancelScanTask('only'))) return;
                  addLog(box.code, 'cancel', 'Zebra scan task cancelled',
                    [scanTask.id, 'method cleared'].filter(Boolean).join(' · '));
                  setScanTask(null);
                  setScanSteps(0);
                  setCancelAsk(false);
                }}
              >
                {cancelWhich === 'only'
                  ? <><span className="s4ct-spin" aria-hidden /> Cancelling…</>
                  : <><IcoBan /> Cancel Task Only</>}
              </button>
              <button
                type="button"
                className="s4ct-manual"
                disabled={cancelBusy}
                aria-busy={cancelWhich === 'manual'}
                onClick={async () => {
                  if (!(await cancelScanTask('manual'))) return;
                  addLog(box.code, 'cancel', 'Zebra scan task cancelled',
                    [scanTask.id, 'switching to manual'].filter(Boolean).join(' · '));
                  setScanTask(null);
                  setScanSteps(0);
                  setCancelAsk(false);
                  setMethodPick('manual');
                  setMethodOk(false);
                  setMethodStage('detail');
                  setMethodAsk(true);
                }}
              >
                {cancelWhich === 'manual'
                  ? <><span className="s4ct-spin" aria-hidden /> Cancelling…</>
                  : <>Cancel &amp; Continue with Manual <IcoChevR /></>}
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
                <div className="s4qm__s">Choose the storage zone type for this box.</div>
              </div>
              <div className="s4wz-ctx">
                <span className="s4wz-ctx__i"><IcoPin /><span><em>Box ID</em><b>{putId(box.code)}</b></span></span>
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
                      aria-disabled={modeAsk.loading}
                      aria-pressed={modePick === k}
                      /* Nothing of this kind to put the box in - not a choice. */
                      disabled={!modeAsk.loading && n === 0}
                      title={!modeAsk.loading && n === 0 ? `No ${unit} available in this warehouse` : undefined}
                      onClick={() => { if (!modeAsk.loading && n > 0) setModePick(k); }}
                    >
                      <span className="s4wz-opt__ic">{k === 'rack' ? <IcoList /> : <IcoHome />}</span>
                      <span className="s4wz-opt__tx">
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
                <div className="s4pd__eyebrow">Product details · {putId(box.code)}</div>
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
