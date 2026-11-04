import { MasterSelect } from '../../../components/ui/MasterSelect';

export interface CrdOption { value: string; label: string; dot?: string }

/** MasterSelect treats '' as "nothing picked", but here '' is a real choice
 *  (No rotation, Select…), so it travels under a stand-in value. */
const NONE = '__crd_none__';
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
