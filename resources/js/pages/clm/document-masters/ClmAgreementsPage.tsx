import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import { ClmSkeletonRows, DeleteConf, SimpleDescModal } from '../shared/clmCommon';
import Tooltip from '../../../components/ui/Tooltip';
import ClmAgreementWizardModal from './ClmAgreementWizardModal';

/* Central CLM → Agreements Master (two tabs: Types + Library). */

/* Applicable-party values are STORED as "Buyer" / "Supplier-Material" etc.
   (the agreement wizard's PARTY_* value set) but the user picks — and should
   see — the friendly labels ("Customer", "Material"). Map value → label for the
   Applicable Party column so it never shows "Buyer" instead of "Customer"
   (CBC-436). Unknown values fall through unchanged. */
const PARTY_LABELS: Record<string, string> = {
  'Buyer': 'Customer',
  'Consignee': 'Consignee',
  'Supplier-Material': 'Material',
  'Supplier-Logistic': 'Logistic',
  'Supplier-Tech': 'Tech',
  'Supplier-Advisory': 'Advisory',
  'Supplier-Strategic Risk': 'Strategic Risk',
};
const partyLabel = (v: string): string => PARTY_LABELS[v] ?? v;

type AgrType = { id: number; code: string; name: string; description: string; in_use?: number };
type AgrLib = {
  id: number; code: string; agreement_type: string; title: string; purpose?: string | null; party: string;
  regulatory: 'highly'|'less'; signing: boolean; segment: string | null;
  agr_status: string; content: string | null; is_signed?: boolean; in_use?: boolean;
};
type Seg = { id: number; code: string; name: string; regulatory_status: 'highly' | 'less' };

