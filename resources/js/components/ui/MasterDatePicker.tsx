import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './MasterDatePicker.css';

/* Shared event name with MasterTimePicker — opening any one picker closes
 * every other open date/time picker so they never stack on screen. Keep this
 * string identical to the one in MasterTimePicker.tsx. */
const PICKER_OPEN_EVENT = 'master-picker-open';


export function MasterDatePicker({
  name,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select date',
  minDate,
  maxDate,
  disabled,
  invalid,
  popupClassName,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Extra class on the portalled popup so a host can re-theme it (e.g. teal). */
  popupClassName?: string;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;

  const [open, setOpen] = useState(false);
  const pickerId = useId();

  const [viewDate, setViewDate] = useState<Date>(() => {
    if (currentValue) return new Date(currentValue);
    // Open on the CURRENT month by default; only clamp into [minDate, maxDate]
    // when today falls outside it. (Previously it jumped straight to maxDate's
    // month — e.g. a Dec salary cap made the picker open in December.)
    const t = new Date();
    if (maxDate && t > new Date(maxDate)) return new Date(maxDate);
    if (minDate && t < new Date(minDate)) return new Date(minDate);
    return t;
  });
  const [popupPos, setPopupPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  
  /* Single-open coordination: announce when we open so other open date/time
   * pickers close, and close ourselves when another picker opens. */
  useEffect(() => {
    if (!open) return;
    document.dispatchEvent(new CustomEvent(PICKER_OPEN_EVENT, { detail: pickerId }));
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== pickerId) setOpen(false);
    };
    document.addEventListener(PICKER_OPEN_EVENT, onOther);
    return () => document.removeEventListener(PICKER_OPEN_EVENT, onOther);
  }, [open, pickerId]);

  useEffect(() => {
    if (!open || !wrapRef.current) { setPopupPos(null); return; }
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const margin = 8;
      const gap = 5;
      const popupW = 240;   // matches the popup's fixed 240px width
      // Clamp horizontally so the calendar never spills off the right edge.
      // Critical inside right-side drawers (e.g. Request Leave) where the
      // field sits near the screen edge and the popup would overflow — this
      // is what kept the Saturday column on-screen (HRMS-BUG-088).
      let left = rect.left;
      if (left + popupW + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - popupW - margin);
      }
      // Open BELOW the field by default. Flip above when there isn't room for
      // the full calendar below AND there's more room above — so a low field
      // in a tall modal opens upward instead of cramming a scrolled calendar
      // into a sliver below it. `desired` is the calendar's real rendered
      // height (measured on the post-render raf pass; the fallback covers the
      // first frame). Positioning never uses it — the above-branch anchors by
      // `bottom` so it stays snug regardless of height.
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      const desired = popupRef.current?.offsetHeight || 320;
      // Never let maxHeight collapse the popup to an invisible sliver — clamp
      // to a sane minimum so the calendar is ALWAYS visible even when the
      // chosen side is cramped (it may slightly overflow, but it shows).
      const MIN_H = 220;
      if (spaceBelow >= desired || spaceBelow >= spaceAbove) {
        // Open below, anchored to the field's bottom edge.
        setPopupPos({ top: rect.bottom + gap, left, width: rect.width, maxHeight: Math.max(MIN_H, spaceBelow) });
      } else {
        // Flip above. Anchor the popup's BOTTOM edge just above the field
        // (via `bottom`) instead of computing `top` from an estimated height —
        // an over-estimated height used to push the calendar far up and leave
        // a big gap between it and the field. Bottom-anchoring keeps it snug
        // no matter the rendered height.
        setPopupPos({ bottom: window.innerHeight - rect.top + gap, left, width: rect.width, maxHeight: Math.max(MIN_H, spaceAbove) });
      }
    };
    update();
    // Re-measure once the popup has actually rendered so the flip decision +
    // position use its true height (the first pass uses the estimate).
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', update); };
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
    // Capture phase: modal wrappers often stopPropagation on mousedown to
    // avoid backdrop-close, which (in React 17+) also blocks the native event
    // from reaching a bubble-phase document listener — leaving this picker
    // stuck open when another field inside the modal is clicked. Capturing
    // runs before that stopPropagation can swallow the event.
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
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
  // Normalize to midnight so day-level comparisons aren't thrown off by the
  // "now" time-of-day that `new Date()` carries.
  const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const minD = minDate ? dayOnly(new Date(minDate)) : null;
  const maxD = maxDate ? dayOnly(new Date(maxDate)) : null;
  const today = new Date();
  const todayDisabled =
    (!!minD && dayOnly(today) < minD) ||
    (!!maxD && dayOnly(today) > maxD);
  const selected = currentValue ? new Date(currentValue) : null;
  // DD-Mon-YYYY (e.g. 11-Jun-2026) — dashed, matching the app's display format.
  const MDP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const display = (() => {
    if (!currentValue) return '';
    const d = new Date(currentValue);
    return Number.isNaN(d.getTime())
      ? ''
      : `${String(d.getDate()).padStart(2, '0')}-${MDP_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  })();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // The popup has three drill-down views: day grid (default), month grid,
  // and year grid. Clicking the title in the header walks `days → months →
  // years`; picking a value walks back down the chain.
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  // Reset to the day grid every time the popup re-opens so the user always
  // starts on the familiar day picker. Also re-anchor the month view on the
  // selected date (or today): browsing to a far month and closing WITHOUT
  // picking a date used to leave the calendar stranded on that month, so
  // reopening showed e.g. "February 2023" while the field held a 2026 date
  // (the value-sync effect below only fires when currentValue *changes*).
  useEffect(() => {
    if (!open) return;
    setView('days');
    setViewDate((() => {
      if (currentValue) return new Date(currentValue);
      const t = new Date();
      if (maxDate && t > new Date(maxDate)) return new Date(maxDate);
      if (minDate && t < new Date(minDate)) return new Date(minDate);
      return t;
    })());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Year grid spans 12 years anchored on the current view year.
  const yearBlockStart = Math.floor(year / 12) * 12;
  const monthLabelsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const prev = () => {
    if (view === 'days')        setViewDate(new Date(year, month - 1, 1));
    else if (view === 'months') setViewDate(new Date(year - 1, month, 1));
    else                        setViewDate(new Date(year - 12, month, 1));
  };
  const next = () => {
    if (view === 'days')        setViewDate(new Date(year, month + 1, 1));
    else if (view === 'months') setViewDate(new Date(year + 1, month, 1));
    else                        setViewDate(new Date(year + 12, month, 1));
  };

  // Title click: walks one level up in the drill-down (days → months → years),
  // and stops at the year grid (no level above it).
  const onTitleClick = () => {
    setView(v => (v === 'days' ? 'months' : v === 'months' ? 'years' : v));
  };
  const titleLabel =
    view === 'days'   ? viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : view === 'months' ? String(year)
    :                     `${yearBlockStart} - ${yearBlockStart + 11}`;

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
          className={`master-datepicker-popup ${popupClassName ?? ''}`}
          style={{
            position: 'fixed',
            // Always set BOTH top and bottom (the unused one to 'auto') — the
            // stylesheet has a non-!important `top: calc(100% + 5px)` for this
            // class, which on a position:fixed element resolves to just past
            // the viewport bottom. If we left `top` unset on the flip-above
            // branch, that CSS would leak in and push the popup off-screen
            // (it looked like the calendar "didn't open"). Explicit 'auto'
            // overrides it.
            top: popupPos.top !== undefined ? popupPos.top : 'auto',
            bottom: popupPos.bottom !== undefined ? popupPos.bottom : 'auto',
            left: popupPos.left,
            minWidth: Math.max(240, popupPos.width),
            maxHeight: popupPos.maxHeight,
            overflowY: 'auto',
            backgroundColor: '#ffffff',
            backgroundImage: 'none',
            opacity: 1,
          }}
        >
          {/* Header: nav + title (title is clickable to drill up: days → months → years) */}
          <div className="d-flex align-items-center justify-content-between mb-1">
            <button type="button" onClick={prev} className="master-datepicker-nav" title={view === 'days' ? 'Previous month' : view === 'months' ? 'Previous year' : 'Previous 12 years'}>
              <i className="ri-arrow-left-s-line" style={{ fontSize: 13 }} />
            </button>
            <button
              type="button"
              onClick={onTitleClick}
              className={`master-datepicker-title-btn${view !== 'years' ? ' is-clickable' : ''}`}
              disabled={view === 'years'}
              title={view === 'days' ? 'Click to pick a month or year' : view === 'months' ? 'Click to pick a year' : ''}
            >
              {titleLabel}
              {view !== 'years' && (
                // Larger, bolder chevron — the previous 13px arrow was
                // easy to miss against the title text, so users didn't
                // know they could click here to jump months/years.
                <i className="ri-arrow-down-s-line" style={{ fontSize: 16, marginLeft: 2, lineHeight: 1 }} />
              )}
            </button>
            <button type="button" onClick={next} className="master-datepicker-nav" title={view === 'days' ? 'Next month' : view === 'months' ? 'Next year' : 'Next 12 years'}>
              <i className="ri-arrow-right-s-line" style={{ fontSize: 13 }} />
            </button>
          </div>

          {view === 'days' && (
            <>
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
                  const isDisabled =
                    (!!minD && d < minD) ||
                    (!!maxD && d > maxD);
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
            </>
          )}

          {view === 'months' && (
            // Month grid — 4 columns × 3 rows. Picking a month drops back to
            // the day grid for that month so the user can pick the date.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 0' }}>
              {monthLabelsShort.map((m, i) => {
                const isCurrentView = i === month;
                const isSelectedMonth =
                  !!selected && selected.getFullYear() === year && selected.getMonth() === i;
                // A whole month is unreachable when its last day is before
                // minDate or its first day is after maxDate.
                const monthFirst = new Date(year, i, 1);
                const monthLast  = new Date(year, i + 1, 0);
                const isDisabled =
                  (!!minD && monthLast < minD) ||
                  (!!maxD && monthFirst > maxD);
                const cls = [
                  'master-datepicker-cell',
                  isSelectedMonth && 'is-selected',
                  !isSelectedMonth && isCurrentView && 'is-today',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => { setViewDate(new Date(year, i, 1)); setView('days'); }}
                    className={cls}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          )}

          {view === 'years' && (
            // Year grid — 12 years per page, anchored on a 12-year block.
            // Picking a year drops back to the month grid for that year.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 0' }}>
              {Array.from({ length: 12 }).map((_, i) => {
                const y = yearBlockStart + i;
                const isCurrentView = y === year;
                const isSelectedYear = !!selected && selected.getFullYear() === y;
                // A whole year is unreachable when its last day is before
                // minDate or its first day is after maxDate.
                const yearFirst = new Date(y, 0, 1);
                const yearLast  = new Date(y, 11, 31);
                const isDisabled =
                  (!!minD && yearLast < minD) ||
                  (!!maxD && yearFirst > maxD);
                const cls = [
                  'master-datepicker-cell',
                  isSelectedYear && 'is-selected',
                  !isSelectedYear && isCurrentView && 'is-today',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={y}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => { setViewDate(new Date(y, month, 1)); setView('months'); }}
                    className={cls}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

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
              disabled={todayDisabled}
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
