import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Product Directory — lists every product mapped to the current
 * opportunity, with inline Edit / Delete actions per row and a
 * "Map Product" CTA in the header to add a new mapping.
 *
 * Frontend-only mock for now; once the opportunity-product mapping
 * API lands, swap the SAMPLE_PRODUCTS list for a `GET
 * /sales/opportunities/{id}/products` call from the parent and pass
 * the rows in via the `products` prop.
 * ──────────────────────────────────────────────────────────────────────── */

export type DirectoryProduct = {
  id: string;
  productCode: string;       // "P-001"
  productName: string;
  category?: string;         // shown as a pill under product name
  status: 'Active' | 'Inactive';
  quantity: number;
  targetPrice: number;
  currency: string;          // "USD", "INR", …
};

const SAMPLE_PRODUCTS: DirectoryProduct[] = [
  { id: '1', productCode: 'P-001', productName: 'Potato 50kg Bag Grade A', category: 'Vegetables', status: 'Active',   quantity: 80,  targetPrice: 290,  currency: 'USD' },
  { id: '2', productCode: 'P-002', productName: 'Basmati Rice 25kg',       category: 'Grains',     status: 'Active',   quantity: 120, targetPrice: 1450, currency: 'USD' },
  { id: '3', productCode: 'P-003', productName: 'Turmeric Powder 10kg',    category: 'Spices',     status: 'Inactive', quantity: 35,  targetPrice: 520,  currency: 'USD' },
  { id: '4', productCode: 'P-004', productName: 'Cashew W240 50kg',        category: 'Dry Fruits', status: 'Inactive', quantity: 60,  targetPrice: 3200, currency: 'USD' },
];

