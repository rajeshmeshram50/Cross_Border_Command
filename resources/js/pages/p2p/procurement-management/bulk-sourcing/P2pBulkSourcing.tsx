import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../../api';
import WorklistPager from '../../../../components/ui/WorklistPager';
import Tooltip from '../../../../components/ui/Tooltip';
import AssignSourcingTargetModal from './AssignSourcingTargetModal';
import SourcingReportModal from './SourcingReportModal';
import ProductListModal from './ProductListModal';
import './bulk-sourcing.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Bulk Sourcing Management — Procure to Pay (P2P).
 * Data comes from the backend (see API.md). Static/mock data removed.
 * ───────────────────────────────────────────────────────────────────────── */

type SourcingRow = {
  id: string;
  source: 'Product Master' | 'Manual Entry';
  // Actual source mix from the target's products — a target can hold both
  // Product Master and Manual Entry rows, so this drives 1 or 2 badges.
  sources?: ('Product Master' | 'Manual Entry')[];
  start: string;
  due: string;
  createdBy: string;
  assignee: string;
  products: number;
  completed: number;
  // Past the due date AND not fully sourced (backend-computed). Drives the
  // red "Overdue" status — completion stays allowed (QA #51).
  overdue?: boolean;
};

const PER_PAGE = 10;
const fmtDate = (d: string) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const initials = (p: string) => p === 'You' ? 'ME' : p.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function Person({ name }: { name: string }) {
  if (!name || name === '—') return <span className="bst-person-none">—</span>;
  return (
    <span className="bst-person">
      <span className={`bst-av ${name === 'You' ? 'bst-av--me' : ''}`}>{initials(name)}</span>
      <span className="bst-person-name">{name}</span>
    </span>
  );
}

function Progress({ products, completed, overdue }: { products: number; completed: number; overdue?: boolean }) {
  const total = products || 0;
  const done = Math.min(completed || 0, total);
  const pending = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const isDone = total > 0 && done === total;
  // Overdue only matters while still unfinished — a completed target is never
  // overdue. Sourcing stays possible; the badge just flags the late task.
  const isOverdue = !!overdue && !isDone;
  const stCls = isDone ? 'bst-st--done' : isOverdue ? 'bst-st--overdue' : 'bst-st--prog';
  const stLabel = isDone ? 'Completed' : isOverdue ? 'Overdue' : 'In Progress';
  return (
    <div className="bst-prog3">
      <div className="bst-prog3-head">
        <span className={`bst-st2 ${stCls}`}><span className="bst-st-dot" />{stLabel}</span>
        <span className={`bst-prog3-pct ${isDone ? 'is-done' : ''}`}>{pct}%</span>
      </div>
      <div className={`bst-bar ${isDone ? 'all-done' : ''}`}><span className="bst-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="bst-prog3-legend">
        <span className="bst-lg done"><i />{done} done</span>
        <span className={`bst-lg pend ${pending === 0 ? 'is-zero' : ''}`}><i />{pending} pending</span>
      </div>
    </div>
  );
}

