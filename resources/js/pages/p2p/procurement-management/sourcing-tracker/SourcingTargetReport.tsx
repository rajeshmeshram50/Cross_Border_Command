import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../components/ui/Tooltip';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { tatState, todayIso, type SourcingTarget } from './data';
import { productProgress, useTargetReport, type ReportProduct } from './targetProducts';
import ClarityChip from './ClarityChip';
import ClipText from './ClipText';
import type { MapEdit } from './MapSupplierModal';
import { dmy, inr } from './format';
import { useFitRows, usePopup } from './popupHooks';
import MappedSuppliers from './MappedSuppliers';
import './popup-shell.css';               // overlay, modal box + colour vars, ×, buttons
import './sourcing-target-report.css';
import { IcoBars, IcoCal, IcoClock, IcoDb, IcoEdit, IcoPin, IcoUser, IcoUsers, IcoX, Svg } from './icons';

/* Sourcing Target Report popup (Figma). Opens from the row's "Sourcing Target Report" button and
   the Mapped Suppliers count. Products: GET /p2p/sourcing-targets/{id}/report (useTargetReport). */

/** Rows shown before the product table scrolls inside the popup. */
const VISIBLE_ROWS = 5;
/** Product names longer than this end in "…"; the full name shows in the app tooltip. */
const NAME_MAX = 25;

function ProductName({ name }: { name: string }) {
  if (name.length <= NAME_MAX) return <span className="str-name">{name}</span>;
  return (
    <Tooltip label={name}>
      <span className="str-name is-cut">
        <span aria-hidden>{`${name.slice(0, NAME_MAX).trimEnd()}…`}</span><span className="visually-hidden">{name}</span>
      </span>
    </Tooltip>
  );
}

type Props = {
  row: SourcingTarget;
  onClose: () => void;
  onMapSupplier: (row: SourcingTarget, product: ReportProduct) => void;
  /** Edit a mapped New Supplier (from its card in Mapped Suppliers). */
  onEditSupplier?: (row: SourcingTarget, product: ReportProduct, edit: MapEdit) => void;
  /** Convert to Supplier from the Mapped Suppliers popup (CS-2222); the page closes this report. */
  onConvert?: (supplierId: number, name: string) => void;
  /** Mapped suppliers already converted to Supplier Master (supKey). */
  converted?: ReadonlySet<string>;
  /** Only the target's assignee maps suppliers (the API answers 403 to anyone else). */
  canMap: boolean;
  /** Bumped by the page after a supplier is mapped: the report loads again. */
  refreshKey?: number;
};
type Tab = 'master' | 'manual';

const IcoHash = () => <Svg size={10} sw={2.4}><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></Svg>;
const IcoTag = () => <Svg size={10} sw={2.4}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Svg>;

/** One of 5 pill colours per segment, stable for the same name. */
const segClass = (name: string) => `str-seg--${[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`;

