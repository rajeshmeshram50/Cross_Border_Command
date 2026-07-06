import Tooltip from '../../../components/ui/Tooltip';

/**
 * Renders a comma-joined (or array) authority list as "First +N": the first
 * authority as a teal badge plus a +N pill when there are more, with the full
 * list shown on hover via the shared Tooltip. Keeps long issuing-authority
 * lists from bloating the table row — matches the Trade Licence master's +N
 * treatment so KYC / DD / (future) masters read consistently.
 */
export default function AuthorityBadges({ value }: { value?: string | string[] | null }) {
  const list = Array.isArray(value)
    ? value.map(s => String(s).trim()).filter(Boolean)
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);

  if (list.length === 0) return <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>;

  const extra = list.length - 1;
  const chip = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className="clm-badge clm-badge-teal">{list[0]}</span>
      {extra > 0 && (
        <span
          aria-label={`+${extra} more issuing ${extra > 1 ? 'authorities' : 'authority'}`}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20,
            background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)',
            color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'default',
            flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)',
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );

  // No overflow → plain chip; otherwise wrap in a Tooltip listing every value.
  return extra > 0 ? <Tooltip label={list.join(', ')}>{chip}</Tooltip> : chip;
}
