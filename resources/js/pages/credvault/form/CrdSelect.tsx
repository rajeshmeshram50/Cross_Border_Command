import { MasterSelect } from '../../../components/ui/MasterSelect';

export interface CrdOption { value: string; label: string; dot?: string; disabled?: boolean; disabledReason?: string }

/** MasterSelect treats '' as "nothing picked", but here '' is a real choice
 *  (No rotation, Select…), so it travels under a stand-in value. */
const NONE = '__crd_none__';
export default function CrdSelect({ id, value, options, onChange, placeholder = 'Select…', disabled, onBlocked, rich }: {
  id?: string; value: string; options: CrdOption[]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
  /** Critical Vault / Team Vault form: a search box on every list, and the risk dots + tick. Off
   *  everywhere else (My Vault, Share, Import, Policies), which keep the plain list. */
  rich?: boolean;
  /** A click on a `disabled` option: the row stays clickable and this explains why it cannot be picked. */
  onBlocked?: (o: { value: string; label: string }) => void;
}) {
  const opts = options.map(o => ({ value: o.value === '' ? NONE : o.value, label: o.label, disabled: o.disabled, disabledReason: o.disabledReason }));
  // A risk list (options carry `dot`) gets the Figma dot + selected tick through crd-dots (form.css).
  const dots = !!rich && options.some(o => o.dot);
  return (
    <div id={id} className="crd-ms">
      <MasterSelect
        value={value === '' && options.some(o => o.value === '') ? NONE : value}
        options={opts}
        placeholder={placeholder}
        disabled={disabled}
        searchable={rich || opts.length > 8}
        menuClassName={dots ? 'crd-dots' : undefined}
        onDisabledClick={onBlocked ? o => onBlocked({ value: o.value, label: o.label }) : undefined}
        onChange={v => onChange(v === NONE ? '' : v)}
      />
    </div>
  );
}
