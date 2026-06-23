import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import AssignSourcingTargetModal from './AssignSourcingTargetModal';
import SourcingReportModal from './SourcingReportModal';
import './bulk-sourcing.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Bulk Sourcing Management — Procure to Pay (P2P).
 * Data comes from the backend (see API.md). Static/mock data removed.
 * ───────────────────────────────────────────────────────────────────────── */

type SourcingRow = {
  id: string;
  source: 'Product Master' | 'Manual Entry';
  start: string;
  due: string;
  createdBy: string;
  assignee: string;
  products: number;
  completed: number;
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

function Progress({ products, completed }: { products: number; completed: number }) {
  const total = products || 0;
  const done = Math.min(completed || 0, total);
  const pending = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const isDone = total > 0 && done === total;
  return (
    <div className="bst-prog3">
      <div className="bst-prog3-head">
        <span className={`bst-st2 ${isDone ? 'bst-st--done' : 'bst-st--prog'}`}><span className="bst-st-dot" />{isDone ? 'Completed' : 'In Progress'}</span>
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
  const toast = useToast();
  const [tab, setTab] = useState<'assigned' | 'created'>('assigned');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [stepsOpen, setStepsOpen] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reportRow, setReportRow] = useState<SourcingRow | null>(null);
  const [editRow, setEditRow] = useState<SourcingRow | null>(null);
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
      const status = (r.completed >= r.products && r.products > 0) ? 'completed' : 'in progress';
      return [r.id, r.source, r.createdBy, r.assignee, status].join(' ').toLowerCase().includes(q);
    });
  }, [allRows, query]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PER_PAGE;
  const pageRows = rows.slice(startIdx, startIdx + PER_PAGE);
  const showingTo = Math.min(startIdx + PER_PAGE, total);

  const soon = (what: string) => toast.info('Coming soon', `${what} will be available once the backend is wired.`);
  const switchTab = (t: 'assigned' | 'created') => { setTab(t); setPage(1); setQuery(''); };

  return (
    <div className="bsm-teal" style={{ padding: '0 4px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>

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
                <div className="bst-empty"><div className="bst-empty-t">Loading sourcing targets…</div></div>
              ) : error ? (
                <div className="bst-empty">
                  <div className="bst-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></div>
                  <div className="bst-empty-t">Couldn’t load sourcing targets</div>
                  <div className="bst-empty-s">Please try again.</div>
                </div>
              ) : total === 0 ? (
                <div className="bst-empty">
                  <div className="bst-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
                  <div className="bst-empty-t">{query ? 'No results found' : (tab === 'created' ? 'No sourcing targets created yet' : 'No sourcing targets assigned to you')}</div>
                  <div className="bst-empty-s">{query ? 'Try a different search term.' : (tab === 'created' ? 'Use “Assign Sourcing Target” to create your first one.' : 'Targets assigned to you will appear here.')}</div>
                </div>
              ) : (
                <>
                  <div className="bst-table">
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
                        <span><span className={`bst-src ${r.source === 'Manual Entry' ? 'bst-src--manual' : 'bst-src--master'}`}>{r.source}</span></span>
                        <span className="bst-due">{fmtDate(r.start)}</span>
                        <span className="bst-due">{fmtDate(r.due)}</span>
                        <span><Person name={r.createdBy} /></span>
                        <span><Person name={r.assignee} /></span>
                        <span className="bst-c-center"><span className="bst-pcount" title="View Products" style={{ cursor: 'pointer' }} onClick={() => soon('Product list')}>{r.products}</span></span>
                        <span className="bst-c-center"><Progress products={r.products} completed={r.completed} /></span>
                        <span className="bst-c-center">
                          <span className="bst-actions">
                            <button type="button" className="bst-act bst-act--edit" title="Edit Sourcing Target" onClick={() => setEditRow(r)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></button>
                            <button type="button" className="bst-report-btn" onClick={() => setReportRow(r)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></svg>Sourcing Report</button>
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="bst-pager">
                    <span className="bst-pg-info">Showing <b>{startIdx + 1}–{showingTo}</b> of <b>{total}</b></span>
                    <div className="bst-pg-ctrls">
                      <button type="button" className="bst-pg-btn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg> Prev</button>
                      {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(p => (
                        <button type="button" key={p} className={`bst-pg-num ${p === safePage ? 'is-active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                      ))}
                      <button type="button" className="bst-pg-btn" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {(assignOpen || editRow) && (
          <AssignSourcingTargetModal key={editRow ? editRow.id : 'new'} editRow={editRow} onClose={() => { setAssignOpen(false); setEditRow(null); }} onSaved={load} />
        )}
        {reportRow && <SourcingReportModal key={reportRow.id} row={reportRow} onClose={() => setReportRow(null)} />}
      </div>
  );
}

const STEPS = [
  { num: 'Step 01', title: 'Create Sourcing', desc: 'Define what needs to be sourced — product name, HSN code, segment, target price & clarity brief.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> },
  { num: 'Step 02', title: 'Assign to Team Member', desc: 'Allocate the sourcing task to a responsible team member with start & due dates for accountability.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
  { num: 'Step 03', title: 'Map Supplier Directory', desc: 'Link one or more verified suppliers to the sourcing row with price, GST & contact details captured.', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
  { num: 'Step 04', title: 'Track Status & Analytics', desc: "Monitor each sourcing row's progress, supplier count, and completion rate from the Analytics view.", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg> },
];
