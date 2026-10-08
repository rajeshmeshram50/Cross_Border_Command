import type {
  InvoiceRow, InvoiceRiskLevel, InvoiceSupplierCategory, InvoicePoType,
  StorageWarehouse,
} from './types';
import type { LegalView } from '../order/create-po/supplier-checks';

/**
 * Stand-in data, shaped exactly like the API will be.
 *
 * It exists so the screens can be built and reviewed before the endpoint
 * exists. Every field here is a field in `InvoiceRow`, so when the API lands
 * the only change is where the array comes from — no component touches this
 * file directly, they all take `InvoiceRow[]`.
 *
 * Built ONCE at module load, not inside a component. A generator called during
 * render would rebuild 60 objects on every keystroke in the search box.
 */

const SUPPLIERS: Array<[string, InvoiceSupplierCategory, InvoiceRiskLevel]> = [
  ['Reliance Industries',  'star',      'low'],
  ['Tata Steel',           'regular',   'medium'],
  ['Asian Paints',         'regular',   'low'],
  ['Adani Enterprises',    'high-risk', 'high'],
  ['Larsen & Toubro',      'star',      'low'],
];

const WAREHOUSES: Array<[string, 'own' | 'third-party']> = [
  ['Pune Phase 2 Warehouse', 'own'],
  ['Third Party Warehouse',  'third-party'],
  ['Mumbai Central Warehouse', 'own'],
  ['Delhi North Warehouse',  'own'],
];

const PO_TYPES: InvoicePoType[] = ['material', 'services'];

/** Zero-pads a sequence number: 7 -> "007". */
const pad = (n: number, width = 3) => String(n).padStart(width, '0');

/** Builds a yyyy-mm-dd date inside the given month, cycling 1..28. */
const dayIn = (month: string, seed: number) => `${month}-${pad(((seed - 1) % 28) + 1, 2)}`;

interface BuildOpts {
  withPo: boolean;
  withShipment: boolean;
  count: number;
  seqStart: number;
}

function build({ withPo, withShipment, count, seqStart }: BuildOpts): InvoiceRow[] {
  const rows: InvoiceRow[] = [];

  for (let i = 0; i < count; i++) {
    const seq = seqStart + i;
    const [supplierName, supplierCategory, riskLevel] = SUPPLIERS[i % SUPPLIERS.length];
    const [warehouseName, warehouseKind] = WAREHOUSES[i % WAREHOUSES.length];

    /* Money. Paid cycles full / half / nothing so the progress column shows all
       three of its states without needing a special case per row. */
    const totalPoAmount = 15000 + i * 2750 + (withPo ? 8000 : 0);
    const netPayable = Math.round(totalPoAmount * 0.98);
    const paidFactor = [1, 0.5, 0][i % 3];
    const totalPaid = Math.round(netPayable * paidFactor);

    rows.push({
      id: `inv-${seq}`,
      invoiceNo: `SPI/2025-26/${pad(seq)}`,
      invoiceDate: dayIn('2026-06', seq),

      ...(withPo ? {
        poNo: `PO/2025-26/${pad(seq)}`,
        poDate: dayIn('2026-05', seq),
        poType: PO_TYPES[i % PO_TYPES.length],
        /* Every third PO is flagged, so the warning chip is visible without
           being on every row. */
        poPhysicalInspection: i % 3 === 0,
      } : {}),

      documentType: i % 2 === 0 ? 'domestic' : 'international',

      ...(withShipment ? {
        shipmentId: `SHP-${pad(seq)}`,
        shipmentDate: dayIn('2026-05', seq + 2),
      } : {}),

      opportunityId: `OPP-${pad(seq)}`,
      opportunityDate: dayIn('2026-04', seq),
      procurementId: `PROC-${pad(seq)}`,
      procurementDate: dayIn('2026-05', seq + 4),

      supplierName,
      supplierCategory,
      riskLevel,

      expectedDeliveryDate: dayIn('2026-07', seq + 4),

      totalPoAmount,
      netPayable,
      totalPaid,

      warehouseName,
      warehouseKind,
      /* One invoice = one GRN = one QA, so the chain shares the sequence. */
      grnId: `GRN-${pad(seq)}`,
      grnDate: dayIn('2026-06', seq + 3),
      qaId: `QA-${pad(seq)}`,
      qaDate: dayIn('2026-06', seq + 5),

      zohoStatus: i % 2 === 0 ? 'synced' : 'not-synced',
      inspectionStatus: withShipment
        ? (i % 3 === 1 ? 'not-applicable' : 'completed')
        : 'completed',
      pendingPaymentRequests: paidFactor === 1 ? 1 : (i % 3 === 1 ? 1 : 2),
      ...(paidFactor === 0.5 ? { approvedForPayment: Math.round(netPayable * 0.35) } : {}),
    });
  }

  return rows;
}

/**
 * 60 invoices across the four combinations the two tab levels slice by:
 * with/without PO × with/without shipment, 15 each.
 *
 * The counts the design shows (60 / 30 / 30, then 31 / 29) come from the
 * prototype's own fixture. Real counts will come from the API; what matters
 * here is that all four combinations exist so every tab has rows to show.
 */
export const INVOICE_ROWS: InvoiceRow[] = [
  ...build({ withPo: true,  withShipment: true,  count: 15, seqStart: 1 }),
  ...build({ withPo: true,  withShipment: false, count: 15, seqStart: 16 }),
  ...build({ withPo: false, withShipment: true,  count: 15, seqStart: 31 }),
  ...build({ withPo: false, withShipment: false, count: 15, seqStart: 46 }),
];

/**
 * The code the next invoice would take.
 *
 * One past the highest sequence in the fixture, so the form never shows a code
 * that is already in the list. The real one is allocated by the server under a
 * row lock when the invoice is saved — this only has to look right until then,
 * which is why it is a constant and not a counter.
 */
export const NEXT_INVOICE_NO = `SPI/2025-26/${pad(INVOICE_ROWS.length + 1)}`;

/**
 * The supplier's Evidence Vault, as the Legal Status card reads it.
 *
 * Typed as the PO form's own `LegalView` and split into the same two groups
 * its `LEGAL_GROUPS` defines, so when the vault endpoint is wired in,
 * `legalFromVault()` already returns exactly this shape and the card does not
 * change. Only the counts here are invented.
 */
export const SUPPLIER_LEGAL: LegalView = {
  sections: [
    {
      name: 'Standard Documents',
      sub: 'One Time · KYC, DD & Licenses',
      parts: ['Company Due Diligence', 'Owner KYC Documents', 'Trade Licenses'],
      done: 11, total: 11, pct: 100, tone: 'ok',
    },
    {
      name: 'Case to Case Documents & Agreements',
      sub: 'Per Deal · Trade Docs & Agreements',
      parts: ['Trade Documents'],
      done: 7, total: 7, pct: 100, tone: 'ok',
    },
  ],
  done: 18, total: 18, pct: 100,
};

/**
 * The warehouses step 2 of the storage wizard offers.
 *
 * Only our OWN sites are listed. A third-party warehouse is the other branch
 * of step 1, so it can never be an option here — if it were, the two steps
 * would be asking the same question twice.
 */
export const STORAGE_WAREHOUSES: StorageWarehouse[] = [
  { id: 'mum', name: 'Mumbai Central Warehouse', location: 'MIDC, Andheri East · Zone A–D' },
  { id: 'pun', name: 'Pune Phase 2 Warehouse',   location: 'Hinjewadi Phase 2 · Zone B–C' },
  { id: 'del', name: 'Delhi North Warehouse',    location: 'Okhla Industrial Area · Zone A' },
];
