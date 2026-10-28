import type { PoItem } from '../order/api/po-api';

/** What /p2p/spi/orders/{po}/lines reports per line, as the grid needs it. */
export type SpiPoOpen = { qty_open: number; qty_billed: number; qty_over: number; closed: boolean };
export interface ProductLine {
  key?: string;
  piCode?: string;
  poProductId?: number;
  poItemId?: number;
  piItemId?: number | null;
  spiItemId?: number;
  uom?: string;
  code: string;
  hsn: string;
  piName: string;
  poName: string;
  spiName: string;
  description: string;
  productId?: number;
  piQty: number;
  poQty: number;
  /**
   * What THIS invoice may still bill on the line, from the server.
   *
   * Not the same as poQty once a second invoice exists: poQty is what the order
   * asked for once, this is what is left after every other invoice took its
   * share. Never negative — an over-supplied line has nothing left to give.
   *
   * Absent on the demo rows, which have no PO behind them; openQtyOf() falls
   * back to poQty there.
   */
  poOpenQty?: number;
  /** How much every OTHER invoice on this PO has already billed. */
  poBilledQty?: number;
  /** How far earlier invoices already went past the order. Shown as context,
   *  never as this invoice EXTRA — that over-supply belongs to the invoice
   *  that caused it. */
  poOverQty?: number;
  /** Nothing left to invoice: the line is done, or already over-supplied. */
  poClosed?: boolean;
  spiQty: number;
  spiRate: number;
  poRate: number;
  gst: number;
}

/** The quantity this invoice is actually working against. */
/* What this invoice is measured against. Normally the purchase order's open
   quantity; on a 2-way match there is no purchase order, so the baseline is
   the shipment's proforma invoice — which is the document the Direct SPI is
   matched to. Measured against a PO it does not have, every line on a Direct
   SPI would read as extra. */
export const openQtyOf = (l: ProductLine, twoWay = false): number =>
  (twoWay ? l.piQty : l.poOpenQty ?? l.poQty);

export type TaxMode = 'intra' | 'inter' | 'export';

export function taxModeFor(country: string, supplierState: string, homeState: string): TaxMode {
  const name = country.trim().toLowerCase();
  if (name !== '' && name !== 'india') return 'export';
  if (!supplierState || !homeState) return 'intra';
  return supplierState === homeState ? 'intra' : 'inter';
}

export const DEFAULT_HOME_STATE_CODE = '27';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LineTotals {
  poCost: number;
  base: number;
  gstAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cgstPct: number;
  sgstPct: number;
  igstPct: number;
  cost: number;
  missing: number;
  extra: number;
}

export function lineTotals(l: ProductLine, mode: TaxMode = 'intra', twoWay = false): LineTotals {
  const base = round2(l.spiQty * l.spiRate);
  const rate = mode === 'export' ? 0 : l.gst;
  const gstAmount = round2((base * rate) / 100);
  const poBase = round2(l.poQty * l.poRate);

  const inter = mode === 'inter' || mode === 'export';

  const cgst = inter ? 0 : round2(gstAmount / 2);
  const sgst = inter ? 0 : round2(gstAmount - cgst);
  const igst = inter ? gstAmount : 0;

  return {
    cgstPct: inter ? 0 : rate / 2,
    sgstPct: inter ? 0 : rate / 2,
    igstPct: inter ? rate : 0,
    poCost: round2(poBase + round2((poBase * rate) / 100)),
    base,
    gstAmount,
    cgst,
    sgst,
    igst,
    cost: round2(base + gstAmount),
    /* Measured against what is OPEN, not against the original order, and not
       against what earlier invoices over-supplied. A line the previous invoice
       covered is not missing again here; one it over-supplied opens at zero and
       only counts as extra if THIS invoice bills against it. */
    missing: Math.max(0, openQtyOf(l, twoWay) - l.spiQty),
    extra: Math.max(0, l.spiQty - openQtyOf(l, twoWay)),
  };
}

export function tableTotals(lines: ProductLine[], mode: TaxMode = 'intra', twoWay = false) {
  return lines.reduce((t, l) => {
    const c = lineTotals(l, mode, twoWay);
    return {
      piQty: t.piQty + l.piQty,
      // The open column, so the footer adds up to what the rows show.
      poQty: t.poQty + openQtyOf(l, twoWay),
      spiQty: t.spiQty + l.spiQty,
      missing: t.missing + c.missing,
      extra: t.extra + c.extra,
      poCost: t.poCost + c.poCost,
      base: t.base + c.base,
      gstAmount: t.gstAmount + c.gstAmount,
      cgst: t.cgst + c.cgst,
      sgst: t.sgst + c.sgst,
      igst: t.igst + c.igst,
      cost: t.cost + c.cost,
    };
  }, {
    piQty: 0, poQty: 0, spiQty: 0, missing: 0, extra: 0,
    poCost: 0, base: 0, gstAmount: 0, cgst: 0, sgst: 0, igst: 0, cost: 0,
  });
}

export const PRODUCT_LINES: ProductLine[] = [
  {
    code: 'P-104',
    hsn: '90183930',
    piName: 'IV Cannula 20G',
    poName: 'IV Cannula 20G',
    spiName: 'IV Cannula 20G',
    description: '20G IV cannula with injection port and wings, individually blister packed, '
      + 'ethylene-oxide sterilised and certified latex-free. Supplied in cartons of 50 with '
      + 'batch number and expiry printed on each unit.',
    productId: 8,
    piQty: 96, poQty: 96, spiQty: 96,
    spiRate: 22, poRate: 22, gst: 12,
  },
  {
    code: 'P-106',
    hsn: '40151900',
    piName: 'Nitrile Examination Gloves',
    poName: 'Nitrile Examination Gloves',
    spiName: 'Nitrile Examination Gloves',
    description: 'Non-sterile nitrile examination gloves, latex-free and powder-free, '
      + 'textured fingertips, ambidextrous. Boxes of 100 in mixed sizes, packed ten boxes '
      + 'to a shipper and stored away from direct sunlight.',
    productId: 4,
    piQty: 36, poQty: 36, spiQty: 36,
    spiRate: 360, poRate: 360, gst: 12,
  },
];

