// Dropdown data the Create PO form needs, loaded once when the form opens.
import { useEffect, useState } from 'react';
import { poLookupApi, type SupplierOption } from '../api/po-api';

/** A product master record as the PO product picker uses it. */
export type ProductOpt = {
  id: number;
  code: string;
  name: string;
  hsn: string;
  /** GST % from the product master; null = not set, the server refuses the line. */
  gst: number | null;
  description: string;
  price: number;
  /** The product's segment (clm_segments); a PO orders only its supplier's segments. */
  segment: string;
};

export type PoLookups = {
  loading: boolean;
  suppliers: SupplierOption[];
  products: ProductOpt[];
  currencies: string[];
  countries: string[];
  /** Re-fetch the product master (after a product is added or edited). */
  reloadProducts: () => void;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const active = (r: Row) => str(r.status || 'Active') === 'Active';
const names = (rows: Row[], field: string) => [...new Set(rows.filter(active).map((r) => str(r[field])).filter(Boolean))];

function toProduct(p: Row): ProductOpt {
  const gstRel = (p.gst_percentage ?? p.gstPercentage) as { percentage?: unknown } | null | undefined;
  return {
    id: num(p.id),
    code: str(p.product_code),
    name: str(p.name),
    hsn: str((p.hsn as { hsn_code?: unknown } | null | undefined)?.hsn_code),
    gst: gstRel?.percentage != null ? num(gstRel.percentage) : null,
    description: str(p.description),
    price: num(p.base_price),
    segment: str((p.segment as { name?: unknown } | null | undefined)?.name),
  };
}

export const EMPTY_LOOKUPS: PoLookups = {
  loading: true, suppliers: [], products: [], currencies: [], countries: [],
  reloadProducts: () => {},
};

/* Masters rarely change, so they are cached for the session (10 min), keyed by
   user + selected branch so a branch switch never shows another branch's list. */
const MASTER_TTL_MS = 10 * 60 * 1000;
const masterCache = new Map<string, { at: number; rows: Promise<Row[]> }>();

function tenantKey(): string {
  try {
    const user = JSON.parse(localStorage.getItem('cbc_user') ?? 'null') as { id?: number } | null;
    return `${user?.id ?? 0}:${localStorage.getItem(`cbc_selected_branch_id_${user?.id}`) ?? 'all'}`;
  } catch {
    return 'anon';
  }
}

function cachedMaster(slug: string): Promise<Row[]> {
  const key = `${tenantKey()}:${slug}`;
  const hit = masterCache.get(key);
  if (hit && Date.now() - hit.at < MASTER_TTL_MS) return hit.rows;
  const rows = poLookupApi.master(slug);
  masterCache.set(key, { at: Date.now(), rows });
  rows.catch(() => masterCache.delete(key)); // a failed load is retried next time
  return rows;
}

export function usePoLookups(onError: (what: string, message: string) => void): PoLookups {
  const [lookups, setLookups] = useState<PoLookups>(EMPTY_LOOKUPS);

  useEffect(() => {
    let alive = true;
    // Each list loads on its own, all in parallel; one failing never blanks the others.
    const load = <T,>(what: string, p: Promise<T>, apply: (v: T) => Partial<PoLookups>) =>
      p.then((v) => { if (alive) setLookups((l) => ({ ...l, ...apply(v) })); })
        .catch((e) => { if (alive) onError(what, e?.firstError ?? 'Could not load.'); });

    Promise.allSettled([
      // Suppliers and products change often (added from this form), so they are always fresh.
      load('Suppliers', poLookupApi.suppliers(), (suppliers) => ({ suppliers })),
      load('Products', poLookupApi.products(), (rows) => ({ products: rows.map(toProduct).filter((p) => p.id && p.name) })),
      load('Currencies', cachedMaster('currencies'), (rows) => ({ currencies: names(rows, 'code') })),
      load('Countries', cachedMaster('countries'), (rows) => ({ countries: names(rows, 'name') })),
    ]).then(() => { if (alive) setLookups((l) => ({ ...l, loading: false })); });

    return () => { alive = false; };
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadProducts = () => {
    poLookupApi.products()
      .then((rows) => setLookups((l) => ({ ...l, products: rows.map(toProduct).filter((p) => p.id && p.name) })))
      .catch((e) => onError('Products', e?.firstError ?? 'Could not load.'));
  };

  return { ...lookups, reloadProducts };
}
