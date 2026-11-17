import { MASTER_PRODUCTS, type DraftProduct, type SourcingTarget } from './data';

/** DUMMY: the list rows carry only counts, so a target's products are seeded from them.
    With the API this is a GET of the target's products — the popups do not change. */
export const seedProducts = (t: SourcingTarget): DraftProduct[] => {
  const hasM = t.sources.includes('Product Master');
  const hasX = t.sources.includes('Manual Entry');
  const nManual = !hasX ? 0 : !hasM ? t.totalProducts : Math.max(1, Math.floor(t.totalProducts / 4));
  const seed = parseInt(t.code.replace(/\D/g, ''), 10) || 1;
  const out: DraftProduct[] = [];
  for (let i = 0; i < t.totalProducts; i++) {
    const manual = i >= t.totalProducts - nManual;
    const price = String(1000 + ((i * 7919 + seed * 131) % 19000));
    if (manual) {
      out.push({ key: `x-${i}`, source: 'Manual Entry', code: '—', name: i === 0 ? t.firstProduct : `Manual item ${i + 1}`, segment: '—', hsn: '—', targetPrice: price });
    } else {
      const m = MASTER_PRODUCTS[i % MASTER_PRODUCTS.length];
      out.push({ key: `m-${i}`, source: 'Product Master', code: m.code, name: i === 0 ? t.firstProduct : m.name, segment: m.segment, hsn: m.hsn, targetPrice: price });
    }
  }
  return out;
};

export type ReportProduct = DraftProduct & { done: boolean; suppliers: number };

/** Sourced = has a supplier mapped. The first `completedProducts` are sourced; extra mapped suppliers go to them. */
export const reportProducts = (t: SourcingTarget): ReportProduct[] => {
  let extra = Math.max(0, t.mappedSuppliers - t.completedProducts);
  return seedProducts(t).map((p, i) => {
    const done = i < t.completedProducts;
    const suppliers = done ? 1 + (extra > 0 ? (extra--, 1) : 0) : 0;
    return { ...p, done, suppliers };
  });
};