export default function ClmAgreementsPage() {
  const toast = useToast();
  const [tab, setTab]       = useState<'type'|'lib'>('type');
  const [types, setTypes]   = useState<AgrType[]>([]);
  const [lib, setLib]       = useState<AgrLib[]>([]);
  const [segs, setSegs]     = useState<Seg[]>([]);
  const [loading, setLoading] = useState(true); // start true so the shimmer shows from frame 1 (not the empty-state icon)

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: AgrType[] }>('/clm/agreement-types'),
      api.get<{ status: boolean; data: AgrLib[]  }>('/clm/agreement-library'),
      api.get<{ status: boolean; data: Seg[]     }>('/clm/segments'),
    ]).then(([t, l, s]) => { setTypes(t.data.data ?? []); setLib(l.data.data ?? []); setSegs(s.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load agreements'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'type' ? 'active' : ''}`} onClick={() => setTab('type')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
        Agreement Types
      </button>
      <button className={`clm-pill ${tab === 'lib' ? 'active' : ''}`} onClick={() => setTab('lib')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
        Agreement Library
      </button>
    </div>
  );

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      {loading && <ShimmerClmMaster cols={5} twoTab />}

      <ClmPageHeader
        icon={ICO.hAgr}
        title="Agreements Master"
        sub="Manage agreement templates & masters for trade and CLM workflows."
        rightSlot={pillSwitcher}
      />

      <ClmBrefBox
        icon={ICO.bAgr}
        label="Agreements Master"
        sub="Manage agreement templates and reusable masters for trade & CLM workflows."
        steps={[
          { n: '01', title: 'Agreement Type',         desc: 'Create sales, purchase, service and other agreement types.', icon: ICO.grid },
          { n: '02', title: 'Draft Agreement',        desc: 'Create agreement templates mapped to segments.',             icon: ICO.edit },
          { n: '03', title: 'Set Applicable Parties', desc: 'Define customer, consignee, and supplier applicability.',        icon: ICO.users },
          { n: '04', title: 'Write Agreement Content',desc: 'Author legal terms, clauses and agreement body.',             icon: ICO.list },
          { n: '05', title: 'Use in CLM Generation',  desc: 'Auto-use in CLM contract generation workflows.',              icon: ICO.check },
        ]}
      />

      {tab === 'type'
        ? <TypesPane rows={types} loading={loading} reload={reload} />
        : <LibraryPane rows={lib} types={types} segs={segs} loading={loading} reload={reload} />}
    </div>
  );
}

function TypesPane({ rows, loading, reload }: { rows: AgrType[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<AgrType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgrType | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
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

  const onSave = async (form: { name: string; description: string }, id?: number) => {
    try {
      if (id) await api.put(`/clm/agreement-types/${id}`, form);
      else    await api.post('/clm/agreement-types', form);
      toast.success(id ? 'Updated' : 'Added', form.name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/agreement-types/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search agreement types…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Tooltip label="Create a new agreement type">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Agreement Type
          </button>
        </Tooltip>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bAgr}</div>
            <div className="clm-empty-title">No agreement types yet</div>
            <div className="clm-empty-sub">Click + Add Agreement Type to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 120, textAlign: 'center' }}>TYPE ID</th>
                <th>AGREEMENT TYPE NAME</th>
                <th>DESCRIPTION</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={5} />}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <Tooltip label={r.name}>
                      <td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.name}</div></td>
                    </Tooltip>
                    <Tooltip label={r.description}>
                      <td className="clm-td-desc clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.description}</div></td>
                    </Tooltip>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        {r.in_use ? (
                          <Tooltip label={`Used by ${r.in_use} agreement${r.in_use === 1 ? '' : 's'} in the library — cannot edit`}>
                            <button className="clm-act clm-act-edit" aria-label="Locked — in use" disabled style={{ opacity: .4, cursor: 'not-allowed' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
                          </Tooltip>
                        ) : (
                          <Tooltip label={`Edit ${r.name}`}>
                            <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          </Tooltip>
                        )}
                        <Tooltip label={`Delete ${r.name}`}>
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

      {modalOpen && <SimpleDescModal title={editing ? 'Edit Agreement Type' : 'Add Agreement Type'} namePlaceholder="e.g. Sales Agreement, Service Agreement" descPlaceholder="Short description of when this agreement type is used" code={editing?.code ?? `AT-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initialName={editing?.name ?? ''} initialDesc={editing?.description ?? ''} existingRows={rows} editingId={editing?.id ?? null} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete agreement type?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

function LibraryPane({ rows, types, segs, loading, reload }: { rows: AgrLib[]; types: AgrType[]; segs: Seg[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<AgrLib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgrLib | null>(null);
  // All-segments popover — opened from the +N badge in the SEGMENT column.
  const [segOpen, setSegOpen] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  const [partyOpen, setPartyOpen] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
  // Close the fixed-positioned badge popovers on scroll/resize so they can't
  // drift out of the table (capture:true catches ancestor + table scrolls).
  useEffect(() => {
    if (!segOpen && !partyOpen) return;
    const close = () => { setSegOpen(null); setPartyOpen(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [segOpen, partyOpen]);
  // Row whose PDF is currently downloading — drives the per-row spinner.
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // Open "Download as Doc / PDF" menu (anchored to the row's download button).
  const [dlMenuFor, setDlMenuFor] = useState<{ row: AgrLib; top: number; right: number } | null>(null);
  // Format currently downloading — drives the loader label (Doc vs PDF).
  const [downloadingFmt, setDownloadingFmt] = useState<'pdf' | 'docx'>('pdf');
  // 0→100 progress for the "Generating PDF" popup. The server gives no real
  // progress, so it eases toward ~90 while generating and snaps to 100 on done.
  const [dlProgress, setDlProgress] = useState(0);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const base = s
      ? rows.filter(r => r.title.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.agreement_type.toLowerCase().includes(s) || (r.segment ?? '').toLowerCase().includes(s))
      : rows;
    // List shown in DESCENDING order — newest agreements (highest id) first.
    return [...base].sort((a, b) => b.id - a.id);
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

  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/agreement-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.title); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  /* Real segments from /clm/segments, kept as objects so the wizard
   * can filter by regulatory tier (high-reg shows only highly-regulated
   * segments + single-select; less-reg shows only less-regulated +
   * multi-select). Names that exist on saved agreement rows but no
   * longer in the segment master are merged in with an 'unknown'
   * regulatory tier so legacy data still surfaces in the dropdown. */
  const knownSegments = useMemo(() => {
    const byName = new Map<string, { name: string; regulatory_status: 'highly' | 'less' }>();
    segs.forEach(s => { if (s.name) byName.set(s.name, { name: s.name, regulatory_status: s.regulatory_status }); });
    rows.forEach(r => {
      if (!r.segment) return;
      // r.segment may be a CSV ("Tobacco, Rice") on multi-segment less-reg
      // agreements — split and add each individually so the wizard's
      // single-name selector still finds them.
      r.segment.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
        if (!byName.has(name)) {
          byName.set(name, { name, regulatory_status: r.regulatory ?? 'less' });
        }
      });
    });
    return Array.from(byName.values());
  }, [rows, segs]);

  // Download the sample agreement as a PDF or DOCX — rendered server-side with
  // the saved page-shell header/footer (logo, name, footer text, pagination).
  const onDownload = async (r: AgrLib, fmt: 'pdf' | 'docx' = 'pdf') => {
    if (downloadingId) return;
    setDownloadingFmt(fmt);
    setDownloadingId(r.id);
    setDlProgress(6);
    let p = 6;
    const timer = window.setInterval(() => { p = Math.min(90, p + Math.random() * 7 + 2); setDlProgress(Math.round(p)); }, 300);
    try {
      const endpoint = fmt === 'docx'
        ? `/clm/agreement-library/${r.id}/download`
        : `/clm/agreement-library/${r.id}/download-pdf`;
      const resp = await api.get(endpoint, { responseType: 'blob' });
      window.clearInterval(timer);
      setDlProgress(100);
      const url  = URL.createObjectURL(resp.data as Blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${r.code}-${slugForFile(r.title)}.${fmt === 'docx' ? 'docx' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await new Promise(res => setTimeout(res, 400)); // let the 100% show briefly
    } catch (e) {
      window.clearInterval(timer);
      // The request is responseType:'blob', so an error body arrives as a Blob —
      // read + parse it to surface the server's real message (e.g. "too large").
      let msg = 'Please try again.';
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        try { msg = JSON.parse(await data.text())?.message || msg; } catch { /* keep default */ }
      } else if (data && typeof data === 'object' && 'message' in data) {
        msg = String((data as { message?: string }).message || msg);
      }
      toast.error('Download failed', msg);
    } finally {
      setDownloadingId(null);
      setDlProgress(0);
    }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search agreement library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Tooltip label="Draft a new agreement template">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Agreement
          </button>
        </Tooltip>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 && !loading ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bAgr}</div>
            <div className="clm-empty-title">No agreements yet</div>
            <div className="clm-empty-sub">Click + Add Agreement to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap clm-table-fill" ref={scrollRef} style={{ minHeight: fillH }}>
            <table className="clm-table" style={{ minWidth: 960 }}>
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 100, textAlign: 'center' }}>AGR. ID</th>
                <th style={{ minWidth: 160 }}>AGREEMENT TITLE</th>
                <th style={{ minWidth: 130 }}>AGREEMENT TYPE</th>
                <th style={{ width: 130, textAlign: 'center' }}>REGULATORY</th>
                <th style={{ width: 120, textAlign: 'left' }}>SEGMENT</th>
                <th style={{ width: 150, textAlign: 'left' }}>APPLICABLE PARTY</th>
                <th style={{ width: 128, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={8} />}
                {!loading && slice.map((r, i) => {
                  const isHigh = r.regulatory === 'highly';
                  return (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}>
                        <Tooltip label={`Auto-generated agreement ID · ${r.code}`}>
                          <span className="clm-code-pill">{r.code}</span>
                        </Tooltip>
                      </td>
                      <Tooltip label={r.title}>
                        <td className="clm-td-name clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.title}</div></td>
                      </Tooltip>
                      <Tooltip label={r.agreement_type}>
                        <td className="clm-td-desc clm-td-trunc-cell"><div className="clm-td-name-trunc">{r.agreement_type}</div></td>
                      </Tooltip>
                      <td style={{ textAlign: 'center' }}>
                        <Tooltip label={isHigh ? 'Highly Regulated — needs segment-specific compliance' : 'Less Regulated — applies to all standard segments'}>
                          <span className={`clm-badge ${isHigh ? 'clm-badge-red' : 'clm-badge-emerald'}`}>
                            <span className="clm-badge-dot" />{isHigh ? 'High' : 'Less'}
                          </span>
                        </Tooltip>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {/* Show only the first mapped segment as a badge; if the
                            agreement maps to more (r.segment is a CSV like
                            "Tobacco, Rice"), surface the rest behind a +N badge
                            that opens a popover. Fall back to "All segments"
                            when nothing is mapped. */}
                        {(() => {
                          const segList = r.segment ? r.segment.split(',').map(s => s.trim()).filter(Boolean) : [];
                          if (segList.length === 0) return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>All segments</span>;
                          const extra = segList.length - 1;
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle', lineHeight: 1 }}>
                              <Tooltip label={`Segment scope · ${segList[0]}`}>
                                <span className="clm-badge clm-badge-teal">{segList[0]}</span>
                              </Tooltip>
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
                      <td style={{ textAlign: 'left' }}>

                        {(() => {
                          const partyList = r.party ? r.party.split(',').map(s => s.trim()).filter(Boolean).map(partyLabel) : [];
                          if (partyList.length === 0) return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>All parties</span>;
                          const extra = partyList.length - 1;
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle', lineHeight: 1 }}>
                              <Tooltip label={`Applicable party · ${partyList[0]}`}>
                                <span className="clm-badge clm-badge-teal">{partyList[0]}</span>
                              </Tooltip>
                              {extra > 0 && (
                                <Tooltip label="View all parties">
                                  <button
                                    type="button"
                                    onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setPartyOpen(partyOpen?.id === r.id ? null : { id: r.id, names: partyList, x: b.left, y: b.bottom + 4 }); }}
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
                          <Tooltip label={r.in_use ? 'In-use — cannot edit' : `Edit — ${r.title}`}>
                            <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { if (r.in_use) { toast.warning('Agreement in use', 'This agreement is In-use, you cannot edit it.'); return; } setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          </Tooltip>
                          <Tooltip label={downloadingId === r.id ? 'Downloading…' : `Download ${r.code} — Doc / PDF`}>
                            <button className="clm-act clm-act-dl" aria-label="Download" disabled={downloadingId === r.id}
                              onClick={(e) => {
                                const b = e.currentTarget.getBoundingClientRect();
                                setDlMenuFor(prev => prev?.row.id === r.id ? null : { row: r, top: b.bottom + 4, right: window.innerWidth - b.right });
                              }}>{downloadingId === r.id ? (<svg className="clm-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>) : (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>)}</button>
                          </Tooltip>
                          <Tooltip label={r.in_use ? 'In-use — cannot delete' : `Delete — ${r.title}`}>
                            <button className="clm-act clm-act-del" aria-label="Delete" onClick={() => { if (r.in_use) { toast.warning('Agreement in use', 'This agreement is In-use, you cannot delete it.'); return; } setPendingDelete(r); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
            )}
          </div>
        )}
      </div>

      {pendingDelete && createPortal(<DeleteConf title="Delete agreement?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}

      {/* Download-format menu — Doc / PDF (anchored to the row's download button). */}
      {dlMenuFor && createPortal(
        <>
          <div onClick={() => setDlMenuFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000 }} />
          <div style={{ position: 'fixed', top: dlMenuFor.top, right: dlMenuFor.right, zIndex: 3001, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,.16)', padding: 4, minWidth: 172 }}>
            {([['docx', 'Download as Doc'], ['pdf', 'Download as PDF']] as const).map(([fmt, label]) => (
              <button key={fmt} type="button"
                onClick={() => { const row = dlMenuFor.row; setDlMenuFor(null); void onDownload(row, fmt); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, color: '#0f172a', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {label}
              </button>
            ))}
          </div>
        </>, document.body)}

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
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Applicable Parties ({partyOpen.names.length})</div>
            {partyOpen.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      <ClmAgreementWizardModal
        open={modalOpen}
        existing={editing}
        types={types}
        knownSegments={knownSegments}
        nextCode={editing?.code ?? `A-${String(rows.length + 1).padStart(3, '0')}`}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => { setModalOpen(false); setEditing(null); reload(); }}
      />

      {/* Popup loader while a PDF is generated — a big/table-rich agreement can
          take several seconds server-side. Shows a 0→100% ring so it's clearly
          working (the tiny row spinner is easy to miss). */}
      {downloadingId !== null && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,30,42,.45)', backdropFilter: 'blur(3px)' }}>
          <div style={{ width: 300, background: '#fff', borderRadius: 18, padding: '26px 24px 22px', textAlign: 'center', boxShadow: '0 24px 60px rgba(8,40,60,.32)' }}>
            <ProgressRing value={dlProgress} />
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0c2c3a', marginTop: 14 }}>Generating {downloadingFmt === 'docx' ? 'Doc' : 'PDF'}…</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: '#5e7888', marginTop: 6, lineHeight: 1.5 }}>Please wait — a large agreement can take a few seconds.</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* Circular 0→100% progress ring for the generate/download popup. */
function ProgressRing({ value }: { value: number }) {
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

/* Small helper reused by the Library pane (PDF download filename). */
function slugForFile(s: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'agreement';
}

