import { useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import AssignSourcingTargetModal from './AssignSourcingTargetModal';
import SourcingReportModal from './SourcingReportModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Bulk Sourcing Management — Procure to Pay (P2P).
 * Faithful static port of the P2P_Sourcing prototype (teal theme). Mock data
 * for now; the backend + dynamic wiring come in the next step.
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

const CREATED: SourcingRow[] = [
  { id: 'SRC-001', source: 'Product Master', start: '2026-01-05', due: '2026-03-31', createdBy: 'Parth Lakare', assignee: 'Arjun Mehta', products: 14, completed: 14 },
  { id: 'SRC-003', source: 'Product Master', start: '2026-02-01', due: '2026-04-15', createdBy: 'Parth Lakare', assignee: 'Priya Sharma', products: 18, completed: 11 },
  { id: 'SRC-004', source: 'Manual Entry', start: '2026-03-01', due: '2026-04-30', createdBy: 'Parth Lakare', assignee: 'Rohan Kulkarni', products: 12, completed: 5 },
  { id: 'SRC-007', source: 'Product Master', start: '2026-03-05', due: '2026-05-01', createdBy: 'Parth Lakare', assignee: 'Karan Singh', products: 15, completed: 0 },
  { id: 'SRC-010', source: 'Product Master', start: '2026-03-20', due: '2026-05-20', createdBy: 'Parth Lakare', assignee: 'Sneha Patil', products: 13, completed: 10 },
  { id: 'SRC-012', source: 'Product Master', start: '2026-01-12', due: '2026-04-02', createdBy: 'Parth Lakare', assignee: 'Vikram Patel', products: 20, completed: 14 },
  { id: 'SRC-014', source: 'Manual Entry', start: '2026-02-08', due: '2026-04-22', createdBy: 'Parth Lakare', assignee: 'Ananya Gupta', products: 11, completed: 11 },
  { id: 'SRC-016', source: 'Product Master', start: '2026-02-18', due: '2026-05-05', createdBy: 'Parth Lakare', assignee: 'Karan Singh', products: 17, completed: 12 },
  { id: 'SRC-018', source: 'Product Master', start: '2026-03-02', due: '2026-05-12', createdBy: 'Parth Lakare', assignee: 'Meera Krishnan', products: 10, completed: 3 },
  { id: 'SRC-021', source: 'Manual Entry', start: '2026-03-10', due: '2026-05-28', createdBy: 'Parth Lakare', assignee: 'Ananya Gupta', products: 16, completed: 0 },
  { id: 'SRC-023', source: 'Product Master', start: '2026-03-15', due: '2026-06-01', createdBy: 'Parth Lakare', assignee: 'Priya Sharma', products: 14, completed: 8 },
  { id: 'SRC-025', source: 'Product Master', start: '2026-03-22', due: '2026-06-10', createdBy: 'Parth Lakare', assignee: 'Arjun Mehta', products: 19, completed: 19 },
  { id: 'SRC-027', source: 'Manual Entry', start: '2026-04-01', due: '2026-06-15', createdBy: 'Parth Lakare', assignee: 'Rohan Kulkarni', products: 12, completed: 9 },
  { id: 'SRC-029', source: 'Product Master', start: '2026-04-05', due: '2026-06-20', createdBy: 'Parth Lakare', assignee: 'Sneha Patil', products: 22, completed: 7 },
  { id: 'SRC-031', source: 'Product Master', start: '2026-04-12', due: '2026-06-30', createdBy: 'Parth Lakare', assignee: 'Vikram Patel', products: 11, completed: 0 },
];

const ASSIGNED: SourcingRow[] = [
  { id: 'SRC-002', source: 'Product Master', start: '2026-01-05', due: '2026-03-31', createdBy: 'Admin', assignee: 'Parth Lakare', products: 13, completed: 8 },
  { id: 'SRC-005', source: 'Product Master', start: '2026-02-15', due: '2026-03-15', createdBy: 'Meera Krishnan', assignee: 'Parth Lakare', products: 10, completed: 10 },
  { id: 'SRC-008', source: 'Manual Entry', start: '2026-03-10', due: '2026-05-10', createdBy: 'Aarav Sharma', assignee: 'Parth Lakare', products: 16, completed: 11 },
  { id: 'SRC-011', source: 'Product Master', start: '2026-01-20', due: '2026-04-10', createdBy: 'Admin', assignee: 'Parth Lakare', products: 14, completed: 4 },
  { id: 'SRC-013', source: 'Product Master', start: '2026-02-02', due: '2026-04-18', createdBy: 'Priya Nair', assignee: 'Parth Lakare', products: 12, completed: 6 },
  { id: 'SRC-015', source: 'Manual Entry', start: '2026-02-22', due: '2026-05-02', createdBy: 'Admin', assignee: 'Parth Lakare', products: 15, completed: 15 },
  { id: 'SRC-017', source: 'Product Master', start: '2026-03-04', due: '2026-05-14', createdBy: 'Rohan Mehta', assignee: 'Parth Lakare', products: 18, completed: 13 },
  { id: 'SRC-019', source: 'Product Master', start: '2026-03-12', due: '2026-05-22', createdBy: 'Aarav Sharma', assignee: 'Parth Lakare', products: 11, completed: 0 },
  { id: 'SRC-022', source: 'Manual Entry', start: '2026-03-18', due: '2026-06-05', createdBy: 'Meera Krishnan', assignee: 'Parth Lakare', products: 10, completed: 0 },
  { id: 'SRC-024', source: 'Product Master', start: '2026-03-25', due: '2026-06-12', createdBy: 'Admin', assignee: 'Parth Lakare', products: 17, completed: 9 },
  { id: 'SRC-026', source: 'Product Master', start: '2026-04-02', due: '2026-06-18', createdBy: 'Priya Nair', assignee: 'Parth Lakare', products: 14, completed: 14 },
  { id: 'SRC-028', source: 'Manual Entry', start: '2026-04-08', due: '2026-06-25', createdBy: 'Rohan Mehta', assignee: 'Parth Lakare', products: 13, completed: 5 },
  { id: 'SRC-030', source: 'Product Master', start: '2026-04-14', due: '2026-07-01', createdBy: 'Aarav Sharma', assignee: 'Parth Lakare', products: 20, completed: 8 },
  { id: 'SRC-032', source: 'Product Master', start: '2026-04-20', due: '2026-07-08', createdBy: 'Admin', assignee: 'Parth Lakare', products: 16, completed: 0 },
  { id: 'SRC-034', source: 'Manual Entry', start: '2026-04-26', due: '2026-07-15', createdBy: 'Meera Krishnan', assignee: 'Parth Lakare', products: 12, completed: 7 },
];

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

  const allRows = tab === 'created' ? CREATED : ASSIGNED;
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
      <style>{CSS}</style>

        {/* HEADER STRIP */}
        <div style={{ flexShrink: 0, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', minHeight: 56, border: '1px solid rgba(6,182,212,.28)', borderRadius: 12, background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 20%,#d4f4f9 50%,#bff0f7 80%,#a5e9f3 100%)', boxShadow: '0 2px 0 rgba(255,255,255,.85) inset,0 4px 16px rgba(6,182,212,.15)' }}>
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
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0c4a6e', letterSpacing: '-.3px', lineHeight: 1.1 }}>Bulk Sourcing Management</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#0e7490', opacity: .85, marginTop: 1 }}>Create, track and manage bulk sourcing requests, RFQs and consolidated procurement across suppliers.</div>
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
                  <span className="bst-tab-c">{ASSIGNED.length}</span>
                </button>
                <button type="button" className={`bst-tab ${tab === 'created' ? 'is-active' : ''}`} onClick={() => switchTab('created')}>
                  <span className="bst-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></span>
                  Sourcing Target Created by Me
                  <span className="bst-tab-c">{CREATED.length}</span>
                </button>
              </div>
              <div className="bst-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" value={query} placeholder="Search by ID, person, source or status..." onChange={e => { setQuery(e.target.value); setPage(1); }} />
                {query && <button type="button" className="bst-search-clear" onClick={() => { setQuery(''); setPage(1); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
              </div>
            </div>

            <div className="bst-panel">
              {total === 0 ? (
                <div className="bst-empty">
                  <div className="bst-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
                  <div className="bst-empty-t">No results found</div>
                  <div className="bst-empty-s">Try a different search term.</div>
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
          <AssignSourcingTargetModal key={editRow ? editRow.id : 'new'} editRow={editRow} onClose={() => { setAssignOpen(false); setEditRow(null); }} />
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

const CSS = `
.bsm-teal .bref-box{background:#fff;border:1px solid #A5F3FC;border-radius:16px;overflow:hidden;position:relative;box-shadow:0 2px 0 rgba(255,255,255,.9) inset,0 6px 22px rgba(6,182,212,.12),0 2px 6px rgba(0,0,0,.04);}
.bsm-teal .bref-box::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#67e8f9,#0891b2,#0e7490);border-radius:16px 0 0 16px;z-index:10;}
.bsm-teal .bref-box__header{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;padding:7px 12px;background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 25%,#cffafe 55%,#bff0f7 85%,#a5e9f3 100%);border-bottom:1px solid #A5F3FC;cursor:pointer;user-select:none;min-height:48px;}
.bsm-teal .bref-box.is-collapsed .bref-box__header{border-bottom-color:transparent;}
.bsm-teal .bref-box__header::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(103,232,249,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(34,211,238,.25) 0%,transparent 55%);}
.bsm-teal .bref-box__header::after{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
.bsm-teal .bref-box__header-ico{width:36px;height:36px;border-radius:11px;flex-shrink:0;background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);display:flex;align-items:center;justify-content:center;color:#fff;position:relative;z-index:1;box-shadow:0 0 0 3px rgba(6,182,212,.20),0 4px 12px rgba(8,145,178,.36);}
.bref-box__header-mid{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;position:relative;z-index:1;}
.bref-box__header-row{display:flex;align-items:center;gap:9px;}
.bsm-teal .bref-box__header-label{font-size:9.5px;font-weight:600;letter-spacing:-.2px;color:#0891b2;line-height:1;white-space:nowrap;flex-shrink:0;}
.bsm-teal .bref-box__header-sep{width:1px;height:13px;background:#A5E8F5;flex-shrink:0;}
.bsm-teal .bref-box__header-title{font-size:11px;font-weight:600;color:#0c4a6e;letter-spacing:-.2px;line-height:1;white-space:nowrap;}
.bsm-teal .bref-box__header-sub{font-size:9.5px;font-weight:500;color:#0e7490;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bref-box__header-right{flex-shrink:0;display:flex;align-items:center;gap:6px;position:relative;z-index:1;}
.bsm-teal .bref-box__toggle{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);border:1.5px solid rgba(8,145,178,.22);color:#0891b2;transition:transform .24s cubic-bezier(.22,1,.36,1);box-shadow:0 1px 4px rgba(8,145,178,.10),inset 0 1px 0 rgba(255,255,255,.9);}
.bref-box.is-collapsed .bref-box__toggle{transform:rotate(-90deg);}
.bsm-teal .bref-box__body{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));background:linear-gradient(180deg,#F0F9FF 0%,#F8FAFC 100%);gap:0;overflow:hidden;max-height:320px;transition:max-height .3s cubic-bezier(.22,1,.36,1),opacity .22s;opacity:1;}
.bref-box.is-collapsed .bref-box__body{max-height:0;opacity:0;}
.bref-item{position:relative;padding:10px 11px 11px;background:#fff;margin:7px 5px;border-radius:11px;border:1.5px solid #E4EFF5;transition:box-shadow .18s,border-color .18s,transform .18s;display:flex;flex-direction:column;gap:0;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.04);}
.bref-item:first-child{margin-left:7px;}
.bref-item:last-child{margin-right:7px;}
.bref-item:hover{border-color:#67E8F9;box-shadow:0 6px 18px rgba(6,182,212,.14),0 1px 4px rgba(15,23,42,.04);transform:translateY(-2px);}
.bref-item::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:11px 11px 0 0;background:linear-gradient(90deg,#06b6d4,#0891b2);}
.bref-item__top{display:flex;align-items:center;gap:6px;margin-bottom:0;}
.bref-item__ico{width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0891b2;}
.bref-item__num{font-size:8.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;line-height:1;}
.bref-item__title{font-size:11px;font-weight:600;color:#0F172A;letter-spacing:-.2px;line-height:1.25;margin-bottom:3px;margin-top:5px;}
.bref-item__desc{font-size:9.5px;font-weight:500;color:#94A3B8;line-height:1.4;}
@media(max-width:1100px){.bsm-teal .bref-box__body{grid-template-columns:repeat(4,1fr)}}
@media(max-width:700px){.bsm-teal .bref-box__body{grid-template-columns:repeat(2,1fr)}}

.bst-card{background:#fff;border:1px solid #d6eef5;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -10px rgba(6,182,212,.16),0 0 0 1px rgba(255,255,255,.6) inset;}
.bst-toolbar{display:flex;align-items:stretch;justify-content:space-between;gap:12px;padding:13px 16px;background:linear-gradient(180deg,#f3fbfd,#fbfeff);border-bottom:1px solid #e6f3f7;flex-wrap:wrap;}
.bst-tabs{display:inline-flex;align-items:center;gap:4px;padding:4px;background:#eef7fa;border:1px solid #d8eef4;border-radius:12px;flex-wrap:nowrap;}
.bst-tab{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12px;font-weight:600;color:#5b7585;background:transparent;border:none;border-radius:9px;padding:9px 16px;cursor:pointer;transition:all .18s;letter-spacing:-.1px;white-space:nowrap;}
.bst-tab:hover{color:#0e7490;background:#f0fdff;}
.bst-tab.is-active{color:#fff;background:linear-gradient(135deg,#22d3ee,#0891b2 60%,#0e7490);box-shadow:0 5px 14px -4px rgba(8,145,178,.55),0 1px 0 rgba(255,255,255,.25) inset;}
.bst-tab-ico{display:flex;align-items:center;color:#94b2bf;}
.bst-tab.is-active .bst-tab-ico{color:rgba(255,255,255,.9);}
.bst-tab-c{font-size:9.5px;font-weight:600;color:#0e7490;background:#e0fbff;border:1px solid #bdf0f7;border-radius:999px;padding:1px 7px;min-width:18px;text-align:center;}
.bst-tab.is-active .bst-tab-c{color:#0e7490;background:#fff;border-color:transparent;}
.bst-search{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid #d8eef4;border-radius:11px;padding:0 12px;min-height:46px;flex:1 1 380px;max-width:600px;min-width:0;transition:border-color .15s,box-shadow .15s;}
.bst-search:focus-within{border-color:#67e8f9;box-shadow:0 0 0 3px rgba(34,211,238,.13);}
.bst-search > svg{flex-shrink:0;}
.bst-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:12.5px;color:#0f172a;height:100%;}
.bst-search input::placeholder{color:#9fb0bf;}
.bst-search-clear{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;border:none;background:#eef4f7;color:#7c93a3;cursor:pointer;transition:all .14s;}
.bst-search-clear:hover{background:#dde9ef;color:#475569;}
.bst-panel{background:#fff;overflow:hidden;}
.bst-table{display:flex;flex-direction:column;overflow-x:hidden;}
.bst-row{display:grid;grid-template-columns:40px 80px 118px 78px 78px minmax(110px,1fr) minmax(110px,1fr) 90px minmax(150px,1.1fr) 180px;align-items:center;gap:8px;padding:5px 14px;border-bottom:1px solid #eff5f8;font-size:11px;}
.bst-row > span{display:flex;align-items:center;min-width:0;}
.bst-row > span.bst-c-center{justify-content:center;text-align:center;}
.bst-row:last-child{border-bottom:none;}
.bst-row:not(.bst-row--head):hover{background:#f6fdfe;}
.bst-row--head{background:linear-gradient(180deg,#e9f9fc,#f2fcfd);font-size:8.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#6b8a97;padding-top:9px;padding-bottom:9px;}
.bst-row--head span{white-space:normal;overflow:visible;text-overflow:unset;line-height:1.3;}
.bst-sr{font-weight:600;color:#7c93a3;font-size:12px;}
.bst-idpill{display:inline-block;font-size:10px;font-weight:600;color:#0e7490;background:#f0fdff;border:1.5px solid #c4eef5;border-radius:7px;padding:3px 7px;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.01em;}
.bst-src{display:inline-block;font-size:9.5px;font-weight:600;border-radius:999px;padding:3px 8px;letter-spacing:.01em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.bst-src--master{color:#0e7490;background:#e0fbff;border:1px solid #bdf0f7;}
.bst-src--manual{color:#7c3aed;background:#f3edff;border:1px solid #ddd0fb;}
.bst-due{color:#334155;font-weight:600;font-size:10.5px;}
.bst-person{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;}
.bst-av{width:24px;height:24px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;font-weight:600;font-size:9px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px -1px rgba(8,145,178,.4);}
.bst-av--me{background:linear-gradient(135deg,#818cf8,#4f46e5);box-shadow:0 2px 5px -1px rgba(79,70,229,.4);}
.bst-person-name{font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;}
.bst-person-none{color:#aab8c5;font-weight:600;padding-left:6px;}
.bst-pcount{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;font-size:13px;font-weight:600;color:#fff;background:linear-gradient(135deg,#22d3ee 0%,#06b6d4 40%,#0891b2 75%,#0e7490 100%);border-radius:10px;box-shadow:0 4px 10px -2px rgba(8,145,178,.55),0 1px 0 rgba(255,255,255,.25) inset;}
.bst-prog3{display:flex;flex-direction:column;gap:5px;width:100%;max-width:200px;margin:0 auto;}
.bst-prog3-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.bst-prog3-pct{font-size:11px;font-weight:600;color:#0891b2;letter-spacing:-.3px;}
.bst-prog3-pct.is-done{color:#16a34a;}
.bst-bar{width:100%;height:6px;border-radius:999px;background:#e6eef2;overflow:hidden;}
.bst-bar-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#0891b2);box-shadow:0 1px 3px -1px rgba(8,145,178,.4);transition:width .4s ease;}
.bst-bar.all-done .bst-bar-fill{background:linear-gradient(90deg,#4ade80,#16a34a);box-shadow:0 1px 3px -1px rgba(22,163,74,.4);}
.bst-prog3-legend{display:flex;align-items:center;gap:12px;font-size:9.5px;font-weight:600;}
.bst-lg{display:inline-flex;align-items:center;gap:4px;}
.bst-lg i{width:6px;height:6px;border-radius:2px;flex-shrink:0;}
.bst-lg.done{color:#16a34a;} .bst-lg.done i{background:linear-gradient(90deg,#22d3ee,#0891b2);}
.bst-lg.pend{color:#ea7a0c;} .bst-lg.pend i{background:#f59e0b;}
.bst-lg.pend.is-zero{color:#aab8c5;} .bst-lg.pend.is-zero i{background:#d4dde4;}
.bst-st2{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:600;border-radius:999px;padding:3px 10px;letter-spacing:.02em;width:max-content;}
.bst-st-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0;}
.bst-st--done,.bst-st2.bst-st--done{color:#15803d;background:#dcfce7;border:1px solid #bbf7d0;}
.bst-st--prog,.bst-st2.bst-st--prog{color:#0e7490;background:#cffafe;border:1px solid #a5f3fc;}
.bst-actions{display:inline-flex;gap:6px;align-items:center;flex-wrap:nowrap;width:100%;justify-content:center;}
.bst-act{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;cursor:pointer;border:none;transition:transform .18s cubic-bezier(.34,1.56,.64,1),filter .14s,box-shadow .18s;color:#fff;position:relative;flex-shrink:0;}
.bst-act--edit{background:linear-gradient(135deg,#22d3ee 0%,#0891b2 60%,#0e7490 100%);box-shadow:0 4px 12px -3px rgba(8,145,178,.65),0 1px 0 rgba(255,255,255,.35) inset;}
.bst-act:hover{transform:translateY(-2px) scale(1.08);filter:brightness(1.08);box-shadow:0 8px 20px -4px rgba(8,145,178,.5),0 1px 0 rgba(255,255,255,.3) inset;}
.bst-act:active{transform:translateY(0) scale(.97);}
.bst-act svg{width:15px;height:15px;}
.bst-report-btn{display:inline-flex;align-items:center;gap:4px;padding:0 10px;height:32px;border-radius:9px;cursor:pointer;border:none;font-family:inherit;font-size:10.5px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:.1px;background:linear-gradient(135deg,#22d3ee 0%,#0891b2 55%,#0e7490 100%);box-shadow:0 4px 12px -3px rgba(8,145,178,.6),0 1px 0 rgba(255,255,255,.3) inset;transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s,filter .14s;}
.bst-report-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 8px 20px -4px rgba(8,145,178,.6),0 1px 0 rgba(255,255,255,.3) inset;filter:brightness(1.07);}
.bst-report-btn:active{transform:translateY(0) scale(.97);}
.bst-report-btn svg{flex-shrink:0;}
.bst-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:38px 20px;text-align:center;}
.bst-empty-ico{width:54px;height:54px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ecfeff,#dff8fc);border:1px solid #a5f3fc;margin-bottom:4px;}
.bst-empty-t{font-size:13.5px;font-weight:600;color:#0c4a6e;}
.bst-empty-s{font-size:11.5px;font-weight:500;color:#8b9bb0;}
.bst-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 18px;border-top:1px solid #eff5f8;background:linear-gradient(180deg,#f7fdfe,#fff);flex-wrap:wrap;}
.bst-pg-info{font-size:11px;font-weight:600;color:#64748b;}
.bst-pg-info b{color:#0e7490;font-weight:600;}
.bst-pg-ctrls{display:inline-flex;align-items:center;gap:5px;}
.bst-pg-btn{display:inline-flex;align-items:center;gap:4px;font-family:inherit;font-size:11px;font-weight:600;color:#0e7490;background:#fff;border:1.5px solid #cdeef5;border-radius:8px;padding:6px 11px;cursor:pointer;transition:all .14s;}
.bst-pg-btn:hover:not(:disabled){background:#ecfeff;border-color:#67e8f9;}
.bst-pg-btn:disabled{opacity:.4;cursor:not-allowed;}
.bst-pg-num{font-family:inherit;font-size:11.5px;font-weight:600;color:#5b7585;background:#fff;border:1.5px solid #e2edf0;border-radius:8px;min-width:30px;height:30px;padding:0 7px;cursor:pointer;transition:all .14s;}
.bst-pg-num:hover{border-color:#a5e8f2;color:#0e7490;}
.bst-pg-num.is-active{color:#fff;background:linear-gradient(135deg,#22d3ee,#0891b2);border-color:transparent;box-shadow:0 3px 9px -3px rgba(8,145,178,.55);}
@media(max-width:820px){.bst-tabs{width:100%;}.bst-tab{flex:1;justify-content:center;font-size:11px;padding:9px 8px;gap:5px;}}
`;
