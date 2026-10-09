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

/**
 * How the GST on a line is split.
 *
 * `intra` — supplier and our branch are in the same state: CGST + SGST, half
 * each. `inter` — different states: one IGST at the full rate. `none` — the
 * supplier is outside India, so Indian GST does not arise at all and the rate
 * is zero before any split is reached.
 *
 * The same three cases the purchase order works in, named the same way:
 * PurchaseOrderService::taxMode() returns 'intra' | 'inter', and an
 * international PO zeroes `gst_pct` at the line before the split happens.
 */
export type TaxMode = 'intra' | 'inter' | 'none';

/**
 * The tax mode for a supplier, from the two things that decide it.
 *
 * Mirrors the server: the country decides whether Indian GST applies at all,
 * and only then does state-vs-state decide the split. Derived, never stored —
 * `App\Support\Gst` says the same of `gst_applicable`.
 */
export function taxModeFor(country: string, supplierState: string, homeState: string): TaxMode {
  /* Blank country means DOMESTIC, matching
     PurchaseOrderController::vendorOrigin() — `if (empty($vendor->country_id))
     return 'domestic'`. Note this is deliberately the opposite of
     App\Support\Gst::isDomestic(), where a blank country is not domestic; the
     purchase order is the behaviour being matched here, so an unanswered
     country is taxed rather than zero-rated. */
  const name = country.trim().toLowerCase();
  if (name !== '' && name !== 'india') return 'none';
  /* An unknown state falls to intra, which is what
     PurchaseOrderService::taxMode() does with a blank code. */
  if (!supplierState || !homeState) return 'intra';
  return supplierState === homeState ? 'intra' : 'inter';
}

/**
 * Maharashtra — the home state assumed when a branch has no GSTIN on file.
 *
 * A stand-in until the branch is loaded into the draft. Note the server has
 * two answers for this: `App\Support\Gst::homeStateCode()` defaults to '27'
 * like this one, while `PurchaseOrderService::homeStateCode()` returns null,
 * which then falls through `taxMode()` to intra. Worth settling on one before
 * this is wired to the real branch.
 */
export const DEFAULT_HOME_STATE_CODE = '27';

/** Paise, the way the server rounds. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Everything derived from a line. Nothing here is stored. */
export interface LineTotals {
  /** What the PO committed to, with GST — the figure being matched. */
  poCost: number;
  /** The invoice's own value before tax. */
  base: number;
  gstAmount: number;
  /** The split of `gstAmount`. Two of the three are always zero. */
  cgst: number;
  sgst: number;
  igst: number;
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
export function lineTotals(l: ProductLine, mode: TaxMode = 'intra'): LineTotals {
  /* Rounded at each step, in the same order as
     PurchaseOrderService::lineAmounts(): taxable to paise, then the GST on
     that rounded figure. Multiplying first and rounding once gives a different
     paisa on some lines, and the two screens would then disagree about the
     same invoice. */
  const base = round2(l.spiQty * l.spiRate);
  /* An import carries no Indian GST, so the rate is zeroed here rather than
     split to nothing later — the same thing the PO does at the line. */
  const rate = mode === 'none' ? 0 : l.gst;
  const gstAmount = round2((base * rate) / 100);
  const poBase = round2(l.poQty * l.poRate);

  /* SGST is the remainder, not a second half: on an odd paisa the two halves
     must still add back to the full GST. PurchaseOrderService::lineAmounts()
     takes the same care. */
  const cgst = mode === 'intra' ? round2(gstAmount / 2) : 0;
  const sgst = mode === 'intra' ? round2(gstAmount - cgst) : 0;
  const igst = mode === 'inter' ? gstAmount : 0;

  return {
    poCost: round2(poBase + round2((poBase * rate) / 100)),
    base,
    gstAmount,
    cgst,
    sgst,
    igst,
    cost: round2(base + gstAmount),
    /* Clamped at zero on both sides: a line is either short or over, never
       both, and a negative "missing" would read as an overage in disguise. */
    missing: Math.max(0, l.poQty - l.spiQty),
    extra: Math.max(0, l.spiQty - l.poQty),
  };
}

/** The column totals, summed from the same function the rows display. */
export function tableTotals(lines: ProductLine[], mode: TaxMode = 'intra') {
  return lines.reduce((t, l) => {
    const c = lineTotals(l, mode);
    return {
      piQty: t.piQty + l.piQty,
      poQty: t.poQty + l.poQty,
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
