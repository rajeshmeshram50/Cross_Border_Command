import { useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
export type CustomFieldType = 'text' | 'date' | 'number' | 'textarea';

export interface CustomFieldFormPayload {
  id?: number;
  name: string;
  type: CustomFieldType;
  description: string;
  // Free-text hint for which templates this field is intended for. Separate
  // from the server-derived `used_in` array (which scans real usage).
  used_in_hint: string;
}

export interface CustomFieldInitial {
  id?: number;
  name?: string;
  type?: CustomFieldType;
  description?: string | null;
  used_in_hint?: string | null;
}

// ── Modal ────────────────────────────────────────────────────────────────────
// Pure form component — the parent owns the API call. `prefillName` lets the
// TemplateEditor open this with an unrecognised {{token}} already filled in.
export default function CustomFieldModal(props: {
  initial: CustomFieldInitial | null;
  prefillName?: string;
  // Names of existing fields — used for instant, inline duplicate detection so
  // the "already exists" warning renders under the Field Name input rather than
  // arriving as a top-right toast after a server round-trip.
  existingNames?: string[];
  onClose: () => void;
  onSave: (row: CustomFieldFormPayload) => void | Promise<void>;
}) {
  const { initial, prefillName, existingNames = [], onClose, onSave } = props;

  // Character limits mirror the server rules (name max:100, description &
  // used_in_hint max:500) so the inline validation matches what would 422.
  const NAME_MAX = 100;
  const TEXT_MAX = 500;

  const [name, setName]               = useState(initial?.name || prefillName || '');
  const [type, setType]               = useState<CustomFieldType>(initial?.type || 'text');
  const [description, setDescription] = useState(initial?.description || '');
  const [usedInHint, setUsedInHint]   = useState(initial?.used_in_hint || '');
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);

  // Lock background page scroll while this overlay is open. It's a custom
  // overlay (not reactstrap's Modal), so it doesn't get Bootstrap's automatic
  // body-scroll lock — without this, scrolling inside the form bleeds through
  // to the dashboard behind it. Restored on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const TYPE_OPTIONS: { value: CustomFieldType; label: string; icon: string }[] = [
    { value: 'text',     label: 'Text',     icon: 'ri-text' },
    { value: 'date',     label: 'Date',     icon: 'ri-calendar-line' },
    { value: 'number',   label: 'Number',   icon: 'ri-money-dollar-circle-line' },
    { value: 'textarea', label: 'Textarea', icon: 'ri-chat-1-line' },
  ];

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const trimmed = name.trim();
    if (!trimmed) {
      e.name = 'Field name is required';
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      e.name = 'No spaces — use PascalCase (e.g. LastWorkingDate)';
    } else if (trimmed.length > NAME_MAX) {
      e.name = `Field name must be ${NAME_MAX} characters or fewer (currently ${trimmed.length}).`;
    } else if (
      // Case-insensitive duplicate check, excluding the field being edited so
      // re-saving an unchanged name doesn't false-positive.
      existingNames.some(n => n.trim().toLowerCase() === trimmed.toLowerCase()
        && n.trim().toLowerCase() !== (initial?.name || '').trim().toLowerCase())
    ) {
      e.name = 'A field with this name already exists';
    }
    // Character limits mirror the server rules (description / used_in_hint
    // max:500) so they surface inline here instead of as a post-save toast.
    if (description.trim().length > TEXT_MAX) {
      e.description = `Description must be ${TEXT_MAX} characters or fewer (currently ${description.trim().length}).`;
    }
    if (usedInHint.trim().length > TEXT_MAX) {
      e.used_in_hint = `Used in Templates must be ${TEXT_MAX} characters or fewer (currently ${usedInHint.trim().length}).`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate() || saving) return;
    // BUG-108: show a loading state while the parent persists the field. The
    // parent's onSave is async (PUT/POST), so await it and keep the spinner up
    // until it resolves; on error the modal stays open and re-enables the button.
    try {
      setSaving(true);
      await onSave({
        id: initial?.id,
        name: name.trim(),
        type,
        description: description.trim(),
        used_in_hint: usedInHint.trim(),
      });
    } catch (err: any) {
      // A server-side rejection (e.g. the unique constraint racing the
      // client-side check) is surfaced inline under Field Name, not as a
      // toast — keeps the modal open with the warning where the user is looking.
      setErrors(prev => ({ ...prev, name: err?.message || 'A field with this name already exists' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes cfm-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cfm-pop  { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
        /* Backdrop, frame, header and buttons all take their numbers from the
           shared violet popup (LFM_CSS .lfm-purple) so this form reads as the
           same component family as Filter Leaves / Filter Holidays. */
        .cfm-overlay {
          position: fixed; inset: 0; z-index: 1060;
          display: flex; align-items: center; justify-content: center; padding: 20px;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          animation: cfm-fade .18s ease both;
        }
        .cfm-popup {
          width: 100%; max-width: 640px; background: #fff; border-radius: 22px;
          overflow: hidden;
          box-shadow: 0 24px 60px rgba(139,92,246,.18), 0 8px 24px rgba(15,23,42,.20);
          animation: cfm-pop .22s cubic-bezier(.22,1,.36,1) both;
        }
        /* Decorative orbs clipped by the header — the same two the shared
           popup carries. */
        .cfm-head { position: relative; overflow: hidden; }
        .cfm-head::before {
          content: ''; position: absolute; right: -35px; top: -35px;
          width: 130px; height: 130px; border-radius: 50%;
          background: rgba(255,255,255,.06); pointer-events: none;
        }
        .cfm-head::after {
          content: ''; position: absolute; right: 70px; bottom: -45px;
          width: 90px; height: 90px; border-radius: 50%;
          background: rgba(255,255,255,.04); pointer-events: none;
        }
        .cfm-head > * { position: relative; z-index: 1; }
        .cfm-input:focus {
          border-color: #a78bfa; outline: none;
          box-shadow: 0 0 0 3px rgba(139,92,246,.16);
        }
        .cfm-type-tile { transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
        .cfm-type-tile:hover:not(.is-active) { border-color: #ddd6fe !important; background: #faf8ff !important; }
        /* Save Field + Close (X) hover feedback (BUG-108 / BUG-109). */
        .cfm-save-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 7px 20px rgba(139,92,246,0.45) !important; }
        .cfm-save-btn:active:not(:disabled) { transform: translateY(0); }
        .cfm-close-x:hover { background: rgba(255,255,255,0.32) !important; }
        /* BUG-108: loading spinner shown inside the Save button while persisting. */
        @keyframes cfm-spin { to { transform: rotate(360deg); } }
        .cfm-spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.45);
          border-top-color: #fff;
          animation: cfm-spin 0.6s linear infinite;
          display: inline-block;
        }

        [data-bs-theme="dark"] .cfm-overlay,
        [data-layout-mode="dark"] .cfm-overlay { background: rgba(2, 6, 23, 0.55); }
        [data-bs-theme="dark"] .cfm-popup,
        [data-layout-mode="dark"] .cfm-popup {
          background: #1f2937 !important;
          box-shadow: 0 25px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);
        }
        [data-bs-theme="dark"] .cfm-body,
        [data-layout-mode="dark"] .cfm-body { background: #1f2937 !important; }
        /* No background: the footer takes the body's, so the two cannot drift
           apart. It used to be #111827 against the body's #1f2937, which read
           as a separate panel bolted under the fields. */
        [data-bs-theme="dark"] .cfm-footer,
        [data-layout-mode="dark"] .cfm-footer {
          background: #1f2937 !important;
          border-top-color: rgba(255,255,255,0.08) !important;
        }
        [data-bs-theme="dark"] .cfm-label,
        [data-layout-mode="dark"] .cfm-label { color: rgba(255,255,255,0.65) !important; }
        [data-bs-theme="dark"] .cfm-input,
        [data-layout-mode="dark"] .cfm-input {
          background: var(--vz-card-bg) !important;
          border-color: var(--vz-border-color) !important;
          color: #f1f5f9 !important;
        }
        [data-bs-theme="dark"] .cfm-input::placeholder,
        [data-layout-mode="dark"] .cfm-input::placeholder { color: rgba(255,255,255,0.35) !important; }
        [data-bs-theme="dark"] .cfm-input:focus,
        [data-layout-mode="dark"] .cfm-input:focus {
          border-color: rgba(139,92,246,0.6) !important;
          outline: none;
          box-shadow: 0 0 0 3px rgba(139,92,246,0.18);
        }
        [data-bs-theme="dark"] .cfm-helper,
        [data-layout-mode="dark"] .cfm-helper { color: rgba(255,255,255,0.5) !important; }
        [data-bs-theme="dark"] .cfm-helper code,
        [data-layout-mode="dark"] .cfm-helper code {
          background: rgba(139,92,246,0.18) !important;
          color: #c4b5fd !important;
        }
        [data-bs-theme="dark"] .cfm-type-tile,
        [data-layout-mode="dark"] .cfm-type-tile {
          background: #0f172a !important;
          border-color: rgba(255,255,255,0.10) !important;
        }
        [data-bs-theme="dark"] .cfm-type-tile.is-active,
        [data-layout-mode="dark"] .cfm-type-tile.is-active {
          background: rgba(139,92,246,0.18) !important;
          border-color: #a78bfa !important;
        }
        [data-bs-theme="dark"] .cfm-type-tile .cfm-type-icon,
        [data-layout-mode="dark"] .cfm-type-tile .cfm-type-icon { color: rgba(255,255,255,0.55) !important; }
        [data-bs-theme="dark"] .cfm-type-tile.is-active .cfm-type-icon,
        [data-layout-mode="dark"] .cfm-type-tile.is-active .cfm-type-icon { color: #ddd6fe !important; }
        [data-bs-theme="dark"] .cfm-type-tile .cfm-type-label,
        [data-layout-mode="dark"] .cfm-type-tile .cfm-type-label { color: rgba(255,255,255,0.78) !important; }
        [data-bs-theme="dark"] .cfm-type-tile.is-active .cfm-type-label,
        [data-layout-mode="dark"] .cfm-type-tile.is-active .cfm-type-label { color: #ede9fe !important; }
        [data-bs-theme="dark"] .cfm-type-tile:hover:not(.is-active),
        [data-layout-mode="dark"] .cfm-type-tile:hover:not(.is-active) {
          background: rgba(139,92,246,0.08) !important;
          border-color: rgba(139,92,246,0.35) !important;
        }
        [data-bs-theme="dark"] .cfm-info,
        [data-layout-mode="dark"] .cfm-info {
          background: rgba(139,92,246,0.12) !important;
          border-color: rgba(139,92,246,0.30) !important;
          color: #ddd6fe !important;
        }
        [data-bs-theme="dark"] .cfm-cancel,
        [data-layout-mode="dark"] .cfm-cancel {
          background: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.10) !important;
          color: #e2e8f0 !important;
        }
        [data-bs-theme="dark"] .cfm-cancel:hover,
        [data-layout-mode="dark"] .cfm-cancel:hover { background: rgba(255,255,255,0.10) !important; }
      `}</style>

      {/* Backdrop click does NOT dismiss — this form collects input that's
          easy to lose on a stray click. Close only via the × / Cancel button. */}
      <div className="cfm-overlay">
        <div className="cfm-popup" onClick={e => e.stopPropagation()}>
          {/* Gradient header */}
          <div className="cfm-head" style={{ padding: '14px 20px', background: 'linear-gradient(135deg,#6d28d9 0%,#8b5cf6 60%,#a78bfa 100%)', display: 'flex', alignItems: 'center', gap: 14, userSelect: 'none', cursor: 'default' }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.28)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ri-star-fill" style={{ fontSize: 18, color: '#fff' }} />
            </span>
            <div className="me-auto" style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, letterSpacing: '-.2px', lineHeight: 1.2 }}>{initial?.id ? 'Edit Custom Field' : 'Add Custom Field'}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>Variables used in templates — filled at document generation time</div>
            </div>
            {/* Closing mid-save would leave the request in flight with no modal
                to report back to — the same reason Cancel is disabled. (#10) */}
            <button type="button" onClick={onClose} disabled={saving} className="cfm-close-x"
              style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'rgba(255,255,255,0.16)', border: 0, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, transition: 'background .15s ease' }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>

          {/* Body.
              Wrapped in a disabled <fieldset> while saving (#10): only the two
              footer buttons were guarded, so the name, description, "used in"
              inputs and the type tiles all stayed live behind "Saving…" — a
              value typed there was never part of the request being sent and was
              silently discarded when the modal closed. A fieldset disables every
              control it contains in one place, so a field added later cannot be
              forgotten. `border:0;padding:0;margin:0` keeps it purely
              behavioural — a fieldset carries its own box styling otherwise. */}
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto' }}>
          <div className="cfm-body" style={{ padding: '16px 22px', opacity: saving ? 0.6 : 1, transition: 'opacity .15s ease' }}>
            <div className="mb-3">
              <label className="cfm-label" style={fieldLabel}>Field Name <span style={req}>*</span></label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. LastWorkingDate (no spaces)"
                className="cfm-input"
                style={inputStyle(!!errors.name)} />
              <div className="cfm-helper" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                No spaces — this becomes <code style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{'{{FieldName}}'}</code> in templates
              </div>
              {errors.name && <div style={errMsg}>{errors.name}</div>}
            </div>

            <div className="mb-3">
              <label className="cfm-label" style={fieldLabel}>Input Type <span style={req}>*</span></label>
              <div className="row g-2">
                {TYPE_OPTIONS.map(opt => {
                  const active = type === opt.value;
                  return (
                    <div key={opt.value} className="col-3">
                      <button type="button" onClick={() => setType(opt.value)}
                        className={`cfm-type-tile${active ? ' is-active' : ''}`}
                        style={{ width: '100%', height: 40, padding: '0 8px', borderRadius: 10, boxSizing: 'border-box',
                          border: '1.5px solid ' + (active ? '#8b5cf6' : '#e5e7eb'),
                          background: active ? '#f5f1fe' : '#fff',
                          boxShadow: active ? '0 0 0 3px rgba(139,92,246,.12)' : 'none',
                          cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                        <i className={`${opt.icon} cfm-type-icon`} style={{ fontSize: 16, lineHeight: 1, color: active ? '#6d28d9' : '#6b7280' }} />
                        <div className="cfm-type-label" style={{ fontSize: 13, fontWeight: 700, color: active ? '#6d28d9' : '#374151' }}>{opt.label}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mb-3">
              <label className="cfm-label" style={fieldLabel}>Description</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="What is this field for? (shown at generation time)"
                className="cfm-input"
                style={inputStyle(!!errors.description)} />
              <div className="d-flex justify-content-between align-items-center" style={{ marginTop: 4, gap: 8 }}>
                <span style={errMsg as React.CSSProperties}>{errors.description || ''}</span>
                <span style={{ fontSize: 11, color: description.trim().length > TEXT_MAX ? '#ef4444' : '#9ca3af', flexShrink: 0, marginLeft: 'auto' }}>
                  {description.trim().length}/{TEXT_MAX}
                </span>
              </div>
            </div>

            <div className="mb-3">
              <label className="cfm-label" style={fieldLabel}>Used in Templates</label>
              <input type="text" value={usedInHint} onChange={e => setUsedInHint(e.target.value)}
                placeholder="e.g. Relieving Letter, Experience Letter (comma separated)"
                className="cfm-input"
                style={inputStyle(!!errors.used_in_hint)} />
              <div className="d-flex justify-content-between align-items-center" style={{ marginTop: 4, gap: 8 }}>
                {errors.used_in_hint
                  ? <span style={errMsg as React.CSSProperties}>{errors.used_in_hint}</span>
                  : <div className="cfm-helper" style={{ fontSize: 11, color: '#9ca3af' }}>
                      Optional. Your hint for which templates this field is for. Actual references update automatically once a template uses <code style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{`{{${name || 'FieldName'}}}`}</code>.
                    </div>}
                <span style={{ fontSize: 11, color: usedInHint.trim().length > TEXT_MAX ? '#ef4444' : '#9ca3af', flexShrink: 0, marginLeft: 'auto' }}>
                  {usedInHint.trim().length}/{TEXT_MAX}
                </span>
              </div>
            </div>

          </div>
          </fieldset>

          {/* Footer */}
          <div className="cfm-footer" style={{ padding: '14px 22px', borderTop: '1px solid #eef2f7', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving} className="cfm-cancel"
              style={{ height: 40, padding: '0 18px', boxSizing: 'border-box', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#475569', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={saving} className="cfm-save-btn"
              style={{ height: 40, padding: '0 18px', boxSizing: 'border-box', background: 'linear-gradient(135deg,#a78bfa 0%,#8b5cf6 55%,#6d28d9 100%)', border: 0, borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff', cursor: saving ? 'progress' : 'pointer', boxShadow: '0 4px 14px rgba(139,92,246,.35), 0 1px 0 rgba(255,255,255,.18) inset', transition: 'transform .15s ease, box-shadow .2s ease, filter .15s ease', opacity: saving ? 0.85 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {saving && <span className="cfm-spinner" />}
              {saving ? 'Saving…' : 'Save Field'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 10.5px, as .rec-form-label is on every other HRMS form.
const fieldLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, display: 'block' };
const req: React.CSSProperties = { color: '#ef4444' };
function inputStyle(error: boolean): React.CSSProperties {
  return {
    // 40px, matching the type tiles and footer buttons — the whole dialog is
    // one control height. Radius 10 to match the tiles beside them.
    width: '100%', height: 40, padding: '0 12px', borderRadius: 10, boxSizing: 'border-box',
    border: '1px solid ' + (error ? '#ef4444' : '#e5e7eb'),
    fontSize: 13, background: '#fff', lineHeight: 1.4,
    boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
    transition: 'border-color .15s, box-shadow .15s',
  };
}
const errMsg: React.CSSProperties = { fontSize: 11.5, color: '#ef4444', marginTop: 4 };
