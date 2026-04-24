import { useEffect, useState } from 'react';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';

/**
 * Custom dropdown matching the master-modal style:
 *   - clean white menu with soft shadow, 10px radius
 *   - subtle hover tint + indigo-wash for the active item
 *   - chevron rotates on open and tints indigo on focus
 *
 * Supports both uncontrolled (defaultValue) and controlled (value + onChange)
 * usage — the hidden <input name> stays in sync either way so FormData works.
 */
export function MasterSelect({
  name,
  value,
  defaultValue,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  onChange,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (value: string) => void;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Reset the search filter each time the menu closes so the next open is fresh.
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const selected = options.find(o => o.value === currentValue);
  const showSearch = options.length > 4;
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const handlePick = (val: string) => {
    if (value === undefined) setInternal(val);
    onChange?.(val);
  };
  return (
    <>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => { if (!disabled) setOpen(v => !v); }}
        className={`master-select-wrap${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle
          tag="button"
          type="button"
          disabled={disabled}
          className="master-select-toggle"
        >
          <span className={selected ? 'master-select-value' : 'master-select-placeholder'}>
            {selected ? selected.label : placeholder}
          </span>
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        <DropdownMenu className="master-select-menu">
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
          <div className="master-select-list">
            {filtered.length === 0 ? (
              <div className="master-select-empty">
                {options.length === 0 ? 'No options' : 'No results'}
              </div>
            ) : filtered.map(opt => (
              <DropdownItem
                key={opt.value}
                active={opt.value === currentValue}
                onClick={() => handlePick(opt.value)}
                className="master-select-item"
              >
                {opt.label}
              </DropdownItem>
            ))}
          </div>
        </DropdownMenu>
      </Dropdown>
      {name !== undefined && <input type="hidden" name={name} value={currentValue} />}
    </>
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
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    margin-bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--vz-heading-color, var(--vz-body-color));
  }
  .master-modal label .req-star {
    color: #f06548;
    font-weight: 700;
    margin-left: 1px;
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

  /* Custom MasterSelect — replaces native <select> dropdowns */
  .master-field.sel .master-select-wrap { width: 100%; }
  .master-select-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 38px;
    padding: 7px 12px 7px 36px;
    border: 1px solid var(--vz-border-color);
    border-radius: 10px;
    background: var(--vz-card-bg);
    color: var(--vz-heading-color, var(--vz-body-color));
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(18,38,63,0.04), inset 0 1px 1px rgba(255,255,255,0.04);
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  .master-select-toggle:hover:not(:disabled) {
    border-color: rgba(99,102,241,0.55);
    box-shadow: 0 2px 6px rgba(99,102,241,0.08);
  }
  .master-select-wrap.show .master-select-toggle {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15), 0 4px 12px rgba(99,102,241,0.12) !important;
  }
  .master-select-wrap.invalid .master-select-toggle {
    border-color: #f06548 !important;
    box-shadow: 0 0 0 3px rgba(240,101,72,0.15) !important;
  }
  .master-select-toggle:disabled {
    background: var(--vz-secondary-bg);
    color: var(--vz-secondary-color);
    cursor: not-allowed;
    opacity: 0.85;
    box-shadow: none;
  }
  .master-select-placeholder {
    color: var(--vz-secondary-color);
    opacity: 0.65;
    font-weight: 400;
    flex-grow: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .master-select-value {
    color: var(--vz-heading-color, var(--vz-body-color));
    flex-grow: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .master-select-chev {
    font-size: 18px;
    color: var(--vz-secondary-color);
    margin-left: 8px;
    flex-shrink: 0;
    transition: transform .2s ease, color .18s ease;
  }
  .master-select-wrap.show .master-select-chev {
    color: #6366f1;
    transform: rotate(180deg);
  }
  .master-modal .master-select-menu.dropdown-menu,
  div.master-select-menu.dropdown-menu {
    width: 100%;
    min-width: 100% !important;
    border-radius: 10px !important;
    padding: 6px !important;
    box-shadow: 0 14px 30px rgba(18,38,63,0.14), 0 2px 8px rgba(18,38,63,0.06) !important;
    border: 1px solid var(--vz-border-color) !important;
    margin-top: 6px !important;
    background-color: #ffffff !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    opacity: 1 !important;
    filter: none !important;
    z-index: 2000 !important;
  }
  /* Search row at the top of the menu (sticks — not part of scroll area) */
  .master-select-search {
    position: relative;
    padding: 2px 2px 6px 2px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--vz-border-color);
  }
  .master-select-search-icon {
    position: absolute;
    left: 11px;
    top: calc(50% - 3px);
    transform: translateY(-50%);
    font-size: 14px;
    color: var(--vz-secondary-color);
    pointer-events: none;
  }
  .master-select-search-input {
    width: 100%;
    height: 34px;
    padding: 6px 10px 6px 34px;
    border: 1px solid var(--vz-border-color);
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--vz-body-color);
    background: var(--vz-secondary-bg);
    outline: none;
    transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }
  .master-select-search-input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
    background: var(--vz-card-bg);
  }
  .master-select-search-input::placeholder {
    color: var(--vz-secondary-color);
    opacity: 0.65;
  }
  /* Scroll area — caps to ~4 items, rest scrolls */
  .master-select-list {
    max-height: 152px;
    overflow-y: auto;
  }
  .master-select-list::-webkit-scrollbar { width: 6px; }
  .master-select-list::-webkit-scrollbar-track { background: transparent; }
  .master-select-list::-webkit-scrollbar-thumb {
    background: var(--vz-border-color);
    border-radius: 6px;
  }
  .master-select-list::-webkit-scrollbar-thumb:hover {
    background: var(--vz-secondary-color);
  }
  html[data-bs-theme="dark"] .master-modal .master-select-menu.dropdown-menu,
  html[data-layout-mode="dark"] .master-modal .master-select-menu.dropdown-menu,
  [data-bs-theme="dark"] div.master-select-menu.dropdown-menu,
  [data-layout-mode="dark"] div.master-select-menu.dropdown-menu {
    background-color: #2a2f34 !important;
    border-color: rgba(255,255,255,0.08) !important;
  }
  .master-select-item {
    background-color: transparent !important;
    padding: 8px 12px !important;
    border-radius: 6px !important;
    font-size: 13px !important;
    color: var(--vz-body-color) !important;
    transition: background .15s ease, color .15s ease;
    margin-bottom: 1px;
  }
  .master-select-item:hover,
  .master-select-item:focus {
    background: var(--vz-secondary-bg) !important;
    color: var(--vz-heading-color, var(--vz-body-color)) !important;
  }
  .master-select-item.active {
    background: rgba(99,102,241,0.10) !important;
    color: #6366f1 !important;
    font-weight: 600;
  }
  .master-select-empty {
    padding: 10px 12px;
    font-size: 12px;
    color: var(--vz-secondary-color);
    text-align: center;
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
