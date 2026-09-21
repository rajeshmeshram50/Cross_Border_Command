// Small display helpers shared by the Inbox section and the review page.

/** 21 Sep 2026 — accepts a date or an ISO timestamp. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** 21 Sep 2026, 6:09 pm */
export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Amount in the PO's currency; falls back to INR, and to a plain number for an unknown code. */
export function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency ?? ''} ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`.trim();
  }
}

export function initialsOf(name: string | null | undefined): string {
  return (name ?? '').split(/\s+/).filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
}

/** Whole months (one decimal) since a date. */
export function monthsSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(`${d.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round(((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10;
}

export const PO_TYPE_LABEL: Record<string, string> = {
  material_goods: 'Material / Goods', services: 'Services', ffd_transporter: 'FFD / Transporter',
};
