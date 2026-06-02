import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Vendor Mappings — opens from the Sales Matrix Stage 3 "Vendor Count"
 * column. Lists every vendor mapped to the product (product_vendor_maps)
 * with contact details + purchase / GST / total pricing. The lowest-total
 * vendor is flagged "L1 Best Price".
 * ───────────────────────────────────────────────────────────────────── */

type Props = {
  open:        boolean;
  productId:   number | null;
  productCode: string | null;
  productName: string | null;
  targetPrice: number | string | null;
  currency:    string | null;
  onClose:     () => void;
};

type VendorMap = {
  id:             number;
  vendor_code:    string | null;
  vendor_name:    string;
  vendor_website: string | null;
  contact_person: string | null;
  contact_no:     string | null;
  email:          string | null;
  designation:    string | null;
  purchase_price: number | string | null;
  gst_percentage: number | string | null;
  gst_amount:     number | string | null;
  total_amount:   number | string | null;
};

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$' };
const sym = (code: string | null | undefined): string => CURRENCY_SYMBOL[(code ?? '').toUpperCase()] ?? ((code ?? '') ? `${code} ` : '₹');

const money = (v: number | string | null | undefined, symbol = '₹'): string => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function VendorMappingsModal({ open, productId, productCode, productName, targetPrice, currency, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [maps, setMaps]       = useState<VendorMap[]>([]);

  useEffect(() => {
    if (!open || !productId) { setMaps([]); return; }
    setLoading(true);
    api.get<{ status: boolean; data: VendorMap[] }>(`/products/${productId}/vendor-maps`)
      .then(({ data }) => setMaps(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not fetch vendor mappings'))
      .finally(() => setLoading(false));
  }, [open, productId, toast]);

  // L1 = vendor with the lowest total (falls back to purchase price).
  const l1Id = useMemo(() => {
    let best: { id: number; v: number } | null = null;
    for (const m of maps) {
      const raw = m.total_amount ?? m.purchase_price;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      if (!best || n < best.v) best = { id: m.id, v: n };
    }
    return best?.id ?? null;
  }, [maps]);

  if (!open) return null;

  const leadSym = sym(currency);
  const code = productCode ?? (productId ? `P-${String(productId).padStart(3, '0')}` : '—');

  return createPortal((
    <div className="vmm-backdrop" onClick={onClose}>
      <style>{VMM_CSS}</style>
      <div className="vmm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="vmm-head">
          <div className="vmm-head-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div className="vmm-head-text">
            <div className="vmm-head-title">Vendor Mappings</div>
            <div className="vmm-head-sub">
              Product: <strong>{productName ?? '—'}</strong>
              <span className="vmm-head-chip">{code}</span>
              <span className="vmm-head-count">{maps.length} vendor{maps.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <button className="vmm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="vmm-body">
          {loading ? (
            <div className="vmm-loading"><span className="vmm-spinner" /> Loading vendor mappings…</div>
          ) : maps.length === 0 ? (
            <div className="vmm-empty">No vendors mapped to this product yet.</div>
          ) : maps.map((m, idx) => {
            const isL1 = m.id === l1Id;
            return (
              <div key={m.id} className={`vmm-card ${isL1 ? 'is-l1' : ''}`}>
                <div className="vmm-card-top">
                  <span className="vmm-rank">{idx + 1}</span>
                  <div className="vmm-vendor">
                    <div className="vmm-vendor-name">{m.vendor_name}</div>
                    {m.vendor_code && <div className="vmm-vendor-code">{m.vendor_code}</div>}
                  </div>
                  {isL1 && (
                    <span className="vmm-l1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      L1 Best Price
                    </span>
                  )}
                </div>

                <div className="vmm-contact">
                  <div className="vmm-contact-cell"><span className="vmm-contact-label">Contact Person</span><span className="vmm-contact-val">{m.contact_person ?? '—'}</span></div>
                  <div className="vmm-contact-cell"><span className="vmm-contact-label">Phone</span><span className="vmm-contact-val">{m.contact_no ?? '—'}</span></div>
                  <div className="vmm-contact-cell"><span className="vmm-contact-label">Email</span><span className="vmm-contact-val">{m.email ?? '—'}</span></div>
                </div>

                <div className="vmm-prices">
                  <div className="vmm-price vmm-price-target"><span className="vmm-price-label">Target Price</span><span className="vmm-price-val">{money(targetPrice, leadSym)}</span></div>
                  <div className="vmm-price vmm-price-purchase"><span className="vmm-price-label">Purchase Price</span><span className="vmm-price-val">{money(m.purchase_price)}</span></div>
                  <div className="vmm-price vmm-price-gst"><span className="vmm-price-label">GST Amount</span><span className="vmm-price-val">{money(m.gst_amount)}</span></div>
                  <div className="vmm-price vmm-price-total"><span className="vmm-price-label">Total Amount</span><span className="vmm-price-val">{money(m.total_amount)}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="vmm-foot">
          <button type="button" className="vmm-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

const VMM_CSS = `
.vmm-backdrop {
  position: fixed; inset: 0; z-index: 1095;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.vmm-modal {
  width: min(680px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.30);
  overflow: hidden; display: flex; flex-direction: column;
}
/* Amber header (figma) */
.vmm-head {
  display: flex; align-items: center; gap: 13px;
  padding: 15px 18px;
  background: linear-gradient(120deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%);
  color: #fff;
}
.vmm-head-icon {
  width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
}
.vmm-head-text { flex: 1; min-width: 0; }
.vmm-head-title { font-size: 16px; font-weight: 800; }
.vmm-head-sub { font-size: 11.5px; color: rgba(255,255,255,.92); margin-top: 3px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vmm-head-sub strong { font-weight: 800; }
.vmm-head-chip { font-family: 'Inter',monospace; font-weight: 800; font-size: 10.5px; background: rgba(255,255,255,.25); padding: 2px 9px; border-radius: 999px; }
.vmm-head-count { font-weight: 700; font-size: 10.5px; background: rgba(0,0,0,.16); padding: 2px 9px; border-radius: 999px; }
.vmm-close {
  width: 30px; height: 30px; flex-shrink: 0;
  background: rgba(255,255,255,.20); border: none; cursor: pointer;
  color: #fff; border-radius: 7px;
  display: flex; align-items: center; justify-content: center; transition: background .15s;
}
.vmm-close:hover { background: rgba(255,255,255,.34); }

.vmm-body { flex: 1; overflow-y: auto; padding: 14px 16px; background: #fffdf7; display: flex; flex-direction: column; gap: 12px; }
.vmm-loading, .vmm-empty { padding: 34px 0; text-align: center; color: #94a3b8; font-style: italic; font-size: 13px; }
.vmm-spinner { display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px; border: 2px solid #fde68a; border-top-color: #f59e0b; border-radius: 50%; animation: vmm-spin .7s linear infinite; }
@keyframes vmm-spin { to { transform: rotate(360deg); } }

.vmm-card {
  background: #fff; border: 1.5px solid #fde68a; border-radius: 13px;
  padding: 13px 15px; box-shadow: 0 2px 10px rgba(217,119,6,.06);
}
.vmm-card.is-l1 { border-color: #6ee7b7; box-shadow: 0 2px 12px rgba(16,185,129,.12); }

.vmm-card-top { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
.vmm-rank {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  background: linear-gradient(135deg, #10b981, #047857); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
}
.vmm-vendor { flex: 1; min-width: 0; }
.vmm-vendor-name { font-size: 14px; font-weight: 800; color: #1e293b; }
.vmm-vendor-code { font-family: 'Inter',monospace; font-size: 10.5px; font-weight: 700; color: #94a3b8; margin-top: 1px; }
.vmm-l1 {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  background: #d1fae5; color: #047857; border: 1px solid #6ee7b7;
  padding: 4px 11px; border-radius: 999px; font-size: 11px; font-weight: 800;
}

.vmm-contact { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 10px 12px; background: #f0fdf4; border-radius: 9px; margin-bottom: 11px; }
.vmm-contact-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.vmm-contact-label { font-size: 9px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #16a34a; }
.vmm-contact-val { font-size: 12px; font-weight: 600; color: #334155; word-break: break-word; }

.vmm-prices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; }
.vmm-price { border-radius: 9px; padding: 9px 11px; border: 1.5px solid; display: flex; flex-direction: column; gap: 3px; }
.vmm-price-label { font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.vmm-price-val { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
.vmm-price-target   { background: #fffbeb; border-color: #fde68a; }
.vmm-price-target   .vmm-price-label, .vmm-price-target   .vmm-price-val { color: #b45309; }
.vmm-price-purchase { background: #f0fdf4; border-color: #bbf7d0; }
.vmm-price-purchase .vmm-price-label, .vmm-price-purchase .vmm-price-val { color: #15803d; }
.vmm-price-gst      { background: #eff6ff; border-color: #bfdbfe; }
.vmm-price-gst      .vmm-price-label, .vmm-price-gst      .vmm-price-val { color: #1d4ed8; }
.vmm-price-total    { background: #fff7ed; border-color: #fed7aa; }
.vmm-price-total    .vmm-price-label, .vmm-price-total    .vmm-price-val { color: #c2410c; }

.vmm-foot { padding: 13px 18px; display: flex; justify-content: flex-end; background: #fff; border-top: 1px solid #f1f5f9; }
.vmm-btn { padding: 8px 22px; border-radius: 8px; font-family: inherit; font-weight: 700; font-size: 12.5px; cursor: pointer; border: 1.5px solid #e5e7eb; background: #fff; color: #1e293b; min-width: 100px; transition: all .15s; }
.vmm-btn:hover { background: #f8fafc; border-color: #cbd5e1; }

/* Dark mode */
[data-bs-theme="dark"] .vmm-modal { background: #14102a; }
[data-bs-theme="dark"] .vmm-body { background: #16122e; }
[data-bs-theme="dark"] .vmm-card { background: #1a1538; border-color: rgba(252,191,36,.30); }
[data-bs-theme="dark"] .vmm-card.is-l1 { border-color: rgba(110,231,183,.45); }
[data-bs-theme="dark"] .vmm-vendor-name { color: #ede9fe; }
[data-bs-theme="dark"] .vmm-contact { background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .vmm-contact-val { color: #d4d1de; }
[data-bs-theme="dark"] .vmm-price-target   { background: rgba(245,158,11,.12); }
[data-bs-theme="dark"] .vmm-price-purchase { background: rgba(16,185,129,.12); }
[data-bs-theme="dark"] .vmm-price-gst      { background: rgba(59,130,246,.12); }
[data-bs-theme="dark"] .vmm-price-total    { background: rgba(234,88,12,.12); }
[data-bs-theme="dark"] .vmm-foot { background: #1a1538; border-top-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .vmm-btn { background: #1f1845; border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .vmm-btn:hover { background: #2a2150; }

@media (max-width: 640px) {
  .vmm-prices { grid-template-columns: repeat(2, 1fr); }
  .vmm-contact { grid-template-columns: 1fr; }
}
`;
