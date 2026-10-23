import { useEffect, useState, type CSSProperties } from 'react';
import api from '../../api';

export type RegulatoryStatus = 'highly' | 'less';

/* Colours match the Segment Master badges:
 *   Reg-High → red     #dc2626 (bg 7%, border 22%)
 *   Reg-Low  → emerald #0d9488 (bg 7%, border 22%)
 * Dark mode swaps to the lighter `dark` tone via the rule injected below. */
const TONES: Record<RegulatoryStatus, { color: string; bg: string; border: string; dark: string; short: string; full: string }> = {
  highly: { color: '#dc2626', bg: 'rgba(220,38,38,.07)', border: 'rgba(220,38,38,.22)', dark: '#f87171', short: 'High', full: 'Highly Regulated' },
  less:   { color: '#0d9488', bg: 'rgba(13,148,136,.07)', border: 'rgba(13,148,136,.22)', dark: '#2dd4bf', short: 'Less', full: 'Less Regulated' },
};

/** Dark-mode text colour for the segment rule-type tags (INT / DOM / +2) in the segment pickers. */
export const SEG_TAG_DARK: Record<string, string> = { INT: '#a5b4fc', DOM: '#5eead4', '+2': '#c4b5fd' };

/* One global dark rule for .seg-reg-badge and .seg-type-badge: the light
 * colours are inline, so dark mode reads the badge's --sb-dk tone and
 * derives a translucent fill + border from it (overrides need !important). */
if (typeof document !== 'undefined' && !document.getElementById('seg-badge-dark')) {
  const el = document.createElement('style');
  el.id = 'seg-badge-dark';
  el.textContent = '[data-bs-theme="dark"] :is(.seg-reg-badge,.seg-type-badge){'
    + 'color:var(--sb-dk)!important;'
    + 'background:color-mix(in srgb,var(--sb-dk) 14%,transparent)!important;'
    + 'border-color:color-mix(in srgb,var(--sb-dk) 38%,transparent)!important}';
  document.head.appendChild(el);
}

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
        verticalAlign: 'middle', '--sb-dk': tone.dark, ...style,
      } as CSSProperties}
    >
      {full ? tone.full : tone.short}
    </span>
  ) : null;

  if (!name) return badge;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
      {badge}
    </span>
  );
}

/* ── Name-based lookup, for records that store the segment NAME (customer, consignee) ── */

type NameMap = Map<string, string | null>;

const NAME_MAP_TTL_MS = 5 * 60_000;
/* The last answer is also kept in localStorage, so a page refresh or a later
   visit draws the badges at once instead of shimmering for a full round trip
   (QA #1/#12: ~1.2 s on live). It is still refetched in the background and the
   badges follow the fresh answer. Older than a day, it is not trusted at all. */
const STORED_MAX_AGE_MS = 24 * 60 * 60_000;

let nameMap: NameMap | null = null;
let nameMapAt = 0;           // 0 = came from storage (or never loaded): refetch on next use
let nameMapOwner = '';       // which user the in-memory map belongs to
let nameMapInFlight: Promise<NameMap> | null = null;
const nameMapListeners = new Set<(m: NameMap) => void>();

/** Per user: segments are tenant- and branch-scoped, so one user's map must never feed another's badges. */
function nameMapOwnerKey(): string {
  try {
    const u = JSON.parse(localStorage.getItem('cbc_user') || 'null');
    return u?.id ? `cbc_seg_status_v1:${u.id}` : '';
  } catch { return ''; }
}

function readStoredNameMap(owner: string): NameMap | null {
  if (!owner) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(owner) || 'null') as { at?: number; pairs?: [string, string | null][] } | null;
    if (!saved?.at || !Array.isArray(saved.pairs) || Date.now() - saved.at > STORED_MAX_AGE_MS) return null;
    return new Map(saved.pairs);
  } catch { return null; }
}

/** The map this user may show right now (fresh, stale or from storage), or null when there is none yet. */
function currentNameMap(): NameMap | null {
  const owner = nameMapOwnerKey();
  if (owner !== nameMapOwner) {
    // Another user signed in on this tab: drop the previous user's map.
    nameMapOwner = owner;
    nameMap = readStoredNameMap(owner);
    nameMapAt = 0;
  }
  return nameMap;
}