export default function ProductDirectoryModal(props: {
  open: boolean;
  onClose: () => void;
  /** Inject the live mapped-product list once the API ships. */
  products?: DirectoryProduct[];
  /** Fires when the user clicks the header "Map Product" button. */
  onMapProduct?: () => void;
}) {
  const { open, onClose, products = SAMPLE_PRODUCTS, onMapProduct } = props;
  const toast = useToast();

  if (!open) return null;

  return createPortal((
    /* Backdrop click intentionally does NOT close — same dismiss
       hardening applied across the wizard's other popups. Use the
       header ✕ button to close. */
    <div className="pdm-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="pdm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdm-head">
          <div className="pdm-head-left">
            <div className="pdm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <div className="pdm-head-title">Product Directory</div>
              <div className="pdm-head-sub">{products.length} {products.length === 1 ? 'product' : 'products'} mapped to this opportunity</div>
            </div>
          </div>
          <div className="pdm-head-actions">
            <button
              className="pdm-map-btn"
              onClick={() => {
                if (onMapProduct) onMapProduct();
                else toast.info('Coming next', 'Map Product flow');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Map Product
            </button>
            <button className="pdm-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pdm-body">
          <div className="pdm-table-wrap">
            <table className="pdm-table">
              <thead>
                <tr>
                  <th>SR NO</th>
                  <th>PRODUCT CODE</th>
                  <th>PRODUCT NAME</th>
                  <th>STATUS</th>
                  <th className="pdm-th-num">QUANTITY</th>
                  <th className="pdm-th-num">TARGET PRICE</th>
                  <th>CURRENCY</th>
                  <th className="pdm-th-actions">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="pdm-empty">
                      No products mapped to this opportunity yet. Click <strong>Map Product</strong> to add the first one.
                    </td>
                  </tr>
                ) : products.map((p, i) => (
                  <tr key={p.id}>
                    <td><span className="pdm-sr">{i + 1}</span></td>
                    <td><span className="pdm-code">{p.productCode}</span></td>
                    <td>
                      <div className="pdm-name">{p.productName}</div>
                      {p.category && <span className="pdm-category">{p.category}</span>}
                    </td>
                    <td>
                      <span className={`pdm-status pdm-status-${p.status.toLowerCase()}`}>
                        <span className="pdm-status-dot" />
                        {p.status}
                      </span>
                    </td>
                    <td className="pdm-td-num">{p.quantity}</td>
                    <td className="pdm-td-num pdm-target">${' '}{p.targetPrice.toFixed(2)}</td>
                    <td><span className="pdm-currency">{p.currency}</span></td>
                    <td>
                      <div className="pdm-actions">
                        <button
                          type="button"
                          className="pdm-action pdm-action-edit"
                          title="Edit"
                          aria-label="Edit"
                          onClick={() => toast.info('Edit product', `${p.productCode}`)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button
                          type="button"
                          className="pdm-action pdm-action-delete"
                          title="Delete"
                          aria-label="Delete"
                          onClick={() => toast.info('Delete product', `${p.productCode}`)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ── Scoped styles ──────────────────────────────────────────────────────── */
const SCOPED_CSS = `
.pdm-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 48px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.pdm-modal {
  width: 100%; max-width: 1180px;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
  max-height: calc(100vh - 96px);
}
.pdm-modal *, .pdm-modal *::before, .pdm-modal *::after { box-sizing: border-box; }

/* Header — violet→purple gradient strip */
.pdm-head {
  position: relative;
  padding: 18px 22px;
  background: linear-gradient(115deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  overflow: hidden;
}
.pdm-head::after {
  content: '';
  position: absolute;
  top: -40%; right: -10%;
  width: 320px; height: 240px;
  background: radial-gradient(ellipse, rgba(255,255,255,.18), transparent 70%);
  pointer-events: none;
}
.pdm-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; position: relative; z-index: 1; }
.pdm-head-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
}
.pdm-head-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.pdm-head-sub   { font-size: 12px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
.pdm-head-actions { display: inline-flex; align-items: center; gap: 10px; position: relative; z-index: 1; }
.pdm-map-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 16px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.30);
  color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: background .15s, transform .12s;
}
.pdm-map-btn:hover { background: rgba(255,255,255,.28); transform: translateY(-1px); }
.pdm-close {
  width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
}
.pdm-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.pdm-body {
  padding: 18px 22px 22px;
  overflow-y: auto;
  background: linear-gradient(180deg, #fafbff 0%, #ffffff 100%);
}

/* Table */
.pdm-table-wrap {
  border: 1px solid #e9d5ff;
  border-radius: 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #c4b5fd transparent;
}
.pdm-table-wrap::-webkit-scrollbar { height: 8px; }
.pdm-table-wrap::-webkit-scrollbar-track { background: transparent; }
.pdm-table-wrap::-webkit-scrollbar-thumb {
  background: #c4b5fd; border-radius: 99px;
}
.pdm-table-wrap::-webkit-scrollbar-thumb:hover { background: #a78bfa; }

.pdm-table {
  width: 100%; min-width: 920px;
  border-collapse: separate; border-spacing: 0;
  font-size: 12.5px;
}
.pdm-table thead th {
  background: linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%);
  color: #fff;
  font-size: 11px; font-weight: 600; letter-spacing: .04em;
  padding: 10px 14px; text-align: left; white-space: nowrap;
  border-bottom: 1px solid rgba(255,255,255,.20);
}
.pdm-table thead th.pdm-th-num     { text-align: right; }
.pdm-table thead th.pdm-th-actions { text-align: center; }

.pdm-table tbody td {
  padding: 12px 14px;
  background: #fff;
  border-top: 1px solid #f1f5f9;
  vertical-align: middle;
  white-space: nowrap;
  color: #1e293b;
}
.pdm-table tbody tr:nth-child(even) td { background: #faf9ff; }
.pdm-table tbody tr:hover td { background: #f5f3ff; }
.pdm-table tbody td.pdm-td-num { text-align: right; font-variant-numeric: tabular-nums; }
.pdm-target { color: #16a34a; font-weight: 700; }

.pdm-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: #ede9fe; color: #5b21b6;
  font-size: 12px; font-weight: 600;
}
.pdm-code {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 6px;
  background: #fff; border: 1px solid #ddd6fe;
  color: #5b21b6;
  font-family: ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11.5px; font-weight: 600;
}
.pdm-name {
  font-size: 13px; font-weight: 600; color: #1e293b;
}
.pdm-category {
  display: inline-block; margin-top: 4px;
  padding: 2px 8px; border-radius: 99px;
  background: #f1f5f9; color: #64748b;
  font-size: 9.5px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase;
}

.pdm-status {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 99px;
  font-size: 11.5px; font-weight: 600;
}
.pdm-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor; flex-shrink: 0;
}
.pdm-status-active   { background: #d1fae5; color: #047857; }
.pdm-status-inactive { background: #fee2e2; color: #b91c1c; }

.pdm-currency {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 6px;
  background: #fff; border: 1px solid #ddd6fe;
  color: #5b21b6;
  font-size: 11.5px; font-weight: 600;
  font-family: ui-monospace, monospace;
}

.pdm-actions { display: inline-flex; align-items: center; gap: 6px; }
.pdm-action {
  width: 30px; height: 30px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  cursor: pointer;
  transition: all .15s ease;
}
.pdm-action-edit:hover {
  background: rgba(64, 81, 137, .10);
  border-color: #405189;
  color: #405189;
}
.pdm-action-delete:hover {
  background: rgba(240, 101, 72, .10);
  border-color: #f06548;
  color: #f06548;
}

.pdm-empty {
  text-align: center;
  padding: 40px 20px;
  color: #64748b;
  font-size: 13px;
  background: #fff;
}
.pdm-empty strong { color: #7c3aed; font-weight: 700; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .pdm-modal { background: #14102a; color: #ede9fe; box-shadow: 0 30px 80px rgba(0, 0, 0, .75); }
[data-bs-theme="dark"] .pdm-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .pdm-table-wrap { border-color: rgba(167, 139, 250, .25); }
[data-bs-theme="dark"] .pdm-table tbody td {
  background: #14102a; color: #cbd5e1;
  border-top-color: rgba(167, 139, 250, .18);
}
[data-bs-theme="dark"] .pdm-table tbody tr:nth-child(even) td { background: #1a1538; }
[data-bs-theme="dark"] .pdm-table tbody tr:hover td { background: #2a2150; }
[data-bs-theme="dark"] .pdm-name { color: #ede9fe; }
[data-bs-theme="dark"] .pdm-sr {
  background: rgba(124, 58, 237, .25); color: #c4b5fd;
}
[data-bs-theme="dark"] .pdm-code {
  background: #2a2150; border-color: rgba(167, 139, 250, .35); color: #c4b5fd;
}
[data-bs-theme="dark"] .pdm-category {
  background: #1a1538; color: #94a3b8;
}
[data-bs-theme="dark"] .pdm-status-active   { background: rgba(16, 185, 129, .22); color: #6ee7b7; }
[data-bs-theme="dark"] .pdm-status-inactive { background: rgba(239, 68, 68, .22);  color: #fca5a5; }
[data-bs-theme="dark"] .pdm-currency {
  background: #2a2150; border-color: rgba(167, 139, 250, .35); color: #c4b5fd;
}
[data-bs-theme="dark"] .pdm-action {
  background: #1f1845; border-color: rgba(167, 139, 250, .25); color: #cbd5e1;
}
[data-bs-theme="dark"] .pdm-action-edit:hover {
  background: rgba(99, 102, 241, .22); border-color: #818cf8; color: #c7d2fe;
}
[data-bs-theme="dark"] .pdm-action-delete:hover {
  background: rgba(248, 113, 113, .22); border-color: #f87171; color: #fecaca;
}
[data-bs-theme="dark"] .pdm-empty { background: #14102a; color: #94a3b8; }
[data-bs-theme="dark"] .pdm-empty strong { color: #c4b5fd; }
[data-bs-theme="dark"] .pdm-target { color: #6ee7b7; }
`;
