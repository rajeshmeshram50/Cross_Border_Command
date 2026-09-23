// Label + field and the dropdown for this form. The field wears the shared
// P2P wizard classes; the dropdown is the app's MasterSelect.
import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import Tooltip from '../../../../../components/ui/Tooltip';

/* Anything this module cuts off must be readable somewhere, so every element
   that can end in "…" is wrapped in this: it watches the element and turns the
   app's own tooltip on only once the text really is cut. Never the browser's
   native `title` — that ignores the app's theme, waits a second to appear and
   is clipped inside scrollers. */
export function FitTip({ label, children }: { label: string; children: ReactElement }) {
  const ref = useRef<HTMLElement | null>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    // The same text can start fitting (or stop) when its column resizes.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [label]);
  // Tooltip merges this ref with its own, so the element stays measurable.
  return <Tooltip label={label} disabled={!cut}>{cloneElement(children, { ref } as never)}</Tooltip>;
}

/* A value that must stay on one line in a fixed-width cell. When it doesn't
   fit it ends in "…", and the full value shows in the tooltip — only then,
   so short numbers don't get a pointless hover. */
export function FitText({ text, className }: { text: string; className?: string }) {
  return (
    <FitTip label={text}>
      <span className={`cpf-fit${className ? ` ${className}` : ''}`}>{text}</span>
    </FitTip>
  );
}

/* The same for a narrow input: a number longer than the box ends in "…" while
   the box isn't being edited, and the tooltip carries the full value. */
export function FitInput({ tooltip, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { tooltip: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setCut(el.scrollWidth > el.clientWidth + 1);
  }, [props.value]);
  return (
    <Tooltip label={tooltip} disabled={!cut}>
      <input ref={ref} {...props} />
    </Tooltip>
  );
}

/* Label + control, one cell of a wizard field grid. */
/* `error` shows under the control (the control itself is flagged by its own invalid prop). */
export function Field({ label, children, full, req, error }: { label: string; children: ReactNode; full?: boolean; req?: boolean; error?: string }) {
  return (
    <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}>
      <label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>
      {children}
      {error && <div className="cpf-err" role="alert">{error}</div>}
    </div>
  );
}

/* Every dropdown in the form is the app's standard MasterSelect — a search box
   on top, options below — so the PO form behaves like every other screen.
   The options here are plain strings, so each is both value and label.
   Also used outside this form (Refund Adjustment, Payment Request), which
   pass `invalid` to flag a required field — keep that prop working. */
export function EditSelect({ value, options, onChange, placeholder, invalid, readOnly, locked, onLockedClick, badges, listBadgesOnly }: {
  value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
  /** Show the value in the wizard's locked-select box instead of a dropdown. */
  readOnly?: boolean;
  /** Options shown with a lock and not selectable: option → the reason shown on it. */
  locked?: Record<string, string>;
  /** Clicked while read-only, or on a locked option — the caller explains why. */
  onLockedClick?: (option?: string) => void;
  /** A tag beside an option (e.g. the product's segment); locked options also get the lock. */
  badges?: Record<string, { text: string; tone: 'green' | 'gray' | 'red' | 'violet' }>;
  /** Keep the badges in the open list and off the closed field. */
  listBadgesOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="spi-dt-select" aria-readonly="true" onClick={() => onLockedClick?.()} style={onLockedClick ? { cursor: 'not-allowed' } : undefined}>
        <FitTip label={value}><span>{value || placeholder || '—'}</span></FitTip>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </div>
    );
  }
  return (
    <MasterSelect
      value={value}
      options={options.map((o) => (locked?.[o]
        ? { value: o, label: o, disabled: true, disabledReason: locked[o], badge: { text: 'Locked', tone: 'gray' as const, lock: true },
          ...(badges?.[o] ? { badges: [badges[o]] } : {}) }
        : { value: o, label: o, ...(badges?.[o] ? { badge: badges[o] } : {}) }))}
      onChange={onChange}
      listBadgesOnly={listBadgesOnly}
      placeholder={placeholder ?? '— Select —'}
      invalid={invalid}
      onDisabledClick={onLockedClick ? (opt) => onLockedClick(opt.value) : undefined}
    />
  );
}
