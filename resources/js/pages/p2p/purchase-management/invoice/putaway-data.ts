import axios from 'axios';
import api from '../../../../api';
import { PoApiError } from '../order/api/po-api';
import { formatProductCode } from './invoice-products';
import type { InvoiceRow } from './types';

export interface PutawayProduct {
  code: string;
  name: string;
  qty: number;
  hazardous: boolean;
  coldChain: boolean;
  flags: string[];
  serial: string;
  lot: string;
  batch: string;
  cat: string;
  remark: string;
  remarkKind: 'correct' | 'damaged' | 'mismatched' | 'extra' | 'other';
  remarkNote: string;
}

export interface PutawayBox {
  apiId: number | null;
  id: string;
  scenario: string;
  warehouse: string | null;
  zone: string | null;
  rack: string | null;
  shelf: string | null;
  allocationId: string | null;
  placed: boolean;
  length: number;
  width: number;
  height: number;
  weight: number;
  net: number;
  gross: number;
  volumetric: number;
  stackable: boolean;
  tempRange: { min: number; max: number } | null;
  products: PutawayProduct[];
}

export interface PutawayParty {
  role: 'Customer' | 'Consignee' | 'Supplier';
  name: string;
  code: string;
  country: string;
}

export interface PutawaySummaryData {
  header: {
    spiId: string;
    spiDate: string;
    spiType: string;
    shipmentId: string;
    opportunityId: string;
    procurementId: string;
    warehouse: { code: string; name: string; isOwn: boolean } | null;
    boxes: number;
    products: number;
    totalQty: number;
    placedBoxes: number;
  };
  analytics: {
    boxes: number; products: number; quantity: number; value: number;
    hazardous: number; coldChain: number; damaged: number; mismatched: number;
  };
  parties: PutawayParty[];
  references: {
    pi: { code: string; date: string };
    po: { code: string; date: string };
    spi: { code: string; date: string };
    poAmount: number | null;
    spiAmount: number;
  };
  boxes: PutawayBox[];
}

type Raw = Record<string, unknown>;

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const day = (v: unknown) => str(v).slice(0, 10);

const REMARK_LABEL: Record<string, string> = {
  correct: 'Correct Product',
  damaged: 'Damaged / Rejected',
  mismatched: 'Mismatched',
  extra: 'Extra Quantity',
};

async function call<T>(action: string, run: () => Promise<{ data: unknown }>, pick: (body: unknown) => T): Promise<T> {
  try {
    return pick((await run()).data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      throw new PoApiError(action, err.response?.status ?? null,
        body?.message || err.message || 'Request failed', body?.errors ?? {}, body ?? null);
    }
    throw err;
  }
}

const toProduct = (p: Raw): PutawayProduct => {
  const remark = str(p.remark);
  const flags = Array.isArray(p.flags) ? (p.flags as Raw[]).map(f => str(f.name)).filter(Boolean) : [];
  return {
    code: formatProductCode(str(p.product_code)) || '—',
    name: str(p.product_name) || '—',
    qty: num(p.quantity),
    hazardous: !!p.hazardous,
    coldChain: !!p.cold_chain,
    flags,
    serial: str(p.serial_no),
    lot: str(p.lot_no),
    batch: str(p.batch_no),
    cat: str(p.cat_no),
    remark: REMARK_LABEL[remark] ?? (remark ? remark[0].toUpperCase() + remark.slice(1) : '—'),
    remarkKind: (['correct', 'damaged', 'mismatched', 'extra'] as const).find(k => k === remark) ?? 'other',
    remarkNote: str(p.remark_note),
  };
};

