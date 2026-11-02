import { MasterSelect } from '../../../components/ui/MasterSelect';

export interface CrdOption { value: string; label: string; dot?: string }

/** MasterSelect treats '' as "nothing picked", but here '' is a real choice
 *  (No rotation, Select…), so it travels under a stand-in value. */
const NONE = '__crd_none__';

/**
 * The CredVault form's dropdown — the house MasterSelect (the one the masters
 * and the SPI popups use), sized and tinted to sit with the form's inputs.
 * A search box only shows on a long list. `dot` is kept on the type for the
 * callers; the house list has no leading dot.
 */
export default function CrdSelect({ id, value, options, onChange, placeholder = 'Select…', disabled }: {
  id?: string; value: string; options: CrdOption[]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const opts = options.map(o => ({ value: o.value === '' ? NONE : o.value, label: o.label }));
  return (
    <div id={id} className="crd-ms">
      <MasterSelect
        value={value === '' && options.some(o => o.value === '') ? NONE : value}
        options={opts}
        placeholder={placeholder}
        disabled={disabled}
        searchable={opts.length > 8}
        onChange={v => onChange(v === NONE ? '' : v)}
      />
    </div>
  );
}
