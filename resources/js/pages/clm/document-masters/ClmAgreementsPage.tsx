import { useEffect, useMemo, useRef, useState } from 'react';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate, clmFillHeight } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ClmSubHead, ICO } from '../shared/ClmPageShell';
import { ClmSkeletonRows, DeleteConf, SimpleDescModal, TruncCell, PopName } from '../shared/clmCommon';
import Tooltip from '../../../components/ui/Tooltip';
import { saveApiBlob } from '../../../utils/downloadFile';
import ClmAgreementWizardModal from './ClmAgreementWizardModal';
import SearchClear from '../../../components/ui/SearchClear';
import useDismissPopover from '../shared/useDismissPopover';

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
  /* content is OPTIONAL: the list endpoint leaves it out (it was 92.9% of that
     response and the table never renders it) and the wizard fetches the one
     row it opens. */
  agr_status: string; content?: string | null; is_signed?: boolean; in_use?: boolean;
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
      /* lite=1 — see the note on ClmTncPage. These segments feed the agreement
         wizard's dropdown (name / code / regulatory_status); in_use on this
         page belongs to agreement types and library rows, not to segments. */
      api.get<{ status: boolean; data: Seg[]     }>('/clm/segments', { params: { lite: 1 } }),
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
  const isEmpty = !loading && filtered.length === 0;

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
      const fh = clmFillHeight(el);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    /* Re-measured as the page settles, as useAutoFitRows does: the strips above the card finish loading after mount, and an empty list never changes length to trigger a second measure - so the first, too-tall height stuck and the page scrolled (QA #56). */
    const settle = [120, 350, 800, 1600].map(ms => window.setTimeout(recompute, ms));
    // Not observing the page root: the "What We Are Doing Here" box animates its
    // height on expand/collapse, so observing the root fired this recompute every
    // animation frame and visibly disturbed the layout. Recompute only on mount
    // and on genuine window resizes instead.
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); settle.forEach(window.clearTimeout); };
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
        <ClmSubHead title="Agreement Types" count={rows.length}
          sub="The kinds of agreement templates are written against." />
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input autoComplete="off" type="text" placeholder="Search agreement types…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
        </div>
        <Tooltip label="Create a new agreement type">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Agreement Type
          </button>
        </Tooltip>
      </div>

      <div className="clm-tab-body has-data">
          <div className={`clm-table-wrap clm-table-fill ${isEmpty ? 'clm-fill-empty' : ''}`} ref={scrollRef} style={{ minHeight: fillH, maxHeight: fillH }}>
            <div className="clm-tscroll"><table className="clm-table">
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
                    <TruncCell value={r.name} />
                    <TruncCell value={r.description} cellClass="clm-td-desc" />
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        {r.in_use ? (
                          <Tooltip label={`Used by ${r.in_use} agreement${r.in_use === 1 ? '' : 's'} in the library — cannot edit`}>
                            <button className="clm-act clm-act-edit" aria-label="Locked — in use" disabled style={{ opacity: .4, cursor: 'not-allowed' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
                          </Tooltip>
                        ) : (
                          <Tooltip label={`Edit ${r.name}`}>
                            <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>
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
            </table></div>
            {isEmpty && (
              <div className="clm-empty" style={{ flex: 1 }}>
                <div className="clm-empty-ico">{ICO.bAgr}</div>
                <div className="clm-empty-title">{search.trim() ? 'No matching agreement types' : 'No agreement types yet'}</div>
                <div className="clm-empty-sub">{search.trim() ? 'No results match the current search.' : 'Click + Add Agreement Type to create the first record.'}</div>
              </div>
            )}
            {!loading && (
              <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
            )}
          </div>
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
  /* flipUp/maxH keep the popover inside the viewport: a +N badge on one of the
   * last rows has almost no room below it, and the panel used to open downwards
   * regardless and get cut off by the bottom of the screen (QA #4). */
  const [segOpen, setSegOpen] = useState<{ id: number; names: string[]; x: number; y: number; flipUp: boolean; maxH: number } | null>(null);
  // Same viewport clamp as the segment popover above (QA #4).
  const [partyOpen, setPartyOpen] = useState<{ id: number; names: string[]; x: number; y: number; flipUp: boolean; maxH: number } | null>(null);
  // Scroll / resize / Escape / tab switch — see useDismissPopover.
  useDismissPopover(!!(segOpen || partyOpen), () => { setSegOpen(null); setPartyOpen(null); });
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
  const isEmpty = !loading && filtered.length === 0;

  // Dynamic pagination: rows-per-page auto-fits the visible table height and
  // the card stretches to cover the page. Anchored via closest('.clm-root').
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      /* Rows fitted to the card's REAL height (clmFillHeight), less the
         measured header and pager. The flat window-minus-136 guess disagreed
         with the card by 17px, so ten 49px rows (these carry the Download
         Draft button, QA #60) were fitted into a card that holds nine and the
         card grew past the footer. */
      const ROW = 49;
      const fh = clmFillHeight(el);
      const theadH = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight || 40;
      const pagerH = (el.querySelector('.wl-pager, .tc-wl-pag') as HTMLElement | null)?.offsetHeight || 58;
      const fit = Math.max(4, Math.floor((fh - theadH - pagerH) / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    /* Re-measured as the page settles, as useAutoFitRows does: the strips above the card finish loading after mount, and an empty list never changes length to trigger a second measure - so the first, too-tall height stuck and the page scrolled (QA #56). */
    const settle = [120, 350, 800, 1600].map(ms => window.setTimeout(recompute, ms));
    // Not observing the page root: the "What We Are Doing Here" box animates its
    // height on expand/collapse, so observing the root fired this recompute every
    // animation frame and visibly disturbed the layout. Recompute only on mount
    // and on genuine window resizes instead.
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); settle.forEach(window.clearTimeout); };
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
    // Keyed by tier + name: the same name (e.g. "Rice") can exist once as a
    // highly- and once as a less-regulated segment, and both must surface.
    const byKey = new Map<string, { name: string; regulatory_status: 'highly' | 'less' }>();
    const names = new Set<string>();
    segs.forEach(s => {
      if (!s.name) return;
      byKey.set(`${s.regulatory_status}|${s.name}`, { name: s.name, regulatory_status: s.regulatory_status });
      names.add(s.name);
    });
    rows.forEach(r => {
      if (!r.segment) return;
      // r.segment may be a CSV ("Tobacco, Rice") on multi-segment less-reg
      // agreements — split and add each individually so the wizard's
      // single-name selector still finds them.
      r.segment.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
        if (!names.has(name)) {
          const status = r.regulatory ?? 'less';
          byKey.set(`${status}|${name}`, { name, regulatory_status: status });
        }
      });
    });
    return Array.from(byKey.values());
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
      /* Check the bytes before writing them to disk.
         With responseType 'blob' axios returns whatever arrived — a JSON error
         body or an HTML page included — and if that came back with HTTP 200
         nothing throws. Saving those bytes under a .docx name is what makes
         Word report "we found a problem with its contents": the failure is
         upstream (a route that never matched, a session redirect, a proxy error
         page, or a DOCX the writer could not finish), but every symptom points
         at the file.
         saveApiBlob compares the leading bytes against the format's signature
         (PK.. for a docx zip, %PDF for a PDF) and raises a readable error
         instead of producing a broken download. Same guard the Trade Documents
         list already uses. */
      await saveApiBlob(
        resp.data as Blob,
        `${r.code}-${slugForFile(r.title)}.${fmt === 'docx' ? 'docx' : 'pdf'}`,
        fmt === 'docx' ? 'docx' : 'pdf',
      );
      await new Promise(res => setTimeout(res, 400)); // let the 100% show briefly
    } catch (e) {
      window.clearInterval(timer);
      // The request is responseType:'blob', so an error body arrives as a Blob —
      // read + parse it to surface the server's real message (e.g. "too large").
      /* saveApiBlob throws a plain Error with no `response`, so its explanation
         ("The server did not return a Word document…") would otherwise fall
         through to the generic default — the one message that says what
         actually went wrong. */
      const err = e as { response?: { data?: unknown }; message?: string };
      let msg = (!err?.response && typeof err?.message === 'string') ? err.message : 'Please try again.';
      const data = err?.response?.data;
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
        <ClmSubHead title="Agreement Library" count={rows.length}
          sub="Reusable agreement templates and masters for trade and CLM workflows." />
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input autoComplete="off" type="text" placeholder="Search agreement library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
        </div>
        <Tooltip label="Draft a new agreement template">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Agreement
          </button>
        </Tooltip>
      </div>

      {/* The Trade Document Library's "Download Draft" button and Doc / PDF
          menu, copied under an agl- prefix so neither page depends on the
          other's styles being mounted (QA #60). */}
      <style>{`
        .agl-dl-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; white-space: nowrap;
          border: 1px solid rgba(8,145,178,.30); background: rgba(8,145,178,.07); color: #0e7490;
          font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background .12s, border-color .12s; }
        .agl-dl-btn:hover { background: rgba(8,145,178,.14); border-color: #0891b2; }
        .agl-dl-backdrop { position: fixed; inset: 0; z-index: 9000; }
        .agl-dl-menu { z-index: 9001; min-width: 180px; padding: 6px;
          background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 12px 28px rgba(15,23,42,.18); }
        .agl-dl-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; border: 0; border-radius: 7px;
          background: none; font-family: inherit; font-size: 12.5px; font-weight: 600; color: #1e293b; cursor: pointer; text-align: left; transition: background .12s; }
        .agl-dl-item:hover { background: #f1f5f9; }
        [data-bs-theme="dark"] .agl-dl-btn { background: rgba(8,145,178,.14); border-color: rgba(6,182,212,.35); color: #67e8f9; }
        [data-bs-theme="dark"] .agl-dl-btn:hover { background: rgba(8,145,178,.22); }
        [data-bs-theme="dark"] .agl-dl-menu { background: #1e293b; border-color: rgba(148,163,184,.22); }
        [data-bs-theme="dark"] .agl-dl-item { color: #e2e8f0; }
        [data-bs-theme="dark"] .agl-dl-item:hover { background: rgba(148,163,184,.14); }
      `}</style>
      <div className="clm-tab-body has-data">
          <div className={`clm-table-wrap clm-table-fill ${isEmpty ? 'clm-fill-empty' : ''}`} ref={scrollRef} style={{ minHeight: fillH, maxHeight: fillH }}>
            <div className="clm-tscroll"><table className="clm-table" style={{ minWidth: 1100 }}>
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 100, textAlign: 'center' }}>AGR. ID</th>
                <th style={{ minWidth: 160 }}>AGREEMENT TITLE</th>
                <th style={{ minWidth: 130 }}>AGREEMENT TYPE</th>
                <th style={{ width: 130, textAlign: 'center' }}>REGULATORY</th>
                <th style={{ width: 120, textAlign: 'left' }}>SEGMENT</th>
                <th style={{ width: 150, textAlign: 'left' }}>APPLICABLE PARTY</th>
                {/* Purpose and a Download column, as the Trade Document Library
                    has them (QA #60). Download used to be a bare icon among the
                    row actions. */}
                <th style={{ width: 220 }}>PURPOSE</th>
                <th style={{ width: 150, textAlign: 'center' }}>DOWNLOAD</th>
                <th style={{ width: 100, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <ClmSkeletonRows cols={10} />}
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
                      <TruncCell value={r.title} />
                      <TruncCell value={r.agreement_type} cellClass="clm-td-desc" />
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
                              {/* Truncated: the segment name is user-typed and a
                                  long one was widening the whole column. The
                                  Tooltip already carries the full value. */}
                              <Tooltip label={`Segment scope · ${segList[0]}`}>
                                <span className="clm-badge clm-badge-teal clm-badge-trunc">{segList[0]}</span>
                              </Tooltip>
                              {extra > 0 && (
                                <Tooltip label="View all segments">
                                  <button
                                    type="button"
                                    onClick={e => {
                                    if (segOpen?.id === r.id) { setSegOpen(null); return; }
                                    const b = e.currentTarget.getBoundingClientRect();
                                    // Open upwards when the space below can't hold the list.
                                    const estH = Math.min(280, 34 + segList.length * 30);
                                    const below = window.innerHeight - b.bottom - 12;
                                    const above = b.top - 12;
                                    const flipUp = below < estH && above > below;
                                    setSegOpen({ id: r.id, names: segList, x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp, maxH: Math.max(120, Math.min(280, flipUp ? above : below)) });
                                  }}
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
                                    onClick={e => {
                                      if (partyOpen?.id === r.id) { setPartyOpen(null); return; }
                                      const b = e.currentTarget.getBoundingClientRect();
                                      const estH = Math.min(280, 34 + partyList.length * 30);
                                      const below = window.innerHeight - b.bottom - 12;
                                      const above = b.top - 12;
                                      const flipUp = below < estH && above > below;
                                      setPartyOpen({ id: r.id, names: partyList, x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp, maxH: Math.max(120, Math.min(280, flipUp ? above : below)) });
                                    }}
                                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)' }}>
                                    +{extra}
                                  </button>
                                </Tooltip>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      {/* Fills the column, then ellipsis with the full text in a
                          tooltip - the Trade Document Library's Purpose cell. */}
                      <TruncCell value={r.purpose?.trim() || '—'} cellClass="" textClass="clm-td-trunc" />
                      <td style={{ textAlign: 'center' }}>
                        <Tooltip label="Download the agreement as Doc or PDF">
                          <button type="button" className="agl-dl-btn" disabled={downloadingId === r.id}
                            onClick={(e) => {
                              const b = e.currentTarget.getBoundingClientRect();
                              setDlMenuFor(prev => prev?.row.id === r.id ? null : { row: r, top: b.bottom + 4, right: window.innerWidth - b.right });
                            }}>
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
                          {/* An in-use agreement is frozen. The buttons must LOOK
                              unavailable, not just refuse on click — they used to
                              render fully enabled and only warn AFTER the click,
                              which reads as a broken button (QA). Mirrors the
                              Agreement Type table above, which already dims its
                              in-use actions. The reason moves onto the tooltip:
                              Tooltip renders for DISABLED children too (it wraps
                              them in a pointer-events span), so a greyed-out
                              button still explains itself on hover. */}
                          <Tooltip label={r.in_use ? `${r.title} is in use by a live agreement, so it can no longer be edited.` : `Edit — ${r.title}`}>
                            <button className="clm-act clm-act-edit" aria-label="Edit"
                              disabled={!!r.in_use}
                              style={r.in_use ? { opacity: .4, cursor: 'not-allowed' } : undefined}
                              onClick={() => { if (r.in_use) return; setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>
                          </Tooltip>
                          <Tooltip label={r.in_use ? `${r.title} is in use by a live agreement, so it can no longer be deleted.` : `Delete — ${r.title}`}>
                            <button className="clm-act clm-act-del" aria-label="Delete"
                              disabled={!!r.in_use}
                              style={r.in_use ? { opacity: .4, cursor: 'not-allowed' } : undefined}
                              onClick={() => { if (r.in_use) return; setPendingDelete(r); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {isEmpty && (
              <div className="clm-empty" style={{ flex: 1 }}>
                <div className="clm-empty-ico">{ICO.bAgr}</div>
                <div className="clm-empty-title">{search.trim() ? 'No matching agreements' : 'No agreements yet'}</div>
                <div className="clm-empty-sub">{search.trim() ? 'No results match the current search.' : 'Click + Add Agreement to create the first record.'}</div>
              </div>
            )}
            {!loading && (
              <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
            )}
          </div>
      </div>

      {pendingDelete && createPortal(<DeleteConf title="Delete agreement?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}

      {/* Download-format menu — Doc / PDF (anchored to the row's download button). */}
      {dlMenuFor && createPortal(
        <>
          <div className="agl-dl-backdrop" onClick={() => setDlMenuFor(null)} />
          <div className="agl-dl-menu" style={{ position: 'fixed', top: dlMenuFor.top, right: dlMenuFor.right }}>
            {([['docx', 'Download as Doc'], ['pdf', 'Download as PDF']] as const).map(([fmt, label]) => (
              <button key={fmt} type="button" className="agl-dl-item"
                onClick={() => { const row = dlMenuFor.row; setDlMenuFor(null); void onDownload(row, fmt); }}>
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
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 230), top: segOpen.flipUp ? undefined : segOpen.y, bottom: segOpen.flipUp ? (window.innerHeight - segOpen.y) : undefined, zIndex: 601, width: 210, maxHeight: segOpen.maxH, overflowY: 'auto', overflowX: 'hidden', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal"><PopName text={name} /></span>
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
          <div className="clm-pop" style={{ position: 'fixed', left: Math.min(partyOpen.x, window.innerWidth - 230), top: partyOpen.flipUp ? undefined : partyOpen.y, bottom: partyOpen.flipUp ? (window.innerHeight - partyOpen.y) : undefined, zIndex: 601, width: 210, maxHeight: partyOpen.maxH, overflowY: 'auto', overflowX: 'hidden', borderRadius: 12, padding: 8 }}>
            <div className="clm-pop-title" style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '4px 8px 7px' }}>Applicable Parties ({partyOpen.names.length})</div>
            {partyOpen.names.map((name, i) => (
              <div key={i} className={i % 2 ? 'clm-pop-row-alt' : ''} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8 }}>
                <span className="clm-badge clm-badge-teal"><PopName text={name} /></span>
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
        /* A type added from inside the wizard belongs in this page's Agreement
           Types list too — without this it only appeared after a refresh. */
        onTypesChanged={reload}
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

