import { supplierCode } from '../order/manage-payment/payment-shared';
import { PRODUCT_LINES } from './invoice-products';
import type { InvoiceRow } from './types';

/** One product inside a putaway box. */
export interface PutawayProduct {
  code: string;
  name: string;
  qty: number;
  hazardous: boolean;
  coldChain: boolean;
  serial: string;
  lot: string;
  batch: string;
  cat: string;
  remark: string;
}

/** One box, with where it was put away and what is in it. */
export interface PutawayBox {
  id: string;
  scenario: string;
  zone: string;
  rack: string;
  shelf: string;
  /** The three joined, which is how the allocation is quoted. */
  allocationId: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  net: number;
  gross: number;
  volumetric: number;
  products: PutawayProduct[];
}

/* Words that decide the two handling flags, rather than a stored column —
   nothing on the invoice records either one yet. */
const HAZARDOUS = /fertil|chemical|pesticide|acid|solvent|hazard/i;
const COLD_CHAIN = /frozen|chilled|dairy|milk|vaccine|cold.?chain|ice cream/i;

const pad3 = (n: number) => String(n).padStart(3, '0');

/**
 * The boxes an invoice was put away as.
 *
 * Box and product-level putaway detail is not stored against an invoice today
 * — only its line items are — so this derives one box per line, seeded from
 * the invoice's own number. Seeded rather than random so the same SPI shows
 * the same zone, rack and shelf every time it is opened; a summary that
 * reshuffles itself between views is not a summary.
 */
export function putawayBoxes(row: InvoiceRow): PutawayBox[] {
  const seedBase = Number((row.invoiceNo || '').replace(/\D/g, '')) || 1;

  return PRODUCT_LINES.map((line, i) => {
    const seed = seedBase * 7 + i * 13;
    const seq = pad3(i + 1);
    const zone = `ZN-0${(seed % 9) + 1}`;
    const rack = `RC-0${((seed >> 2) % 9) + 1}`;
    const shelf = `SH-0${((seed >> 4) % 9) + 1}`;

    const length = 40 + (seed % 40);
    const width = 30 + ((seed >> 1) % 30);
    const height = 20 + ((seed >> 2) % 25);
    /* The SPI's own name and quantity: a putaway records what physically
       arrived, which is what the supplier billed, not what the PI asked for. */
    const name = line.spiName || line.poName || line.piName;
    const qty = line.spiQty || line.poQty || 1;
    const weight = Math.max(1, Math.round(qty * 0.3));

    return {
      id: `PUT-B-${seq}`,
      scenario: '1 Product → 1 Box',
      zone,
      rack,
      shelf,
      allocationId: `${zone}-${rack}-${shelf}`,
      length,
      width,
      height,
      weight,
      net: weight,
      gross: Math.round(weight * 1.08),
      /* The shipping convention: L×W×H over a divisor, never below 1. */
      volumetric: Math.max(1, Math.round((length * width * height) / 5000)),
      products: [{
        code: line.code,
        name,
        qty,
        hazardous: HAZARDOUS.test(name),
        coldChain: COLD_CHAIN.test(name),
        serial: `SR-${seedBase}-${seq}`,
        lot: `LOT-${seedBase}-${seq}`,
        batch: `BAT-${seedBase}-${seq}`,
        cat: 'General Storage',
        remark: 'Correct Product',
      }],
    };
  });
}

/** One trading party on the summary. */
export interface PutawayParty {
  role: 'Customer' | 'Consignee' | 'Supplier';
  name: string;
  code: string;
  country: string;
}

/* The buyers an invoice can be raised against. An invoice does not record its
   customer today — it is reached through the opportunity — so this picks one
   by the opportunity number rather than inventing a different name each view. */
const BUYERS = [
  { name: 'Apollo Hospitals', code: 'C-001', country: 'Singapore' },
  { name: 'Fortis Healthcare', code: 'C-004', country: 'India' },
  { name: 'Narayana Health', code: 'C-007', country: 'India' },
  { name: 'Raffles Medical', code: 'C-012', country: 'Singapore' },
];

/**
 * The three parties this invoice sits between.
 *
 * Only the supplier is real — it is on the row. The buyer and the consignee
 * are reached through the opportunity, which this screen does not load, so
 * they are picked deterministically from the opportunity number.
 */
export function putawayParties(row: InvoiceRow): PutawayParty[] {
  const seed = Number((row.opportunityId || '').replace(/\D/g, '')) || 1;
  /* 1-based: OPP-001 is the first buyer, not the second. */
  const buyer = BUYERS[(seed - 1) % BUYERS.length];
  return [
    { role: 'Customer', name: buyer.name, code: buyer.code, country: buyer.country },
    /* Ship-to defaults to the buyer: a separate consignee is the exception,
       and the invoice carries no second address to tell them apart. */
    { role: 'Consignee', name: buyer.name, code: buyer.code.replace('C-', 'CSG-'), country: buyer.country },
    /* The shared allocator, not one of our own: it holds the real codes for
       the suppliers the app already knows, so Reliance reads S-001 here and
       on every other screen rather than a second invented number. */
    { role: 'Supplier', name: row.supplierName, code: supplierCode(row.supplierName), country: 'India' },
  ];
}

/** The proforma this invoice descends from, numbered off its own series. */
export function proformaNo(row: InvoiceRow): string {
  return row.invoiceNo.replace(/^SPI/, 'PI');
}

/** The eight figures the Analytics Overview counts, all from the boxes. */
export function putawayTotals(boxes: PutawayBox[], row: InvoiceRow) {
  const products = boxes.flatMap(b => b.products);
  return {
    boxes: boxes.length,
    products: products.length,
    quantity: products.reduce((n, p) => n + p.qty, 0),
    value: row.netPayable,
    hazardous: products.filter(p => p.hazardous).length,
    coldChain: products.filter(p => p.coldChain).length,
    /* Neither is recorded against a temporary putaway — this runs before any
       GRN exists, which is where a rejection would be raised. */
    damaged: 0,
    mismatched: 0,
  };
}
