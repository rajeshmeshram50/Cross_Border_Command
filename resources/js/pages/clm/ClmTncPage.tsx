import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { DeleteConf, ShortCodeNameModal } from './clmCommon';

/* Central CLM → Terms & Conditions master (two tabs: Categories + Library). */

type Cat = { id: number; code: string; short_code: string; name: string };
type Lib = { id: number; code: string; segment: string; category: string; party: string; content: string | null };

export default function ClmTncPage() {
  const toast = useToast();
  const [tab, setTab]     = useState<'categories'|'library'>('categories');
  const [cats, setCats]   = useState<Cat[]>([]);
  const [lib, setLib]     = useState<Lib[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Cat[] }>('/clm/tnc-categories'),
      api.get<{ status: boolean; data: Lib[] }>('/clm/tnc-library'),
    ]).then(([c, l]) => { setCats(c.data.data ?? []); setLib(l.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load T&C data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>
      <div className="clm-head-card">
        <div className="clm-head-left">
          <div className="clm-head-ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="15" y2="18" /></svg>
          </div>
          <div>
            <div className="clm-crumb">Central CLM · Contract &amp; Document Masters</div>
            <div className="clm-head-title">Terms &amp; Conditions</div>
            <div className="clm-head-sub">Reusable T&amp;C structures — grouped into categories (Proforma Invoice, GPO, FFD PO, …) with party-specific blocks.</div>
          </div>
        </div>
      </div>
      <div className="clm-body-card">
        <div className="clm-tabs">
          <button className={`clm-tab ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>
            Categories <span className="clm-tab-count">{cats.length}</span>
          </button>
          <button className={`clm-tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
            T&amp;C Library <span className="clm-tab-count">{lib.length}</span>
          </button>
        </div>
        {tab === 'categories' ? <CategoriesTab rows={cats} loading={loading} reload={reload} /> : null}
        {tab === 'library'    ? <LibraryTab    rows={lib}  cats={cats} loading={loading} reload={reload} /> : null}
      </div>
    </div>
  );
}

function CategoriesTab(props: { rows: Cat[]; loading: boolean; reload: () => void }) {
  const { rows, loading, reload } = props;
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.short_code.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { short_code: string; name: string }, id?: number) => {
    try {
      if (id) await api.put(`/clm/tnc-categories/${id}`, form);
      else    await api.post('/clm/tnc-categories', form);
      toast.success(id ? 'Updated' : 'Added', form.name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-categories/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <>
      <div className="clm-tabs" style={{ borderTop: 'none' }}>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add Category
        </button>
        <div className="clm-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input type="text" placeholder="Search categories…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>
      <div className="clm-table-wrap">
        <table className="clm-table">
          <thead><tr>
            <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
            <th style={{ width: 110, textAlign: 'center' }}>CATEGORY ID</th>
            <th style={{ width: 110, textAlign: 'center' }}>SHORT CODE</th>
            <th>CATEGORY NAME</th>
            <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="clm-status">Loading…</td></tr>}
            {!loading && slice.length === 0 && (
              <tr><td colSpan={5} className="clm-empty">
                <div className="clm-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /></svg></div>
                <div className="clm-empty-title">No categories yet</div>
                <div className="clm-empty-sub">Click + Add Category to create the first record.</div>
              </td></tr>
            )}
            {!loading && slice.map((r, i) => (
              <tr key={r.id}>
                <td className="clm-td-num">{start + i + 1}</td>
                <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                <td style={{ textAlign: 'center' }}><span className="clm-badge clm-badge-indigo">{r.short_code}</span></td>
                <td className="clm-td-name">{r.name}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="clm-actions">
                    <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                    <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length > 0 && (
          <div className="clm-pag">
            <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
            <div className="clm-pag-btns">{Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
            ))}</div>
          </div>
        )}
      </div>
      {modalOpen && <ShortCodeNameModal title={editing ? 'Edit Category' : 'Add Category'} code={editing?.code ?? `DC-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initialShortCode={editing?.short_code ?? ''} initialName={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete category?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </>
  );
}

function LibraryTab(props: { rows: Lib[]; cats: Cat[]; loading: boolean; reload: () => void }) {
  const { rows, cats, loading, reload } = props;
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

  const onSave = async (form: Omit<Lib, 'id'|'code'>, id?: number) => {
    try {
      if (id) await api.put(`/clm/tnc-library/${id}`, form);
      else    await api.post('/clm/tnc-library', form);
      toast.success(id ? 'Updated' : 'Added', form.category);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.category); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <>
      <div className="clm-tabs" style={{ borderTop: 'none' }}>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add T&amp;C Block
        </button>
        <div className="clm-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input type="text" placeholder="Search by category, party, segment…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>
      <div className="clm-table-wrap">
        <table className="clm-table">
          <thead><tr>
            <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
            <th style={{ width: 110, textAlign: 'center' }}>T&amp;C ID</th>
            <th style={{ width: 110, textAlign: 'center' }}>SEGMENT</th>
            <th>CATEGORY</th>
            <th>PARTY</th>
            <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="clm-status">Loading…</td></tr>}
            {!loading && slice.length === 0 && (
              <tr><td colSpan={6} className="clm-empty">
                <div className="clm-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /></svg></div>
                <div className="clm-empty-title">No T&amp;C blocks yet</div>
                <div className="clm-empty-sub">Click + Add T&amp;C Block to create the first record.</div>
              </td></tr>
            )}
            {!loading && slice.map((r, i) => (
              <tr key={r.id}>
                <td className="clm-td-num">{start + i + 1}</td>
                <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                <td style={{ textAlign: 'center' }}><span className="clm-badge clm-badge-slate">{r.segment}</span></td>
                <td className="clm-td-name">{r.category}</td>
                <td className="clm-td-desc">{r.party}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="clm-actions">
                    <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                    <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length > 0 && (
          <div className="clm-pag">
            <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
            <div className="clm-pag-btns">{Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
            ))}</div>
          </div>
        )}
      </div>
      {modalOpen && <TncBlockModal existing={editing} cats={cats} nextCode={`TNC-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete T&C block?" sub={`${pendingDelete.category} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </>
  );
}

function TncBlockModal(props: { existing: Lib | null; cats: Cat[]; nextCode: string; onClose: () => void; onSave: (f: Omit<Lib, 'id'|'code'>) => void }) {
  const { existing, cats, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;
  const [segment, setSegment]   = useState(existing?.segment ?? 'General');
  const [category, setCategory] = useState(existing?.category ?? (cats[0]?.name ?? ''));
  const [party, setParty]       = useState(existing?.party ?? '');
  const [content, setContent]   = useState(existing?.content ?? '');
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!category.trim()) next.category = 'Category is required';
    if (!party.trim())    next.party    = 'Party is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        segment: segment.trim() || 'General', category: category.trim(),
        party: party.trim(), content: content.trim() || null,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal clm-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="15" y2="18" /></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit T&C Block' : 'Add T&C Block'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the T&C block details.' : 'Register a reusable T&C block tagged to a category.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'T&C Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Segment</label>
              <input className="clm-input" placeholder="General, Tobacco, Pharma…" value={segment} onChange={e => setSegment(e.target.value)} />
              <div className="clm-field-hint">Defaults to "General" if blank.</div>
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Category <span className="clm-req">*</span></label>
              <select className={`clm-select ${errors.category ? 'clm-input-err' : ''}`} value={category} onChange={e => { setCategory(e.target.value); setErrors(p => ({ ...p, category: '' })); }}>
                <option value="">— Select —</option>
                {cats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                {category && !cats.find(c => c.name === category) && <option value={category}>{category}</option>}
              </select>
              {errors.category && <div className="clm-err">{errors.category}</div>}
            </div>
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Party <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.party ? 'clm-input-err' : ''}`} placeholder="e.g. Buyer, Consignee, Supplier-Material" value={party} onChange={e => { setParty(e.target.value); setErrors(p => ({ ...p, party: '' })); }} />
            {errors.party && <div className="clm-err">{errors.party}</div>}
          </div>

          <div className="clm-field">
            <label className="clm-field-label">Content (optional)</label>
            <textarea className="clm-textarea" placeholder="Full clause text…" value={content ?? ''} onChange={e => setContent(e.target.value)} style={{ minHeight: 120 }} />
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
