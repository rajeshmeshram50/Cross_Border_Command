/* ─────────────────────────────────────────────────────────────────────────
 * Sourcing Management Tracker — types and the API row mapper.
 *
 * The list comes from GET /p2p/sourcing-targets?tab=all|created|assigned
 * (same targets as Bulk Sourcing). The screens read SourcingTarget; fromApi()
 * is the one place where the API's field names are turned into ours.
 * ───────────────────────────────────────────────────────────────────────── */

export type SourceType = 'Product Master' | 'Manual Entry';

export type SourcingTarget = {
  /** SRC-001 — per-client sequential. */
  code: string;
  /** Start date, ISO yyyy-mm-dd. Always the day the target was created. */
  startDate: string;
  /** Sourcing TAT — the due date, ISO yyyy-mm-dd. */
  dueDate: string;
  /** Where the products came from; a target can hold both. */
  sources: SourceType[];
  createdBy: string;
  assignedTo: string;
  /** First product's name, shown as "Flow Meter DN50 +13". */
  firstProduct: string;
  /** Products on the target. */
  totalProducts: number;
  /** Products with at least one supplier mapped (= sourced). */
  completedProducts: number;
  /** Suppliers mapped across all of the target's products. */
  mappedSuppliers: number;
  /** Server-computed: past the TAT and not fully sourced. */
  overdue?: boolean;
  /** User ids, for the creator-only Edit and the assignee-only Map Supplier. */
  createdById?: string | null;
  assigneeId?: string | null;
};

/** One row of GET /p2p/sourcing-targets?tab=… (only the fields the screens use). */
export type ApiTargetRow = {
  id: string;
  source?: string;
  sources?: string[];
  start?: string;
  due?: string;
  createdBy?: string;
  assignee?: string;
  products?: number;
  completed?: number;
  mappedSuppliers?: number;
  overdue?: boolean;
  createdById?: string | null;
  assigneeId?: string | null;
  firstProduct?: string | null;
};

const asSource = (s?: string): SourceType => (s === 'Manual Entry' ? 'Manual Entry' : 'Product Master');

export const fromApi = (r: ApiTargetRow): SourcingTarget => ({
  code: r.id,
  startDate: r.start ?? '',
  dueDate: r.due ?? '',
  sources: r.sources?.length ? r.sources.map(asSource) : [asSource(r.source)],
  createdBy: r.createdBy || '—',
  assignedTo: r.assignee || '—',
  firstProduct: r.firstProduct || '—',
  totalProducts: r.products ?? 0,
  completedProducts: r.completed ?? 0,
  mappedSuppliers: r.mappedSuppliers ?? 0,
  overdue: r.overdue,
  createdById: r.createdById ?? null,
  assigneeId: r.assigneeId ?? null,
});

/* ── Derived state (never stored) ─────────────────────────────────────── */

export const isComplete = (r: SourcingTarget) => r.totalProducts > 0 && r.completedProducts >= r.totalProducts;

const progressPct = (r: SourcingTarget) =>
  r.totalProducts ? Math.round((Math.min(r.completedProducts, r.totalProducts) / r.totalProducts) * 100) : 0;

/** Total / done / pending / % / complete for a target — the list row, the report and the Product
    List popup all read these, so they always show the same numbers (CS-2216 V-T69). */
export const progressOf = (r: SourcingTarget) => {
  const total = r.totalProducts;
  const done = Math.min(r.completedProducts, total);
  return { total, done, pending: total - done, pct: progressPct(r), full: isComplete(r) };
};

type TatState = 'ontrack' | 'atrisk' | 'overdue';

/** On track / at risk (due within 7 days) / overdue — a finished target is always on track. */
export const tatState = (r: SourcingTarget): TatState => {
  if (isComplete(r)) return 'ontrack';
  // Overdue is the server's call (it knows the real date); at-risk is counted from today here.
  const days = r.dueDate ? Math.round((Date.parse(r.dueDate) - Date.parse(todayIso())) / 86400000) : Infinity;
  if (r.overdue ?? days < 0) return 'overdue';
  return days <= 7 ? 'atrisk' : 'ontrack';
};


/** One product row in the Assign / Edit popup (until it is saved). */
export type DraftProduct = {
  key: string;
  /** The saved product's id (Edit): sent back so the server keeps the row instead of re-adding it. */
  id?: number;
  /** Has suppliers mapped: it cannot be removed from the target. */
  mapped?: boolean;
  source: SourceType;
  code: string;      // '—' for a manual product
  name: string;
  segment: string;
  hsn: string;
  targetPrice: string;   // required
};

/** Today's real date, local time, yyyy-mm-dd. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
