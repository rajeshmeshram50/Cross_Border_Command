import { MasterSelect } from './MasterSelect';

/**
 * Multi-value variant of MasterSelect — a chip row + an inline picker
 * for adding more. Used in Stage 1 of the customer/consignee/supplier
 * onboarding wizards so a record can be tagged with multiple segments
 * (the segment-rule resolver then unions all selected segments' DD /
 * KYC / TL / TD / QC docs into Stage 2 + Stage 3).
 *
 * Visual notes:
 *   • The picker reuses MasterSelect so the dropdown styling/auto-flip
 *     stays consistent with the rest of the form.
 *   • Already-picked values are removed from the picker's options so the
 *     same segment can't be added twice.
 *   • The chip's × removes the value; no confirmation since this is a
 *     pure UI selection (no API side-effect).
 */
export function MasterMultiSelect({
  values,
  options,
  placeholder = 'Select…',
  addMorePlaceholder = '+ Add another',
  disabled,
  invalid,
  onChange,
}: {
  values: string[];
  options: { value: string; label: string }[];
  placeholder?: string;
  addMorePlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (next: string[]) => void;
}) {
  const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const remaining = options.filter(o => !values.includes(o.value));

  const remove = (v: string) => {
    if (disabled) return;
    onChange(values.filter(x => x !== v));
  };
  const add = (v: string) => {
    if (!v || disabled || values.includes(v)) return;
    onChange([...values, v]);
  };

  return (
    <div className={`mms-root ${invalid ? 'mms-invalid' : ''}`}>
      <style>{MMS_CSS}</style>
      {values.length > 0 && (
        <div className="mms-chips">
          {values.map(v => (
            <span key={v} className="mms-chip" title={labelFor(v)}>
              <span className="mms-chip-label">{labelFor(v)}</span>
              {!disabled && (
                <button
                  type="button"
                  className="mms-chip-x"
                  aria-label={`Remove ${labelFor(v)}`}
                  onClick={() => remove(v)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <MasterSelect
        value=""
        options={remaining}
        placeholder={values.length === 0 ? placeholder : addMorePlaceholder}
        disabled={disabled || remaining.length === 0}
        invalid={invalid}
        onChange={add}
      />
    </div>
  );
}

const MMS_CSS = `
.mms-root { display:flex; flex-direction:column; gap:6px; }
.mms-chips { display:flex; flex-wrap:wrap; gap:6px; }
.mms-chip {
  display:inline-flex; align-items:center; gap:4px;
  padding:3px 4px 3px 10px; border-radius:999px;
  background:linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  border:1px solid #c4b5fd;
  font-size:11.5px; font-weight:600; color:#5b21b6;
  max-width:240px;
}
.mms-chip-label {
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.mms-chip-x {
  display:inline-flex; align-items:center; justify-content:center;
  width:18px; height:18px; border-radius:999px;
  background:rgba(91,33,182,0.12); border:none; cursor:pointer;
  color:#5b21b6; font-size:14px; line-height:1; font-weight:700;
  padding:0;
}
.mms-chip-x:hover { background:#7c3aed; color:#fff; }
.mms-invalid > div:last-child { border-color:#ef4444; }
`;
