import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Multi-value picker shared by the Customer / Consignee / Vendor (Supplier)
 * onboarding wizards. Modelled after the Ancillary Role widget in the
 * employee form — chips live INSIDE the toggle container, not stacked
 * above a separate dropdown. The integrated layout keeps the field a
 * single visual unit and frees up vertical space on dense Stage-1 grids.
 *
 * The public API matches the previous chip-row + inline-MasterSelect
 * implementation so callers don't need any changes:
 *   • values / options / onChange — controlled multi-select
 *   • placeholder                 — shown when no chips selected
 *   • addMorePlaceholder          — kept for backward compatibility; the
 *                                   integrated design renders chips +
 *                                   chevron instead, so this prop is no
 *                                   longer surfaced visually
 *   • invalid                     — red border when set
 *   • disabled                    — read-only chip row, no dropdown
 */
export function MasterMultiSelect({
  values,
  options,
  placeholder = 'Select…',
  addMorePlaceholder: _addMorePlaceholder,
  disabled,
  invalid,
  onChange,
}: {
  values: string[];
  options: { value: string; label: string }[];
  placeholder?: string;
  /** @deprecated kept for caller compatibility; no longer rendered separately. */
  addMorePlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (next: string[]) => void;
}) {
  void _addMorePlaceholder;
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef   = useRef<HTMLDivElement | null>(null);
  const menuRef   = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /* The dropdown is portalled to body so it escapes the form section's
   * `overflow: hidden`. We track the toggle's viewport rect to position
   * the menu directly under it, and recompute on scroll/resize so the
   * popover stays anchored as the form scrolls. */
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const reposition = () => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
  };
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => reposition();
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open]);

  // Outside click / Escape closes the dropdown. The portalled menu lives
  // outside the wrapper, so we have to test both refs to keep clicks
  // inside the popover from collapsing it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t))  return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus the search field on open; reset the query on close.
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else      setQuery('');
  }, [open]);

  const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const remove = (v: string) => {
    if (disabled) return;
    onChange(values.filter(x => x !== v));
  };
  const toggle = (v: string) => {
    if (disabled) return;
    if (values.includes(v)) onChange(values.filter(x => x !== v));
    else                    onChange([...values, v]);
  };

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} className={`mms-root ${invalid ? 'mms-invalid' : ''}`}>
      <style>{MMS_CSS}</style>

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={`mms-toggle ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${invalid ? 'is-invalid' : ''}`}
      >
        {values.length === 0 && <span className="mms-placeholder">{placeholder}</span>}
        {values.map(v => (
          <span key={v} className="mms-chip" title={labelFor(v)}>
            <span className="mms-chip-label">{labelFor(v)}</span>
            {!disabled && (
              <button
                type="button"
                className="mms-chip-x"
                aria-label={`Remove ${labelFor(v)}`}
                onClick={(e) => { e.stopPropagation(); remove(v); }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <svg
          className="mms-chev"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && !disabled && menuRect && createPortal(
        <div
          ref={menuRef}
          className="mms-menu"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="mms-search-wrap">
            <svg className="mms-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="mms-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="mms-list">
            {options.length === 0 ? (
              <div className="mms-empty">No options</div>
            ) : filtered.length === 0 ? (
              <div className="mms-empty">No matches for “{query}”</div>
            ) : filtered.map(opt => {
              const on = values.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  className={`mms-item ${on ? 'is-on' : ''}`}
                  onClick={() => toggle(opt.value)}
                >
                  <span className="mms-check">
                    {on && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="mms-item-label">{opt.label}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const MMS_CSS = `
.mms-root { position: relative; width: 100%; }

/* Integrated container — chips + chevron live inside the same border. */
.mms-toggle {
  width: 100%; min-height: 38px;
  padding: 5px 36px 5px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  color: #1f2937;
  cursor: pointer;
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  position: relative;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.mms-toggle:hover:not(.is-disabled) { border-color: rgba(99,102,241,0.55); }
.mms-toggle.is-open {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
}
.mms-toggle.is-invalid { border-color: #ef4444; }
.mms-toggle.is-invalid.is-open { box-shadow: 0 0 0 3px rgba(239,68,68,0.18); }
.mms-toggle.is-disabled { background: #f9fafb; cursor: not-allowed; opacity: 0.85; }

.mms-placeholder {
  color: #9ca3af;
  font-weight: 400;
  padding: 3px 0;
}

.mms-chev {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
  transition: transform .2s ease, color .15s ease;
}
.mms-toggle.is-open .mms-chev { transform: translateY(-50%) rotate(180deg); color: #6366f1; }

/* Chips — soft violet pills, ellipsised when long. */
.mms-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 4px 3px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  border: 1px solid #c4b5fd;
  font-size: 11.5px; font-weight: 600; color: #5b21b6;
  max-width: 240px;
}
.mms-chip-label {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mms-chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 999px;
  background: rgba(91,33,182,0.12);
  border: none; cursor: pointer;
  color: #5b21b6;
  font-size: 14px; line-height: 1; font-weight: 700;
  padding: 0;
}
.mms-chip-x:hover { background: #7c3aed; color: #fff; }

/* Dropdown popover — portalled to body and pinned with position: fixed
 * so it escapes the form section's overflow:hidden and floats above
 * sibling cards. z-index sits above the customer/consignee/vendor wizard
 * (which uses ~200000 for its overlay) so the menu is always visible. */
.mms-menu {
  position: fixed;
  z-index: 260000;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 14px 30px rgba(18,38,63,0.18), 0 2px 8px rgba(18,38,63,0.06);
  padding: 6px;
  max-height: 260px;
  display: flex; flex-direction: column;
}
.mms-search-wrap {
  position: relative; flex-shrink: 0;
  padding: 2px 2px 6px 2px;
  margin-bottom: 6px;
  border-bottom: 1px solid #e5e7eb;
}
.mms-search-icon {
  position: absolute; left: 11px; top: 50%;
  transform: translateY(calc(-50% - 3px));
  color: #9ca3af;
  pointer-events: none;
}
.mms-search {
  width: 100%; height: 32px;
  padding: 6px 10px 6px 32px;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  background: #fff;
  color: #1f2937;
  font-size: 12.5px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.mms-search:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
}
.mms-list { overflow-y: auto; flex: 1 1 auto; }
.mms-empty {
  padding: 14px 10px; text-align: center;
  color: #9ca3af; font-size: 12px;
}
.mms-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 6px;
  font-size: 13px; color: #1f2937; cursor: pointer;
  transition: background .15s ease;
}
.mms-item:hover { background: #f3f4f6; }
.mms-item.is-on {
  background: rgba(99,102,241,0.10);
  color: #6366f1;
  font-weight: 600;
}
.mms-check {
  width: 16px; height: 16px; border-radius: 4px;
  border: 1.5px solid #e5e7eb;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  background: #fff;
  color: #fff;
}
.mms-item.is-on .mms-check {
  background: #6366f1;
  border-color: #6366f1;
}
.mms-item-label { flex: 1; }

/* Dark mode parity. */
[data-bs-theme="dark"] .mms-toggle,
[data-layout-mode="dark"] .mms-toggle {
  background: #2a2f34;
  border-color: rgba(255,255,255,0.10);
  color: #e5e7eb;
}
[data-bs-theme="dark"] .mms-toggle.is-disabled,
[data-layout-mode="dark"] .mms-toggle.is-disabled { background: rgba(255,255,255,0.04); }
[data-bs-theme="dark"] .mms-placeholder,
[data-layout-mode="dark"] .mms-placeholder { color: #6b7280; }
[data-bs-theme="dark"] .mms-menu,
[data-layout-mode="dark"] .mms-menu {
  background: #2a2f34;
  border-color: rgba(255,255,255,0.08);
}
[data-bs-theme="dark"] .mms-search,
[data-layout-mode="dark"] .mms-search {
  background: #1f242a;
  border-color: rgba(255,255,255,0.10);
  color: #e5e7eb;
}
[data-bs-theme="dark"] .mms-item,
[data-layout-mode="dark"] .mms-item { color: #e5e7eb; }
[data-bs-theme="dark"] .mms-item:hover,
[data-layout-mode="dark"] .mms-item:hover { background: rgba(255,255,255,0.04); }
[data-bs-theme="dark"] .mms-search-wrap,
[data-layout-mode="dark"] .mms-search-wrap { border-bottom-color: rgba(255,255,255,0.08); }
[data-bs-theme="dark"] .mms-check,
[data-layout-mode="dark"] .mms-check {
  background: transparent;
  border-color: rgba(255,255,255,0.18);
}

/* Chips — the light violet pills glare on the dark surface. Swap to a
 * translucent violet fill with lighter text so they read cleanly. */
[data-bs-theme="dark"] .mms-chip,
[data-layout-mode="dark"] .mms-chip {
  background: rgba(124,58,237,0.22);
  border-color: rgba(124,58,237,0.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .mms-chip-x,
[data-layout-mode="dark"] .mms-chip-x {
  background: rgba(196,181,253,0.18);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .mms-chip-x:hover,
[data-layout-mode="dark"] .mms-chip-x:hover {
  background: #7c3aed;
  color: #fff;
}
`;
