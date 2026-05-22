import { useState } from 'react';
import { createPortal } from 'react-dom';

/* ─────────────────────────────────────────────────────────────────────────
 * Shared modal shells used by every 2-tab CLM master page.
 *
 *   SimpleNameModal    — one-field add/edit (Trade Doc Name, etc.)
 *   SimpleDescModal    — name + description (Agreement Type, Clause Type)
 *   ShortCodeNameModal — short_code + name (T&C Category)
 *   DeleteConf         — confirmation dialog
 *
 * They reuse the `clm-modal-*` styles from clmShared.CSS so no extra CSS
 * lives here. Pages call createPortal-wrapped modals already; these helpers
 * are designed to be rendered inline because each page wraps them in its
 * own modalOpen guard.
 * ───────────────────────────────────────────────────────────────────────── */

export function SimpleNameModal(props: {
  title: string;
  placeholder: string;
  code: string;
  isEdit: boolean;
  initial: string;
  headIconSvg?: React.ReactNode;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { title, placeholder, code, isEdit, initial, headIconSvg, onClose, onSave } = props;
  const [name, setName]     = useState(initial);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try { await Promise.resolve(onSave(name.trim())); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              {headIconSvg ?? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
              )}
            </div>
            <div>
              <div className="clm-modal-head-title">{title}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Rename the entry below.' : 'Create a new lightweight master record.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{code}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${error ? 'clm-input-err' : ''}`} placeholder={placeholder} value={name} onChange={e => { setName(e.target.value); setError(''); }} autoFocus />
            {error && <div className="clm-err">{error}</div>}
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

export function SimpleDescModal(props: {
  title: string;
  namePlaceholder: string;
  descPlaceholder: string;
  code: string;
  isEdit: boolean;
  initialName: string;
  initialDesc: string;
  headIconSvg?: React.ReactNode;
  onClose: () => void;
  onSave: (form: { name: string; description: string }) => void;
}) {
  const { title, namePlaceholder, descPlaceholder, code, isEdit, initialName, initialDesc, headIconSvg, onClose, onSave } = props;
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!desc.trim()) next.desc = 'Description is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: name.trim(), description: desc.trim() })); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              {headIconSvg ?? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                </svg>
              )}
            </div>
            <div>
              <div className="clm-modal-head-title">{title}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the entry below.' : 'Register a new master record.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{code}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder={namePlaceholder} value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Description <span className="clm-req">*</span></label>
            <textarea className={`clm-textarea ${errors.desc ? 'clm-input-err' : ''}`} placeholder={descPlaceholder} value={desc} onChange={e => { setDesc(e.target.value); setErrors(p => ({ ...p, desc: '' })); }} />
            {errors.desc && <div className="clm-err">{errors.desc}</div>}
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

export function ShortCodeNameModal(props: {
  title: string;
  code: string;
  isEdit: boolean;
  initialShortCode: string;
  initialName: string;
  onClose: () => void;
  onSave: (form: { short_code: string; name: string }) => void;
}) {
  const { title, code, isEdit, initialShortCode, initialName, onClose, onSave } = props;
  const [shortCode, setShortCode] = useState(initialShortCode);
  const [name, setName]           = useState(initialName);
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [saving, setSaving]       = useState(false);

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!shortCode.trim()) next.shortCode = 'Short code is required';
    if (!name.trim())      next.name      = 'Name is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ short_code: shortCode.trim().toUpperCase(), name: name.trim() })); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal" onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="15" y2="18" /></svg>
            </div>
            <div>
              <div className="clm-modal-head-title">{title}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update the category below.' : 'Add a T&C category for grouping reusable terms.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">{isEdit ? 'Category Code' : 'Auto Generated Code'}</div>
              <div className="clm-autocode-val">{code}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Short Code <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.shortCode ? 'clm-input-err' : ''}`} placeholder="e.g. IPI, DPI, IGPO" value={shortCode} onChange={e => { setShortCode(e.target.value); setErrors(p => ({ ...p, shortCode: '' })); }} maxLength={12} style={{ textTransform: 'uppercase' }} />
            <div className="clm-field-hint">3–4 letter chip displayed on cards.</div>
            {errors.shortCode && <div className="clm-err">{errors.shortCode}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Category Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. International - Proforma Invoice" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} />
            {errors.name && <div className="clm-err">{errors.name}</div>}
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

export function DeleteConf(props: { title: string; sub: string; onCancel: () => void; onConfirm: () => void }) {
  const { title, sub, onCancel, onConfirm } = props;
  return (
    <div className="clm-conf-bd" onClick={onCancel}>
      <div className="clm-conf" onClick={e => e.stopPropagation()}>
        <div className="clm-conf-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg></div>
        <div className="clm-conf-title">{title}</div>
        <div className="clm-conf-sub">{sub}</div>
        <div className="clm-conf-btns">
          <button className="clm-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="clm-btn-del" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
