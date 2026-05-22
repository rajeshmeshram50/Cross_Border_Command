import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf, SimpleDescModal } from './clmCommon';

/* Central CLM → Agreements Master (two tabs: Types + Library). */

type AgrType = { id: number; code: string; name: string; description: string };
type AgrLib = {
  id: number; code: string; agreement_type: string; title: string; party: string;
  regulatory: 'highly'|'less'; signing: boolean; segment: string | null;
  agr_status: string; content: string | null;
};

export default function ClmAgreementsPage() {
  const toast = useToast();
  const [tab, setTab]       = useState<'type'|'lib'>('type');
  const [types, setTypes]   = useState<AgrType[]>([]);
  const [lib, setLib]       = useState<AgrLib[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: AgrType[] }>('/clm/agreement-types'),
      api.get<{ status: boolean; data: AgrLib[]  }>('/clm/agreement-library'),
    ]).then(([t, l]) => { setTypes(t.data.data ?? []); setLib(l.data.data ?? []); })
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
        : <LibraryPane rows={lib} types={types} loading={loading} reload={reload} />}
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
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

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
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Agreement Type
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bAgr}</div>
            <div className="clm-empty-title">No agreement types yet</div>
            <div className="clm-empty-sub">Click + Add Agreement Type to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
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

      {modalOpen && <SimpleDescModal title={editing ? 'Edit Agreement Type' : 'Add Agreement Type'} namePlaceholder="e.g. Sales Agreement, Service Agreement" descPlaceholder="Short description of when this agreement type is used" code={editing?.code ?? `AT-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initialName={editing?.name ?? ''} initialDesc={editing?.description ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete agreement type?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </div>
  );
}

function LibraryPane({ rows, types, loading, reload }: { rows: AgrLib[]; types: AgrType[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<AgrLib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgrLib | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.title.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.agreement_type.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: Omit<AgrLib, 'id'|'code'>, id?: number) => {
    try {
      if (id) await api.put(`/clm/agreement-library/${id}`, form);
      else    await api.post('/clm/agreement-library', form);
      toast.success(id ? 'Updated' : 'Added', form.title);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/agreement-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.title); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search agreement library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Agreement
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bAgr}</div>
            <div className="clm-empty-title">No agreements yet</div>
            <div className="clm-empty-sub">Click + Add Agreement to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
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
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => {
                  const isHigh = r.regulatory === 'highly';
                  return (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <td className="clm-td-name">{r.title}</td>
                      <td className="clm-td-desc">{r.agreement_type}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`clm-badge ${isHigh ? 'clm-badge-red' : 'clm-badge-green'}`}>
                          <span className="clm-badge-dot" />{isHigh ? 'High' : 'Less'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 11.5 }}>
                        {isHigh ? <span style={{ fontWeight: 600, color: '#0891b2' }}>{r.segment || '—'}</span> : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>All segments</span>}
                      </td>
                      <td className="clm-td-desc">{r.party}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`clm-badge ${r.signing ? 'clm-badge-indigo' : 'clm-badge-slate'}`}>{r.signing ? 'Yes' : 'No'}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {modalOpen && <AgrLibModal existing={editing} types={types} nextCode={`A-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete agreement?" sub={`${pendingDelete.title} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={() => void onDelete()} />, document.body)}
    </div>
  );
}

function AgrLibModal(props: { existing: AgrLib | null; types: AgrType[]; nextCode: string; onClose: () => void; onSave: (f: Omit<AgrLib, 'id'|'code'>) => void; }) {
  const { existing, types, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;
  const [type, setType]   = useState(existing?.agreement_type ?? (types[0]?.name ?? ''));
  const [title, setTitle] = useState(existing?.title ?? '');
  const [party, setParty] = useState(existing?.party ?? '');
  const [reg, setReg]     = useState<'highly'|'less'>(existing?.regulatory ?? 'less');
  const [signing, setSigning] = useState(existing?.signing ?? true);
  const [segment, setSegment] = useState(existing?.segment ?? '');
  const [agrStatus, setAgrStatus] = useState(existing?.agr_status ?? 'Active');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!type.trim())  next.type  = 'Agreement type is required';
    if (!title.trim()) next.title = 'Title is required';
    if (!party.trim()) next.party = 'Party is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        agreement_type: type.trim(), title: title.trim(), party: party.trim(),
        regulatory: reg, signing, segment: segment.trim() || null,
        agr_status: agrStatus, content: null,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal clm-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Agreement' : 'Add New Agreement'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update agreement template details.' : 'Create a reusable agreement template for CLM workflows.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Agreement ID' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Agreement Type <span className="clm-req">*</span></label>
              <select className={`clm-select ${errors.type ? 'clm-input-err' : ''}`} value={type} onChange={e => { setType(e.target.value); setErrors(p => ({ ...p, type: '' })); }}>
                <option value="">— Select —</option>
                {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                {type && !types.find(t => t.name === type) && <option value={type}>{type}</option>}
              </select>
              {errors.type && <div className="clm-err">{errors.type}</div>}
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Agreement Title <span className="clm-req">*</span></label>
              <input className={`clm-input ${errors.title ? 'clm-input-err' : ''}`} placeholder="e.g. Master Supplier Agreement — FY2026" value={title} onChange={e => { setTitle(e.target.value); setErrors(p => ({ ...p, title: '' })); }} />
              {errors.title && <div className="clm-err">{errors.title}</div>}
            </div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Applicable Party <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.party ? 'clm-input-err' : ''}`} placeholder="Comma-separated, e.g. Buyer, Supplier-Material" value={party} onChange={e => { setParty(e.target.value); setErrors(p => ({ ...p, party: '' })); }} />
            {errors.party && <div className="clm-err">{errors.party}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Regulatory</label>
              <select className="clm-select" value={reg} onChange={e => setReg(e.target.value as 'highly'|'less')}>
                <option value="less">Less Regulatory</option>
                <option value="highly">High Regulatory</option>
              </select>
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Segment</label>
              <input className="clm-input" placeholder={reg === 'highly' ? 'e.g. Tobacco, Pharma' : 'All standard'} value={segment} onChange={e => setSegment(e.target.value)} disabled={reg !== 'highly'} />
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Status</label>
              <select className="clm-select" value={agrStatus} onChange={e => setAgrStatus(e.target.value)}>
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
              </select>
            </div>
          </div>
          <div className="clm-field">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#0c4a6e' }}>
              <input type="checkbox" checked={signing} onChange={e => setSigning(e.target.checked)} style={{ accentColor: '#0891b2' }} />
              Signing workflow required (e-sign / signature pad)
            </label>
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
