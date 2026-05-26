import { useState } from 'react';
import { createPortal } from 'react-dom';

/* ─────────────────────────────────────────────────────────────────────────
 * Shared CLM input validators.
 *
 * Every CLM master form (Authority, KYC, DD, QC, Trade License, Agreement
 * Type, T&C Category, Trade Document, …) accepts free-text names and
 * descriptions that previously had no client-side validation, letting
 * users save XSS payloads, SQL injection strings, emoji-only entries,
 * symbol soup, and 1000-char garbage.
 *
 * The helpers below are exported so any modal can drop in matching
 * defence in a few lines instead of duplicating the regex set.
 *   sanitizeClmName       — XSS strip → SQL strip → name whitelist (`A-Z0-9 .,-()&/'%`)
 *   sanitizeClmDescription — XSS strip → SQL strip → address-style whitelist
 *                            (broader; permits #, _, : for prose)
 *   validateClmDuplicate  — case-insensitive uniqueness against an existing
 *                            list of rows, excluding the row being edited
 * ───────────────────────────────────────────────────────────────────────── */
export const CLM_NAME_MAX = 100;
export const CLM_DESC_MAX = 255;
const CLM_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;
const CLM_NAME_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%]/g;
const CLM_DESC_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%#:_!?]/g;

export type ClmSanitizeResult = { cleaned: string; error?: string };

const stripXssAndSql = (raw: string) => {
  const afterAngles = raw.replace(/[<>]/g, '');
  const afterSql = afterAngles.replace(CLM_SQL_RE, '');
  return { stripped: afterSql, afterAngles, afterSql };
};

export function sanitizeClmName(raw: string, maxLen = CLM_NAME_MAX): ClmSanitizeResult {
  const { stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(CLM_NAME_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = "Use letters, numbers, spaces, and . , - ( ) & / ' % only";
  return { cleaned, error };
}

export function sanitizeClmDescription(raw: string, maxLen = CLM_DESC_MAX): ClmSanitizeResult {
  const { stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(CLM_DESC_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = `Description may only contain letters, numbers, spaces, and basic punctuation (max ${maxLen} chars)`;
  return { cleaned, error };
}

/** Required-field meaningful-input check. Rejects whitespace-only,
 * symbol-only, or emoji-only entries that bypass `if (!value.trim())`. */
export function isMeaningfulClmValue(raw: string): boolean {
  return /[A-Za-z0-9]/.test(raw);
}

/** Case-insensitive duplicate check against the existing list. */
export function findClmDuplicate<T extends { id?: string | number; name?: string; description?: string; title?: string }>(
  rows: T[],
  field: 'name' | 'description' | 'title',
  value: string,
  editingId?: string | number | null,
): T | undefined {
  const target = value.trim().toLowerCase();
  if (!target) return undefined;
  return rows.find(r => {
    if (editingId != null && r.id === editingId) return false;
    return String((r as Record<string, unknown>)[field] ?? '').trim().toLowerCase() === target;
  });
}

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
  /** Optional list of existing rows for client-side duplicate check.
   *  When omitted, only XSS/SQL/charset/length validation runs. */
  existingRows?: Array<{ id?: string | number; name?: string }>;
  editingId?: string | number | null;
}) {
  const { title, placeholder, code, isEdit, initial, headIconSvg, onClose, onSave, existingRows, editingId } = props;
  const [name, setName]     = useState(initial);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleChange = (raw: string) => {
    const { cleaned, error: e } = sanitizeClmName(raw);
    setName(cleaned);
    setError(e ?? '');
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    if (!isMeaningfulClmValue(trimmed)) { setError('Name must contain letters or numbers, not only symbols'); return; }
    if (existingRows && findClmDuplicate(existingRows, 'name', trimmed, editingId)) {
      setError(`"${trimmed}" already exists — pick a different name`);
      return;
    }
    setSaving(true);
    try { await Promise.resolve(onSave(trimmed)); }
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
            <input className={`clm-input ${error ? 'clm-input-err' : ''}`} placeholder={placeholder} value={name} maxLength={CLM_NAME_MAX} onChange={e => handleChange(e.target.value)} autoFocus />
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
  /** Optional list of existing rows for client-side duplicate name check. */
  existingRows?: Array<{ id?: string | number; name?: string }>;
  editingId?: string | number | null;
}) {
  const { title, namePlaceholder, descPlaceholder, code, isEdit, initialName, initialDesc, headIconSvg, onClose, onSave, existingRows, editingId } = props;
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeClmName(raw);
    setName(cleaned);
    setErrors(p => ({ ...p, name: error ?? '' }));
  };
  const handleDescChange = (raw: string) => {
    const { cleaned, error } = sanitizeClmDescription(raw);
    setDesc(cleaned);
    setErrors(p => ({ ...p, desc: error ?? '' }));
  };

  const handleSave = async () => {
    const next: Record<string, string> = {};
    const trimmedName = name.trim();
    const trimmedDesc = desc.trim();
    if (!trimmedName) next.name = 'Name is required';
    else if (!isMeaningfulClmValue(trimmedName)) next.name = 'Name must contain letters or numbers, not only symbols';
    else if (existingRows && findClmDuplicate(existingRows, 'name', trimmedName, editingId)) {
      next.name = `"${trimmedName}" already exists — pick a different name`;
    }
    if (!trimmedDesc) next.desc = 'Description is required';
    else if (!isMeaningfulClmValue(trimmedDesc)) next.desc = 'Description must contain letters or numbers, not only symbols';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try { await Promise.resolve(onSave({ name: trimmedName, description: trimmedDesc })); }
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
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder={namePlaceholder} value={name} maxLength={CLM_NAME_MAX} onChange={e => handleNameChange(e.target.value)} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Description <span className="clm-req">*</span></label>
            <textarea className={`clm-textarea ${errors.desc ? 'clm-input-err' : ''}`} placeholder={descPlaceholder} value={desc} maxLength={CLM_DESC_MAX} onChange={e => handleDescChange(e.target.value)} />
            {errors.desc && <div className="clm-err">{errors.desc}</div>}
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2, textAlign: 'right' }}>{desc.length}/{CLM_DESC_MAX}</div>
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
  const { title, code, isEdit, initialShortCode, onClose, onSave } = props;
  const [name, setName]     = useState(props.initialName);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /* Auto-derive a 3–4 letter short_code from the category name:
   * first letter of each word longer than 2 chars, uppercased, capped at 4.
   * Backend still requires short_code, so we send it but never show the field. */
  const deriveShortCode = (raw: string): string => {
    const fromWords = raw.split(/\s+/).filter(w => w.length > 2).map(w => w[0]).join('').toUpperCase().slice(0, 4);
    return fromWords || raw.replace(/\s+/g, '').toUpperCase().slice(0, 4) || 'CAT';
  };

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const sc = (initialShortCode && isEdit) ? initialShortCode : deriveShortCode(name.trim());
      await Promise.resolve(onSave({ short_code: sc, name: name.trim() }));
    } finally { setSaving(false); }
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
              <div className="clm-modal-head-sub">{isEdit ? 'Update category details.' : 'Create a new document category.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">Document Category ID</div>
              <div className="clm-autocode-val">{code}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Document Category Name <span className="clm-req">*</span></label>
            <input className={`clm-input ${errors.name ? 'clm-input-err' : ''}`} placeholder="e.g. International – Proforma Invoice" value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }} autoFocus />
            {errors.name && <div className="clm-err">{errors.name}</div>}
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Category' : 'Save Entry')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

