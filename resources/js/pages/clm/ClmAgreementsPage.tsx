import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf, LockedConf, SimpleDescModal } from './clmCommon';
import Tooltip from '../../components/ui/Tooltip';
import ClmAgreementWizardModal from './ClmAgreementWizardModal';

/* Central CLM → Agreements Master (two tabs: Types + Library). */

type AgrType = { id: number; code: string; name: string; description: string };
type AgrLib = {
  id: number; code: string; agreement_type: string; title: string; purpose?: string | null; party: string;
  regulatory: 'highly'|'less'; signing: boolean; segment: string | null;
  agr_status: string; content: string | null; is_signed?: boolean;
};
type Seg = { id: number; code: string; name: string; regulatory_status: 'highly' | 'less' };

export default function ClmAgreementsPage() {
  const toast = useToast();
  const [tab, setTab]       = useState<'type'|'lib'>('type');
  const [types, setTypes]   = useState<AgrType[]>([]);
  const [lib, setLib]       = useState<AgrLib[]>([]);
  const [segs, setSegs]     = useState<Seg[]>([]);
  const [loading, setLoading] = useState(false);

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
          { n: '03', title: 'Set Applicable Parties', desc: 'Define buyer, consignee, and supplier applicability.',        icon: ICO.users },
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
      setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    const rootEl = scrollRef.current?.closest('.clm-root');
    if (rootEl) ro.observe(rootEl);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
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
        {slice.length === 0 ? (
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
                {loading && <tr><td colSpan={5} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td className="clm-td-name">{r.name}</td>
                    <td className="clm-td-desc">{r.description}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <Tooltip label={`Edit ${r.name}`}>
                          <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        </Tooltip>
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
              <div className="clm-pag">
                <span className="clm-pag-info">Showing <b>{start + 1}–{start + slice.length}</b> of <b>{filtered.length}</b></span>
                <div className="clm-pag-btns">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                  ))}
                </div>
              </div>
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
  // Blocked-action popup state — set when the user clicks Edit/Delete on an
  // agreement that has already been signed.
  const [locked, setLocked] = useState<{ mode: 'edit' | 'delete'; row: AgrLib } | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.title.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.agreement_type.toLowerCase().includes(s));
  }, [rows, search]);
  const [rpp, setRpp]     = useState(PER_PAGE);
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
      setRpp(prev => (prev === fit ? prev : fit));
      const fh = Math.max(0, window.innerHeight - top - 64);
      setFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    const rootEl = scrollRef.current?.closest('.clm-root');
    if (rootEl) ro.observe(rootEl);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
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

  // Download the sample agreement as a PDF — rendered server-side with the
  // saved page-shell header/footer (logo, name, footer text, pagination).
  const onDownload = async (r: AgrLib) => {
    try {
      const resp = await api.get(`/clm/agreement-library/${r.id}/download-pdf`, { responseType: 'blob' });
      const url  = URL.createObjectURL(resp.data as Blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${r.code}-${slugForFile(r.title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Download failed', msg || 'Please try again.');
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
        {slice.length === 0 ? (
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
                <th style={{ width: 120, textAlign: 'center' }}>SEGMENT</th>
                <th>APPLICABLE PARTY</th>
                <th style={{ width: 85, textAlign: 'center' }}>SIGNING</th>
                <th style={{ width: 128, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="clm-status">Loading…</td></tr>}
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
                      <td className="clm-td-name">{r.title}</td>
                      <td className="clm-td-desc">{r.agreement_type}</td>
                      <td style={{ textAlign: 'center' }}>
                        <Tooltip label={isHigh ? 'Highly Regulated — needs segment-specific compliance' : 'Less Regulated — applies to all standard segments'}>
                          <span className={`clm-badge ${isHigh ? 'clm-badge-red' : 'clm-badge-emerald'}`}>
                            <span className="clm-badge-dot" />{isHigh ? 'High' : 'Less'}
                          </span>
                        </Tooltip>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {isHigh && r.segment
                          ? <Tooltip label={`Segment scope · ${r.segment}`}>
                              <span className="clm-badge clm-badge-teal">{r.segment}</span>
                            </Tooltip>
                          : <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>All segments</span>}
                      </td>
                      <td className="clm-td-desc">
                        <Tooltip label={r.party.split(',').map(s => s.trim()).filter(Boolean).join(' · ')} maxWidth={320}>
                          <span>{r.party}</span>
                        </Tooltip>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <Tooltip label={r.signing ? 'Signing workflow required' : 'No signing workflow'}>
                          <span className={`clm-badge ${r.signing ? 'clm-badge-green' : 'clm-badge-slate'}`}>{r.signing ? 'Yes' : 'No'}</span>
                        </Tooltip>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <Tooltip label={r.is_signed ? 'Signed — cannot edit' : `Edit — ${r.title}`}>
                            <button className="clm-act clm-act-edit" aria-label="Edit" onClick={() => { if (r.is_signed) { setLocked({ mode: 'edit', row: r }); return; } setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          </Tooltip>
                          <Tooltip label={`Download ${r.code} as PDF`}>
                            <button className="clm-act clm-act-dl" aria-label="Download" onClick={() => onDownload(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                          </Tooltip>
                          <Tooltip label={r.is_signed ? 'Signed — cannot delete' : `Delete — ${r.title}`}>
                            <button className="clm-act clm-act-del" aria-label="Delete" onClick={() => { if (r.is_signed) { setLocked({ mode: 'delete', row: r }); return; } setPendingDelete(r); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <div className="clm-pag">
                <span className="clm-pag-info">Showing <b>{start + 1}–{start + slice.length}</b> of <b>{filtered.length}</b></span>
                <div className="clm-pag-btns">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {pendingDelete && createPortal(<DeleteConf title="Delete agreement?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}

      {locked && (
        <LockedConf
          title={locked.mode === 'edit' ? 'Cannot edit this agreement' : 'Cannot delete this agreement'}
          sub={`${locked.row.title} (${locked.row.code}) has already been signed by the customer / consignee / supplier, so it can no longer be ${locked.mode === 'edit' ? 'edited' : 'deleted'}.`}
          onClose={() => setLocked(null)}
        />
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
    </div>
  );
}

/* Small helper reused by the Library pane (PDF download filename). */
function slugForFile(s: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'agreement';
}

