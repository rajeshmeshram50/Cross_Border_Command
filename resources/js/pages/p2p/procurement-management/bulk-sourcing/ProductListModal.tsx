import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useModalGuard } from './useModalGuard';
import './bulk-sourcing.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Product List — read-only view of a sourcing target's products, opened from
 * the "Total Products" count on the Bulk Sourcing list. Reuses the Sourcing
 * Report data (GET /p2p/sourcing-targets/{id}/report) and the srpt-* styling,
 * trimmed to a plain products table (no clarity / supplier / action columns).
 * ───────────────────────────────────────────────────────────────────────── */

type PLProduct = {
  type: 'master' | 'manual'; code: string; name: string;
  segment?: string; hsn?: string; price: string; status: 'Completed' | 'In Progress';
};

export type PLRow = { id: string; source: string; due: string };

const fmt = (s: string) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
/* Always show Target Price in INR. Product Master rows already carry the ₹; manual
   entries come through as plain numbers, so prefix + thousands-format those. */
const fmtPrice = (p: string) => {
  if (!p && p !== '0') return '—';
  if (String(p).trim().startsWith('₹')) return p;
  const n = Number(String(p).replace(/,/g, ''));
  return isNaN(n) ? p : `₹${n.toLocaleString('en-IN')}`;
};

export default function ProductListModal({ row, onClose }: { row: PLRow; onClose: () => void }) {
  const [products, setProducts] = useState<PLProduct[]>([]);
  const [tab, setTab] = useState<'master' | 'manual'>('master');
  const [loading, setLoading] = useState(true);
  const { pulse, guardOverlay } = useModalGuard();

  useEffect(() => {
    setLoading(true);
    api.get<{ data: { products: PLProduct[] } }>(`/p2p/sourcing-targets/${row.id}/report`)
      .then(r => setProducts(r.data?.data?.products ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [row]);

  const total = products.length;
  const done = products.filter(p => p.status === 'Completed').length;
  const pending = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;
  const masterCount = products.filter(p => p.type === 'master').length;
  const manualCount = total - masterCount;
  const rows = products.filter(p => p.type === tab);

  return createPortal(
    <div id="srpt-overlay" onMouseDown={guardOverlay}>
      <div className={`srpt-box pl-box${pulse ? ' bsm-pulse' : ''}`}>
        <div className="srpt-header">
          <div className="srpt-hrow">
            <div className="srpt-title-wrap">
              <div className="srpt-hicon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg></div>
              <div className="srpt-title-block">
                <div className="srpt-title-line">
                  <h3 className="srpt-title">Product List —</h3>
                  <span className="srpt-id-pill">{row.id}</span>
                  <span className={`srpt-badge ${allDone ? 'done' : 'prog'}`}><span className="srpt-bdot" />{allDone ? 'Completed' : 'In Progress'}</span>
                </div>
                <p className="srpt-sub">Source: {row.source} &nbsp;·&nbsp; Due: {fmt(row.due)}</p>
              </div>
            </div>
            <button className="srpt-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>

          <div className="pl-stats">
            <div className="pl-stats-left">
              <div className="pl-stat"><div className="pl-stat-lbl">Total Products</div><div className="pl-stat-val white">{loading ? <span className="pl-skel pl-skel-num" /> : total}</div></div>
              <div className="pl-stat"><div className="pl-stat-lbl">Completed</div><div className="pl-stat-val green">{loading ? <span className="pl-skel pl-skel-num" /> : done}</div></div>
              <div className="pl-stat"><div className="pl-stat-lbl">Pending</div><div className="pl-stat-val amber">{loading ? <span className="pl-skel pl-skel-num" /> : pending}</div></div>
            </div>
            <div className="pl-stat pl-stat--prog">
              <div className="pl-stat-row">
                <div className="pl-stat-lbl">Overall Progress</div>
                <div className="pl-stat-val green" style={{ fontSize: 13 }}>{loading ? '' : `${pct}%`}</div>
              </div>
              <div className="srpt-pbar"><div className="srpt-pfill" style={{ width: loading ? '0%' : `${pct}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="srpt-tabs">
          <button className={`srpt-tab ${tab === 'master' ? 'active' : ''}`} onClick={() => setTab('master')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
            Product Master<span className="srpt-tab-cnt">{masterCount}</span>
          </button>
          <button className={`srpt-tab ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
            Manual Entry<span className="srpt-tab-cnt">{manualCount}</span>
          </button>
        </div>

        <div className="srpt-body">
          {loading ? (
            <div className="pl-skel-wrap">
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="pl-skel pl-skel-bar" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="srpt-empty-tab"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg><p>No {tab === 'master' ? 'Product Master' : 'Manual Entry'} products</p></div>
          ) : (
            <table className="srpt-table">
              <thead><tr>
                <th style={{ width: 64 }}>Sr No</th>
                {tab === 'master' && <th>Product Code</th>}
                <th style={{ textAlign: 'left' }}>Product Name</th>
                {tab === 'master' && <th>Segment</th>}
                {tab === 'master' && <th>HSN Code</th>}
                <th>Target Price</th><th>Sourcing Status</th>
              </tr></thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr className="srpt-row" key={i}>
                    <td style={{ textAlign: 'center' }}><span className="srpt-sno">{i + 1}</span></td>
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="srpt-code">{p.code}</span></td>}
                    <td style={{ textAlign: 'left' }}><div className="srpt-pname">{p.name}</div></td>
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className={`srpt-seg ${(p.segment || 'General').replace(/ /g, '-')}`}>{p.segment}</span></td>}
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="srpt-hsn">{p.hsn}</span></td>}
                    <td style={{ textAlign: 'center' }} className="srpt-price">{fmtPrice(p.price)}</td>
                    <td style={{ textAlign: 'center' }}><span className={`srpt-status ${p.status === 'Completed' ? 'done' : 'prog'}`} style={{ cursor: 'default' }}><span className="srpt-sdot" />{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pl-foot">
          <span className="pl-chip pl-chip--total"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /></svg>{total} Total</span>
          <span className="pl-chip pl-chip--done"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{done} Completed</span>
          <span className="pl-chip pl-chip--pend"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>{pending} Pending</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