export function DeleteConf(props: { title: string; sub: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const { title, sub, onCancel, onConfirm } = props;
  /* Local in-flight guard — prevents duplicate API calls when the
   * user double-clicks Delete (which was causing 404/409 backend
   * errors). Awaits onConfirm so the state stays true until the
   * parent's async delete actually resolves; if the parent unmounts
   * the modal on success, the state is irrelevant. */
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    if (deleting) return;
    setDeleting(true);
    try { await Promise.resolve(onConfirm()); }
    finally { setDeleting(false); }
  };
  const handleCancel = () => { if (!deleting) onCancel(); };

  /* Wrap any "(XX-NNN)" code pattern in the sub string with a
   * monospace cyan pill — matches the CLM table code pills. We
   * split on the parenthesised group and rebuild as JSX so React
   * can attach the styling without dangerouslySetInnerHTML. */
  const renderSub = (text: string) => {
    const parts = text.split(/(\([A-Z]{1,4}-\d{2,4}\))/);
    return parts.map((p, i) => {
      const m = /^\((.+)\)$/.exec(p);
      return m
        ? <span key={i}>(<span className="clm-conf-code">{m[1]}</span>)</span>
        : <span key={i}>{p}</span>;
    });
  };

  return (
    <div className="clm-conf-bd" onClick={handleCancel}>
      <div className="clm-conf" onClick={e => e.stopPropagation()}>
        <div className="clm-conf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
        <div className="clm-conf-title">{title}</div>
        <div className="clm-conf-sub">{renderSub(sub)}</div>
        <div className="clm-conf-hint">This action cannot be undone.</div>
        <div className="clm-conf-btns">
          <button className="clm-btn-cancel" onClick={handleCancel} disabled={deleting}>Cancel</button>
          <button className="clm-btn-del" onClick={() => void handleConfirm()} disabled={deleting}>
            {deleting ? (
              <>
                <svg className="clm-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Deleting…
              </>
            ) : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
