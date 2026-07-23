import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import { ClmSkeletonRows, DeleteConf } from '../shared/clmCommon';
import ClmTncWizardModal from './ClmTncWizardModal';
import Tooltip from '../../../components/ui/Tooltip';
import { MasterSelect } from '../../../components/ui/MasterSelect';

/* Central CLM → Terms & Conditions Master (two tabs: Categories + Library). */

/* The backend still requires a non-null short_code (12-char column) even
 * though the figma-aligned UI no longer exposes it. Derive a sensible
 * abbreviation client-side so saves don't 422. */
export function deriveShortCode(name: string): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return 'CAT';
  const words = cleaned
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const initials = words.map(w => w.charAt(0)).join('').toUpperCase();
  const result = initials || cleaned.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (result || 'CAT').slice(0, 12);
}

type Cat = { id: number; code: string; name: string };
type Lib = { id: number; code: string; segment: string; regulatory?: 'highly' | 'less' | null; category: string; party: string; content: string | null };
type Seg = { id: number; code: string; name: string; regulatory_status: 'highly' | 'less' };

/* The party field is stored by internal value ("Buyer", "Supplier-Material")
   but the form (and the user) picks by label ("Customer", "Material"). Map the
   stored values back to their display labels so the "Applies To" column matches
   what was selected — e.g. "Customer", not "Buyer" (CBC-443). */
const PARTY_LABELS: Record<string, string> = {
  'Buyer': 'Customer',
  'Consignee': 'Consignee',
  'Supplier-Material': 'Material',
};
const partyLabels = (party: string): string[] =>
  party.split(',').map(s => s.trim()).filter(Boolean).map(v => PARTY_LABELS[v] ?? v);

/* Display label for the regulatory status — mirrors the table cell (anything
   not "less" reads as "Highly Regulatory"). Used for the status search + filter. */
const regLabel = (r?: 'highly' | 'less' | null): string => (r === 'less' ? 'Less Regulatory' : 'Highly Regulatory');

