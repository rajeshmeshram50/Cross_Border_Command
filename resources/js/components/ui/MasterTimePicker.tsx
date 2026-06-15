import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './MasterTimePicker.css';

/* MasterTimePicker — themed two-column (HH / MM) time picker, paired
 * visually with MasterSelect + MasterDatePicker. Outputs `HH:MM` in
 * 24-hour format. Empty string when no time is selected. */
export function MasterTimePicker({
  name,
  value,
  defaultValue,
  onChange,
  placeholder = '--:--',
  disabled,
  invalid,
  minuteStep = 5,
  showNow = true,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  minuteStep?: number;
  /* The "Now" shortcut only makes sense for a "start" time. Pass false to
   * hide it (e.g. an end time — setting it to "now" is meaningless). */
  showNow?: boolean;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? '');
  useEffect(() => {
    if (value === undefined) setInternal(defaultValue ?? '');
  }, [defaultValue, value]);
  const currentValue = value !== undefined ? value : internal;

  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hColRef = useRef<HTMLDivElement>(null);
  const mColRef = useRef<HTMLDivElement>(null);

  const pad = (n: number) => String(n).padStart(2, '0');
  const [hStr = '', mStr = ''] = currentValue.split(':');
  const selH = hStr ? parseInt(hStr, 10) : null;
  const selM = mStr ? parseInt(mStr, 10) : null;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep);

  useEffect(() => {
    if (!open || !wrapRef.current) { setPopupPos(null); return; }
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const margin = 8;
      const popupW = Math.max(rect.width, 180);
      // Real popup height once rendered; 300 fallback for the first frame.
      const popupH = popupRef.current?.offsetHeight || 300;
      // Clamp horizontally so the popup never spills off the right edge.
      let left = rect.left;
      if (left + popupW + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - popupW - margin);
      }
      // Flip ABOVE the field only when there genuinely isn't room below, and
      // sit it snug above the field using the measured height (keeps the whole
      // picker — including the Clear/Now/Done footer — on screen).
      let top = rect.bottom + 5;
      if (top + popupH + margin > window.innerHeight && rect.top - popupH - 5 > margin) {
        top = rect.top - popupH - 5;
      }
      setPopupPos({ top, left, width: popupW });
    };
    update();
    // Re-measure after the popup mounts so the flip uses its true height.
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', update); };
  }, [open]);

  /* After the popup mounts, scroll the selected hour/minute into view so
   * the user lands near their current pick instead of at the top. */
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      hColRef.current?.querySelector('.master-timepicker-item.selected')
        ?.scrollIntoView({ block: 'center' });
      mColRef.current?.querySelector('.master-timepicker-item.selected')
        ?.scrollIntoView({ block: 'center' });
    });
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
    // Close on scroll of an ANCESTOR (page / modal body) so the portalled
    // popup doesn't float in a stale spot — but IGNORE scrolls that happen
    // INSIDE the popup (the HH / MM columns), otherwise scrolling the list
    // closed the picker before the user could reach a value.
    const onScroll = (e: Event) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const commit = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };

  const pickHour = (h: number) => {
    const m = selM != null ? selM : 0;
    commit(`${pad(h)}:${pad(m)}`);
  };
  const pickMinute = (m: number) => {
    const h = selH != null ? selH : 0;
    commit(`${pad(h)}:${pad(m)}`);
  };

  return (
    <div ref={wrapRef} className={`master-timepicker-wrap ${invalid ? 'invalid' : ''} ${disabled ? 'disabled' : ''}`}>
      {name && <input type="hidden" name={name} value={currentValue} />}
      <div
        className={`master-timepicker-toggle ${open ? 'open' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        aria-disabled={disabled}
      >
        {currentValue
          ? <span className="master-timepicker-value">{currentValue}</span>
          : <span className="master-timepicker-placeholder">{placeholder}</span>}
        {currentValue && !disabled && (
          <button
            type="button"
            className="master-timepicker-clear"
            onClick={(e) => { e.stopPropagation(); commit(''); }}
            aria-label="Clear"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <svg className="master-timepicker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>

      {open && popupPos && createPortal(
        <div
          ref={popupRef}
          className="master-timepicker-popup"
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            width: popupPos.width,
            // Sits above modal overlays (Sales Todo modal is z-index 9500,
            // others up to 10000) so the dropdown never opens behind the
            // popup. Matches MasterDatePicker's 11100.
            zIndex: 11100,
          }}
        >
          <div className="master-timepicker-cols">
            <div className="master-timepicker-col">
              <div className="master-timepicker-col-head">HH</div>
              <div ref={hColRef} className="master-timepicker-col-list">
                {hours.map(h => (
                  <button
                    key={h}
                    type="button"
                    className={`master-timepicker-item ${selH === h ? 'selected' : ''}`}
                    onClick={() => pickHour(h)}
                  >
                    {pad(h)}
                  </button>
                ))}
              </div>
            </div>
            <div className="master-timepicker-col">
              <div className="master-timepicker-col-head">MM</div>
              <div ref={mColRef} className="master-timepicker-col-list">
                {minutes.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`master-timepicker-item ${selM === m ? 'selected' : ''}`}
                    onClick={() => pickMinute(m)}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="master-timepicker-foot">
            <button
              type="button"
              className="master-timepicker-foot-btn"
              onClick={() => { commit(''); setOpen(false); }}
            >Clear</button>
            {showNow && (
              <button
                type="button"
                className="master-timepicker-foot-btn primary"
                onClick={() => {
                  const now = new Date();
                  commit(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
                  setOpen(false);
                }}
              >Now</button>
            )}
            <button
              type="button"
              className="master-timepicker-foot-btn primary"
              onClick={() => setOpen(false)}
            >Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
