import { useCallback, useEffect, useState } from 'react';
import api from '../../../../api';
import type { Clarity } from './ClarityDialog';
import type { DraftProduct, SourcingTarget } from './data';

/* A target's products, from GET /p2p/sourcing-targets/{id}/report. The Sourcing Target Report and
   the Product List popup both read them through useTargetReport, so their numbers always agree. */

export type ReportProduct = DraftProduct & {
  /** The sourcing product's id: every map / mapped-suppliers call is made with it. */
  id: number;
  /** Sourcing status from the server (Completed once a supplier is mapped). */
  done: boolean;
  suppliers: number;
  clarity?: Clarity;
};

type ApiProduct = {
  id: number; type?: string; code?: string; name?: string; segment?: string | null; hsn?: string | null;
  price?: string | number | null; status?: string; supplierCount?: number;
  clarity?: { type: 'text' | 'link' | 'pdf'; val: string } | null;
};

const dash = (v?: string | null) => (v && String(v).trim() ? String(v) : '—');

const toProduct = (p: ApiProduct): ReportProduct => {
  const manual = p.type === 'manual';
  return {
    key: `p-${p.id}`,
    id: p.id,
    source: manual ? 'Manual Entry' : 'Product Master',
    code: manual ? '—' : dash(p.code),
    name: p.name || '—',
    segment: manual ? '—' : dash(p.segment),
    hsn: manual ? '—' : dash(p.hsn),
    // The server keeps the price as typed ("18,500"); the popups format plain digits.
    targetPrice: String(p.price ?? '').replace(/,/g, ''),
    done: p.status === 'Completed',
    suppliers: p.supplierCount ?? 0,
    clarity: p.clarity && p.clarity.val ? { type: p.clarity.type, value: p.clarity.val } : undefined,
  };
};

/** Total / done / pending / % / complete from the loaded products (same rule as the list row). */
export const productProgress = (products: ReportProduct[]) => {
  const total = products.length;
  const done = products.filter(p => p.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { total, done, pending: total - done, pct, full: total > 0 && done >= total };
};

/**
 * Loads a target's report. `refreshKey` reloads it (e.g. after a supplier is mapped); while a
 * reload runs the previous products stay on screen, so the table does not flash empty.
 */
export function useTargetReport(row: SourcingTarget, refreshKey = 0) {
  const [products, setProducts] = useState<ReportProduct[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.get<{ data: { products?: ApiProduct[] } }>(`/p2p/sourcing-targets/${encodeURIComponent(row.code)}/report`)
      .then(r => { if (alive) setProducts((r.data?.data?.products ?? []).map(toProduct)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [row.code, refreshKey, retry]);

  const reload = useCallback(() => setRetry(n => n + 1), []);
  return { products, loading: products === null && !failed, failed, reload };
}

/** A clarity document's stored paths (a product can hold several, newline-joined). */
export const clarityPaths = (c: Clarity) => c.value.split('\n').map(s => s.trim()).filter(Boolean);
export const fileOf = (path: string) => path.split('/').pop() || path;

/**
 * Open a clarity document in a new tab: a file picked in this session, or a stored one fetched
 * through the API (the plain /storage link would skip the company check). The tab is opened first,
 * on the click itself, so the browser does not block it as a pop-up while the file loads.
 */
export async function viewDocument(src: File | string) {
  // A stored business card (p2p/supplier-cards) is a plain public file: open it directly.
  if (typeof src === 'string' && !src.includes('/p2p/clarity/')) { window.open(src, '_blank', 'noopener'); return; }
  const tab = window.open('', '_blank');
  try {
    const blob = typeof src === 'string'
      ? (await api.get<Blob>('/p2p/clarity/download', { params: { path: src }, responseType: 'blob' })).data
      : src;
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
