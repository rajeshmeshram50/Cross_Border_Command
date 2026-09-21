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
};

export type PoLookups = {
  loading: boolean;
  suppliers: SupplierOption[];
  products: ProductOpt[];
  currencies: string[];
  incoterms: string[];
  countries: string[];
  portsLoading: string[];
  portsDischarge: string[];
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
  };
}

export const EMPTY_LOOKUPS: PoLookups = {
  loading: true, suppliers: [], products: [], currencies: [], incoterms: [], countries: [], portsLoading: [], portsDischarge: [],
  reloadProducts: () => {},
};

export function usePoLookups(onError: (what: string, message: string) => void): PoLookups {
  const [lookups, setLookups] = useState<PoLookups>(EMPTY_LOOKUPS);

  useEffect(() => {
    let alive = true;
    // Each list loads on its own; one failing never blanks the others.
    const load = <T,>(what: string, p: Promise<T>, apply: (v: T) => Partial<PoLookups>) =>
      p.then((v) => { if (alive) setLookups((l) => ({ ...l, ...apply(v) })); })
        .catch((e) => { if (alive) onError(what, e?.firstError ?? 'Could not load.'); });

    Promise.allSettled([
      load('Suppliers', poLookupApi.suppliers(), (suppliers) => ({ suppliers })),
      load('Products', poLookupApi.products(), (rows) => ({ products: rows.map(toProduct).filter((p) => p.id && p.name) })),
      load('Currencies', poLookupApi.master('currencies'), (rows) => ({ currencies: names(rows, 'code') })),
      load('Incoterms', poLookupApi.master('incoterms'), (rows) => ({ incoterms: names(rows, 'code') })),
      load('Countries', poLookupApi.master('countries'), (rows) => ({ countries: names(rows, 'name') })),
      load('Ports of loading', poLookupApi.master('port_of_loading'), (rows) => ({ portsLoading: names(rows, 'name') })),
      load('Ports of discharge', poLookupApi.master('port_of_discharge'), (rows) => ({ portsDischarge: names(rows, 'name') })),
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
