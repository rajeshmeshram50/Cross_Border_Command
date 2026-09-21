// Label + field and the dropdown for this form. The field wears the shared
// P2P wizard classes; the dropdown is the app's MasterSelect.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import Tooltip from '../../../../../components/ui/Tooltip';

/* A value that must stay on one line in a fixed-width cell. When it doesn't
   fit it ends in "…", and the full value shows in the tooltip — only then,
   so short numbers don't get a pointless hover. */
export function FitText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <Tooltip label={text} disabled={!cut}>
      <span ref={ref} className={`cpf-fit${className ? ` ${className}` : ''}`}>{text}</span>
    </Tooltip>
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
export function Field({ label, children, full, req }: { label: string; children: ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}

/* Every dropdown in the form is the app's standard MasterSelect — a search box
   on top, options below — so the PO form behaves like every other screen.
   The options here are plain strings, so each is both value and label.
   Also used outside this form (Refund Adjustment, Payment Request), which
   pass `invalid` to flag a required field — keep that prop working. */
export function EditSelect({ value, options, onChange, placeholder, invalid, readOnly }: {
  value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
  /** Show the value in the wizard's locked-select box instead of a dropdown. */
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="spi-dt-select" title={value || undefined} aria-readonly="true">
        <span>{value || placeholder || '—'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </div>
    );
  }
  return (
    <MasterSelect
      value={value}
      options={options.map((o) => ({ value: o, label: o }))}
      onChange={onChange}
      placeholder={placeholder ?? '— Select —'}
      invalid={invalid}
    />
  );
}
