import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';

/* Central CLM → Quality & Compliance Documents Master. 3-card faithful port. */

type Qc = {
  id: number; code: string; name: string; purpose: string; issued_by: string;
  doc_type: 'cert'|'comp'; qa_params: string | null; min_criteria: string | null;
  status: 'active'|'inactive';
};
type Authority = { id: number; code: string; name: string };
type Counts = { all: number; cert: number; comp: number };

export default function ClmQcPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Qc[]>([]);
  const [counts, setCounts]     = useState<Counts>({ all: 0, cert: 0, comp: 0 });
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState<'all'|'cert'|'comp'>('all');
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [editing, setEditing]   = useState<Qc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Qc | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Qc[]; counts: Counts }>('/clm/qc-documents'),
      api.get<{ status: boolean; data: Authority[] }>('/clm/authorities'),
    ]).then(([k, a]) => { setRows(k.data.data ?? []); setCounts(k.data.counts ?? { all: 0, cert: 0, comp: 0 }); setAuths(a.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load QC documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const base = tab === 'all' ? rows : rows.filter(r => r.doc_type === tab);
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter(r =>
      r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) ||
      r.purpose.toLowerCase().includes(s) || r.issued_by.toLowerCase().includes(s));
  }, [rows, tab, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: Omit<Qc, 'id'|'code'|'status'>, id?: number) => {
    try {
      if (id) { await api.put(`/clm/qc-documents/${id}`, form); toast.success('Updated', `${form.name} saved`); }
      else    { await api.post('/clm/qc-documents', form);     toast.success('Added',   `${form.name} added`); }
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) {
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save');
    }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/qc-documents/${pendingDelete.id}`); toast.success('Deleted', `${pendingDelete.name} removed`); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hQc}
        title="Quality & Compliance Documents"
        sub="Manage QC certificates, testing documents, and compliance verification records."
        addLabel="Add QC Document"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bCheck}
        label="Quality & Compliance Docs"
        sub="Manage quality certificates, testing standards, and compliance document structures."
        steps={[
          { n: '01', title: 'Create QC Record',       desc: 'Add quality and compliance certificates.',           icon: ICO.check },
          { n: '02', title: 'Define QC Purpose',      desc: 'Set testing and compliance objectives.',             icon: ICO.info },
          { n: '03', title: 'Map Authority',          desc: 'Link QC documents with issuing authorities.',        icon: ICO.shield },
          { n: '04', title: 'Configure QC Standards', desc: 'Define testing parameters and acceptance criteria.', icon: ICO.zap },
        ]}
      />

      <div className="clm-page-card">
        <div className="clm-tabs-bar">
          <button className={`clm-tab ${tab === 'all'  ? 'active' : ''}`} onClick={() => { setTab('all');  setPage(1); }}>
            All <span className="clm-tab-count">{counts.all}</span>
          </button>
          <button className={`clm-tab ${tab === 'cert' ? 'active' : ''}`} onClick={() => { setTab('cert'); setPage(1); }}>
            <span className="clm-tab-dot" style={{ background: '#0891b2' }} /> Certificates <span className="clm-tab-count">{counts.cert}</span>
          </button>
          <button className={`clm-tab ${tab === 'comp' ? 'active' : ''}`} onClick={() => { setTab('comp'); setPage(1); }}>
            <span className="clm-tab-dot" style={{ background: '#7c3aed' }} /> Compliance Docs <span className="clm-tab-count">{counts.comp}</span>
          </button>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div className="clm-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="Search QC documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bCheck}</div>
              <div className="clm-empty-title">No QC documents yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add QC Document to create the first record.' : 'No results match the current tab / search.'}</div>
            </div>
          ) : (
            <div className="clm-table-wrap">
              <table className="clm-table">
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>QC ID</th>
                  <th>QC DOCUMENT NAME</th>
                  <th>PURPOSE</th>
                  <th style={{ width: 150, textAlign: 'center' }}>ISSUED BY</th>
                  <th style={{ width: 130, textAlign: 'center' }}>TYPE</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="clm-status">Loading…</td></tr>}
                  {!loading && slice.map((r, i) => (
                    <tr key={r.id}>
                      <td className="clm-td-num">{start + i + 1}</td>
                      <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                      <td className="clm-td-name">{r.name}</td>
                      <td className="clm-td-desc">{r.purpose}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="clm-badge clm-badge-teal"><span className="clm-badge-dot" />{r.issued_by}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`clm-badge ${r.doc_type === 'cert' ? 'clm-badge-teal' : 'clm-badge-violet'}`}>
                          {r.doc_type === 'cert' ? 'Certificate' : 'Compliance Doc'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="clm-actions">
                          <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
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
      </div>

      {modalOpen && <QcModal existing={editing} authorities={auths} nextCode={`QC-${String(rows.length + 1).padStart(3, '0')}`} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal((
        <div className="clm-conf-bd" onClick={() => setPendingDelete(null)}>
          <div className="clm-conf" onClick={e => e.stopPropagation()}>
            <div className="clm-conf-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></div>
            <div className="clm-conf-title">Delete QC document?</div>
            <div className="clm-conf-sub"><strong>{pendingDelete.name}</strong> ({pendingDelete.code}) will be removed.</div>
            <div className="clm-conf-btns"><button className="clm-btn-cancel" onClick={() => setPendingDelete(null)}>Cancel</button><button className="clm-btn-del" onClick={() => void onDelete()}>Delete</button></div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function QcModal(props: { existing: Qc | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: Omit<Qc, 'id'|'code'|'status'>) => void; }) {
  const { existing, authorities, nextCode, onClose, onSave } = props;
  const isEdit = !!existing;
  const [name, setName]         = useState(existing?.name ?? '');
  const [purpose, setPurpose]   = useState(existing?.purpose ?? '');
  const [issuedBy, setIssuedBy] = useState(existing?.issued_by ?? '');
  const [type, setType]         = useState<'cert'|'comp'>(existing?.doc_type ?? 'cert');
  const [qaParams, setQaParams] = useState(existing?.qa_params ?? '');
  const [minCrit, setMinCrit]   = useState(existing?.min_criteria ?? '');
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim())     next.name     = 'Name is required';
    if (!purpose.trim())  next.purpose  = 'Purpose is required';
    if (!issuedBy.trim()) next.issuedBy = 'Authority is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        name: name.trim(), purpose: purpose.trim(), issued_by: issuedBy.trim(),
        doc_type: type, qa_params: qaParams?.trim() || null, min_criteria: minCrit?.trim() || null,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal clm-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit QC Document' : 'Add QC Document'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update QC document details.' : 'Register a new quality / compliance document.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'QC Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">QC Certificate Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. ISO 9001, HACCP, GOTS" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Purpose <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.purpose ? 'clm-input-err' : ''}`} placeholder="What this certificate is for…" value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: '' })); }} />
            {errors.purpose && <div className="clm-err">{errors.purpose}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Issued By (Authority) <span className="clm-req">*</span></label>
              <select className={`clm-select ${errors.issuedBy ? 'clm-input-err' : ''}`} value={issuedBy} onChange={e => { setIssuedBy(e.target.value); setErrors(p => ({ ...p, issuedBy: '' })); }}>
                <option value="">— Select —</option>
                {authorities.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                {issuedBy && !authorities.find(a => a.name === issuedBy) && <option value={issuedBy}>{issuedBy}</option>}
              </select>
              {errors.issuedBy && <div className="clm-err">{errors.issuedBy}</div>}
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Type</label>
              <select className="clm-select" value={type} onChange={e => setType(e.target.value as 'cert'|'comp')}>
                <option value="cert">Certificate</option>
                <option value="comp">Compliance Document</option>
              </select>
            </div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">QA Testing Parameters</label>
            <textarea className="clm-textarea" placeholder="e.g. Moisture %, microbial count, contamination levels" value={qaParams ?? ''} onChange={e => setQaParams(e.target.value)} />
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Minimum Acceptance Criteria</label>
            <textarea className="clm-textarea" placeholder="e.g. Moisture < 13%, zero contamination, pH 6.0–7.5" value={minCrit ?? ''} onChange={e => setMinCrit(e.target.value)} />
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