export default function P2pBulkSourcing() {
  const [tab, setTab] = useState<'assigned' | 'created'>('assigned');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  // Dynamic pagination: rows-per-page auto-fits the visible table height.
  const [rpp, setRpp] = useState(PER_PAGE);
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reportRow, setReportRow] = useState<SourcingRow | null>(null);
  const [editRow, setEditRow] = useState<SourcingRow | null>(null);
  const [productsRow, setProductsRow] = useState<SourcingRow | null>(null);
  const [assigned, setAssigned] = useState<SourcingRow[]>([]);
  const [created, setCreated] = useState<SourcingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true); setError(false);
    api.get<{ data: { assigned: SourcingRow[]; created: SourcingRow[] } }>('/p2p/sourcing-targets')
      .then(res => { setAssigned(res.data?.data?.assigned ?? []); setCreated(res.data?.data?.created ?? []); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const allRows = tab === 'created' ? created : assigned;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(r => {
      const isComplete = r.completed >= r.products && r.products > 0;
      const status = isComplete ? 'completed' : (r.overdue ? 'overdue' : 'in progress');
      const src = (r.sources?.length ? r.sources : [r.source]).join(' ');
      return [r.id, src, r.createdBy, r.assignee, status].join(' ').toLowerCase().includes(q);
    });
  }, [allRows, query]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const startIdx = (safePage - 1) * rpp;
  const pageRows = rows.slice(startIdx, startIdx + rpp);

  // Dynamic pagination: pick the rows-per-page that fits between the table's top
  // and the bottom of the viewport, so the page fills the screen and spills the
  // rest onto further pages (same behaviour as the Segment master list).
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;       // viewport-relative top of table
      const THEAD = 38, ROW = 54, FOOTER = 96;           // header row + pager/footer reserve
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [rows.length, tab]);

  const switchTab = (t: 'assigned' | 'created') => { setTab(t); setPage(1); setQuery(''); };

  return (
    <div className="bsm-teal" ref={rootRef} style={{ margin: '-6px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* HEADER STRIP */}
        <div className="bsm-headstrip" style={{ flexShrink: 0, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', minHeight: 56, border: '1px solid rgba(6,182,212,.28)', borderRadius: 12, background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 20%,#d4f4f9 50%,#bff0f7 80%,#a5e9f3 100%)', boxShadow: '0 2px 0 rgba(255,255,255,.85) inset,0 4px 16px rgba(6,182,212,.15)' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)', borderRadius: '12px 0 0 12px' }} />
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.5),transparent)', pointerEvents: 'none', borderRadius: '12px 12px 0 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, zIndex: 1, paddingLeft: 8 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 0 0 2px rgba(6,182,212,.25),0 3px 8px rgba(8,145,178,.4)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              </div>
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff' }} />
            </div>
            <div>
              <div className="bsm-head-title" style={{ fontSize: 13.5, fontWeight: 600, color: '#0c4a6e', letterSpacing: '-.3px', lineHeight: 1.1 }}>Bulk Sourcing Management</div>
              <div className="bsm-head-sub" style={{ fontSize: 10, fontWeight: 500, color: '#0e7490', opacity: .85, marginTop: 1 }}>Create, track and manage bulk sourcing requests, RFQs and consolidated procurement across suppliers.</div>
            </div>
          </div>
          <button type="button" onClick={() => setAssignOpen(true)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 9, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer', zIndex: 1, background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 3px 10px rgba(8,145,178,.45)' }}>
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '9px 9px 0 0', pointerEvents: 'none' }} />
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Assign Sourcing Target
          </button>
        </div>

        {/* WHAT WE ARE DOING HERE */}
        <div className={`bref-box ${stepsOpen ? '' : 'is-collapsed'}`}>
          <div className="bref-box__header" onClick={() => setStepsOpen(o => !o)}>
            <div className="bref-box__header-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </div>
            <div className="bref-box__header-mid">
              <div className="bref-box__header-row">
                <div className="bref-box__header-label">Bulk Sourcing Management</div>
                <div className="bref-box__header-sep" />
                <div className="bref-box__header-title">What We Are Doing Here</div>
              </div>
              <div className="bref-box__header-sub">A simple four-step flow from raising a sourcing need to tracking it to completion.</div>
            </div>
            <div className="bref-box__header-right">
              <div className="bref-box__toggle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
          </div>
          <div className="bref-box__body">
            {STEPS.map(s => (
              <div className="bref-item" key={s.num}>
                <div className="bref-item__top">
                  <div className="bref-item__ico">{s.icon}</div>
                  <span className="bref-item__num">{s.num}</span>
                </div>
                <div className="bref-item__title">{s.title}</div>
                <div className="bref-item__desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* SOURCING TARGETS LIST */}
        <div className="bst-wrap">
          <div className="bst-card">
            <div className="bst-toolbar">
              <div className="bst-tabs">
                <button type="button" className={`bst-tab ${tab === 'assigned' ? 'is-active' : ''}`} onClick={() => switchTab('assigned')}>
                  <span className="bst-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
                  Sourcing Target Assigned to Me
                  <span className="bst-tab-c">{assigned.length}</span>
                </button>
                <button type="button" className={`bst-tab ${tab === 'created' ? 'is-active' : ''}`} onClick={() => switchTab('created')}>
                  <span className="bst-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></span>
                  Sourcing Target Created by Me
                  <span className="bst-tab-c">{created.length}</span>
                </button>
              </div>
              <div className="bst-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" value={query} placeholder="Search by ID, person, source or status..." onChange={e => { setQuery(e.target.value); setPage(1); }} />
                {query && <button type="button" className="bst-search-clear" onClick={() => { setQuery(''); setPage(1); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
              </div>
            </div>

            <div className="bst-panel">
              {loading ? (
                <div className="bst-table">
                  <div className="bst-row bst-row--head">
                    <span>Sr No</span><span>Sourcing ID</span><span>I Want to Source To</span>
                    <span>Start Date</span><span>Due Date</span><span>Created By</span><span>Assigned To</span>
                    <span className="bst-c-center">Total Products</span>
                    <span className="bst-c-center">Sourcing Progress Status</span>
                    <span className="bst-c-center">Action</span>
                  </div>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div className="bst-row" key={i}>
                      <span><span className="bsm-sk" style={{ width: 18, height: 14 }} /></span>
                      <span><span className="bsm-sk" style={{ width: 64, height: 18, borderRadius: 7 }} /></span>
                      <span><span className="bsm-sk" style={{ width: 90, height: 16, borderRadius: 999 }} /></span>
                      <span><span className="bsm-sk" style={{ width: 58, height: 12 }} /></span>
                      <span><span className="bsm-sk" style={{ width: 58, height: 12 }} /></span>
                      <span style={{ gap: 6 }}><span className="bsm-sk bsm-sk-circle" style={{ width: 24, height: 24 }} /><span className="bsm-sk" style={{ width: 56, height: 12 }} /></span>
                      <span style={{ gap: 6 }}><span className="bsm-sk bsm-sk-circle" style={{ width: 24, height: 24 }} /><span className="bsm-sk" style={{ width: 56, height: 12 }} /></span>
                      <span className="bst-c-center"><span className="bsm-sk" style={{ width: 34, height: 34, borderRadius: 10 }} /></span>
                      <span className="bst-c-center"><span className="bsm-sk" style={{ width: 150, height: 30, borderRadius: 8 }} /></span>
                      <span className="bst-c-center"><span className="bsm-sk" style={{ width: 120, height: 32, borderRadius: 9 }} /></span>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="bst-empty" style={{ minHeight: fillH }}>
                  <div className="bst-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div>
                  <div className="bst-empty-t">Couldn’t load sourcing targets</div>
                  <div className="bst-empty-s">Please try again.</div>
                </div>
              ) : total === 0 ? (
                <div className="bst-empty" style={{ minHeight: fillH }}>
                  <div className="bst-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
                  <div className="bst-empty-t">{query ? 'No results found' : (tab === 'created' ? 'No sourcing targets created yet' : 'No sourcing targets assigned to you')}</div>
                  <div className="bst-empty-s">{query ? 'Try a different search term.' : (tab === 'created' ? 'Use “Assign Sourcing Target” to create your first one.' : 'Targets assigned to you will appear here.')}</div>
                </div>
              ) : (
                <>
                  <div className="bst-table" ref={scrollRef} style={{ minHeight: fillH }}>
                    <div className="bst-row bst-row--head">
                      <span>Sr No</span><span>Sourcing ID</span><span>I Want to Source To</span>
                      <span>Start Date</span><span>Due Date</span><span>Created By</span><span>Assigned To</span>
                      <span className="bst-c-center">Total Products</span>
                      <span className="bst-c-center">Sourcing Progress Status</span>
                      <span className="bst-c-center">Action</span>
                    </div>
                    {pageRows.map((r, i) => (
                      <div className="bst-row" key={r.id}>
                        <span className="bst-sr">{startIdx + i + 1}</span>
                        <span><span className="bst-idpill">{r.id}</span></span>
                        <span>
                          <span className="bst-src-wrap">
                            {(r.sources?.length ? r.sources : [r.source]).map(s => (
                              <span key={s} className={`bst-src ${s === 'Manual Entry' ? 'bst-src--manual' : 'bst-src--master'}`}>{s}</span>
                            ))}
                          </span>
                        </span>
                        <span className="bst-due">{fmtDate(r.start)}</span>
                        <span className="bst-due">{fmtDate(r.due)}</span>
                        <span><Person name={r.createdBy} /></span>
                        <span><Person name={r.assignee} /></span>
                        <span className="bst-c-center"><Tooltip label="View Products"><span className="bst-pcount" style={{ cursor: 'pointer' }} onClick={() => setProductsRow(r)}>{r.products}</span></Tooltip></span>
                        <span className="bst-c-center"><Progress products={r.products} completed={r.completed} overdue={r.overdue} /></span>
                        <span className="bst-c-center">
                          <span className="bst-actions">
                            {/* Edit is owner-only: shown on the "Created by Me" tab.
                                A target merely assigned to you isn't yours to re-edit
                                — you work it through the Sourcing Report instead. */}
                            {tab === 'created' && (
                              <Tooltip label="Edit Sourcing Target"><button type="button" className="bst-act bst-act--edit" onClick={() => setEditRow(r)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></button></Tooltip>
                            )}
                            <button type="button" className="bst-report-btn" onClick={() => setReportRow(r)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></svg>Sourcing Report</button>
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <WorklistPager total={total} page={safePage} pageSize={rpp} onPage={setPage} />
                </>
              )}
            </div>
          </div>
        </div>

        {(assignOpen || editRow) && (
          <AssignSourcingTargetModal key={editRow ? editRow.id : 'new'} editRow={editRow} onClose={() => { setAssignOpen(false); setEditRow(null); }} onSaved={load} />
        )}
        {reportRow && <SourcingReportModal key={reportRow.id} row={reportRow} canMap={tab === 'assigned'} onClose={() => { setReportRow(null); load(); }} />}
        {productsRow && <ProductListModal key={productsRow.id} row={productsRow} onClose={() => setProductsRow(null)} />}
      </div>
  );
}

const STEPS = [
  { num: 'Step 01', title: 'Create Sourcing', desc: 'Define what needs to be sourced — product name, HSN code, segment, target price & clarity brief.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> },
  { num: 'Step 02', title: 'Assign to Team Member', desc: 'Allocate the sourcing task to a responsible team member with start & due dates for accountability.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
  { num: 'Step 03', title: 'Map Supplier Directory', desc: 'Link one or more verified suppliers to the sourcing row with price, GST & contact details captured.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
  { num: 'Step 04', title: 'Track Status & Analytics', desc: "Monitor each sourcing row's progress, supplier count, and completion rate from the Analytics view.", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg> },
];