const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

export function formatProductCode(code: string | null | undefined): string {
  const raw = (code ?? '').trim();
  const m = /^([A-Za-z]+)-?(\d+)$/.exec(raw);
  return m ? `${m[1].toUpperCase()}-${m[2].padStart(3, '0')}` : raw;
}

const withoutCodePrefix = (name: string, code: string | null | undefined) => {
  if (!code) return name;
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(`^\\s*${esc}\\s*[–—-]\\s*`), '') || name;
};

/**
 * @param open  Per PO line, what the server says is left after every OTHER
 *              invoice on this order. Keyed by po_item_id. Empty when the PO
 *              has no invoices yet, and the row then opens on its full quantity.
 */
export function linesFromPo(items: PoItem[], open: Record<number, SpiPoOpen>): ProductLine[] {
  return items.map(it => {
    const poQty = num(it.quantity);
    const o = open[it.id];
    // No entry at all means nothing is invoiced yet, so the whole line is open.
    const poOpenQty = o ? o.qty_open : poQty;
    // Pre-fill with what is left; a closed or over-supplied line opens at zero.
    const spiQty = Math.max(0, poOpenQty);
    const name = it.product_name ?? it.description ?? `Line ${it.line_no}`;
    return {
      key: `po-${it.id}`,
      poItemId: it.id,
      piItemId: it.pi_item_id,
      productId: it.product_id ?? undefined,
      poProductId: it.product_id ?? undefined,
      uom: it.uom ?? undefined,
      code: formatProductCode(it.product_code) || `L-${it.line_no}`,
      piCode: it.pi_product_code ? formatProductCode(it.pi_product_code) : undefined,
      hsn: it.hsn_code ?? '—',
      piName: it.pi_product_name
        ? withoutCodePrefix(it.pi_product_name, it.pi_product_code)
        : (it.pi_item_id ? name : '—'),
      poName: name,
      spiName: name,
      description: it.description ?? '',
      piQty: num(it.pi_quantity ?? (it.pi_item_id ? poQty : 0)),
      poQty,
      poOpenQty,
      poBilledQty: o ? o.qty_billed : 0,
      poOverQty: o ? o.qty_over : 0,
      poClosed: o ? o.closed : false,
      spiQty,
      spiRate: num(it.rate),
      poRate: num(it.rate),
      gst: num(it.gst_pct),
    };
  });
}

export type SpiItemsPayload = {
  items: Array<{
    po_item_id: number | null;
    product_id: number;
    qty_spi: number;
    rate: number;
    extra_qty: number;
    gst_pct: number | null;
    taxable_amount: number;
    cgst_amount: number | null;
    sgst_amount: number | null;
    igst_amount: number | null;
    line_total: number;
  }>;
  taxable_total: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  grand_total: number;
};

export function itemsPayload(lines: ProductLine[], mode: TaxMode): SpiItemsPayload {
  const billed = lines.filter(l => l.spiQty > 0 && l.productId != null);
  const t = tableTotals(billed, mode);
  const exportSpi = mode === 'export';
  return {
    items: billed.map(l => {
      const c = lineTotals(l, mode);
      return {
        po_item_id: l.poItemId ?? null,
        product_id: l.productId!,
        qty_spi: l.spiQty,
        rate: l.spiRate,
        extra_qty: c.extra,
        gst_pct: exportSpi ? null : l.gst,
        taxable_amount: c.base,
        cgst_amount: exportSpi ? null : c.cgst,
        sgst_amount: exportSpi ? null : c.sgst,
        igst_amount: exportSpi ? null : c.igst,
        line_total: c.cost,
      };
    }),
    taxable_total: round2(t.base),
    total_cgst: round2(t.cgst),
    total_sgst: round2(t.sgst),
    total_igst: round2(t.igst),
    grand_total: round2(t.cost),
  };
}

export const DESC_MAX = 30;

export function truncateDesc(text: string): string {
  return text.length <= DESC_MAX ? text : `${text.slice(0, DESC_MAX).trimEnd()}…`;
}

/**
 * Product names are free text and some are very long — a 60-character name
 * widens the column it sits in and pushes every control on the row off the
 * screen. Shorter than the description's 30: a name sits in a narrow column
 * with its HSN beneath it, where prose gets the width of a sentence.
 */
export const NAME_MAX = 20;

/**
 * The 3-way match table gives the name a column of its own, so it can carry
 * half again as much as NAME_MAX's narrow cells.
 *
 * A name is free text and plenty of them arrive with no spaces at all, which
 * is the case that actually breaks: a 60-character run cannot wrap, so the
 * column grows to fit it and pushes the quantity cells off the right of the
 * table. Cut it here and the full name stays on the cell's tooltip.
 */
export const MATCH_NAME_MAX = 30;

export function truncate(text: string, max: number): string {
  /* One over is left whole: the ellipsis costs a character itself, so cutting
     a 31-character name to 30 + "…" is the same width and two fewer letters. */
  return text.length <= max + 1 ? text : `${text.slice(0, max).trimEnd()}…`;
}

export function truncateName(text: string): string {
  return truncate(text, NAME_MAX);
}

export const PRODUCT_CATALOGUE = PRODUCT_LINES.map(l => ({
  value: l.code,
  label: `${l.code} — ${l.spiName}`,
}));
