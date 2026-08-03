import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import { ClmSkeletonRows, DeleteConf, LockedConf, SimpleNameModal } from '../shared/clmCommon';
import Tooltip from '../../../components/ui/Tooltip';
import ClmTradeDocumentDraftModal from './ClmTradeDocumentDraftModal';

/* Central CLM → Trade Documents Master (two tabs: List + Library). */

type TdName = { id: number; code: string; name: string; in_use?: number };
type TdLib  = { id: number; code: string; name: string; title: string; doc_type: string; purpose: string; party: string; regulatory?: 'highly'|'less'; segment?: string | null; file_path: string | null; content: string | null; is_signed?: boolean };
type Seg    = { id: number; name: string; regulatory_status: 'highly' | 'less' };

/* The Applicable-Party field stores internal values ("Buyer", "Supplier-Material")
   but the form picks by label ("Customer", "Material"). Map stored values back to
   their display labels so the column shows what the user selected. */
const PARTY_LABELS: Record<string, string> = {
  'Buyer': 'Customer',
  'Consignee': 'Consignee',
  'Supplier-Material': 'Material',
  'Supplier-Logistic': 'Logistic',
  'Supplier-Tech': 'Tech',
  'Supplier-Advisory': 'Advisory',
  'Supplier-Strategic Risk': 'Strategic Risk',
};
const partyLabels = (party: string): string[] =>
  (party ?? '').split(',').map(s => s.trim()).filter(Boolean).map(v => PARTY_LABELS[v] ?? v);

export default function ClmTradeDocumentsPage() {
  const toast = useToast();
  const [tab, setTab]           = useState<'list'|'lib'>('list');
  const [names, setNames]       = useState<TdName[]>([]);
  const [lib, setLib]           = useState<TdLib[]>([]);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [loading, setLoading]   = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: TdName[] }>('/clm/trade-doc-names'),
      api.get<{ status: boolean; data: TdLib[] }>('/clm/trade-doc-library'),
      // Segments drive the Step-1 Segment Regulatory Status selector in the
      // draft modal (same source the Agreement wizard uses).
      api.get<{ status: boolean; data: Seg[] }>('/clm/segments').catch(() => ({ data: { data: [] } })),
    ]).then(([n, l, s]) => { setNames(n.data.data ?? []); setLib(l.data.data ?? []); setSegments((s.data as { data?: Seg[] }).data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load trade documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
        Trade Document Type
      </button>
      <button className={`clm-pill ${tab === 'lib' ? 'active' : ''}`} onClick={() => setTab('lib')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        Trade Document Library
      </button>
    </div>
  );

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={4} twoTab />}

      <ClmPageHeader
        icon={ICO.hTd}
        title="Trade Documents Master"
        sub="Manage trade declarations, undertakings, and reusable document templates."
        rightSlot={pillSwitcher}
      />

      <ClmBrefBox
        icon={ICO.bTrade}
        label="Trade Documents Master"
        sub="Manage reusable trade document templates and declaration structures."
        steps={[
          { n: '01', title: 'Create Document Name', desc: 'Add declaration and undertaking document names.', icon: ICO.doc },
          { n: '02', title: 'Create Draft Template', desc: 'Create reusable draft document content.',         icon: ICO.edit },
          { n: '03', title: 'Set Applies To',        desc: 'Define buyer, consignee, and supplier applicability.', icon: ICO.users },
          { n: '04', title: 'Insert Placeholders',   desc: 'Configure dynamic document placeholders.',        icon: ICO.zap },
          { n: '05', title: 'Enable Usage',          desc: 'Use trade docs across CLM workflows.',             icon: ICO.check },
        ]}
      />

      {tab === 'list'
        ? <NamesPane rows={names} loading={loading} reload={reload} />
        : <LibraryPane rows={lib} names={names} segments={segments} loading={loading} reload={reload} />}
    </div>
  );
}

/* ─── Names sub-tab ─── */

