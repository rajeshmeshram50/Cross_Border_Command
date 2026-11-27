import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { type SourcingTarget } from './data';
import { productProgress, useTargetReport, type ReportProduct } from './targetProducts';
import { dmy, inr } from './format';
import { useFitRows, usePopup } from './popupHooks';
import ClipText from './ClipText';
import './product-list.css';
import { IcoCheck, IcoDb, IcoEdit, IcoX, Svg } from './icons';

/* Product List popup ("View More" from the list's Total Products cell) — Figma #bstProdModal
   (stpl-* classes). Read-only (CS-2216 V-T71). Same products as the Sourcing Target Report
   (GET /p2p/sourcing-targets/{id}/report), so Total / Completed / Pending / % match it (V-T69). */

type Tab = 'master' | 'manual';

/** Rows shown before the table scrolls inside the popup (same as the Sourcing Target Report). */
const VISIBLE_ROWS = 5;


const IcoBox = ({ size = 16, sw = 2.2 }: { size?: number; sw?: number }) => (
  <Svg size={size} sw={sw}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></Svg>
);
const IcoPendingClock = () => <Svg size={11} sw={2.5}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Svg>;
const IcoEmpty = () => <Svg size={40} sw={1.5}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></Svg>;

function Status({ done }: { done: boolean }) {
  return <span className={`stpl-pstatus ${done ? 'done' : 'prog'}`}><span className="sdot" />{done ? 'Completed' : 'In Progress'}</span>;
}

