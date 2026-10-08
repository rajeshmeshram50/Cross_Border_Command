/**
 * One line of the 3-way match: the same product as the PI named it, as the PO
 * named it, and as the supplier invoiced it.
 *
 * The three names are separate fields rather than one, because the whole point
 * of the screen is that they can disagree.
 */
export interface ProductLine {
  code: string;
  hsn: string;
  piName: string;
  poName: string;
  /** The only identity on the row the user may change. */
  spiName: string;
  description: string;
  /**
   * The product master record behind the line, for the detail view "Read more"
   * opens. Optional because a line can name a product the master does not hold
   * yet, and there is then nothing to open.
   */
  productId?: number;
  piQty: number;
  poQty: number;
  /** Editable: what the supplier actually billed. */
  spiQty: number;
  /** Editable: the rate on the supplier's invoice. */
  spiRate: number;
  /** The rate the PO agreed, for the cost being matched against. */
  poRate: number;
  gst: number;
}

/** Everything derived from a line. Nothing here is stored. */
export interface LineTotals {
  /** What the PO committed to, with GST — the figure being matched. */
  poCost: number;
  /** The invoice's own value before tax. */
  base: number;
  gstAmount: number;
  /** base + GST. */
  cost: number;
  /** Short of the PO, never negative — the overage is `extra`. */
  missing: number;
  extra: number;
}

/**
 * The derived figures for one line.
 *
 * A plain function, not a memo: it is six multiplications, and the table calls
 * it once per row per render. Caching it would cost more in bookkeeping than
 * the arithmetic it saves.
 */
export function lineTotals(l: ProductLine): LineTotals {
  const base = l.spiQty * l.spiRate;
  const gstAmount = (base * l.gst) / 100;
  const poBase = l.poQty * l.poRate;
  return {
    poCost: poBase + (poBase * l.gst) / 100,
    base,
    gstAmount,
    cost: base + gstAmount,
    /* Clamped at zero on both sides: a line is either short or over, never
       both, and a negative "missing" would read as an overage in disguise. */
    missing: Math.max(0, l.poQty - l.spiQty),
    extra: Math.max(0, l.spiQty - l.poQty),
  };
}

/** The column totals, summed from the same function the rows display. */
export function tableTotals(lines: ProductLine[]) {
  return lines.reduce((t, l) => {
    const c = lineTotals(l);
    return {
      piQty: t.piQty + l.piQty,
      poQty: t.poQty + l.poQty,
      spiQty: t.spiQty + l.spiQty,
      missing: t.missing + c.missing,
      extra: t.extra + c.extra,
      poCost: t.poCost + c.poCost,
      base: t.base + c.base,
      gstAmount: t.gstAmount + c.gstAmount,
      cost: t.cost + c.cost,
    };
  }, { piQty: 0, poQty: 0, spiQty: 0, missing: 0, extra: 0, poCost: 0, base: 0, gstAmount: 0, cost: 0 });
}

/**
 * The lines this invoice starts with, copied from the purchase order.
 *
 * Stand-in data until the endpoint exists. Quantities and rates match the PO
 * exactly, so the table opens on a clean match and any mismatch on screen is
 * one the user created by editing.
 */
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

/** How much of a description a table shows before cutting it. */
export const DESC_MAX = 30;

/**
 * Cuts a description to `DESC_MAX` characters.
 *
 * A character count, not a CSS clamp: the column has to hold the same width
 * whatever the viewport, and a clamp cuts at whatever happens to fit — which
 * is how a column grows under one description and shrinks under the next.
 * Trailing space is dropped first so the ellipsis sits against the last word
 * rather than floating away from it.
 *
 * Shared by all three tables that show a description, so a line reads the same
 * in the 3-way match, the box table and Packed Products.
 */
export function truncateDesc(text: string): string {
  return text.length <= DESC_MAX ? text : `${text.slice(0, DESC_MAX).trimEnd()}…`;
}

/** The catalogue the Product (SPI) picker offers. */
export const PRODUCT_CATALOGUE = PRODUCT_LINES.map(l => ({
  value: l.code,
  label: `${l.code} — ${l.spiName}`,
}));
