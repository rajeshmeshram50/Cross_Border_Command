import type { PoItem } from '../order/api/po-api';
export interface ProductLine {
  key?: string;
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
  spiQty: number;
  spiRate: number;
  poRate: number;
  gst: number;
}

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

export function lineTotals(l: ProductLine, mode: TaxMode = 'intra'): LineTotals {
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
    missing: Math.max(0, l.poQty - l.spiQty),
    extra: Math.max(0, l.spiQty - l.poQty),
  };
}

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

export function linesFromPo(items: PoItem[], open: Record<number, number>): ProductLine[] {
  return items.map(it => {
    const poQty = num(it.quantity);
    const left = open[it.id];
    const spiQty = left === undefined ? poQty : Math.max(0, left);
    const name = it.product_name ?? it.description ?? `Line ${it.line_no}`;
    return {
      key: `po-${it.id}`,
      poItemId: it.id,
      piItemId: it.pi_item_id,
      productId: it.product_id ?? undefined,
      uom: it.uom ?? undefined,
      code: it.product_code ?? `L-${it.line_no}`,
      hsn: it.hsn_code ?? '—',
      piName: it.pi_product_name ?? (it.pi_item_id ? name : '—'),
      poName: name,
      spiName: name,
      description: it.description ?? '',
      piQty: num(it.pi_quantity ?? (it.pi_item_id ? poQty : 0)),
      poQty,
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

export const PRODUCT_CATALOGUE = PRODUCT_LINES.map(l => ({
  value: l.code,
  label: `${l.code} — ${l.spiName}`,
}));
