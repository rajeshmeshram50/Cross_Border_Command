import { useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
// Side-effect import: MasterMultiSelect (below) reuses .master-select-* classes,
// so the dropdown CSS must load whenever this module is imported — even when
// the consumer only pulls in MasterMultiSelect / MasterFileInput / MasterFormStyles.
import '../../components/ui/MasterSelect.css';

// MasterSelect and MasterDatePicker live in components/ui as standalone,
// reusable UI primitives. They are re-exported here so existing
// `from './master/masterFormKit'` imports keep working unchanged.
export { MasterSelect } from '../../components/ui/MasterSelect';
export { MasterDatePicker } from '../../components/ui/MasterDatePicker';

/**
 * Multi-select sibling of `MasterSelect`. Mirrors the styling 1:1 so the
 * two read as a single visual family. The picker is fully controlled —
 * `value` is an array of selected values, `onChange` returns a new
 * array. Items toggle on click; the toggle pill shows a chip strip
 * with the selected labels (truncates with `+N more` when crowded).
 */
export function MasterMultiSelect({
  name,
  value,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  onChange,
  maxChips = 3,
}: {
  name?: string;
  value: string[];
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (value: string[]) => void;
  maxChips?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropDir, setDropDir] = useState<'up' | 'down'>('down');
  // Mirror MasterSelect: track the trigger's width so the portalled menu
  // can be sized to match it (otherwise it stretches to the body width).
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setMenuWidth(rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const ESTIMATED_HEIGHT = 240;
      setDropDir(spaceBelow < ESTIMATED_HEIGHT && spaceAbove > spaceBelow ? 'up' : 'down');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  const selectedSet = new Set(value);
  const selectedOptions = options.filter(o => selectedSet.has(o.value));
  const showSearch = options.length > 4;
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const toggleVal = (v: string) => {
    const next = selectedSet.has(v) ? value.filter(x => x !== v) : [...value, v];
    onChange?.(next);
  };
  const removeVal = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(value.filter(x => x !== v));
  };

  return (
    <div ref={wrapRef}>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => { if (!disabled) setOpen(v => !v); }}
        direction={dropDir}
        className={`master-select-wrap${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle
          tag="button"
          type="button"
          disabled={disabled}
          className="master-select-toggle"
          style={{ minHeight: 38, padding: '4px 30px 4px 12px' }}
        >
          {selectedOptions.length === 0 ? (
            <span className="master-select-placeholder">{placeholder}</span>
          ) : (
            <span className="d-inline-flex align-items-center flex-wrap gap-1" style={{ overflow: 'hidden' }}>
              {selectedOptions.slice(0, maxChips).map(o => (
                <span
                  key={o.value}
                  className="d-inline-flex align-items-center"
                  style={{
                    background: '#eef2ff',
                    color: '#4338ca',
                    padding: '2px 6px 2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                    maxWidth: 180,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {o.label}
                  <span
                    role="button"
                    onClick={(e) => removeVal(o.value, e)}
                    style={{ marginLeft: 4, cursor: 'pointer', lineHeight: 1, fontSize: 14 }}
                    aria-label={`Remove ${o.label}`}
                  >
                    ×
                  </span>
                </span>
              ))}
              {selectedOptions.length > maxChips && (
                <span style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 600 }}>
                  +{selectedOptions.length - maxChips} more
                </span>
              )}
            </span>
          )}
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        <DropdownMenu
          className="master-select-menu"
          container="body"
          strategy="fixed"
          style={menuWidth ? { width: menuWidth, minWidth: menuWidth } : undefined}
        >
          {showSearch && (
            <div
              className="master-select-search"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <i className="ri-search-line master-select-search-icon" />
              <input
                type="text"
                className="master-select-search-input"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          <div className="master-select-list" style={{ maxHeight: 200 }}>
            {filtered.length === 0 ? (
              <div className="master-select-empty">
                {options.length === 0 ? 'No options' : 'No results'}
              </div>
            ) : filtered.map(opt => {
              const checked = selectedSet.has(opt.value);
              return (
                <DropdownItem
                  key={opt.value}
                  toggle={false}
                  active={checked}
                  onClick={() => toggleVal(opt.value)}
                  className="master-select-item d-flex align-items-center"
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: '1.5px solid ' + (checked ? '#7c5cfc' : '#cbd5e1'),
                      background: checked ? '#7c5cfc' : '#fff',
                      marginRight: 8,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked && <i className="ri-check-line" style={{ color: '#fff', fontSize: 12 }} />}
                  </span>
                  {opt.label}
                </DropdownItem>
              );
            })}
          </div>
        </DropdownMenu>
      </Dropdown>
      {name !== undefined && <input type="hidden" name={name} value={value.join(',')} />}
    </div>
  );
}


/**
 * Custom file input — replaces the native <input type="file"> (which renders
 * an ugly browser-default "Choose File / No file chosen" pair). Looks and
 * feels like the rest of the master-modal form: bordered pill-shaped frame
 * with a gradient "Choose File" button on the left, filename + size on the
 * right, and a clear (×) button once a file is selected.
 */
export function MasterFileInput({
  name,
  accept,
  required,
  disabled,
  invalid,
  onChange,
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    onChange?.(f);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (inputRef.current) inputRef.current.value = '';
    setFile(null);
    onChange?.(null);
  };

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      className={`master-file-input${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}${file ? ' has-file' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <span className="master-file-btn">
        <i className="ri-attachment-2" />
        <span>Choose File</span>
      </span>
      <span className={`master-file-name${file ? '' : ' is-empty'}`}>
        {file ? (
          <>
            <span className="master-file-name-text">{file.name}</span>
            <span className="master-file-size">· {formatSize(file.size)}</span>
          </>
        ) : (
          'No file chosen'
        )}
      </span>
      {file && !disabled && (
        <button
          type="button"
          className="master-file-clear"
          onClick={handleClear}
          aria-label="Clear file"
          title="Clear"
        >
          <i className="ri-close-line" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/** Style block shared by every master-modal form (render once per page) */
export function MasterFormStyles() {
  return <style>{MASTER_MODAL_CSS}</style>;
}

export const MASTER_MODAL_CSS = `
  .master-modal .modal-content {
    border-radius: 20px !important;
    overflow: hidden;
    border: 0;
  }
  .master-modal .modal-body {
    background:
      radial-gradient(circle at 0% 0%, rgba(99,102,241,0.05) 0%, transparent 40%),
      radial-gradient(circle at 100% 100%, rgba(14,165,233,0.04) 0%, transparent 40%),
      var(--vz-card-bg);
  }
  .master-modal label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #405189;
  }
  [data-bs-theme="dark"] .master-modal label,
  [data-layout-mode="dark"] .master-modal label {
    color: #8aa1d9;
  }
  .master-modal label .req-star {
    color: #f06548;
    font-weight: 700;
    margin-left: 1px;
  }
  /* Subtle blue tint on input backgrounds to match the branded modal header. */
  .master-modal .master-field .form-control,
  .master-modal .master-field .form-select {
    background: color-mix(in srgb, #6691e7 5%, var(--vz-card-bg)) !important;
    border-color: color-mix(in srgb, #6691e7 20%, var(--vz-border-color)) !important;
    transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .master-modal .master-field .form-control:focus,
  .master-modal .master-field .form-select:focus {
    background: var(--vz-card-bg) !important;
    border-color: #6691e7 !important;
    box-shadow: 0 0 0 3px rgba(102,145,231,0.18) !important;
  }
  [data-bs-theme="dark"] .master-modal .master-field .form-control,
  [data-bs-theme="dark"] .master-modal .master-field .form-select,
  [data-layout-mode="dark"] .master-modal .master-field .form-control,
  [data-layout-mode="dark"] .master-modal .master-field .form-select {
    background: color-mix(in srgb, #6691e7 12%, var(--vz-card-bg)) !important;
  }

  /* Prefix-icon input groups */
  .master-field { position: relative; }
  .master-field .form-control,
  .master-field .form-select {
    padding-left: 36px !important;
  }
  .master-field-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 15px;
    color: var(--vz-secondary-color);
    pointer-events: none;
    z-index: 3;
    line-height: 1;
    transition: color .18s ease, transform .18s ease;
  }
  .master-field.ta .master-field-icon {
    top: 12px;
    transform: none;
  }
  .master-field:has(.form-control:focus) .master-field-icon,
  .master-field:has(.form-select:focus) .master-field-icon {
    color: #6366f1;
  }
  .master-field:has(.form-control:focus) .master-field-icon:not(.ta),
  .master-field:has(.form-select:focus) .master-field-icon {
    transform: translateY(-50%) scale(1.08);
  }

  /* Auto-generated fields (e.g. Designation Code) — visually flagged so the
     user understands they can't edit it; the server fills it on save. */
  .master-field .form-control.master-field-auto {
    background: color-mix(in srgb, var(--vz-warning-rgb, 247, 184, 75) 12%, var(--vz-card-bg)) !important;
    color: var(--vz-warning, #f7b84b) !important;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: not-allowed;
  }
  [data-bs-theme="dark"] .master-field .form-control.master-field-auto,
  [data-layout-mode="dark"] .master-field .form-control.master-field-auto {
    background: color-mix(in srgb, var(--vz-warning, #f7b84b) 18%, var(--vz-card-bg)) !important;
    color: #ffd47a !important;
  }


  .master-modal .form-control,
  .master-modal .form-select {
    font-size: 13px;
    padding: 7px 12px;
    height: 38px;
    border-radius: 10px;
    background: var(--vz-card-bg);
    border: 1px solid var(--vz-border-color);
    box-shadow: 0 1px 2px rgba(18,38,63,0.04), inset 0 1px 1px rgba(255,255,255,0.04);
    transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
  }
  .master-modal textarea.form-control {
    height: auto;
    min-height: 72px;
  }
  .master-modal .form-control:hover:not(:disabled):not([readonly]):not(.is-invalid),
  .master-modal .form-select:hover:not(:disabled):not(.is-invalid) {
    border-color: rgba(99,102,241,0.55);
    box-shadow: 0 2px 6px rgba(99,102,241,0.08);
  }
  .master-modal .form-control:focus:not(.is-invalid),
  .master-modal .form-select:focus:not(.is-invalid) {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15), 0 4px 12px rgba(99,102,241,0.12);
  }
  .master-modal .form-control.is-invalid,
  .master-modal .form-select.is-invalid {
    border-color: #f06548;
    box-shadow: 0 0 0 3px rgba(240,101,72,0.15);
  }
  .master-modal .form-control:disabled,
  .master-modal .form-control[readonly],
  .master-modal .form-select:disabled {
    background: var(--vz-secondary-bg);
    color: var(--vz-secondary-color);
    cursor: not-allowed;
    box-shadow: none;
  }
  .master-modal .form-control::placeholder {
    color: var(--vz-secondary-color);
    opacity: 0.65;
  }

  .master-modal-cancel {
    background: transparent;
    border: 1.5px solid var(--vz-border-color);
    color: var(--vz-heading-color, var(--vz-body-color));
    font-weight: 600;
    padding: 8px 22px;
    border-radius: 999px;
    transition: all .2s ease;
  }
  .master-modal-cancel:hover {
    background: var(--vz-light);
    border-color: transparent;
    color: var(--vz-heading-color, var(--vz-body-color));
  }

`;
