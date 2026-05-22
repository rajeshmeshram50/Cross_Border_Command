import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';

/* ────────────────────────────────────────────────────────────────────────────
 * Generic entity-picker popup — used by the Lead Detail action row to
 * surface "pick an existing record OR add a new one" flows for Customer
 * and Consignee buttons.
 *
 *   • Dropdown of existing entities (label + value).
 *   • A "+" button next to the dropdown opens the Add form.
 *   • Picking from the dropdown opens the Edit form for that row.
 *
 * Caller decides what "Add" and "Edit" mean by passing onAdd / onEdit
 * handlers — the picker itself is form-agnostic and works for any
 * entity that ships a {value,label} list.
 * ──────────────────────────────────────────────────────────────────────── */

export type PickerOption = { value: string; label: string };

export default function EntityPickerModal(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Placeholder shown on the dropdown when nothing is picked yet. */
  placeholder?: string;
  /** Label rendered above the dropdown. */
  fieldLabel?: string;
  /** Options for the dropdown. */
  options: PickerOption[];
  /** True while the options list is being fetched. */
  loading?: boolean;
  /** Empty-state copy when `options` is empty (and not loading). */
  emptyHint?: string;
  /** Tooltip / aria-label on the "+" button. */
  addLabel?: string;
  /** Fires when the user clicks the "+" button. */
  onAdd: () => void;
  /** Fires when the user picks an option from the dropdown. */
  onEdit: (option: PickerOption) => void;
  onClose: () => void;
}) {
  const {
    open, title, subtitle, placeholder, fieldLabel,
    options, loading, emptyHint,
    addLabel, onAdd, onEdit, onClose,
  } = props;

  const toast = useToast();
  const [selected, setSelected] = useState<string>('');

  // Reset selection each time the popup opens so a previous session's
  // pick doesn't leak into the next.
  useEffect(() => { if (open) setSelected(''); }, [open]);

  if (!open) return null;

  const handlePick = (value: string) => {
    setSelected(value);
    const opt = options.find(o => o.value === value);
    if (!opt) {
      toast.error('Selection invalid', 'Pick a value from the list');
      return;
    }
    onEdit(opt);
  };

  return createPortal((
    <div className="epm-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="epm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="epm-head">
          <div className="epm-head-left">
            <div className="epm-head-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div>
              <div className="epm-head-title">{title}</div>
              {subtitle && <div className="epm-head-sub">{subtitle}</div>}
            </div>
          </div>
          <button className="epm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="epm-body">
          {fieldLabel && <label className="epm-label">{fieldLabel}</label>}
          <div className="epm-row">
            <div className="epm-select-wrap">
              <MasterSelect
                value={selected}
                onChange={handlePick}
                options={options}
                placeholder={
                  loading
                    ? 'Loading…'
                    : options.length === 0
                      ? (emptyHint ?? 'No records available')
                      : (placeholder ?? 'Select a record')
                }
                disabled={loading || options.length === 0}
              />
            </div>
            <button
              type="button"
              className="epm-add-btn"
              onClick={onAdd}
              aria-label={addLabel ?? 'Add new'}
              title={addLabel ?? 'Add new'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="epm-helper">
            Select an existing record to edit, or click <strong>+</strong> to create a new one.
          </div>
        </div>

        <div className="epm-foot">
          <button className="epm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ── Scoped styles ──────────────────────────────────────────────────────── */
const SCOPED_CSS = `
.epm-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.epm-modal {
  margin: auto;
  width: 100%; max-width: 560px;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.epm-modal *, .epm-modal *::before, .epm-modal *::after { box-sizing: border-box; }

.epm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
}
.epm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.epm-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.epm-head-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.epm-head-sub   { font-size: 11.5px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
.epm-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
}
.epm-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.epm-body {
  padding: 20px;
  display: flex; flex-direction: column; gap: 8px;
  background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);
}
.epm-label {
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #5b21b6;
}
.epm-row {
  display: flex; align-items: stretch; gap: 8px;
}
.epm-select-wrap {
  position: relative; flex: 1; min-width: 0;
}
.epm-select {
  width: 100%; height: 42px;
  padding: 8px 36px 8px 14px;
  appearance: none; -webkit-appearance: none;
  border: 1.5px solid #ddd6fe;
  border-radius: 10px;
  background: #fff;
  color: #1e1b4b;
  font-family: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.epm-select:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.epm-select:disabled {
  background: #f5f3ff; cursor: not-allowed; color: #94a3b8;
}
.epm-select-arrow {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font-size: 18px; color: #7c3aed; pointer-events: none;
}
.epm-add-btn {
  flex-shrink: 0;
  width: 42px; height: 42px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
  transition: transform .15s ease, box-shadow .15s ease;
}
.epm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124, 58, 237, .45); }

.epm-helper {
  font-size: 11.5px; color: #6b7280;
  margin-top: 4px;
}
.epm-helper strong {
  font-weight: 700; color: #7c3aed;
}

.epm-foot {
  display: flex; justify-content: flex-end;
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.epm-btn-ghost {
  height: 36px; padding: 0 18px;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
  border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.epm-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .epm-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .epm-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .epm-foot  { background: #1a1538; border-top-color: #2a2150; }
[data-bs-theme="dark"] .epm-label { color: #c4b5fd; }
[data-bs-theme="dark"] .epm-select {
  background: #2a2150; border-color: #3b2a6b; color: #ede9fe;
}
[data-bs-theme="dark"] .epm-select:disabled { background: #1a1538; color: #6b7280; }
[data-bs-theme="dark"] .epm-select-arrow { color: #c4b5fd; }
[data-bs-theme="dark"] .epm-helper { color: #94a3b8; }
[data-bs-theme="dark"] .epm-helper strong { color: #c4b5fd; }
[data-bs-theme="dark"] .epm-btn-ghost { background: transparent; color: #cbd5e1; border-color: #3b2a6b; }
[data-bs-theme="dark"] .epm-btn-ghost:hover { background: #2a2150; border-color: #4338ca; }
`;