export default function ProductList({ row, onClose }: { row: SourcingTarget; onClose: () => void }) {
  const { products: loaded, loading, failed, reload } = useTargetReport(row);
  const products = useMemo(() => loaded ?? [], [loaded]);
  const masters = products.filter(p => p.source === 'Product Master');
  const manuals = products.filter(p => p.source === 'Manual Entry');
  // Opens on Product Master when it has rows, otherwise on Manual Entry (V-T74).
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (masters.length || !manuals.length ? 'master' : 'manual');
  const setTab = setPicked;

  // From the loaded products (the list row's numbers until they arrive).
  const rowDone = Math.min(row.completedProducts, row.totalProducts);
  const { total, done, pending, pct, full } = loaded ? productProgress(loaded) : {
    total: row.totalProducts, done: rowDone, pending: row.totalProducts - rowDone,
    pct: row.totalProducts ? Math.round((rowDone / row.totalProducts) * 100) : 0,
    full: row.totalProducts > 0 && rowDone >= row.totalProducts,
  };
  const shown: ReportProduct[] = tab === 'master' ? masters : manuals;

  // One fixed table height for both tabs (sticky header + up to 5 rows); see useFitRows.
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxH = useFitRows(bodyRef, {
    // As tall as the tab being viewed (up to 5 rows) — not the longer tab's height (CS-2215).
    headSelector: 'thead', rowSelector: 'tbody tr', tab,
    rows: Math.min(VISIBLE_ROWS, shown.length),
  });

  // Scroll lock, Esc and focus; a backdrop click does nothing.
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose });

  return createPortal(
    <div className="stpl-overlay">
      <div ref={dialogRef} className="stpl-box" role="dialog" aria-modal="true" aria-label={`Product List — ${row.code}`}>
        <div className="stpl-header">
          <div className="stpl-header-inner">
            <div className="stpl-title-row">
              <div className="stpl-title">
                <div className="stpl-title-icon"><IcoBox /></div>
                <div className="stpl-title-text">
                  <div className="stpl-title-line">
                    <h3>Product List — {row.code}</h3>
                    <span className={`stpl-status ${full ? 'done' : 'prog'}`}><span className="dot" />{full ? 'Completed' : 'In Progress'}</span>
                  </div>
                  <p>Source: {row.sources.join(' + ')} · Due: {dmy(row.dueDate)}</p>
                </div>
              </div>
              <button type="button" className="stpl-close" aria-label="Close" onClick={onClose}><IcoX size={13} sw={2.8} /></button>
            </div>

            <div className="stpl-stats-row">
              <div className="stpl-stat-card"><div className="stpl-stat-label">Total Products</div><div className="stpl-stat-val">{total}</div></div>
              <div className="stpl-stat-card"><div className="stpl-stat-label">Completed</div><div className="stpl-stat-val done-val">{done}</div></div>
              <div className="stpl-stat-card"><div className="stpl-stat-label">Pending</div><div className="stpl-stat-val pend-val">{pending}</div></div>
              <div className="stpl-stat-card stpl-stat-card--prog">
                <div className="stpl-stat-label">Overall Progress</div>
                <div className="stpl-prog-line">
                  <div className="stpl-progress-mini" role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="stpl-progress-mini-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="stpl-pct">{pct}%</div>
                </div>
              </div>
            </div>
          </div>

          <div className="stpl-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'master'} className={`stpl-tab${tab === 'master' ? ' active' : ''}`} onClick={() => setTab('master')}>
              <IcoDb size={13} sw={2.3} />Product Master <span className="stpl-tab-count">{masters.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'manual'} className={`stpl-tab${tab === 'manual' ? ' active' : ''}`} onClick={() => setTab('manual')}>
              <IcoEdit size={13} sw={2.3} />Manual Entry <span className="stpl-tab-count">{manuals.length}</span>
            </button>
          </div>
        </div>

        <div className="stpl-body sct-scroller" ref={bodyRef} style={boxH ? { height: boxH, flex: '0 1 auto', minHeight: 0 } : undefined}>
          {loading || (failed && !loaded) ? (
            <div className="stpl-empty">
              {loading
                ? <p><span className="sct-spin sct-spin--dark" aria-hidden />Loading the products…</p>
                : <><p>Couldn’t load the products</p><button type="button" className="str-retry" onClick={reload}>Retry</button></>}
            </div>
          ) : shown.length === 0 ? (
            <div className="stpl-empty">
              <IcoEmpty />
              <p>No {tab === 'master' ? 'Product Master' : 'Manual Entry'} products</p>
              <small>Switch tab to see other products</small>
            </div>
          ) : (
            <table className={`stpl-table stpl-table--${tab}`}>
              <thead>
                <tr>
                  <th className="stpl-c-no">Sr No</th>
                  {tab === 'master' && <th>Product Code</th>}
                  <th className="stpl-l">Product Name</th>
                  {tab === 'master' && <><th className="stpl-c-seg">Segment</th><th className="stpl-c-hsn">HSN Code</th></>}
                  <th>Target Price</th>
                  <th>Sourcing Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr key={p.key}>
                    <td className="stpl-c-no"><span className="stpl-sno">{i + 1}</span></td>
                    {tab === 'master' && <td><span className="stpl-code">{p.code}</span></td>}
                    <td className="stpl-l"><FitTip label={p.name}><div className="stpl-pname">{p.name}</div></FitTip></td>
                    {tab === 'master' && <>
                      <td className="stpl-c-seg"><ClipText text={p.segment && p.segment !== '—' ? p.segment : 'N/A'} className="stpl-segment" /></td>
                      <td className="stpl-c-hsn"><span className="stpl-hsn">{p.hsn && p.hsn !== '—' ? p.hsn : 'N/A'}</span></td>
                    </>}
                    <td className="stpl-price-cell"><FitTip label={inr(p.targetPrice)}><div className="stpl-price">{inr(p.targetPrice)}</div></FitTip></td>
                    <td><Status done={p.done} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="stpl-footer">
          <span className="stpl-footer-chip total"><IcoBox size={11} sw={2.5} />{total} Total</span>
          <span className="stpl-footer-chip done"><IcoCheck size={11} sw={2.5} />{done} Completed</span>
          <span className="stpl-footer-chip pend"><IcoPendingClock />{pending} Pending</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
