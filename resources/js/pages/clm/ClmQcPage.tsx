import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { SimpleDescModal } from './clmCommon';

/* Central CLM → Quality & Compliance Documents Master. 3-card faithful port. */

type Qc = {
  id: number; code: string; name: string; purpose: string; issued_by: string;
  doc_type: 'cert'|'comp'; qa_params: string | null; min_criteria: string | null;
  status: 'active'|'inactive';
};
type Authority = { id: number; code: string; name: string };

export default function ClmQcPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<Qc[]>([]);
  const [auths, setAuths]       = useState<Authority[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [editing, setEditing]   = useState<Qc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Qc | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Qc[] }>('/clm/qc-documents'),
      api.get<{ status: boolean; data: Authority[] }>('/clm/authorities'),
    ]).then(([k, a]) => { setRows(k.data.data ?? []); setAuths(a.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load QC documents'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) ||
      r.purpose.toLowerCase().includes(s) || r.issued_by.toLowerCase().includes(s));
  }, [rows, search]);
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
          <div className="clm-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" placeholder="Search QC documents…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
          {slice.length === 0 ? (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bCheck}</div>
              <div className="clm-empty-title">No QC documents yet</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Click + Add QC Document to create the first record.' : 'No results match the current search.'}</div>
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
                  <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6} className="clm-status">Loading…</td></tr>}
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
                        <div className="clm-actions">
                          <Tooltip label="Edit"><button type="button" aria-label="Edit" className="clm-act clm-act-edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></Tooltip>
                          <Tooltip label="Delete"><button type="button" aria-label="Delete" className="clm-act clm-act-del" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></Tooltip>
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
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete QC Document"
        itemName={pendingDelete ? `${pendingDelete.name} (${pendingDelete.code})` : undefined}
        subMessage="This QC document will be permanently removed. The action cannot be undone."
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}

function QcModal(props: { existing: Qc | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: Omit<Qc, 'id'|'code'|'status'>) => void; }) {
  const { existing, authorities: initialAuthorities, nextCode, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;
  const [name, setName]         = useState(existing?.name ?? '');
  const [purpose, setPurpose]   = useState(existing?.purpose ?? '');
  const [issuedBy, setIssuedBy] = useState(existing?.issued_by ?? '');
  // Type dropdown removed from the form — preserve the existing value on
  // edit, default to 'cert' on add. Backend still receives doc_type.
  const type: 'cert'|'comp'     = existing?.doc_type ?? 'cert';
  const [qaParams, setQaParams] = useState(existing?.qa_params ?? '');
  const [minCrit, setMinCrit]   = useState(existing?.min_criteria ?? '');
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);
  const [authorities, setAuthorities] = useState<Authority[]>(initialAuthorities);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  useEffect(() => { setAuthorities(initialAuthorities); }, [initialAuthorities]);

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

  const onAddNewAuthority = async (form: { name: string; description: string }) => {
    try {
      const r = await api.post<{ status: boolean; data: Authority }>('/clm/authorities', form);
      const created = r.data.data;
      setAuthorities(prev => [...prev, created]);
      setIssuedBy(created.name);
      setErrors(p => ({ ...p, issuedBy: '' }));
      setQuickAddOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not add authority');
    }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal clm-modal-wide">
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
          <div className="clm-field">
            <label className="clm-field-label">Issued By (Authority) <span className="clm-req">*</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MasterSelect
                  key={`qc-issuedBy-${authorities.length}`}
                  value={issuedBy}
                  invalid={!!errors.issuedBy}
                  placeholder="— Select —"
                  options={[
                    ...authorities.map(a => ({ value: a.name, label: a.name })),
                    ...(issuedBy && !authorities.find(a => a.name === issuedBy) ? [{ value: issuedBy, label: issuedBy }] : []),
                  ]}
                  onChange={(v) => { setIssuedBy(v); setErrors(p => ({ ...p, issuedBy: '' })); }}
                />
              </div>
              <Tooltip label="Add new authority">
                <button type="button" className="clm-quick-add-btn" onClick={() => setQuickAddOpen(true)} aria-label="Add new authority">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </Tooltip>
            </div>
            <div className="clm-field-hint">Pulls from Authority Master — click + to add a new authority.</div>
            {errors.issuedBy && <div className="clm-err">{errors.issuedBy}</div>}
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
      {quickAddOpen && (
        <SimpleDescModal
          title="Add New Authority"
          namePlaceholder="e.g. Income Tax Department, DGFT, GSTN"
          descPlaceholder="What this authority issues / regulates"
          code={`A-${String(authorities.length + 1).padStart(3, '0')}`}
          isEdit={false}
          initialName=""
          initialDesc=""
          onClose={() => setQuickAddOpen(false)}
          onSave={(f) => void onAddNewAuthority(f)}
        />
      )}
    </div>
  ), document.body);
}
