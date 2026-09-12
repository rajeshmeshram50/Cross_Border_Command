/* TlModal — extracted from ClmTradeLicensesPage so the Document Control Panel can
 * lazy-load the FORM without pulling in the whole master page.
 *
 * ClmDcpPage used to `import { TlModal } from './ClmTradeLicensesPage'`, which is a plain
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
import { MasterMultiSelect } from '../../../components/ui/MasterMultiSelect';
import { ClmSkeletonRows, SimpleDescModal, useScrollLock } from '../shared/clmCommon';
import type { Tl, Authority } from './ClmTradeLicensesPage';

export function TlModal(props: { existing: Tl | null; authorities: Authority[]; nextCode: string; onClose: () => void; onSave: (f: { name: string; authority: string }) => void; }) {
  const { existing, authorities: initialAuthorities, nextCode, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  // Issuing authority is now multi-select. Stored on the backend as a single
  // comma-joined string (the `authority` column, max 255) — split on load,
  // join on save, so no backend/schema change is needed.
  const [authList, setAuthList] = useState<string[]>(
    existing?.authority ? existing.authority.split(',').map(s => s.trim()).filter(Boolean) : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [authorities, setAuthorities] = useState<Authority[]>(initialAuthorities);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  useEffect(() => { setAuthorities(initialAuthorities); }, [initialAuthorities]);

  const handleSave = async () => {
    // Guard at the TOP, not just `disabled` on the button — the button attribute
    // doesn't stop an Enter-key handler or a programmatic call.
    if (saving) return;
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Licence name is required';
    else if (name.trim().length > 255) next.name = 'Name must not be greater than 255 characters';
    if (authList.length === 0) next.auth = 'Select at least one authority';
    const joined = authList.join(', ');
    if (joined.length > 255) next.auth = 'Too many authorities selected (max 255 characters combined)';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: name.trim(), authority: joined })); }
    catch (e: any) {
      const apiErrors = e?.response?.data?.errors as Record<string, string[] | string> | undefined;
      if (apiErrors) {
        const keyMap: Record<string, string> = { authority: 'auth' };   // backend field → inline field
        setErrors(p => ({ ...p, ...Object.fromEntries(Object.entries(apiErrors).map(([k, v]) => [keyMap[k] ?? k, Array.isArray(v) ? v[0] : String(v)])) }));
      }
    }
    finally { setSaving(false); }
  };

  const onAddNewAuthority = async (form: { name: string; description: string }) => {
    try {
      const r = await api.post<{ status: boolean; data: Authority }>('/clm/authorities', form);
      const created = r.data.data;
      setAuthorities(prev => [...prev, created]);
      setAuthList(prev => prev.includes(String(created.id)) ? prev : [...prev, String(created.id)]);
      setErrors(p => ({ ...p, auth: '' }));
      setQuickAddOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not add authority');
    }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal">
        {saving && <div className="clm-saving-veil" aria-hidden />}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Trade Licence' : 'Add Trade Licence'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update trade licence details.' : 'Register a statutory trade licence record.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'TL Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Licence Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. GST Registration, IEC Certificate" maxLength={255} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{name.length}/255</div>
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Issuing Authority <span className="clm-req">*</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MasterMultiSelect
                  values={authList}
                  invalid={!!errors.auth}
                  placeholder="— Select Authorities —"
                  options={[
                    ...authorities.map(a => ({ value: String(a.id), label: a.name })),
                    // keep any already-selected authority that's no longer in the
                    // master list so it stays toggle-able (e.g. renamed/removed).
                    ...authList.filter(v => !authorities.find(a => String(a.id) === v)).map(v => ({ value: v, label: v })),
                  ]}
                  onChange={(next) => { setAuthList(next); setErrors(p => ({ ...p, auth: '' })); }}
                />
              </div>
              <Tooltip label="Add new authority"><button type="button" className="clm-quick-add-btn" onClick={() => setQuickAddOpen(true)} aria-label="Add new authority" disabled={saving}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button></Tooltip>
            </div>
            <div className="clm-field-hint">Pulls from Authority Master — click + to add a new authority.</div>
            {errors.auth && <div className="clm-err">{errors.auth}</div>}
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


export default TlModal;
