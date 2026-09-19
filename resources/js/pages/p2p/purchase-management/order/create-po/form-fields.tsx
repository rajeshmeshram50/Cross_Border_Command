// Label + field and the dropdown for this form. The field wears the shared
// P2P wizard classes; the dropdown is the app's MasterSelect.
import type { ReactNode } from 'react';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';

/* Label + control, one cell of a wizard field grid. */
export function Field({ label, children, full, req }: { label: string; children: ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}

/* Every dropdown in the form is the app's standard MasterSelect — a search box
   on top, options below — so the PO form behaves like every other screen.
   The options here are plain strings, so each is both value and label.
   Also used outside this form (Refund Adjustment, Payment Request), which
   pass `invalid` to flag a required field — keep that prop working. */
export function EditSelect({ value, options, onChange, placeholder, invalid }: {
  value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
}) {
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