const nameMapIsFresh = () => !!nameMap && nameMapAt > 0 && Date.now() - nameMapAt < NAME_MAP_TTL_MS;

/** lower(name) → status across all the user's branches; a name with both Reg-High and Reg-Low defaults to Reg-High. */
function fetchNameMap(): Promise<NameMap> {
  if (nameMapInFlight) return nameMapInFlight;
  const owner = nameMapOwnerKey();
  nameMapInFlight = api.get<{ data?: { name?: string; regulatory_status?: string }[] }>('/clm/segments', { params: { branch_id: 0, lite: 1 } })
    .then(res => {
      const m: NameMap = new Map();
      for (const s of res.data?.data ?? []) {
        const k = (s.name ?? '').trim().toLowerCase();
        if (!k || !isStatus(s.regulatory_status)) continue;
        if (m.get(k) !== 'highly') m.set(k, s.regulatory_status);
      }
      if (owner === nameMapOwnerKey()) {
        nameMap = m;
        nameMapAt = Date.now();
        nameMapOwner = owner;
        try { if (owner) localStorage.setItem(owner, JSON.stringify({ at: nameMapAt, pairs: [...m] })); } catch { /* storage full or blocked — memory still works */ }
        nameMapListeners.forEach(l => l(m));
      }
      return m;
    })
    // Same as before on failure: keep whatever is showing, retry on the next use.
    .catch(() => nameMap ?? new Map<string, string | null>())
    .finally(() => { nameMapInFlight = null; });
  return nameMapInFlight;
}

export function useSegmentStatusByName(): (name?: string | null) => string | null {
  return useSegmentStatusByNameState().statusOf;
}

/** The same lookup, plus whether it has arrived.
 *
 *  The map is fetched once and cached for five minutes, so most callers get it
 *  immediately. On the first open of a session it is still in flight, and a
 *  badge that renders nothing until it lands lets the operator read and tick a
 *  row before its regulatory tier appears - which is the one fact that would
 *  have changed the choice. Knowing it is loading is what lets the row say so. */
export function useSegmentStatusByNameState(): {
  statusOf: (name?: string | null) => string | null;
  loading: boolean;
} {
  const [map, setMap] = useState<NameMap | null>(() => currentNameMap());
  useEffect(() => {
    let live = true;
    const onFresh = (m: NameMap) => { if (live) setMap(m); };
    nameMapListeners.add(onFresh);
    const shown = currentNameMap();
    if (shown) setMap(shown);
    if (!nameMapIsFresh()) void fetchNameMap().then(onFresh);
    return () => { live = false; nameMapListeners.delete(onFresh); };
  }, []);
  return {
    statusOf: (name) => map?.get((name ?? '').trim().toLowerCase()) ?? null,
    loading: map === null,
  };
}

/** Badge for a segment known only by name (Reg-High when the name has both). Renders nothing when unknown. */
/** Badge for a segment item: its own tier when known, else the name lookup. */
export function SegmentItemBadge({ item, style }: { item: SegmentItem; style?: CSSProperties }) {
  if (item.regulatory_status !== undefined) return <SegmentBadge status={item.regulatory_status} style={{ marginLeft: 5, flexShrink: 0, ...style }} />;
  return <SegmentNameBadge name={item.name} style={style} />;
}

export function SegmentNameBadge({ name, style }: { name?: string | null; style?: CSSProperties }) {
  const { statusOf, loading } = useSegmentStatusByNameState();
  /* While the tiers are in flight the row holds their place and shimmers, so
     the badges arrive in a space already reserved rather than appearing under
     a cursor that has moved on. */
  if (loading) return <SegmentBadgeSkeleton style={style} />;
  return <SegmentBadge status={statusOf(name)} style={{ marginLeft: 5, flexShrink: 0, ...style }} />;
}

/** The badge's own footprint, shimmering, using app.css's global keyframe. */
export function SegmentBadgeSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        marginLeft: 5, flexShrink: 0, display: 'inline-block',
        width: 42, height: 17, borderRadius: 999,
        background: 'linear-gradient(90deg, rgba(148,163,184,.14) 0%, rgba(148,163,184,.3) 50%, rgba(148,163,184,.14) 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.3s ease-in-out infinite',
        ...style,
      }}
    />
  );
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