export default function ClmTncPage() {
  const toast = useToast();
  const [tab, setTab]     = useState<'cat'|'lib'>('cat');
  const [cats, setCats]   = useState<Cat[]>([]);
  const [lib, setLib]     = useState<Lib[]>([]);
  const [segs, setSegs]   = useState<Seg[]>([]);
  const [loading, setLoading] = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Cat[] }>('/clm/tnc-categories'),
      api.get<{ status: boolean; data: Lib[] }>('/clm/tnc-library'),
      api.get<{ status: boolean; data: Seg[] }>('/clm/segments'),
    ]).then(([c, l, s]) => { setCats(c.data.data ?? []); setLib(l.data.data ?? []); setSegs(s.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load T&C data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'cat' ? 'active' : ''}`} onClick={() => setTab('cat')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
        Document Category
      </button>
      <button className={`clm-pill ${tab === 'lib' ? 'active' : ''}`} onClick={() => setTab('lib')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        T&amp;C Library
      </button>
    </div>
  );

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={7} twoTab />}

      <ClmPageHeader
        icon={ICO.hTnc}
        title="T&C Master"
        sub="Manage reusable Terms & Conditions templates for trade and operational documents."
        rightSlot={pillSwitcher}
      />

      <ClmBrefBox
        icon={ICO.bTnc}
        label="T&C Master"
        sub="Manage document-wise Terms & Conditions and reusable legal content."
        steps={[
          { n: '01', title: 'Create Category',       desc: 'Add PI, PO, Invoice, and document categories.',         icon: ICO.grid },
          { n: '02', title: 'Create T&C',            desc: 'Add reusable Terms & Conditions content.',              icon: ICO.book },
          { n: '03', title: 'Set Applies To',        desc: 'Define buyer, consignee, and supplier applicability.',   icon: ICO.users },
          { n: '04', title: 'Write T&C Content',     desc: 'Create legal rules and reusable clauses.',              icon: ICO.edit },
          { n: '05', title: 'Enable Usage',          desc: 'Use T&Cs across contracts and trade workflows.',         icon: ICO.check },
        ]}
      />

      {tab === 'cat'
        ? <CategoriesPane rows={cats} loading={loading} reload={reload} />
        : <LibraryPane rows={lib} cats={cats} segs={segs} loading={loading} reload={reload} />}
    </div>
  );
}

function CategoriesPane({ rows, loading }: { rows: Cat[]; loading: boolean; reload: () => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const [rpp, setRpp]     = useState(PER_PAGE);
  const autoFitRef        = useRef(true);
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const scrollRef         = useRef<HTMLDivElement | null>(null);
  const { slice, start, pageCount, safePage } = paginate(filtered, page, rpp);

  // Dynamic pagination: rows-per-page auto-fits the visible table height and
  // the card stretches to cover the page. Anchored via closest('.clm-root').
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const THEAD = 40, ROW = 46, FOOTER = 96;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    // Not observing the page root: the "What We Are Doing Here" box animates its
    // height on expand/collapse, so observing the root fired this recompute every
    // animation frame and visibly disturbed the layout. Recompute only on mount
    // and on genuine window resizes instead.
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [filtered.length]);

  // Document categories are read-only — they're owned by the Quotation &
  // Proforma Invoice documents, so there's no add / edit / delete here.

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search categories…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {/* Document categories are read-only — they're tied to the
            Quotation & Proforma Invoice documents, so they aren't added
            or changed from here. */}
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No categories yet</div>
            <div className="clm-empty-sub">Document categories are set up for your Quotation &amp; Proforma Invoice documents.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 130, textAlign: 'center' }}>CATEGORY ID</th>
                <th>DOCUMENT CATEGORY NAME</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={3} />}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}>
                      <Tooltip label={`Auto-generated category ID · ${r.code}`}>
                        <span className="clm-code-pill">{r.code}</span>
                      </Tooltip>
                    </td>
                    <td className="clm-td-name">{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryPane({ rows, cats, segs, loading, reload }: { rows: Lib[]; cats: Cat[]; segs: Seg[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<Lib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Lib | null>(null);
  // All-segments popover — opened from the +N badge in the SEGMENT column
  // (same pattern as the DCP authorities popover).
  const [segPop, setSegPop] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // All-parties popover — opened from the +N badge in the APPLIES TO column
  // (same one-badge + "+N" pattern as the SEGMENT column).
  const [partyPop, setPartyPop] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // Close the fixed-positioned badge popovers on scroll/resize so they can't
  // drift out of the table (capture:true catches ancestor + table scrolls).
  useEffect(() => {
    if (!segPop && !partyPop) return;
    const close = () => { setSegPop(null); setPartyPop(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [segPop, partyPop]);
  // Regulatory-status filter dropdown (All / Highly / Less).
  const [statusFilter, setStatusFilter] = useState<'all' | 'highly' | 'less'>('all');

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter === 'less')   list = list.filter(r => r.regulatory === 'less');
    if (statusFilter === 'highly') list = list.filter(r => r.regulatory !== 'less');
    const s = search.trim().toLowerCase();
    if (!s) return list;
    return list.filter(r => r.category.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.party.toLowerCase().includes(s) || partyLabels(r.party).join(' ').toLowerCase().includes(s) || r.segment.toLowerCase().includes(s) || regLabel(r.regulatory).toLowerCase().includes(s));
  }, [rows, search, statusFilter]);
  /* Next T&C code preview for a NEW entry — MAX(existing suffix)+1, matching the
     backend's allocator, so gaps from deletions don't reuse a lower number
     (e.g. after TNC-014 it shows TNC-015, not TNC-010) (CBC-442). */
  const nextTncCode = useMemo(() => {
    let maxN = 0;
    for (const r of rows) {
      const m = /^TNC-(\d+)$/i.exec(r.code ?? '');
      if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
    }
    return `TNC-${String(maxN + 1).padStart(3, '0')}`;
  }, [rows]);
  const [rpp, setRpp]     = useState(PER_PAGE);
  const autoFitRef        = useRef(true);
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const scrollRef         = useRef<HTMLDivElement | null>(null);
  const { slice, start, pageCount, safePage } = paginate(filtered, page, rpp);

  // Dynamic pagination: rows-per-page auto-fits the visible table height and
  // the card stretches to cover the page. Anchored via closest('.clm-root').
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const THEAD = 40, ROW = 46, FOOTER = 96;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    // Not observing the page root: the "What We Are Doing Here" box animates its
    // height on expand/collapse, so observing the root fired this recompute every
    // animation frame and visibly disturbed the layout. Recompute only on mount
    // and on genuine window resizes instead.
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [filtered.length]);

  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.category); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  // Segments with their regulatory tier — drives the wizard's tier-filtered
  // picker (highly → single, less → multi).
  const segOpts = useMemo(
    () => segs.filter(s => s.name).map(s => ({ name: s.name, regulatory_status: s.regulatory_status, code: s.code })),
    [segs],
  );

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search T&C library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div style={{ width: 190, flex: '0 0 auto' }}>
          <MasterSelect
            value={statusFilter}
            placeholder="Status"
            options={[
              { value: 'all',    label: 'Status: All' },
              { value: 'highly', label: 'Highly Regulatory' },
              { value: 'less',   label: 'Less Regulatory' },
            ]}
            onChange={(v) => { setStatusFilter((v || 'all') as 'all' | 'highly' | 'less'); setPage(1); }}
          />
        </div>
        <Tooltip label="Draft a new reusable T&C block">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add T&amp;C
          </button>
        </Tooltip>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No T&amp;C blocks yet</div>
            <div className="clm-empty-sub">Click + Add T&amp;C to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>T&amp;C ID</th>
                <th style={{ width: 150, textAlign: 'center' }}>SEGMENT</th>
                <th style={{ width: 150, textAlign: 'center' }}>STATUS</th>
                <th>DOCUMENT CATEGORY</th>
                <th>APPLIES TO</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={7} />}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}>
                      <Tooltip label={`Auto-generated T&C ID · ${r.code}`}>
                        <span className="clm-code-pill">{r.code}</span>
                      </Tooltip>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {(() => {
                        const list = (r.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
                        if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;
                        const extra = list.length - 1;
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                            <Tooltip label={`Segment scope · ${list[0]}`}>
                              <span className="clm-badge clm-badge-teal" style={{ display: 'inline-block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{list[0]}</span>
                            </Tooltip>
                            {extra > 0 && (
                              <Tooltip label="View all segments">
                                <button
                                  type="button"
                                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(segPop?.id === r.id ? null : { id: r.id, names: list, x: b.left, y: b.bottom + 4 }); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)' }}>
                                  +{extra}
                                </button>
                              </Tooltip>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {/* Debit/Credit Note documents carry no regulatory tier → "—". */}
                      {r.regulatory ? (
                        <span className={`clm-badge ${r.regulatory === 'less' ? 'clm-badge-green' : 'clm-badge-red'}`}>
                          <span className="clm-badge-dot" />
                          {r.regulatory === 'less' ? 'Less Regulatory' : 'Highly Regulatory'}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>
                      )}
                    </td>
                    <td className="clm-td-name">
                      <Tooltip label={r.category}>
                        <span>{r.category}</span>
                      </Tooltip>
                    </td>
                    <td className="clm-td-desc">
                      {(() => {
                        const list = partyLabels(r.party);
                        if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;
                        const extra = list.length - 1;
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Tooltip label={`Applies to · ${list[0]}`}>
                              <span className="clm-badge clm-badge-teal">{list[0]}</span>
                            </Tooltip>
                            {extra > 0 && (
                              <Tooltip label="View all applicable parties">
                                <button
                                  type="button"
                                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setPartyPop(partyPop?.id === r.id ? null : { id: r.id, names: list, x: b.left, y: b.bottom + 4 }); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)' }}>
                                  +{extra}
                                </button>
                              </Tooltip>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <Tooltip label={`Edit T&C — ${r.category}`}>
                          <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        </Tooltip>
                        <Tooltip label={`Delete T&C — ${r.category}`}>
                          <button className="clm-act clm-act-del" aria-label="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
            )}
          </div>
        )}
      </div>

      {pendingDelete && createPortal(<DeleteConf title="Delete T&C block?" sub={`${pendingDelete.category} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}

      {/* All-segments popover (opened from the +N badge in the SEGMENT column) */}
      {segPop && createPortal(
        <>
          <div onClick={() => setSegPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(segPop.x, window.innerWidth - 230), top: segPop.y, zIndex: 601, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Segments ({segPop.names.length})</div>
            {segPop.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* All-parties popover (opened from the +N badge in the APPLIES TO column) */}
      {partyPop && createPortal(
        <>
          <div onClick={() => setPartyPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(partyPop.x, window.innerWidth - 230), top: partyPop.y, zIndex: 601, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Applies To ({partyPop.names.length})</div>
            {partyPop.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      <ClmTncWizardModal
        open={modalOpen}
        existing={editing}
        cats={cats}
        segments={segOpts}
        nextCode={editing?.code ?? nextTncCode}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => { setModalOpen(false); setEditing(null); reload(); }}
      />
    </div>
  );
}

