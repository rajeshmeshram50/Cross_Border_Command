import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf, SimpleNameModal } from './clmCommon';

/* Central CLM → Trade Documents Master (two tabs: List + Library). */

type TdName = { id: number; code: string; name: string };
type TdLib  = { id: number; code: string; name: string; title: string; doc_type: string; purpose: string; party: string; file_path: string | null };

const DOC_TYPES = ['Declaration', 'Undertaking', 'Authorization', 'Bond', 'Certificate', 'Letter'] as const;

export default function ClmTradeDocumentsPage() {
  const toast = useToast();
  const [tab, setTab]           = useState<'list'|'lib'>('list');
  const [names, setNames]       = useState<TdName[]>([]);
  const [lib, setLib]           = useState<TdLib[]>([]);
  const [loading, setLoading]   = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: TdName[] }>('/clm/trade-doc-names'),
      api.get<{ status: boolean; data: TdLib[] }>('/clm/trade-doc-library'),
    ]).then(([n, l]) => { setNames(n.data.data ?? []); setLib(l.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load trade documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
        Trade Documents List
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
        : <LibraryPane rows={lib} names={names} loading={loading} reload={reload} />}
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
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

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
          <input type="text" placeholder="Search trade documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Trade Document
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTrade}</div>
            <div className="clm-empty-title">No trade documents yet</div>
            <div className="clm-empty-sub">Click + Add Trade Document to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 130, textAlign: 'center' }}>DOC NAME ID</th>
                <th>TRADE DOCUMENT NAME</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={4} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td className="clm-td-name">{r.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
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

      {modalOpen && <SimpleNameModal title={editing ? 'Edit Trade Document' : 'Add Trade Document'} placeholder="e.g. Bill of Lading, Commercial Invoice" code={editing?.code ?? `TDN-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initial={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(name) => onSave(name, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete trade document?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </div>
  );
}

/* ─── Library sub-tab ─── */

function LibraryPane({ rows, names, loading, reload }: { rows: TdLib[]; names: TdName[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<TdLib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TdLib | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.title.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.doc_type.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: Omit<TdLib, 'id'|'code'>, id?: number) => {
    try {
      if (id) await api.put(`/clm/trade-doc-library/${id}`, form);
      else    await api.post('/clm/trade-doc-library', form);
      toast.success(id ? 'Updated' : 'Added', form.title);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/trade-doc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.title); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  const typeBadge = (t: string) => {
    const map: Record<string, string> = {
      Declaration: 'clm-badge-teal', Undertaking: 'clm-badge-indigo', Authorization: 'clm-badge-amber',
      Bond: 'clm-badge-green', Certificate: 'clm-badge-violet', Letter: 'clm-badge-slate',
    };
    return map[t] ?? 'clm-badge-slate';
  };

  return (
    <div className="clm-page-card">
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
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTrade}</div>
            <div className="clm-empty-title">No library entries yet</div>
            <div className="clm-empty-sub">Click + Draft New Trade Document to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>TRADE DOC ID</th>
                <th>TRADE DOCUMENT TITLE</th>
                <th style={{ width: 130, textAlign: 'center' }}>TYPE</th>
                <th>PURPOSE</th>
                <th>APPLICABLE PARTY</th>
                <th style={{ width: 110, textAlign: 'center' }}>DOWNLOAD</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td className="clm-td-name">{r.title}</td>
                    <td style={{ textAlign: 'center' }}><span className={`clm-badge ${typeBadge(r.doc_type)}`}>{r.doc_type}</span></td>
                    <td className="clm-td-desc">{r.purpose}</td>
                    <td className="clm-td-desc">{r.party}</td>
                    <td style={{ textAlign: 'center' }}>
                      {r.file_path
                        ? <a href={r.file_path} download className="clm-badge clm-badge-teal" style={{ textDecoration: 'none' }}>.docx</a>
                        : <span className="clm-badge clm-badge-slate">No file</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
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

      {modalOpen && <LibraryModal existing={editing} names={names} nextCode={`TD-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete library entry?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </div>
  );
}

function LibraryModal(props: { existing: TdLib | null; names: TdName[]; nextCode: string; onClose: () => void; onSave: (f: Omit<TdLib, 'id'|'code'>) => void; }) {
  const { existing, names, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;
  const [name, setName]       = useState(existing?.name ?? '');
  const [title, setTitle]     = useState(existing?.title ?? '');
  const [docType, setDocType] = useState(existing?.doc_type ?? DOC_TYPES[0]);
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [party, setParty]     = useState(existing?.party ?? '');
  const [filePath, setFilePath] = useState(existing?.file_path ?? '');
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim())    next.name    = 'Document name is required';
    if (!title.trim())   next.title   = 'Title is required';
    if (!purpose.trim()) next.purpose = 'Purpose is required';
    if (!party.trim())   next.party   = 'Party is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        name: name.trim(), title: title.trim(), doc_type: docType.trim(),
        purpose: purpose.trim(), party: party.trim(), file_path: filePath?.trim() || null,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal clm-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Library Entry' : 'Add Library Entry'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update trade document template details.' : 'Register a reusable trade document template.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Trade Doc ID' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Document Name <span className="clm-req">*</span></label>
              <select className={`clm-select ${errors.name ? 'clm-input-err' : ''}`} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}>
                <option value="">— Select —</option>
                {names.map(n => <option key={n.id} value={n.name}>{n.name}</option>)}
                {name && !names.find(n => n.name === name) && <option value={name}>{name}</option>}
              </select>
              <div className="clm-field-hint">Pulls from Trade Document Names tab.</div>
              {errors.name && <div className="clm-err">{errors.name}</div>}
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Type <span className="clm-req">*</span></label>
              <select className="clm-select" value={docType} onChange={e => setDocType(e.target.value)}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Document Title <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.title ? 'clm-input-err' : ''}`} placeholder="e.g. Supplier Self Declaration Form" value={title} onChange={e => { setTitle(e.target.value); setErrors(p => ({ ...p, title: '' })); }} />
            {errors.title && <div className="clm-err">{errors.title}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Purpose <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.purpose ? 'clm-input-err' : ''}`} placeholder="What this template is for…" value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: '' })); }} />
            {errors.purpose && <div className="clm-err">{errors.purpose}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Applicable Party <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.party ? 'clm-input-err' : ''}`} placeholder="Comma-separated, e.g. Buyer, Supplier-Material" value={party} onChange={e => { setParty(e.target.value); setErrors(p => ({ ...p, party: '' })); }} />
            <div className="clm-field-hint">List the parties signing or using the document.</div>
            {errors.party && <div className="clm-err">{errors.party}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">File Path (optional)</label>
            <input className="clm-input" placeholder="storage/trade-docs/supplier-decl.docx" value={filePath ?? ''} onChange={e => setFilePath(e.target.value)} />
            <div className="clm-field-hint">Storage-relative path to the docx / pdf template.</div>
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
