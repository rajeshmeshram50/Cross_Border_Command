import type { CSSProperties } from 'react';

export type RegulatoryStatus = 'highly' | 'less';

/* Colours match the Segment Master badges:
 *   Reg-High → red     #dc2626 (bg 7%, border 22%)
 *   Reg-Low  → emerald #0d9488 (bg 7%, border 22%)
 * Dark mode lifts brightness via the rule injected below. */
const TONES: Record<RegulatoryStatus, { color: string; bg: string; border: string; short: string; full: string }> = {
  highly: { color: '#dc2626', bg: 'rgba(220,38,38,.07)', border: 'rgba(220,38,38,.22)', short: 'Reg-High', full: 'Highly Regulated' },
  less:   { color: '#0d9488', bg: 'rgba(13,148,136,.07)', border: 'rgba(13,148,136,.22)', short: 'Reg-Low', full: 'Less Regulated' },
};

const isStatus = (v: unknown): v is RegulatoryStatus => v === 'highly' || v === 'less';

/** "Sugar · Reg-High" — for dropdown options and plain text. */
export function segmentLabel(name?: string | null, status?: string | null): string {
  const n = (name ?? '').trim();
  return isStatus(status) ? `${n} · ${TONES[status].short}` : n;
}

type Props = {
  status?: string | null;
  /** When given, renders the name followed by the badge. */
  name?: string | null;
  /** Full label ("Highly Regulated") instead of the short one ("Reg-High"). */
  full?: boolean;
  style?: CSSProperties;
};

/** Regulatory condition of a segment: Reg-High (red) / Reg-Low (green). Renders nothing for an unknown status. */
export default function SegmentBadge({ status, name, full = false, style }: Props) {
  const tone = isStatus(status) ? TONES[status] : null;
  const badge = tone ? (
    <span
      className="seg-reg-badge"
      title={tone.full}
      style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 999,
        fontSize: 10, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap',
        color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`,
        verticalAlign: 'middle', ...style,
      }}
    >
      {full ? tone.full : tone.short}
    </span>
  ) : null;

  const darkRule = <style>{'[data-bs-theme="dark"] .seg-reg-badge{filter:brightness(1.35)}'}</style>;

  if (!name) return badge ? <>{darkRule}{badge}</> : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
      {darkRule}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
      {badge}
    </span>
  );
}
