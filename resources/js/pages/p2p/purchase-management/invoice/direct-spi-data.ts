import { useEffect, useState } from 'react';
import type { PickRow } from './DirectSpiPicker';
import type { SupplierRow } from './DirectSpiSupplierPicker';
import { PoApiError, poLookupApi, type ShipmentOption, type SupplierOption } from '../order/api/po-api';

export type ShipmentRow = PickRow & { id: number; piNumber: string | null };

const slashDate = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

const shipmentRow = (s: ShipmentOption): ShipmentRow => ({
  id: s.id,
  code: s.code,
  title: s.customer || s.consignee || '—',
  sub: slashDate(s.shipment_date),
  piNumber: s.pi_number,
});

export function useShipmentRows(enabled = true) {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(null);
    poLookupApi.shipments()
      .then(list => { if (live) setRows((list ?? []).map(shipmentRow)); })
      .catch(e => { if (live) setError(e instanceof PoApiError ? e.firstError : 'Could not load shipments.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [enabled, tick]);

  return { rows, loading, error, retry: () => setTick(t => t + 1) };
}

const PEOPLE = [
  'Priya Sharma', 'Rohan Verma', 'Sneha Kulkarni', 'Vikram Singh', 'Ananya Iyer',
  'Karan Malhotra', 'Divya Nair', 'Arjun Mehta', 'Parth Lakare', 'Meera Joshi',
];
const TYPES = [
  { text: 'Material / Goods', tone: 'goods' as const },
  { text: 'FFD / Transporter', tone: 'ffd' as const },
  { text: 'Service', tone: 'service' as const },
];

export const PROCUREMENTS: PickRow[] = Array.from({ length: 57 }, (_, i) => {
  const n = i + 1;
  const owner = PEOPLE[i % PEOPLE.length];
  const raiser = PEOPLE[(i + 7) % PEOPLE.length];
  const day = String((i % 27) + 1).padStart(2, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  const pct = [100, 42, 100, 64, 100, 76, 88, 31, 100, 55][i % 10];
  return {
    code: `PC-${String(n).padStart(3, '0')}`,
    title: `Assigned to ${owner}`,
    sub: `Raised by ${raiser} · ${day}/${month}/2025 · ${pct}% complete`,
    tag: TYPES[i % TYPES.length],
  };
});

export const NEXT_PROCUREMENT = `PC-${String(PROCUREMENTS.length + 1).padStart(3, '0')}`;

const kindOf = (type?: string | null): SupplierRow['kind'] => {
  const t = (type ?? '').toLowerCase();
  if (t.includes('service')) return 'service';
  if (/ffd|transport|logistic|trad/.test(t)) return 'trader';
  return 'manufacturer';
};

const supplierRow = (v: SupplierOption): SupplierRow => ({
  id: v.id,
  docType: v.document_type,
  code: v.code,
  name: v.name,
  kind: kindOf(v.supplier_type),
  segment: v.segments ?? [],
  location: [v.city, v.state].filter(Boolean).join(', ') || '—',
  risk: !v.risk ? '—' : /risk/i.test(v.risk) ? v.risk : `${v.risk} Risk`,
});

export function useSupplierRows(enabled = true) {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(null);
    poLookupApi.suppliers('domestic')
      .then(list => { if (live) setRows((list ?? []).map(supplierRow)); })
      .catch(e => { if (live) setError(e instanceof PoApiError ? e.firstError : 'Could not load suppliers.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [enabled, tick]);

  return { rows, loading, error, retry: () => setTick(t => t + 1) };
}
