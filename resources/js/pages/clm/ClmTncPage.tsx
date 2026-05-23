import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf, SimpleNameModal } from './clmCommon';
import ClmTncWizardModal from './ClmTncWizardModal';
import Tooltip from '../../components/ui/Tooltip';

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
type Lib = { id: number; code: string; segment: string; category: string; party: string; content: string | null };
type Seg = { id: number; code: string; name: string };

export default function ClmTncPage() {
  const toast = useToast();
  const [tab, setTab]     = useState<'cat'|'lib'>('cat');
  const [cats, setCats]   = useState<Cat[]>([]);
  const [lib, setLib]     = useState<Lib[]>([]);
  const [segs, setSegs]   = useState<Seg[]>([]);
  const [loading, setLoading] = useState(false);

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

function CategoriesPane({ rows, loading, reload }: { rows: Cat[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (name: string, id?: number) => {
    try {
      const payload = { name, short_code: deriveShortCode(name) };
      if (id) await api.put(`/clm/tnc-categories/${id}`, payload);
      else    await api.post('/clm/tnc-categories', payload);
      toast.success(id ? 'Updated' : 'Added', name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-categories/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search categories…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Tooltip label="Create a new document category">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Document Category
          </button>
        </Tooltip>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No categories yet</div>
            <div className="clm-empty-sub">Click + Add Document Category to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 130, textAlign: 'center' }}>CATEGORY ID</th>
                <th>DOCUMENT CATEGORY NAME</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={4} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}>
                      <Tooltip label={`Auto-generated category ID · ${r.code}`}>
                        <span className="clm-code-pill">{r.code}</span>
                      </Tooltip>
                    </td>
                    <td className="clm-td-name">{r.name}</td>
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
                <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
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

      {modalOpen && <SimpleNameModal title={editing ? 'Edit Document Category' : 'Add New Document Category'} placeholder="e.g. International – Proforma Invoice" code={editing?.code ?? `DC-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initial={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(name) => onSave(name, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete category?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
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

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.category.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.party.toLowerCase().includes(s) || r.segment.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.category); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  // Real segments from /clm/segments — fall back to anything already
  // present in the library rows so older data still surfaces.
  const knownSegments = useMemo(() => {
    const set = new Set<string>();
    segs.forEach(s => { if (s.name) set.add(s.name); });
    rows.forEach(r => { if (r.segment) set.add(r.segment); });
    return Array.from(set);
  }, [rows, segs]);

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search T&C library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Tooltip label="Draft a new reusable T&C block">
          <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add T&amp;C
          </button>
        </Tooltip>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No T&amp;C blocks yet</div>
            <div className="clm-empty-sub">Click + Add T&amp;C to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>T&amp;C ID</th>
                <th style={{ width: 110, textAlign: 'center' }}>SEGMENT</th>
                <th>DOCUMENT CATEGORY</th>
                <th>APPLIES TO</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}>
                      <Tooltip label={`Auto-generated T&C ID · ${r.code}`}>
                        <span className="clm-code-pill">{r.code}</span>
                      </Tooltip>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <Tooltip label={`Segment scope · ${r.segment}`}>
                        <span className="clm-badge clm-badge-teal">{r.segment}</span>
                      </Tooltip>
                    </td>
                    <td className="clm-td-name">{r.category}</td>
                    <td className="clm-td-desc">
                      <Tooltip label={r.party.split(',').map(s => s.trim()).filter(Boolean).join(' · ')} maxWidth={320}>
                        <span>{r.party}</span>
                      </Tooltip>
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
              <div className="clm-pag">
                <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
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

      {pendingDelete && createPortal(<DeleteConf title="Delete T&C block?" sub={`${pendingDelete.category} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}

      <ClmTncWizardModal
        open={modalOpen}
        existing={editing}
        cats={cats}
        knownSegments={knownSegments}
        nextCode={editing?.code ?? `TNC-${String(rows.length + 1).padStart(3, '0')}`}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => { setModalOpen(false); setEditing(null); reload(); }}
      />
    </div>
  );
}