const toSummary = (d: Raw, ids: Map<string, number>): PutawaySummaryData => {
  const h = (d.header ?? {}) as Raw;
  const a = (d.analytics ?? {}) as Raw;
  const r = (d.references ?? {}) as Raw;
  const wh = h.warehouse as Raw | null;
  const locations = new Map(((d.locations ?? []) as Raw[]).map(l => [str(l.box_id), l]));

  return {
    header: {
      spiId: str(h.spi_id),
      spiDate: day(h.spi_date),
      spiType: str(h.spi_type),
      shipmentId: str(h.shipment_id),
      opportunityId: str(h.opportunity_id),
      procurementId: str(h.procurement_id),
      warehouse: wh ? { code: str(wh.code), name: str(wh.name), isOwn: !!wh.is_own } : null,
      boxes: num(h.boxes),
      products: num(h.products),
      totalQty: num(h.total_qty),
      placedBoxes: num(h.placed_boxes),
    },
    analytics: {
      boxes: num(a.total_boxes),
      products: num(a.total_products),
      quantity: num(a.total_quantity),
      value: num(a.spi_value),
      hazardous: num(a.hazardous),
      coldChain: num(a.cold_chain),
      damaged: num(a.damaged_rejected),
      mismatched: num(a.mismatched),
    },
    parties: ((d.parties ?? []) as Raw[]).map(p => ({
      role: str(p.role) as PutawayParty['role'],
      name: str(p.name) || '—',
      code: str(p.code) || '—',
      country: str(p.country) || '—',
    })),
    references: {
      pi: { code: str((r.pi as Raw)?.code), date: day((r.pi as Raw)?.date) },
      po: { code: str((r.po as Raw)?.code), date: day((r.po as Raw)?.date) },
      spi: { code: str((r.spi as Raw)?.code), date: day((r.spi as Raw)?.date) },
      poAmount: r.po_amount == null ? null : num(r.po_amount),
      spiAmount: num(r.spi_amount),
    },
    boxes: ((d.boxes ?? []) as Raw[]).map(b => {
      const code = str(b.box_id);
      const loc = locations.get(code) ?? {};
      const min = b.temp_min_c, max = b.temp_max_c;
      return {
        apiId: ids.get(code) ?? null,
        id: code,
        scenario: str(b.scenario),
        warehouse: str(loc.warehouse) || null,
        zone: str(loc.zone) || null,
        rack: str(loc.rack) || null,
        shelf: str(loc.shelf) || null,
        allocationId: str(loc.allocation_id || b.location) || null,
        placed: !!loc.confirmed,
        length: num(b.length_cm),
        width: num(b.width_cm),
        height: num(b.height_cm),
        weight: num(b.weight_kg),
        net: num(b.net_wt_kg),
        gross: num(b.gross_wt_kg),
        volumetric: num(b.vol_wt_kg),
        stackable: num(b.is_stackable) === 1,
        tempRange: min != null && max != null ? { min: Number(min), max: Number(max) } : null,
        products: ((b.products ?? []) as Raw[]).map(toProduct),
      };
    }),
  };
};

export const putawayApi = {
  summary: async (spiId: number): Promise<PutawaySummaryData> => {
    const [body, boxes] = await Promise.all([
      call('SPI summary', () => api.get(`/p2p/spi/${spiId}/summary`), b => ((b as { data?: Raw } | null)?.data ?? {}) as Raw),
      call('SPI boxes', () => api.get(`/p2p/spi/${spiId}/boxes`),
        b => (((b as { data?: { boxes?: Raw[] } } | null)?.data?.boxes) ?? []) as Raw[]).catch(() => [] as Raw[]),
    ]);
    const ids = new Map(boxes.map(x => [str(x.box_code), num(x.id)]));
    return toSummary(body, ids);
  },

  stickerPdf: async (spiId: number, boxId: number): Promise<Blob> => {
    try {
      const res = await api.get(`/p2p/spi/${spiId}/boxes/${boxId}/sticker/download`, { responseType: 'blob' });
      return res.data as Blob;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        throw new PoApiError('Box sticker', err.response?.status ?? null, 'Could not fetch the sticker.', {}, null);
      }
      throw err;
    }
  },
};

export function proformaNo(row: InvoiceRow): string {
  return row.invoiceNo.replace(/^SPI/, 'PI');
}
