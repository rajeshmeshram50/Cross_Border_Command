import { useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import '../../components/ui/MasterSelect.css';
import SearchClear from '../../components/ui/SearchClear';

export { MasterSelect } from '../../components/ui/MasterSelect';
export { MasterDatePicker } from '../../components/ui/MasterDatePicker';

const CHIPSTRIP_CSS = `
.master-multi-chipstrip { scrollbar-width: none; -ms-overflow-style: none; }
.master-multi-chipstrip::-webkit-scrollbar { width: 0; height: 0; display: none; }
[data-bs-theme="dark"] .master-multi-chip {
  background: transparent !important;
  color: #ddd6fe !important;
  border: 1px solid rgba(167,139,250,0.40) !important;
}
[data-bs-theme="dark"] .master-multi-chip [role="button"] { color: #ede9fe !important; opacity: .85; }
[data-bs-theme="dark"] .master-multi-chip [role="button"]:hover { opacity: 1; }
[data-bs-theme="dark"] .master-multi-more {
  background: rgba(124,58,237,0.26) !important;
  color: #ddd6fe !important;
  border-color: rgba(167,139,250,0.50) !important;
}
`;

export function MasterMultiSelect({
  name,
  value,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  onChange,
  maxChips = 3,
  lockedValues,
  disabledValues,
  disabledHint,
  emptyText,
  renderBadges,
  onOpen,
  menuClassName,
}: {
  menuClassName?: string;
  name?: string;
  value: string[];
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (value: string[]) => void;
  maxChips?: number;
  renderBadges?: (value: string) => React.ReactNode;
  lockedValues?: string[];
  disabledValues?: string[];
  disabledHint?: string;
  emptyText?: string;
  onOpen?: () => void;
}) {
  const lockedSet = new Set(lockedValues ?? []);
  const disabledSet = new Set(disabledValues ?? []);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropDir, setDropDir] = useState<'up' | 'down'>('down');
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
    const closeOnResize = () => setOpen(false);
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && t instanceof HTMLElement && t.closest?.('.master-select-menu')) return;
      setOpen(false);
    };
    window.addEventListener('resize', closeOnResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', closeOnResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const selectedSet = new Set(value);
  const selectedOptions = options.filter(o => selectedSet.has(o.value));
  const showSearch = options.length > 4;
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const toggleVal = (v: string) => {
    if (selectedSet.has(v) && lockedSet.has(v)) return;
    if (!selectedSet.has(v) && disabledSet.has(v)) return;
    const next = selectedSet.has(v) ? value.filter(x => x !== v) : [...value, v];
    onChange?.(next);
  };
  const removeVal = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (lockedSet.has(v)) return;
    onChange?.(value.filter(x => x !== v));
  };

  return (
    <div ref={wrapRef}>
      <style>{CHIPSTRIP_CSS}</style>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => {
          if (disabled) return;
          setOpen(v => {
            if (!v) onOpen?.();
            return !v;
          });
        }}
        direction={dropDir}
        className={`master-select-wrap${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle
          tag="button"
          type="button"
          disabled={disabled}
          className="master-select-toggle"
          style={{ minHeight: 38, padding: '4px 12px' }}
        >
          {selectedOptions.length === 0 ? (
            <span className="master-select-placeholder">{placeholder}</span>
          ) : (
            <span
              className="d-inline-flex align-items-center gap-1"
              style={{ flexWrap: 'nowrap', overflow: 'hidden', maxWidth: '100%', minWidth: 0, flex: '1 1 auto' }}
            >
              <span
                className={`d-inline-flex align-items-center gap-1${expanded ? ' master-multi-chipstrip' : ''}`}
                style={{
                  flex: '1 1 auto',
                  flexWrap: 'nowrap', minWidth: 0,
                  overflowX: expanded ? 'auto' : 'hidden',
                  overflowY: 'hidden',
                }}
              >
                {(expanded ? selectedOptions : selectedOptions.slice(0, maxChips)).map(o => (
                  <span
                    key={o.value}
                    title={o.label}
                    className="d-inline-flex align-items-center master-multi-chip"
                    style={{
                      background: 'transparent',
                      color: '#4338ca',
                      border: '1px solid #c7d2fe',
                      padding: '2px 6px 2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      maxWidth: expanded ? 200 : 130,
                      minWidth: 0,
                      flexShrink: expanded ? 0 : 1,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                    {lockedSet.has(o.value) ? (
                      <i
                        className="ri-lock-2-line"
                        title="Documents uploaded — can't be removed"
                        style={{ marginLeft: 4, fontSize: 12, flexShrink: 0, opacity: 0.7 }}
                      />
                    ) : (
                      <span
                        role="button"
                        onClick={(e) => removeVal(o.value, e)}
                        style={{ marginLeft: 4, cursor: 'pointer', lineHeight: 1, fontSize: 14, flexShrink: 0 }}
                        aria-label={`Remove ${o.label}`}
                      >
                        ×
                      </span>
                    )}
                  </span>
                ))}
              </span>
              {selectedOptions.length > maxChips && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault(); e.stopPropagation();
                      setExpanded(v => !v);
                    }
                  }}
                  title={expanded ? 'Show less' : `Show all ${selectedOptions.length} — ${selectedOptions.slice(maxChips).map(o => o.label).join(', ')}`}
                  className="master-multi-more"
                  style={{
                    fontSize: 10, fontWeight: 600, lineHeight: 1.2,
                    padding: '1px 6px', borderRadius: 10,
                    background: '#eef2ff', color: '#4338ca',
                    cursor: 'pointer', userSelect: 'none',
                    border: '1px solid #c7d2fe',
                    flexShrink: 0, whiteSpace: 'nowrap',
                  }}
                >
                  {expanded ? 'Show less' : `+${selectedOptions.length - maxChips} more`}
                </span>
              )}
            </span>
          )}
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        <DropdownMenu
          className={`master-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
          container="body"
          strategy="fixed"
          modifiers={[
            { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8, altAxis: true } },
            { name: 'flip', options: { boundary: 'viewport', fallbackPlacements: ['top', 'bottom'] } },
          ] as any}
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
                autoComplete="off"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                autoFocus
              />
              <SearchClear show={search} onClear={() => { setSearch(''); }} />
            </div>
          )}
          <div className="master-select-list" style={{ maxHeight: 203 }}>
            {filtered.length === 0 ? (
              <div className="master-select-empty">
                {options.length === 0 ? (emptyText ?? 'No options') : 'No results'}
              </div>
            ) : filtered.map(opt => {
              const checked = selectedSet.has(opt.value);
              const locked = checked && lockedSet.has(opt.value);
              const unusable = !checked && disabledSet.has(opt.value);
              return (
                <DropdownItem
                  key={opt.value}
                  toggle={false}
                  active={checked}
                  disabled={locked || unusable}
                  onClick={() => toggleVal(opt.value)}
                  className="master-select-item d-flex align-items-center"
                  title={locked
                    ? `${opt.label} — documents uploaded, can't be removed`
                    : unusable
                      ? `${opt.label}${disabledHint ? ` — ${disabledHint}` : ''}`
                      : opt.label}
                  style={unusable ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                >
                  <span className={`master-select-check${checked ? ' is-on' : ''}`}>
                    {checked && <i className="ri-check-line" />}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.label}
                  </span>
                  {renderBadges && !unusable && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
                      {renderBadges(opt.value)}
                    </span>
                  )}
                  {locked && <i className="ri-lock-2-line" style={{ fontSize: 12, opacity: 0.6, marginLeft: 6, flexShrink: 0 }} />}
                  {unusable && (
                    <span
                      style={{
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '.02em',
                        padding: '1px 6px', borderRadius: 10, marginLeft: 6, flexShrink: 0,
                        background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      No rule
                    </span>
                  )}
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

export function MasterFormStyles() {
  return <style>{MASTER_MODAL_CSS}</style>;
}

export const MASTER_MODAL_CSS = `
  .mp-seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border: 1px solid var(--vz-border-color); border-radius: 12px; background: var(--vz-light, #f3f6f9); }
  .mp-seg__opt { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; margin: 0; padding: 0 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: var(--vz-secondary-color); cursor: pointer; text-align: center; transition: background .15s, color .15s, box-shadow .15s; }
  .mp-seg__opt input { position: absolute; opacity: 0; pointer-events: none; }
  .mp-seg__opt:hover:not(.is-on):not(.is-disabled) { color: var(--vz-heading-color, var(--vz-body-color)); background: rgba(64, 81, 137, .06); }
  .mp-seg__dot { width: 14px; height: 14px; flex-shrink: 0; border-radius: 50%; border: 2px solid #94a3b8; transition: border-color .15s, box-shadow .15s; }
  .mp-seg__opt.is-on { color: #fff; background: linear-gradient(135deg, #405189, #5b73e8); box-shadow: 0 4px 12px -4px rgba(64, 81, 137, .55); }
  .mp-seg__opt.is-on .mp-seg__dot { border-color: #fff; box-shadow: inset 0 0 0 3px #4a5fb3, inset 0 0 0 7px #fff; }
  .mp-seg__opt.is-disabled { cursor: not-allowed; opacity: .65; }
  .mp-seg__opt:has(input:focus-visible) { outline: 2px solid var(--vz-primary); outline-offset: 2px; }
  [data-bs-theme="dark"] .mp-seg { background: rgba(255, 255, 255, .04); border-color: rgba(255, 255, 255, .12); }
  [data-bs-theme="dark"] .mp-seg__opt:hover:not(.is-on):not(.is-disabled) { background: rgba(255, 255, 255, .06); }
  [data-bs-theme="dark"] .mp-seg__dot { border-color: #64748b; }
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
  .master-select-toggle {
    background: var(--vz-card-bg, #fff);
    color: var(--vz-body-color);
  }
  .master-select-toggle:disabled {
    background: var(--vz-secondary-bg, #f3f4f6);
    color: var(--vz-secondary-color);
  }

  .master-modal .master-select-toggle:not(:disabled) {
    background: color-mix(in srgb, #6691e7 5%, var(--vz-card-bg)) !important;
  }
  .master-modal .master-select-wrap:not(.show):not(.invalid) .master-select-toggle:not(:disabled) {
    border-color: color-mix(in srgb, #6691e7 20%, var(--vz-border-color)) !important;
  }
  [data-bs-theme="dark"] .master-modal .master-select-toggle:not(:disabled),
  [data-layout-mode="dark"] .master-modal .master-select-toggle:not(:disabled) {
    background: color-mix(in srgb, #6691e7 12%, var(--vz-card-bg)) !important;
  }

  [data-bs-theme="dark"] .hrms-modal .modal-content,
  [data-layout-mode="dark"] .hrms-modal .modal-content {
    background: color-mix(in srgb, #000 24%, var(--vz-card-bg));
  }
  [data-bs-theme="dark"] .hrms-modal .master-field .form-control,
  [data-bs-theme="dark"] .hrms-modal .master-field .form-select,
  [data-bs-theme="dark"] .hrms-modal .master-select-toggle:not(:disabled),
  [data-bs-theme="dark"] .hrms-modal .master-datepicker-toggle,
  [data-layout-mode="dark"] .hrms-modal .master-field .form-control,
  [data-layout-mode="dark"] .hrms-modal .master-field .form-select,
  [data-layout-mode="dark"] .hrms-modal .master-select-toggle:not(:disabled),
  [data-layout-mode="dark"] .hrms-modal .master-datepicker-toggle {
    background: var(--vz-card-bg) !important;
    border-color: var(--vz-border-color) !important;
    color: var(--vz-body-color) !important;
  }
  [data-bs-theme="dark"] .hrms-modal .master-field .form-control:focus,
  [data-layout-mode="dark"] .hrms-modal .master-field .form-control:focus {
    background: var(--vz-card-bg) !important;
  }

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
    border: 1.5px solid #94a3b8;
    box-shadow: 0 1px 2px rgba(18,38,63,0.04), inset 0 1px 1px rgba(255,255,255,0.04);
    transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
  }
  [data-bs-theme="dark"] .master-modal .form-control,
  [data-bs-theme="dark"] .master-modal .form-select {
    border-color: var(--vz-border-color);
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
    border: 1.5px solid #ced4da;
    color: var(--vz-heading-color, var(--vz-body-color));
    font-weight: 600;
    padding: 8px 22px;
    border-radius: 999px;
    transition: all .2s ease;
  }
  [data-bs-theme="dark"] .master-modal-cancel { border-color: rgba(255,255,255,0.28); }
  .master-modal-cancel:hover {
    background: #fef2f2;
    border-color: #f87171;
    color: #b91c1c;
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(239,68,68,0.15);
  }
  [data-bs-theme="dark"] .master-modal-cancel:hover {
    background: rgba(239,68,68,0.14);
    border-color: rgba(252,165,165,0.55);
    color: #fca5a5;
    box-shadow: 0 4px 12px rgba(0,0,0,0.40);
  }

  .master-modal-save {
    background: linear-gradient(120deg, #405189 0%, #6691e7 100%) !important;
    color: #fff !important;
    border: none !important;
    font-weight: 600;
    padding: 8px 22px !important;
    border-radius: 999px !important;
    box-shadow: 0 4px 12px rgba(64,81,137,0.30);
    transition: transform .2s ease, box-shadow .2s ease, filter .2s ease;
    display: inline-flex; align-items: center; justify-content: center;
    gap: 8px;
    white-space: nowrap;
  }
  .master-modal-save:hover:not(:disabled) {
    transform: translateY(-1.5px);
    box-shadow: 0 8px 20px rgba(64,81,137,0.45);
    filter: brightness(1.08);
    color: #fff !important;
  }
  .master-modal-save:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 3px 8px rgba(64,81,137,0.30);
  }
  .master-modal-save:disabled {
    opacity: 0.75;
    cursor: wait;
    transform: none;
  }
  [data-bs-theme="dark"] .master-modal-save {
    box-shadow: 0 4px 14px rgba(0,0,0,0.45);
  }
  [data-bs-theme="dark"] .master-modal-save:hover:not(:disabled) {
    box-shadow: 0 8px 22px rgba(0,0,0,0.55);
  }

  [data-bs-theme="dark"] .master-multi-more {
    background: rgba(124,58,237,0.22) !important;
    color: #ddd6fe !important;
    border-color: rgba(167,139,250,0.45) !important;
  }
  [data-bs-theme="dark"] .master-multi-more:hover {
    background: rgba(124,58,237,0.32) !important;
    color: #fff !important;
  }
  .master-multi-more:hover { filter: brightness(.97); }

  .master-select-toggle > span.d-inline-flex.flex-wrap {
    flex-wrap: nowrap !important;
    max-width: 100%;
    overflow-x: auto !important;
    overflow-y: hidden;
    padding-bottom: 2px;
    scrollbar-width: thin;
    scrollbar-color: #c4b5fd transparent;
  }
  .master-select-toggle > span.d-inline-flex.flex-wrap > span { flex-shrink: 0; }
  .master-select-toggle > span.d-inline-flex.flex-wrap::-webkit-scrollbar { height: 4px; }
  .master-select-toggle > span.d-inline-flex.flex-wrap::-webkit-scrollbar-thumb {
    background: #c4b5fd; border-radius: 6px;
  }
  [data-bs-theme="dark"] .master-select-toggle > span.d-inline-flex.flex-wrap {
    scrollbar-color: rgba(167,139,250,0.45) transparent;
  }
  [data-bs-theme="dark"] .master-select-toggle > span.d-inline-flex.flex-wrap::-webkit-scrollbar-thumb {
    background: rgba(167,139,250,0.45);
  }

  .master-lock { position: absolute; inset: 0; z-index: 20; border-radius: inherit; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.6); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); cursor: progress; }
  .master-lock__box { display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 13px; font-weight: 700; letter-spacing: .2px; color: #405189; }
  .master-lock__spin { width: 40px; height: 40px; border-radius: 50%; border: 3.5px solid rgba(64,81,137,.2); border-top-color: #5562c4; animation: masterLockSpin .7s linear infinite; }
  @keyframes masterLockSpin { to { transform: rotate(360deg); } }
  [data-bs-theme="dark"] .master-lock { background: rgba(15,18,32,.62); }
  [data-bs-theme="dark"] .master-lock__box { color: #c4b5fd; }
  [data-bs-theme="dark"] .master-lock__spin { border-color: rgba(167,139,250,.22); border-top-color: #a78bfa; }
  @media (prefers-reduced-motion: reduce) { .master-lock__spin { animation: none; } }
`;

export function MasterSavingLock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="master-lock">
      <div className="master-lock__box"><span className="master-lock__spin" />{label}</div>
    </div>
  );
}
