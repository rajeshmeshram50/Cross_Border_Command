import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';


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

/**
 * Compact themed date picker — same visual language as MasterSelect.
 *   - Click-to-open toggle (looks like an input, 38px height, 10px radius)
 *   - 240px compact calendar popup
 *   - Indigo focus ring, indigo "today" highlight, gradient selected day
 *   - Supports both controlled (value + onChange) and uncontrolled (defaultValue) usage
 *   - Renders a hidden <input name> so FormData-based forms get the value
 */
export function MasterDatePicker({
  name,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select date',
  minDate,
  disabled,
  invalid,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  minDate?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;

  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() => currentValue ? new Date(currentValue) : new Date());
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Compute popup position from the toggle's bounding rect. Runs whenever `open`
  // flips to true, and on window resize/scroll while open so the popup tracks
  // (we close on any scroll inside the modal to avoid stale positions there).
  useEffect(() => {
    if (!open || !wrapRef.current) { setPopupPos(null); return; }
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setPopupPos({
        top: rect.bottom + 5,
        left: rect.left,
        width: rect.width,
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inWrap = wrapRef.current?.contains(target);
      const inPopup = popupRef.current?.contains(target);
      if (!inWrap && !inPopup) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Close if the user scrolls any ancestor (modal body, page, etc.) so the
    // portalled popup doesn't float in a stale position.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // When the bound value changes externally (e.g. record loaded in edit mode),
  // pull the month view into the selected month so it's visible on open.
  useEffect(() => {
    if (currentValue) setViewDate(new Date(currentValue));
  }, [currentValue]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minD = minDate ? new Date(minDate) : null;
  const today = new Date();
  const selected = currentValue ? new Date(currentValue) : null;
  const display = currentValue
    ? new Date(currentValue).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prev = () => setViewDate(new Date(year, month - 1, 1));
  const next = () => setViewDate(new Date(year, month + 1, 1));

  const sameDay = (a: Date | null, b: Date | null) =>
    !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const commit = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };

  return (
    <div
      ref={wrapRef}
      className={`master-datepicker-wrap${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}
      style={{ position: 'relative', width: '100%' }}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        onKeyDown={e => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
        }}
        className={`master-datepicker-toggle${open ? ' open' : ''}`}
      >
        <span className={display ? 'master-datepicker-value' : 'master-datepicker-placeholder'}>
          {display || placeholder}
        </span>
        {currentValue && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); commit(''); }}
            className="master-datepicker-clear"
            title="Clear"
          >
            <i className="ri-close-line" />
          </button>
        )}
        <i className="ri-calendar-line master-datepicker-icon" />
      </div>

      {open && !disabled && popupPos && createPortal(
        <div
          ref={popupRef}
          className="master-datepicker-popup"
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            minWidth: Math.max(240, popupPos.width),
            backgroundColor: '#ffffff',
            backgroundImage: 'none',
            opacity: 1,
          }}
        >
          {/* Header: month nav */}
          <div className="d-flex align-items-center justify-content-between mb-1">
            <button type="button" onClick={prev} className="master-datepicker-nav">
              <i className="ri-arrow-left-s-line" style={{ fontSize: 13 }} />
            </button>
            <div className="master-datepicker-title">
              {viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
            <button type="button" onClick={next} className="master-datepicker-nav">
              <i className="ri-arrow-right-s-line" style={{ fontSize: 13 }} />
            </button>
          </div>

          {/* Weekday labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
              <div key={d} className="master-datepicker-dow">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {Array.from({ length: firstDow }).map((_, i) => <div key={`blank-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const d = new Date(year, month, day);
              const isToday = sameDay(today, d);
              const isSelected = sameDay(selected, d);
              const isDisabled = minD ? d < new Date(minD.getFullYear(), minD.getMonth(), minD.getDate()) : false;
              const cls = [
                'master-datepicker-day',
                isSelected && 'is-selected',
                isToday && !isSelected && 'is-today',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => { commit(fmt(d)); setOpen(false); }}
                  className={cls}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="master-datepicker-footer">
            <button
              type="button"
              onClick={() => { commit(''); setOpen(false); }}
              className="clear-btn"
            >
              <i className="ri-close-line" />Clear
            </button>
            <button
              type="button"
              onClick={() => { commit(fmt(today)); setViewDate(today); setOpen(false); }}
              className="today-btn"
            >
              <i className="ri-focus-2-line" />Today
            </button>
          </div>
        </div>,
        document.body
      )}

      {name !== undefined && <input type="hidden" name={name} value={currentValue} />}
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
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
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

  /* Custom MasterSelect — replaces native <select> dropdowns */
  .master-select-wrap { width: 100%; }
  .master-select-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 38px;
    padding: 7px 12px;
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
  /* Extra left padding only when sitting inside a master-field wrapper
     (accommodates the prefix icon used in master-modal forms) */
  .master-field .master-select-toggle { padding-left: 36px; }
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

  /* ── MasterDatePicker ─────────────────────────────────────────── */
  .master-datepicker-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 38px;
    padding: 7px 12px;
    border: 1px solid var(--vz-border-color);
    border-radius: 10px;
    background: var(--vz-card-bg);
    color: var(--vz-heading-color, var(--vz-body-color));
    font-size: 13px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 1px 2px rgba(18,38,63,0.04), inset 0 1px 1px rgba(255,255,255,0.04);
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  .master-datepicker-toggle:hover:not([aria-disabled="true"]) {
    border-color: rgba(99,102,241,0.55);
    box-shadow: 0 2px 6px rgba(99,102,241,0.08);
  }
  .master-datepicker-toggle.open {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15), 0 4px 12px rgba(99,102,241,0.12);
  }
  .master-datepicker-wrap.invalid .master-datepicker-toggle {
    border-color: #f06548;
    box-shadow: 0 0 0 3px rgba(240,101,72,0.15);
  }
  .master-datepicker-toggle[aria-disabled="true"],
  .master-datepicker-wrap.disabled .master-datepicker-toggle {
    background: var(--vz-secondary-bg);
    color: var(--vz-secondary-color);
    cursor: not-allowed;
    opacity: 0.85;
    box-shadow: none;
  }
  /* Extra left padding when inside a master-field wrapper with a prefix icon */
  .master-field .master-datepicker-toggle { padding-left: 36px; }
  /* Hide the internal right-side calendar icon when already shown as prefix */
  .master-field .master-datepicker-icon { display: none; }
  /* Tint the master-field prefix icon indigo while the picker is open */
  .master-field:has(.master-datepicker-toggle.open) .master-field-icon {
    color: #6366f1;
  }

  .master-datepicker-placeholder {
    flex: 1;
    color: var(--vz-secondary-color);
    opacity: 0.65;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .master-datepicker-value {
    flex: 1;
    color: var(--vz-heading-color, var(--vz-body-color));
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .master-datepicker-icon {
    color: #6366f1;
    font-size: 16px;
    flex-shrink: 0;
  }
  .master-datepicker-clear {
    border: none;
    background: transparent;
    color: var(--vz-secondary-color);
    font-size: 14px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color .15s ease;
  }
  .master-datepicker-clear:hover { color: #f06548; }

  /* Popup — compact 240px. Extra selectors + resets to beat anything that
     tries to leak through (transparent CSS vars, opacity inheritance, etc.) */
  .master-datepicker-popup,
  div.master-datepicker-popup,
  .master-modal .master-datepicker-popup,
  .master-field .master-datepicker-popup {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    min-width: 240px;
    max-width: 240px;
    background-color: #ffffff !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    opacity: 1 !important;
    filter: none !important;
    border: 1px solid var(--vz-border-color);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.16);
    padding: 10px;
    z-index: 2000 !important;
  }
  html[data-bs-theme="dark"] .master-datepicker-popup,
  html[data-layout-mode="dark"] .master-datepicker-popup,
  [data-bs-theme="dark"] .master-datepicker-popup,
  [data-layout-mode="dark"] .master-datepicker-popup,
  [data-bs-theme="dark"] div.master-datepicker-popup,
  [data-layout-mode="dark"] div.master-datepicker-popup {
    background-color: #2a2f34 !important;
    border-color: rgba(255,255,255,0.08);
  }
  .master-datepicker-nav {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--vz-secondary-bg);
    border: 1px solid var(--vz-border-color);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--vz-heading-color, var(--vz-body-color));
    transition: background .15s ease, color .15s ease, border-color .15s ease;
  }
  .master-datepicker-nav:hover {
    background: rgba(99,102,241,0.10);
    color: #6366f1;
    border-color: rgba(99,102,241,0.3);
  }
  .master-datepicker-title {
    font-weight: 700;
    font-size: 12px;
    color: var(--vz-heading-color, var(--vz-body-color));
  }
  .master-datepicker-dow {
    font-size: 9.5px;
    font-weight: 700;
    color: var(--vz-secondary-color);
    padding: 2px 0;
    text-align: center;
    letter-spacing: 0.03em;
  }
  .master-datepicker-day {
    height: 26px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    background: transparent;
    color: var(--vz-heading-color, var(--vz-body-color));
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background .15s ease, color .15s ease;
  }
  .master-datepicker-day:hover:not(:disabled):not(.is-selected) {
    background: rgba(99,102,241,0.10);
    color: #6366f1;
  }
  .master-datepicker-day.is-today {
    background: rgba(99,102,241,0.12);
    color: #6366f1;
    font-weight: 600;
  }
  .master-datepicker-day.is-selected {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: #fff;
    font-weight: 700;
    box-shadow: 0 3px 8px rgba(99,102,241,0.30);
  }
  .master-datepicker-day:disabled {
    color: var(--vz-secondary-color);
    opacity: 0.35;
    cursor: not-allowed;
  }
  .master-datepicker-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 4px;
    margin-top: 4px;
    border-top: 1px solid var(--vz-border-color);
  }
  .master-datepicker-footer .clear-btn,
  .master-datepicker-footer .today-btn {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    font-size: 10.5px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .master-datepicker-footer .clear-btn {
    color: var(--vz-secondary-color);
    font-weight: 600;
  }
  .master-datepicker-footer .today-btn {
    color: #6366f1;
    font-weight: 700;
  }
`;
