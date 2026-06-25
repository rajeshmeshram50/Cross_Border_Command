import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import MapSupplierModal from './MapSupplierModal';
import MappedSuppliersModal from './MappedSuppliersModal';
import { useModalGuard } from './useModalGuard';
import { resolveFileUrl, downloadFile } from '../../../../utils/resolveFileUrl';
import './bulk-sourcing.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Sourcing Report — products + progress for a sourcing target.
 * Data comes from GET /p2p/sourcing-targets/{id}/report (see API.md).
 * ───────────────────────────────────────────────────────────────────────── */

export type ReportRow = { id: string; source: string; start: string; due: string; createdBy: string; assignee: string; products: number; completed: number };

type Clarity = { type: 'text' | 'link' | 'pdf'; val: string } | null;
type ReportProduct = { id?: number | string; type: 'master' | 'manual'; code: string; name: string; segment?: string; hsn?: string; price: string; status: 'Completed' | 'In Progress'; supplierCount?: number; clarity?: Clarity };

const fmt = (s: string) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
/* Always show Target Price in INR. Product Master rows already carry the ₹;
   manual entries come as plain numbers, so prefix + thousands-format those. */
const fmtPrice = (p: string) => {
  if (!p && p !== '0') return '—';
  if (String(p).trim().startsWith('₹')) return p;
  const n = Number(String(p).replace(/,/g, ''));
  return isNaN(n) ? p : `₹${n.toLocaleString('en-IN')}`;
};
const genDate = () => { const d = new Date(); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

const I = (children: React.ReactNode) => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const REF_ICO = {
  id: I(<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>),
  type: I(<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />),
  cal: I(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  clock: I(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>),
  user: I(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  users: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
};

/* Product Clarity cell — text is clickable (opens a themed popup with the full
   note); link/pdf are clickable. A PDF downloads on click; a link opens in a
   new tab. */
function ClarityCell({ clarity }: { clarity?: Clarity }) {
  const [open, setOpen] = useState(false);
  if (!clarity || !clarity.type || !clarity.val) return <span className="srpt-attach-dash">—</span>;

  if (clarity.type === 'text') {
    return (
      <>
        <button type="button" className="srpt-clarity-text" title="Click to view full text" onClick={() => setOpen(true)}>
          {clarity.val}
        </button>
        {open && createPortal(
          <div className="srpt-clarity-ov" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
            <div className="srpt-clarity-modal">
              <div className="srpt-clarity-modal-head">
                <span className="srpt-clarity-modal-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></span>
                <span className="srpt-clarity-modal-title">Product Clarity</span>
                <button type="button" className="srpt-clarity-modal-close" onClick={() => setOpen(false)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
              </div>
              <div className="srpt-clarity-modal-body">{clarity.val}</div>
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  const url = resolveFileUrl(clarity.val);
  if (clarity.type === 'pdf') {
    return (
      <button type="button" className="srpt-clarity-link" title="Download clarity PDF"
        onClick={() => downloadFile(url, url.split('/').pop() || 'clarity.pdf')}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        PDF
      </button>
    );
  }
  // link
  return (
    <a className="srpt-clarity-link" href={url} target="_blank" rel="noreferrer" title={clarity.val}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
      Link
    </a>
  );
}

export default function SourcingReportModal({ row, onClose }: { row: ReportRow; onClose: () => void }) {
  const toast = useToast();
  const [products, setProducts] = useState<ReportProduct[]>([]);
  const [statuses, setStatuses] = useState<('Completed' | 'In Progress')[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'master' | 'manual'>('master');
  // Per-product supplier mapping override (index → { count, name }).
  const [mapped, setMapped] = useState<Record<number, { count: number; name: string }>>({});
  const [mapIdx, setMapIdx] = useState<number | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const { pulse, guardOverlay } = useModalGuard();

  // Lock background page scroll while the report modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<{ data: { products: ReportProduct[] } }>(`/p2p/sourcing-targets/${row.id}/report`)
      .then(r => { const ps = r.data?.data?.products ?? []; setProducts(ps); setStatuses(ps.map(p => p.status)); })
      .catch(() => { setProducts([]); setStatuses([]); })
      .finally(() => setLoading(false));
  }, [row]);

  const masterCount = products.filter(p => p.type === 'master').length;
  const supCountOf = (gi: number) => mapped[gi]?.count ?? (products[gi]?.supplierCount ?? (statuses[gi] === 'Completed' ? 1 : 0));

  const total = products.length;
  const done = statuses.filter(s => s === 'Completed').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  // Persist the status flip via PATCH; optimistic update, revert on failure.
  const toggle = (gi: number) => {
    const next: 'Completed' | 'In Progress' = statuses[gi] === 'Completed' ? 'In Progress' : 'Completed';
    setStatuses(s => s.map((x, i) => i === gi ? next : x));
    const pid = products[gi]?.id;
    if (pid == null) return;
    api.patch(`/p2p/sourcing-targets/${row.id}/products/${pid}/status`, { status: next })
      .catch(() => {
        setStatuses(s => s.map((x, i) => i === gi ? (next === 'Completed' ? 'In Progress' : 'Completed') : x));
        toast.error('Update failed', 'Could not change the sourcing status.');
      });
  };

  // rows for the active tab, carrying their global index (for status toggle)
  const tabRows = products.map((p, gi) => ({ p, gi })).filter(x => x.p.type === tab);

  return createPortal(
    <div id="srpt-overlay" onMouseDown={guardOverlay}>
      <div className={`srpt-box${pulse ? ' bsm-pulse' : ''}`}>
        <div className="srpt-header">
          <div className="srpt-hrow">
            <div className="srpt-title-wrap">
              <div className="srpt-hicon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></svg></div>
              <div className="srpt-title-block">
                <div className="srpt-title-line">
                  <h3 className="srpt-title">Sourcing Report</h3>
                  <span className="srpt-id-pill">{row.id}</span>
                  <span className={`srpt-badge ${allDone ? 'done' : 'prog'}`}><span className="srpt-bdot" />{allDone ? 'Completed' : 'In Progress'}</span>
                </div>
                <p className="srpt-sub">Business Reference &nbsp;·&nbsp; Generated {genDate()}</p>
              </div>
            </div>
            <button className="srpt-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>

          <div className="srpt-refcards">
            {([
              ['Sourcing ID', row.id, 'cyan', REF_ICO.id], ['Source Type', row.source, '', REF_ICO.type], ['Start Date', fmt(row.start), '', REF_ICO.cal],
              ['Due Date', fmt(row.due), 'amber', REF_ICO.clock], ['Created By', row.createdBy, '', REF_ICO.user], ['Assigned To', row.assignee, 'green', REF_ICO.users],
            ] as const).map(([lbl, val, cls, ico]) => (
              <div className="srpt-refcard" key={lbl}>
                <div className="srpt-rclbl">{ico}{lbl}</div>
                <div className={`srpt-rcval ${cls}`}>{val}</div>
              </div>
            ))}
          </div>

          <div className="srpt-statsbar">
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Total Products</div><div className="srpt-sbarval white">{total}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Completed</div><div className="srpt-sbarval green">{done}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem"><div className="srpt-sbarlbl">Pending</div><div className="srpt-sbarval amber">{total - done}</div></div>
            <div className="srpt-sbardiv" />
            <div className="srpt-sbaritem srpt-sbaritem--prog">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <div className="srpt-sbarlbl">Overall Progress</div>
                <div className="srpt-sbarval green" style={{ fontSize: 13 }}>{pct}%</div>
              </div>
              <div className="srpt-pbar"><div className="srpt-pfill" style={{ width: `${pct}%` }} /></div>
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
            Manual Product Entry<span className="srpt-tab-cnt">{total - masterCount}</span>
          </button>
        </div>

        <div className="srpt-body">
          {loading ? (
            <table className="srpt-table">
              <thead><tr>
                <th style={{ width: 64 }}>Sr No</th>{tab === 'master' && <th>Product Code</th>}<th style={{ textAlign: 'left' }}>Product Name</th>
                {tab === 'master' && <th>Segment</th>}{tab === 'master' && <th>HSN Code</th>}
                <th>Target Price</th><th>Product Clarity</th><th>Sourcing Status</th><th>Supplier Count</th><th style={{ textAlign: 'center' }}>Action</th>
              </tr></thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr className="srpt-row" key={i}>
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 22, height: 22, borderRadius: 7 }} /></td>
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 46, height: 12 }} /></td>}
                    <td><span className="bsm-sk" style={{ width: 130, height: 13 }} /></td>
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 72, height: 16, borderRadius: 999 }} /></td>}
                    {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 62, height: 16, borderRadius: 6 }} /></td>}
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 50, height: 12 }} /></td>
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 16, height: 12 }} /></td>
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 82, height: 20, borderRadius: 999 }} /></td>
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 24, height: 22, borderRadius: 7 }} /></td>
                    <td style={{ textAlign: 'center' }}><span className="bsm-sk" style={{ width: 130, height: 28, borderRadius: 8 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tabRows.length === 0 ? (
            <div className="srpt-empty-tab"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg><p>No {tab === 'master' ? 'Product Master' : 'Manual Entry'} products</p></div>
          ) : (
            <table className="srpt-table">
              <thead><tr>
                <th style={{ width: 64 }}>Sr No</th>
                {tab === 'master' && <th>Product Code</th>}
                <th style={{ textAlign: 'left' }}>Product Name</th>
                {tab === 'master' && <th>Segment</th>}
                {tab === 'master' && <th>HSN Code</th>}
                <th>Target Price</th><th>Product Clarity</th><th>Sourcing Status</th><th>Supplier Count</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr></thead>
              <tbody>
                {tabRows.map(({ p, gi }, i) => {
                  const st = statuses[gi];
                  const doneP = st === 'Completed';
                  const supCount = supCountOf(gi);
                  return (
                    <tr className="srpt-row" key={gi}>
                      <td style={{ textAlign: 'center' }}><span className="srpt-sno">{i + 1}</span></td>
                      {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="srpt-code">{p.code}</span></td>}
                      <td style={{ textAlign: 'left' }}><div className="srpt-pname">{p.name}</div></td>
                      {tab === 'master' && <td style={{ textAlign: 'center' }}><span className={`srpt-seg ${(p.segment || 'General').replace(/ /g, '-')}`}>{p.segment}</span></td>}
                      {tab === 'master' && <td style={{ textAlign: 'center' }}><span className="srpt-hsncode">{p.hsn}</span></td>}
                      <td style={{ textAlign: 'center' }} className="srpt-price">{fmtPrice(p.price)}</td>
                      <td style={{ textAlign: 'center' }}><ClarityCell clarity={p.clarity} /></td>
                      <td style={{ textAlign: 'center' }}><span className={`srpt-status ${doneP ? 'done' : 'prog'}`} onClick={() => toggle(gi)} title="Click to toggle status" style={{ cursor: 'pointer' }}><span className="srpt-sdot" />{doneP ? 'Completed' : 'In Progress'}</span></td>
                      <td style={{ textAlign: 'center' }}>{supCount > 0
                        ? <span className="srpt-sup-count has-sup srpt-sup-clickable" title="View mapped suppliers" onClick={() => setViewIdx(gi)}>{supCount}</span>
                        : <span className="srpt-sup-count">0</span>}</td>
                      <td style={{ textAlign: 'center' }}><button className="srpt-map-btn" onClick={() => setMapIdx(gi)}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>Map Supplier Directory</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {mapIdx !== null && (
        <MapSupplierModal
          product={{ name: products[mapIdx].name, code: products[mapIdx].code, segment: products[mapIdx].segment, price: products[mapIdx].price, supplierCount: supCountOf(mapIdx) }}
          targetId={row.id}
          productId={products[mapIdx].id}
          onClose={() => setMapIdx(null)}
          onMapped={(name) => {
            const gi = mapIdx!;
            setMapped(m => { const cur = m[gi]?.count ?? (statuses[gi] === 'Completed' ? 1 : 0); return { ...m, [gi]: { count: cur + 1, name } }; });
            setStatuses(s => s.map((x, i) => i === gi ? 'Completed' : x)); // backend marks it Completed on first map
            setMapIdx(null);
            toast.success('Supplier mapped', name);
          }}
        />
      )}
      {viewIdx !== null && (
        <MappedSuppliersModal
          product={{ name: products[viewIdx].name, code: products[viewIdx].code, segment: products[viewIdx].segment, price: products[viewIdx].price, supplierCount: supCountOf(viewIdx), mappedName: mapped[viewIdx]?.name }}
          recordId={row.id}
          recordSource={row.source}
          targetId={row.id}
          productId={products[viewIdx].id}
          onClose={() => setViewIdx(null)}
          onAddSupplier={() => { const gi = viewIdx!; setViewIdx(null); setMapIdx(gi); }}
        />
      )}
    </div>,
    document.body,
  );
}
