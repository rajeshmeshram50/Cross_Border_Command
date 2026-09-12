/* QcModal — extracted from ClmQcPage so the Document Control Panel can
 * lazy-load the FORM without pulling in the whole master page.
 *
 * ClmDcpPage used to `import { QcModal } from './ClmQcPage'`, which is a plain
 * eager import: it dragged the entire page — table, toolbar, pager, shimmer
 * and every dependency — into the DCP chunk, four times over. Same pattern the
 * Customer / Consignee / Supplier masters already use for their heavy modals.
 *
 * The row types stay declared on the page and are imported here as TYPES only,
 * so nothing of the page survives into this chunk at runtime. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import Tooltip from '../../../components/ui/Tooltip';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { clip, SimpleDescModal, useScrollLock } from '../shared/clmCommon';
import type { Qc, Authority } from './ClmQcPage';

export function QcModal(props: { existing: Qc | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: Omit<Qc, 'id'|'code'|'status'>) => void; }) {
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
    // Guard at the TOP, not just `disabled` on the button — the button attribute
    // doesn't stop an Enter-key handler or a programmatic call.
    if (saving) return;
    const next: Record<string, string> = {};
    if (!name.trim())     next.name     = 'Name is required';
    else if (name.trim().length > 255) next.name = 'Name must not be greater than 255 characters';
    if (!purpose.trim())  next.purpose  = 'Purpose is required';
    else if (purpose.trim().length > 500) next.purpose = 'Purpose must not be greater than 500 characters';
    if (!issuedBy.trim()) next.issuedBy = 'Authority is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave({
        name: name.trim(), purpose: purpose.trim(), issued_by: issuedBy.trim(),
        doc_type: type, qa_params: qaParams?.trim() || null, min_criteria: minCrit?.trim() || null,
      }));
    } catch (e: any) {
      const apiErrors = e?.response?.data?.errors as Record<string, string[] | string> | undefined;
      if (apiErrors) {
        const keyMap: Record<string, string> = { issued_by: 'issuedBy' };   // backend field → inline field
        setErrors(p => ({ ...p, ...Object.fromEntries(Object.entries(apiErrors).map(([k, v]) => [keyMap[k] ?? k, Array.isArray(v) ? v[0] : String(v)])) }));
      }
    } finally { setSaving(false); }
  };

  const onAddNewAuthority = async (form: { name: string; description: string }) => {
    try {
      const r = await api.post<{ status: boolean; data: Authority }>('/clm/authorities', form);
      const created = r.data.data;
      setAuthorities(prev => [...prev, created]);
      setIssuedBy(String(created.id));
      setErrors(p => ({ ...p, issuedBy: '' }));
      setQuickAddOpen(false);
      toast.success('Added', clip(created.name));
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not add authority');
    }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal clm-modal-wide">
        {saving && <div className="clm-saving-veil" aria-hidden />}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit QC Document' : 'Add QC Document'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update QC document details.' : 'Register a new quality / compliance document.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} disabled={saving}>×</button>
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
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. ISO 9001, HACCP, GOTS" maxLength={255} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{name.length}/255</div>
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Purpose <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.purpose ? 'clm-input-err' : ''}`} placeholder="What this certificate is for…" maxLength={500} value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: '' })); }} />
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
                    ...authorities.map(a => ({ value: String(a.id), label: a.name })),
                    ...(issuedBy && !authorities.find(a => String(a.id) === issuedBy) ? [{ value: issuedBy, label: issuedBy }] : []),
                  ]}
                  onChange={(v) => { setIssuedBy(v); setErrors(p => ({ ...p, issuedBy: '' })); }}
                />
              </div>
              <Tooltip label="Add new authority"><button type="button" className="clm-quick-add-btn" onClick={() => setQuickAddOpen(true)} aria-label="Add new authority" disabled={saving}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button></Tooltip>
            </div>
            <div className="clm-field-hint">Pulls from Authority Master — click + to add a new authority.</div>
            {errors.issuedBy && <div className="clm-err">{errors.issuedBy}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">QA Testing Parameters</label>
            <textarea className="clm-textarea" placeholder="e.g. Moisture %, microbial count, contamination levels" value={qaParams ?? ''} maxLength={256} onChange={e => setQaParams(e.target.value.slice(0, 256))} />
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{(qaParams ?? '').length}/256</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Minimum Acceptance Criteria</label>
            <textarea className="clm-textarea" placeholder="e.g. Moisture < 13%, zero contamination, pH 6.0–7.5" value={minCrit ?? ''} maxLength={256} onChange={e => setMinCrit(e.target.value.slice(0, 256))} />
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{(minCrit ?? '').length}/256</div>
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
          onSave={(f) => onAddNewAuthority(f)}
        />
      )}
    </div>
  ), document.body);
}


export default QcModal;
