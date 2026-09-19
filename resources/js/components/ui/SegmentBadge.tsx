import { useEffect, useState, type CSSProperties } from 'react';
import api from '../../api';

export type RegulatoryStatus = 'highly' | 'less';

/* Colours match the Segment Master badges:
 *   Reg-High → red     #dc2626 (bg 7%, border 22%)
 *   Reg-Low  → emerald #0d9488 (bg 7%, border 22%)
 * Dark mode lifts brightness via the rule injected below. */
const TONES: Record<RegulatoryStatus, { color: string; bg: string; border: string; short: string; full: string }> = {
  highly: { color: '#dc2626', bg: 'rgba(220,38,38,.07)', border: 'rgba(220,38,38,.22)', short: 'High', full: 'Highly Regulated' },
  less:   { color: '#0d9488', bg: 'rgba(13,148,136,.07)', border: 'rgba(13,148,136,.22)', short: 'Less', full: 'Less Regulated' },
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

/* ── Name-based lookup, for records that store the segment NAME (customer, consignee) ── */

let nameMapPromise: Promise<Map<string, string | null>> | null = null;
let nameMapAt = 0;

/** lower(name) → status across all the user's branches; a name with both Reg-High and Reg-Low defaults to Reg-High. */
function loadNameMap(): Promise<Map<string, string | null>> {
  if (nameMapPromise && Date.now() - nameMapAt < 5 * 60_000) return nameMapPromise;
  nameMapAt = Date.now();
  nameMapPromise = api.get<{ data?: { name?: string; regulatory_status?: string }[] }>('/clm/segments', { params: { branch_id: 0 } })
    .then(res => {
      const m = new Map<string, string | null>();
      for (const s of res.data?.data ?? []) {
        const k = (s.name ?? '').trim().toLowerCase();
        if (!k || !isStatus(s.regulatory_status)) continue;
        if (m.get(k) !== 'highly') m.set(k, s.regulatory_status);
      }
      return m;
    })
    .catch(() => { nameMapPromise = null; return new Map<string, string | null>(); });
  return nameMapPromise;
}

export function useSegmentStatusByName(): (name?: string | null) => string | null {
  const [map, setMap] = useState<Map<string, string | null> | null>(null);
  useEffect(() => { let live = true; void loadNameMap().then(m => { if (live) setMap(m); }); return () => { live = false; }; }, []);
  return (name) => map?.get((name ?? '').trim().toLowerCase()) ?? null;
}

/** Badge for a segment known only by name (Reg-High when the name has both). Renders nothing when unknown. */
export function SegmentNameBadge({ name, style }: { name?: string | null; style?: CSSProperties }) {
  const statusOf = useSegmentStatusByName();
  return <SegmentBadge status={statusOf(name)} style={{ marginLeft: 5, flexShrink: 0, ...style }} />;
}

/** One-line "Sugar [Reg-High] +2": only the name truncates, so the badge and count stay visible. */
export function SegmentBadgeLine({ label, status, more = 0 }: { label: string; status?: string | null; more?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', minWidth: 0, verticalAlign: 'bottom' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
      <SegmentBadge status={status} style={{ flexShrink: 0 }} />
      {more > 0 && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '0 6px', borderRadius: 999, background: 'rgba(124,58,237,.1)' }}>+{more}</span>}
    </span>
  );
}

/** "S-001: Sugar [Reg-High], Rice [Reg-Low]" for a name list (array or comma string). */
export type SegmentItem = { name: string; code?: string | null; regulatory_status?: string | null };

/** Pass `items` (known segments, e.g. from `segments` in the API) — the name lookup is only a fallback. */
export function SegmentNameList({ names, codeOf, compact = false, items }: {
  names?: string | string[] | null; codeOf?: (name: string) => string | undefined; compact?: boolean; items?: SegmentItem[];
}) {
  const statusOf = useSegmentStatusByName();
  const rows: { label: string; status: string | null }[] = items
    ? items.map(s => ({ label: s.code ? `${s.code}: ${s.name}` : s.name, status: s.regulatory_status ?? null }))
    : (Array.isArray(names) ? names : String(names ?? '').split(',').map(s => s.trim()).filter(Boolean))
        .map(n => { const code = codeOf?.(n); return { label: code ? `${code}: ${n}` : n, status: statusOf(n) }; });
  if (!rows.length) return <>—</>;
  // One-line cells: truncate only the first name so its badge and the "+N" stay visible.
  if (compact) return <SegmentBadgeLine label={rows[0].label} status={rows[0].status} more={rows.length - 1} />;
  return (
    <>
      {rows.map((r, i) => (
        <span key={`${r.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 6 }}>
          {r.label}
          <SegmentBadge status={r.status} />
          {i < rows.length - 1 ? ',' : ''}
        </span>
      ))}
    </>
  );
}