function NamesPane({ rows, loading, reload }: { rows: TdName[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<TdName | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TdName | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const [rpp, setRpp]     = useState(PER_PAGE);
  // Auto-fit rows to the viewport by default; once the user picks a value from
  // the "Rows per page" dropdown we respect their choice.
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

  const onSave = async (name: string, id?: number) => {
    try {
      if (id) await api.put(`/clm/trade-doc-names/${id}`, { name });
      else    await api.post('/clm/trade-doc-names', { name });
      toast.success(id ? 'Updated' : 'Added', name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/trade-doc-names/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search trade document types…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Trade Document Type
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTrade}</div>
            <div className="clm-empty-title">No trade document types yet</div>
            <div className="clm-empty-sub">Click + Add Trade Document Type to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 130, textAlign: 'center' }}>DOC NAME ID</th>
                <th>TRADE DOCUMENT NAME</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={4} />}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <Tooltip label={r.name}><td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.name}</div></td></Tooltip>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        {(() => {
                          // A trade document type used by Library drafts can't be edited
                          // OR deleted — the library references it by name, so renaming
                          // would orphan those drafts and deleting would break them.
                          // Only fresh (unused) types are editable/deletable (QA #43).
                          const used = (r.in_use ?? 0) > 0;
                          const usedMsg = (verb: string) => `Used by ${r.in_use} draft${r.in_use === 1 ? '' : 's'} in the Trade Document Library — can't ${verb}. Remove or reassign ${r.in_use === 1 ? 'it' : 'them'} first.`;
                          return (
                            <>
                              <Tooltip label={used ? usedMsg('edit') : 'Edit'}>
                                <button
                                  className="clm-act clm-act-edit"
                                  disabled={used}
                                  style={used ? { opacity: .4, cursor: 'not-allowed' } : undefined}
                                  onClick={() => { if (used) return; setEditing(r); setModalOpen(true); }}
                                ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                              </Tooltip>
                              <Tooltip label={used ? usedMsg('delete') : 'Delete'}>
                                <button
                                  className="clm-act clm-act-del"
                                  aria-label="Delete"
                                  disabled={used}
                                  style={used ? { opacity: .4, cursor: 'not-allowed' } : undefined}
                                  onClick={() => { if (used) return; setPendingDelete(r); }}
                                ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                              </Tooltip>
                            </>
                          );
                        })()}
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

      {modalOpen && <SimpleNameModal title={editing ? 'Edit Trade Document Type' : 'Add Trade Document Type'} placeholder="e.g. Bill of Lading, Commercial Invoice" code={editing?.code ?? `TDN-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initial={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(name) => onSave(name, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete trade document type?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

/* ─── Library sub-tab ─── */

function LibraryPane({ rows, names, segments, loading, reload }: { rows: TdLib[]; names: TdName[]; segments: Seg[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<TdLib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TdLib | null>(null);
  // All-segments popover — opened from the +N badge in the SEGMENT column.
  const [segOpen, setSegOpen] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // All-parties popover — opened from the +N badge in the APPLICABLE PARTY column.
  const [partyOpen, setPartyOpen] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // These popovers are portalled with fixed positioning off the badge's rect, so
  // a page/table scroll leaves them behind (they drift out of the table and look
  // mispositioned). Close them on any scroll (capture:true catches ancestor +
  // table scrolls) or resize — same behaviour as the master dropdowns.
  useEffect(() => {
    if (!segOpen && !partyOpen) return;
    const close = () => { setSegOpen(null); setPartyOpen(null); };
    // Close on PAGE/table scroll, but not when scrolling inside the popover itself
    // (that scroll used to close it, making a long list unscrollable).
    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('.clm-pop')) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [segOpen, partyOpen]);
  // Blocked-action popup state — set when the user clicks Edit/Delete on a
  // draft that has already been signed.
  const [locked, setLocked] = useState<{ mode: 'edit' | 'delete'; row: TdLib } | null>(null);

  /* Download a library row as PDF (full page-shell: branded header + content
   * + footer) or DOCX. The list exposes only the PDF preview. Errors arrive
   * as a Blob, so read them back for the message. */
  // Row id currently generating a download, so its button can show a spinner
  // and disable to prevent duplicate clicks while the PDF/DOCX renders.
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // Open "Download as Doc / PDF" menu (anchored to the row's download button).
  const [dlMenuFor, setDlMenuFor] = useState<{ row: TdLib; top: number; right: number } | null>(null);
  // 0→100 progress + label for the "Generating…" popup. The server gives no real
  // progress, so it eases toward ~90 while rendering and snaps to 100 on done.
  const [dlProgress, setDlProgress] = useState(0);
  const [dlKind, setDlKind] = useState<'pdf' | 'docx'>('pdf');
  const download = async (row: TdLib, fmt: 'pdf' | 'docx') => {
    if (downloadingId) return;
    setDownloadingId(row.id);
    setDlKind(fmt);
    setDlProgress(6);
    let p = 6;
    const timer = window.setInterval(() => { p = Math.min(90, p + Math.random() * 7 + 2); setDlProgress(Math.round(p)); }, 300);
    try {
      const url = fmt === 'pdf'
        ? `/clm/trade-doc-library/${row.id}/download-pdf`
        : `/clm/trade-doc-library/${row.id}/download`;
      const resp = await api.get(url, { responseType: 'blob' });
      window.clearInterval(timer);
      setDlProgress(100);
      const blobUrl = URL.createObjectURL(new Blob([resp.data], { type: fmt === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${row.code || 'trade-document'}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
      await new Promise(res => setTimeout(res, 400)); // let 100% show briefly
    } catch (e: any) {
      window.clearInterval(timer);
      let msg = 'Please try again.';
      try {
        const blob = e?.response?.data;
        if (blob instanceof Blob) { const json = JSON.parse(await blob.text()); if (json?.message) msg = json.message; }
        else if (typeof e?.response?.data?.message === 'string') msg = e.response.data.message;
      } catch { /* keep default */ }
      toast.error('Download failed', msg);
    } finally {
      setDownloadingId(null);
      setDlProgress(0);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.title.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.doc_type.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || (r.segment ?? '').toLowerCase().includes(s) || (r.purpose ?? '').toLowerCase().includes(s) || partyLabels(r.party).join(' ').toLowerCase().includes(s));
  }, [rows, search]);
  const [rpp, setRpp]     = useState(PER_PAGE);
  // Auto-fit rows to the viewport by default; once the user picks a value from
  // the "Rows per page" dropdown we respect their choice.
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
    try { await api.delete(`/clm/trade-doc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.title); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <style>{`
        .tdl-dl-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; white-space: nowrap;
          border: 1px solid rgba(8,145,178,.30); background: rgba(8,145,178,.07); color: #0e7490;
          font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background .12s, border-color .12s; }
        .tdl-dl-btn:hover { background: rgba(8,145,178,.14); border-color: #0891b2; }
        .tdl-dl-backdrop { position: fixed; inset: 0; z-index: 9000; }
        .tdl-dl-menu { z-index: 9001; min-width: 180px; padding: 6px;
          background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 12px 28px rgba(15,23,42,.18); }
        .tdl-dl-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; border: 0; border-radius: 7px;
          background: none; font-family: inherit; font-size: 12.5px; font-weight: 600; color: #1e293b; cursor: pointer; text-align: left; transition: background .12s; }
        .tdl-dl-item:hover { background: #f1f5f9; }
        [data-bs-theme="dark"] .tdl-dl-btn { background: rgba(8,145,178,.14); border-color: rgba(6,182,212,.35); color: #67e8f9; }
        [data-bs-theme="dark"] .tdl-dl-btn:hover { background: rgba(8,145,178,.22); }
        [data-bs-theme="dark"] .tdl-dl-menu { background: #1e293b; border-color: rgba(148,163,184,.22); }
        [data-bs-theme="dark"] .tdl-dl-item { color: #e2e8f0; }
        [data-bs-theme="dark"] .tdl-dl-item:hover { background: rgba(148,163,184,.14); }
      `}</style>
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search trade document drafts…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Draft New Trade Document
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTrade}</div>
            <div className="clm-empty-title">No library entries yet</div>
            <div className="clm-empty-sub">Click + Draft New Trade Document to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>TRADE DOC ID</th>
                <th>TRADE DOCUMENT TITLE</th>
                <th style={{ width: 150 }}>TRADE DOCUMENT TYPE</th>
                <th style={{ width: 110, textAlign: 'center' }}>REGULATORY</th>
                <th style={{ width: 130, textAlign: 'left' }}>SEGMENT</th>
                <th>PURPOSE</th>
                <th>APPLICABLE PARTY</th>
                <th style={{ width: 110, textAlign: 'center' }}>DOWNLOAD</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={10} />}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <Tooltip label={r.title}><td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.title}</div></td></Tooltip>
                    {r.name
                      ? <Tooltip label={r.name}><td className="clm-td-desc clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.name}</div></td></Tooltip>
                      : <td><span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>—</span></td>}
                    <td style={{ textAlign: 'center' }}>
                      {(() => {
                        const isHigh = r.regulatory === 'highly';
                        return (
                          <Tooltip label={isHigh ? 'Highly Regulated — needs segment-specific compliance' : 'Less Regulated — applies to all standard segments'}>
                            <span className={`clm-badge ${isHigh ? 'clm-badge-red' : 'clm-badge-emerald'}`}>
                              <span className="clm-badge-dot" />{isHigh ? 'High' : 'Less'}
                            </span>
                          </Tooltip>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {(() => {
                        const segList = r.segment ? r.segment.split(',').map(s => s.trim()).filter(Boolean) : [];
                        if (segList.length === 0) return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>All segments</span>;
                        const extra = segList.length - 1;
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Tooltip label={`Segment scope · ${segList[0]}`}><span className="clm-badge clm-badge-teal" style={{ verticalAlign: 'middle' }}>{segList[0].length > 15 ? `${segList[0].slice(0, 15)}…` : segList[0]}</span></Tooltip>
                            {extra > 0 && (
                              <Tooltip label="View all segments">
                                <button
                                  type="button"
                                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegOpen(segOpen?.id === r.id ? null : { id: r.id, names: segList, x: b.left, y: b.bottom + 4 }); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)' }}>
                                  +{extra}
                                </button>
                              </Tooltip>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <Tooltip label={r.purpose}><td className="clm-td-trunc-cell"><div className="clm-td-trunc">{r.purpose}</div></td></Tooltip>
                    <td>
                      {(() => {
                        const list = partyLabels(r.party);
                        if (list.length === 0) return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>—</span>;
                        const extra = list.length - 1;
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Tooltip label={`Applies to · ${list[0]}`}><span className="clm-badge clm-badge-teal">{list[0]}</span></Tooltip>
                            {extra > 0 && (
                              <Tooltip label="View all applicable parties">
                                <button
                                  type="button"
                                  onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setPartyOpen(partyOpen?.id === r.id ? null : { id: r.id, names: list, x: b.left, y: b.bottom + 4 }); }}
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
                      {/* Draft PDF preview — the complete combined document
                          (branded header + content + footer), to see how the
                          finished trade document looks. */}
                      <Tooltip label="Download the complete draft as Doc or PDF">
                        <button type="button" className="tdl-dl-btn" disabled={downloadingId === r.id}
                          onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setDlMenuFor({ row: r, top: rect.bottom + 4, right: window.innerWidth - rect.right }); }}>
                          {downloadingId === r.id ? (
                            <>
                              <svg className="clm-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                              Preparing…
                            </>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                              Download Draft
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 1 }}><polyline points="6 9 12 15 18 9" /></svg>
                            </>
                          )}
                        </button>
                      </Tooltip>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <Tooltip label={r.is_signed ? 'Signed — cannot edit' : 'Edit'}><button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { if (r.is_signed) { setLocked({ mode: 'edit', row: r }); return; } setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></Tooltip>
                        <Tooltip label={r.is_signed ? 'Signed — cannot delete' : 'Delete'}><button className="clm-act clm-act-del" aria-label="Delete" onClick={() => { if (r.is_signed) { setLocked({ mode: 'delete', row: r }); return; } setPendingDelete(r); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></Tooltip>
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

      {pendingDelete && createPortal(<DeleteConf title="Delete library entry?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}

      {/* All-segments popover (opened from the +N badge in the SEGMENT column) */}
      {segOpen && createPortal(
        <>
          <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 230), top: segOpen.y, zIndex: 601, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* All-parties popover (opened from the +N badge in the APPLICABLE PARTY column) */}
      {partyOpen && createPortal(
        <>
          <div onClick={() => setPartyOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(partyOpen.x, window.innerWidth - 230), top: partyOpen.y, zIndex: 601, width: 210, maxHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Applicable Party ({partyOpen.names.length})</div>
            {partyOpen.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      {locked && (
        <LockedConf
          title={locked.mode === 'edit' ? 'Cannot edit this draft' : 'Cannot delete this draft'}
          sub={`${locked.row.title} (${locked.row.code}) has already been signed by the customer / consignee / supplier, so it can no longer be ${locked.mode === 'edit' ? 'edited' : 'deleted'}.`}
          onClose={() => setLocked(null)}
        />
      )}

      <ClmTradeDocumentDraftModal
        open={modalOpen}
        existing={editing}
        names={names}
        nextCode={editing?.code ?? `TDL-${String(rows.length + 1).padStart(3, '0')}`}
        knownSegments={segments.map(s => ({ name: s.name, regulatory_status: s.regulatory_status }))}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => { setModalOpen(false); setEditing(null); reload(); }}
      />

      {/* "Download as Doc / PDF" menu, anchored under the row's download button. */}
      {dlMenuFor && createPortal(
        <>
          <div className="tdl-dl-backdrop" onClick={() => setDlMenuFor(null)} />
          <div className="tdl-dl-menu" style={{ position: 'fixed', top: dlMenuFor.top, right: dlMenuFor.right }}>
            {([['docx', 'Download as Doc'], ['pdf', 'Download as PDF']] as const).map(([fmt, label]) => (
              <button key={fmt} type="button" className="tdl-dl-item"
                onClick={() => { const row = dlMenuFor.row; setDlMenuFor(null); void download(row, fmt); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* Popup loader while a PDF/DOCX is generated — a big/table-rich trade doc
          can take several seconds server-side. Shows a 0→100% ring. */}
      {downloadingId !== null && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,30,42,.45)', backdropFilter: 'blur(3px)' }}>
          <div style={{ width: 300, background: '#fff', borderRadius: 18, padding: '26px 24px 22px', textAlign: 'center', boxShadow: '0 24px 60px rgba(8,40,60,.32)' }}>
            <TdProgressRing value={dlProgress} />
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0c2c3a', marginTop: 14 }}>{dlKind === 'pdf' ? 'Generating PDF…' : 'Generating Word file…'}</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: '#5e7888', marginTop: 6, lineHeight: 1.5 }}>Please wait — a large document can take a few seconds.</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* Circular 0→100% progress ring for the generate/download popup. */
function TdProgressRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div style={{ position: 'relative', width: 92, height: 92, margin: '0 auto' }}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={R} fill="none" stroke="#e6edf2" strokeWidth="8" />
        <circle cx="46" cy="46" r={R} fill="none" stroke="#0891b2" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform="rotate(-90 46 46)"
          style={{ transition: 'stroke-dashoffset .3s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#0e7490' }}>
        {Math.round(v)}<span style={{ fontSize: 12, fontWeight: 700, marginLeft: 1 }}>%</span>
      </div>
    </div>
  );
}