export default function SourcingTargetReport({ row, onClose, onMapSupplier, onEditSupplier, onConvert, converted, canMap, refreshKey = 0 }: Props) {
  const { products: loaded, loading, failed, reload } = useTargetReport(row, refreshKey);
  const products = useMemo(() => loaded ?? [], [loaded]);
  const masters = products.filter(p => p.source === 'Product Master');
  const manuals = products.filter(p => p.source === 'Manual Entry');
  const [picked, setPicked] = useState<Tab | null>(null);
  // Opens on Product Master when it has rows, otherwise on Manual Entry (decided once the products load).
  const tab: Tab = picked ?? (masters.length || !manuals.length ? 'master' : 'manual');
  const setTab = setPicked;
  // The product whose Supplier Count was clicked: its Mapped Suppliers popup is open.
  const [mapped, setMapped] = useState<ReportProduct | null>(null);

  // Scroll lock, Esc and focus (Mapped Suppliers / Map Supplier opened on top take Esc first).
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose });

  // From the loaded products (the list row's numbers until they arrive).
  const fromRow = { total: row.totalProducts, done: Math.min(row.completedProducts, row.totalProducts) };
  const prog = loaded ? productProgress(loaded) : { ...fromRow, pending: fromRow.total - fromRow.done, pct: fromRow.total ? Math.round((fromRow.done / fromRow.total) * 100) : 0, full: fromRow.total > 0 && fromRow.done >= fromRow.total };
  const { total, done, pending, pct, full } = prog;
  const overdue = tatState(row) === 'overdue';
  const isM = tab === 'master';
  const shown = isM ? masters : manuals;
  const sourceType = row.sources.join(' + ');

  // One fixed table height for both tabs (sticky header + up to 5 rows); see useFitRows.
  const scrollRef = useRef<HTMLDivElement>(null);
  const boxH = useFitRows(scrollRef, {
    headSelector: '.str-row--head', rowSelector: '.str-row:not(.str-row--head)', tab,
    rows: Math.min(VISIBLE_ROWS, Math.max(masters.length, manuals.length)),
  });

  const tiles: { icon: ReactNode; label: string; value: string; cls?: string }[] = [
    { icon: <IcoHash />, label: 'Sourcing Target ID', value: row.code, cls: 'is-code' },
    { icon: <IcoTag />, label: 'Source Type', value: sourceType },
    { icon: <IcoCal size={10} sw={2.4} />, label: 'Start Date', value: dmy(row.startDate) },
    { icon: <IcoClock size={10} sw={2.4} />, label: 'Due Date', value: dmy(row.dueDate), cls: overdue ? 'is-overdue' : 'is-due' },
    { icon: <IcoUser size={10} sw={2.4} />, label: 'Created By', value: row.createdBy },
    { icon: <IcoUsers size={10} sw={2.4} />, label: 'Assigned To', value: row.assignedTo, cls: 'is-assignee' },
  ];

  const rowCls = `str-row ${isM ? 'str-row--m' : 'str-row--n'}`;

  return createPortal(
    // A click on the backdrop does nothing: × or Esc closes the popup (it holds no form).
    <div className="sta-overlay">
      <div ref={dialogRef} className="sta-modal sta-modal--report" role="dialog" aria-modal="true" aria-label="Sourcing Target Report">

        <div className="str-head">
          <div className="str-head-top">
            <span className="str-head-ico"><IcoBars size={20} /></span>
            <div className="sta-head-txt">
              <div className="str-title">
                Sourcing Target Report
                <span className="str-chip">{row.code}</span>
                <span className={`str-state${full ? '' : ' is-prog'}`}><i />{full ? 'Completed' : 'In Progress'}</span>
              </div>
              <div className="str-sub">Business Reference · Generated {dmy(todayIso())}</div>
            </div>
            <button type="button" className="sta-close" aria-label="Close" onClick={onClose}><IcoX size={14} sw={2.6} /></button>
          </div>

          <div className="str-tiles">
            {tiles.map(t => (
              <div key={t.label} className="str-tile">
                <div className="str-tile-l">{t.icon}{t.label}</div>
                {/* A long name ends in "…"; the full value shows in the tooltip, only when it is cut. */}
                <FitTip label={t.value}><div className={`str-tile-v ${t.cls ?? ''}`}>{t.value}</div></FitTip>
              </div>
            ))}
          </div>

          <div className="str-stats">
            <div className="str-stat"><span>Total Products</span><b>{total}</b></div>
            <div className="str-stat is-done"><span>Completed</span><b>{done}</b></div>
            <div className="str-stat is-pend"><span>Pending</span><b>{pending}</b></div>
            <div className="str-prog">
              <div className="str-prog-top"><span>Overall Progress</span><b>{pct}%</b></div>
              <div className="str-bar" role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="str-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={isM} className={`str-tab${isM ? ' is-on' : ''}`} onClick={() => setTab('master')}>
            <IcoDb size={14} />Product Master<span>{masters.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={!isM} className={`str-tab${!isM ? ' is-on' : ''}`} onClick={() => setTab('manual')}>
            <IcoEdit size={14} />Manual Product Entry<span>{manuals.length}</span>
          </button>
        </div>

        <div className="str-scroll sct-scroller" ref={scrollRef} style={boxH ? { height: boxH } : undefined}>
          {loading ? (
            <div className="str-empty"><span><span className="sct-spin sct-spin--dark" aria-hidden />Loading the products…</span></div>
          ) : failed && !loaded ? (
            <div className="str-empty"><span>Couldn’t load the products.<button type="button" className="str-retry" onClick={reload}>Retry</button></span></div>
          ) : shown.length === 0 ? (
            <div className="str-empty">{isM ? 'No Product Master products on this sourcing target.' : 'No manually entered products on this sourcing target.'}</div>
          ) : (
            <div>
              <div className={`${rowCls} str-row--head`}>
                <span className="c">Sr No</span>{isM && <span className="c">Product Code</span>}<span>Product Name</span>
                {isM && <><span className="c">Segment</span><span className="c">HSN Code</span></>}
                <span className="c">Target Price</span><span className="c">Product Clarity</span><span className="c">Sourcing Status</span>
                <span className="c">Supplier Count</span><span className="c">Action</span>
              </div>
              {shown.map((p, i) => (
                <div key={p.key} className={rowCls}>
                  <span className="c"><span className="str-no">{i + 1}</span></span>
                  {isM && <span className="c str-code">{p.code}</span>}
                  <ProductName name={p.name} />
                  {isM && <><span className="c"><ClipText text={p.segment} className={`str-seg ${segClass(p.segment)}`} /></span><span className="c str-hsn">{p.hsn}</span></>}
                  <span className="c str-price">{inr(p.targetPrice)}</span>
                  <span className="c"><ClarityChip clarity={p.clarity} productName={p.name} /></span>
                  <span className="c"><span className={`str-status${p.done ? '' : ' is-pend'}`}><i />{p.done ? 'Completed' : 'Pending'}</span></span>
                  <span className="c">
                    {/* 0 suppliers: a plain badge, not clickable (Figma; CS-2220 V-T48). */}
                    {p.suppliers > 0 ? (
                      <Tooltip label="View mapped suppliers">
                        <button type="button" className="str-count"
                          aria-label={`${p.suppliers} mapped supplier${p.suppliers === 1 ? '' : 's'} — view`} onClick={() => setMapped(p)}>
                          {p.suppliers}
                        </button>
                      </Tooltip>
                    ) : <span className="str-count is-zero"><span aria-hidden>0</span><span className="visually-hidden">No suppliers mapped</span></span>}
                  </span>
                  <span className="c">
                    {canMap ? (
                      <button type="button" className="sta-btn sta-btn-primary str-map" onClick={() => onMapSupplier(row, p)}><IcoPin size={13} />Map Supplier Directory</button>
                    ) : (
                      // A disabled button gets no hover, so the tooltip sits on a wrapper.
                      <Tooltip label="Only the assignee maps suppliers to this target">
                        <span className="str-map-wrap">
                          <button type="button" className="sta-btn sta-btn-primary str-map is-off" disabled><IcoPin size={13} />Map Supplier Directory</button>
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {mapped && (
        <MappedSuppliers row={row} product={mapped} onClose={() => setMapped(null)} converted={converted} canMap={canMap}
          refreshKey={refreshKey}
          onAddSupplier={() => { const p = mapped; setMapped(null); onMapSupplier(row, p); }}
          /* Stays OPEN behind the edit popup — the price being edited belongs to
             a row in this list, so closing it loses the context. */
          onEdit={onEditSupplier ? e => onEditSupplier(row, mapped, e) : undefined}
          onConvert={onConvert ? (k, n) => { setMapped(null); onConvert(k, n); } : undefined} />
      )}
    </div>,
    document.body,
  );
}
