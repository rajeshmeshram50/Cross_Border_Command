import { useState } from 'react';

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

  const [name, setName]               = useState(initial?.name || prefillName || '');
  const [type, setType]               = useState<CustomFieldType>(initial?.type || 'text');
  const [description, setDescription] = useState(initial?.description || '');
  const [usedInHint, setUsedInHint]   = useState(initial?.used_in_hint || '');
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);

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
    } else if (
      // Case-insensitive duplicate check, excluding the field being edited so
      // re-saving an unchanged name doesn't false-positive.
      existingNames.some(n => n.trim().toLowerCase() === trimmed.toLowerCase()
        && n.trim().toLowerCase() !== (initial?.name || '').trim().toLowerCase())
    ) {
      e.name = 'A field with this name already exists';
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
        .cfm-overlay {
          position: fixed; inset: 0; z-index: 1060;
          display: flex; align-items: center; justify-content: center; padding: 20px;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: cfm-fade .18s ease both;
        }
        .cfm-popup {
          width: 100%; max-width: 640px; background: #fff; border-radius: 16px;
          overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.25);
          animation: cfm-pop .22s cubic-bezier(.22,1,.36,1) both;
        }
        .cfm-type-tile { transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
        .cfm-type-tile:hover:not(.is-active) { border-color: #c7d2fe !important; background: #fafaff !important; }
        /* Save Field + Close (X) hover feedback (BUG-108 / BUG-109). */
        .cfm-save-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 7px 20px rgba(99,102,241,0.45) !important; }
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
        [data-bs-theme="dark"] .cfm-footer,
        [data-layout-mode="dark"] .cfm-footer {
          background: #111827 !important;
          border-top-color: rgba(255,255,255,0.08) !important;
        }
        [data-bs-theme="dark"] .cfm-label,
        [data-layout-mode="dark"] .cfm-label { color: rgba(255,255,255,0.65) !important; }
        [data-bs-theme="dark"] .cfm-input,
        [data-layout-mode="dark"] .cfm-input {
          background: #0f172a !important;
          border-color: rgba(255,255,255,0.10) !important;
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
          background: rgba(99,102,241,0.18) !important;
          border-color: #818cf8 !important;
        }
        [data-bs-theme="dark"] .cfm-type-tile .cfm-type-icon,
        [data-layout-mode="dark"] .cfm-type-tile .cfm-type-icon { color: rgba(255,255,255,0.55) !important; }
        [data-bs-theme="dark"] .cfm-type-tile.is-active .cfm-type-icon,
        [data-layout-mode="dark"] .cfm-type-tile.is-active .cfm-type-icon { color: #c7d2fe !important; }
        [data-bs-theme="dark"] .cfm-type-tile .cfm-type-label,
        [data-layout-mode="dark"] .cfm-type-tile .cfm-type-label { color: rgba(255,255,255,0.78) !important; }
        [data-bs-theme="dark"] .cfm-type-tile.is-active .cfm-type-label,
        [data-layout-mode="dark"] .cfm-type-tile.is-active .cfm-type-label { color: #e0e7ff !important; }
        [data-bs-theme="dark"] .cfm-type-tile:hover:not(.is-active),
        [data-layout-mode="dark"] .cfm-type-tile:hover:not(.is-active) {
          background: rgba(99,102,241,0.08) !important;
          border-color: rgba(99,102,241,0.35) !important;
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
          <div style={{ padding: '13px 22px', background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)', display: 'flex', alignItems: 'center', gap: 14, userSelect: 'none', cursor: 'default' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ri-star-fill" style={{ fontSize: 22, color: '#fff' }} />
            </span>
            <div className="me-auto">
              <h5 className="mb-0 fw-bold" style={{ color: '#fff' }}>{initial?.id ? 'Edit Custom Field' : 'Add Custom Field'}</h5>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.9)' }}>Variables used in templates — filled at document generation time</div>
            </div>
            <button type="button" onClick={onClose} className="cfm-close-x"
              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', cursor: 'pointer', transition: 'background .15s ease' }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>

          {/* Body */}
          <div className="cfm-body" style={{ padding: '16px 22px' }}>
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
                        style={{ width: '100%', padding: '12px 6px', borderRadius: 10,
                          border: '2px solid ' + (active ? '#6366f1' : '#e5e7eb'),
                          background: active ? '#eef2ff' : '#fff',
                          cursor: 'pointer', textAlign: 'center' }}>
                        <i className={`${opt.icon} cfm-type-icon`} style={{ fontSize: 18, color: active ? '#4338ca' : '#6b7280', display: 'block', marginBottom: 4 }} />
                        <div className="cfm-type-label" style={{ fontSize: 12, fontWeight: 700, color: active ? '#4338ca' : '#374151' }}>{opt.label}</div>
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
                style={inputStyle(false)} />
            </div>

            <div className="mb-3">
              <label className="cfm-label" style={fieldLabel}>Used in Templates</label>
              <input type="text" value={usedInHint} onChange={e => setUsedInHint(e.target.value)}
                placeholder="e.g. Relieving Letter, Experience Letter (comma separated)"
                className="cfm-input"
                style={inputStyle(false)} />
              <div className="cfm-helper" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                Optional. Your hint for which templates this field is for. Actual references update automatically once a template uses <code style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{`{{${name || 'FieldName'}}}`}</code>.
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="cfm-footer" style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={saving} className="cfm-cancel"
              style={{ padding: '8px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={saving} className="cfm-save-btn"
              style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: saving ? 'progress' : 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)', transition: 'transform .15s ease, box-shadow .2s ease, filter .15s ease', opacity: saving ? 0.85 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {saving && <span className="cfm-spinner" />}
              {saving ? 'Saving…' : 'Save Field'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const fieldLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6, display: 'block' };
const req: React.CSSProperties = { color: '#ef4444' };
function inputStyle(error: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid ' + (error ? '#ef4444' : '#e5e7eb'),
    fontSize: 13.5, background: '#fff', lineHeight: 1.4,
  };
}
const errMsg: React.CSSProperties = { fontSize: 11.5, color: '#ef4444', marginTop: 4 };
