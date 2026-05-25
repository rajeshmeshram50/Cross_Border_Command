import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Procurement Details — first modal opens when the user clicks PROC-### on
 * the Stage 3 Sourcing Required tab. Renders a Parameter | Description grid
 * (IDIMS layout) summarising the procurement, with a "View Products"
 * footer button that opens a second modal listing every line item.
 * ───────────────────────────────────────────────────────────────────── */

type Props = {
  open:           boolean;
  procurementId:  number | null;
  onClose:        () => void;
};

type ProductLine = {
  id:           number;
  product_id:   number;
  qty:          string | number | null;
  target_price: string | number | null;
  product?: {
    id:           number;
    product_code: string | null;
    name:         string | null;
    status:       string | null;
  } | null;
};

type ProcurementDetails = {
  id:                number;
  lead_id:           number | null;
  procurement_date:  string | null;
  assign_id:         number | null;
  status:            string;
  attachments:       string[] | null;
  created_by:        number | null;
  created_at:        string;
  updated_at:        string;
  lead?: {
    id: number;
    opp_code?: string | null;
    unique_query_id?: string | null;
    query_time?: string | null;
    created_at?: string | null;
  } | null;
  assignee?: { id: number; name: string | null } | null;
  creator?:  { id: number; name: string | null } | null;
  products?: ProductLine[];
};

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB');
}

export default function ProcurementDetailsModal({ open, procurementId, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading]   = useState(false);
  const [details, setDetails]   = useState<ProcurementDetails | null>(null);
  const [showProducts, setShowProducts] = useState(false);

  useEffect(() => {
    if (!open || !procurementId) { setDetails(null); setShowProducts(false); return; }
    setLoading(true);
    api.get<{ status: boolean; data: ProcurementDetails }>(`/procurements/${procurementId}`)
      .then(({ data }) => setDetails(data.data ?? null))
      .catch(() => toast.error('Load failed', 'Could not fetch procurement details'))
      .finally(() => setLoading(false));
  }, [open, procurementId, toast]);

  if (!open) return null;

  const statusLc    = (details?.status ?? '').toLowerCase();
  const statusLabel = statusLc === 'done' ? 'Completed' : statusLc === 'inprogress' ? 'In Progress' : (details?.status ?? '—');
  const statusCls   = statusLc === 'done' ? 'pdv-status-done' : 'pdv-status-prog';
  const procCode    = details ? `PROC-${String(details.id).padStart(3, '0')}` : '—';
  const oppId       = details?.lead?.opp_code ?? details?.lead?.unique_query_id ?? (details?.lead_id ? `LEAD-${details.lead_id}` : '—');
  const oppDate     = formatDate(details?.lead?.query_time ?? details?.lead?.created_at ?? null);
  const procDate    = formatDate(details?.procurement_date ?? details?.created_at ?? null);
  const tatDate     = formatDate(details?.procurement_date ?? null);
  const createdBy   = details?.creator?.name ?? 'Admin';
  const assignedTo  = details?.assignee?.name ?? '—';
  const productCount = details?.products?.length ?? 0;

  return createPortal((
    <>
      {/* ── PRIMARY MODAL — Parameter | Description grid ── */}
      <div className="pdv-backdrop" onClick={onClose}>
        <style>{SCOPED_CSS}</style>
        <div className="pdv-modal" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="pdv-head">
            <div className="pdv-head-col">Parameter</div>
            <div className="pdv-head-col">Description</div>
            <button className="pdv-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="pdv-body">
            {loading ? (
              <div className="pdv-loading">Loading procurement details…</div>
            ) : !details ? (
              <div className="pdv-loading">No data found</div>
            ) : (
              <div className="pdv-grid">
                <div className="pdv-grid-label">Opp ID</div>
                <div className="pdv-grid-val">{oppId}</div>

                <div className="pdv-grid-label">Opp Date</div>
                <div className="pdv-grid-val">{oppDate}</div>

                <div className="pdv-grid-label">PROC ID</div>
                <div className="pdv-grid-val pdv-mono">{procCode}</div>

                <div className="pdv-grid-label">PROC Date</div>
                <div className="pdv-grid-val">{procDate}</div>

                <div className="pdv-grid-label">TAT</div>
                <div className="pdv-grid-val">{tatDate}</div>

                <div className="pdv-grid-label">Created By</div>
                <div className="pdv-grid-val">{createdBy}</div>

                <div className="pdv-grid-label">Assigned To</div>
                <div className="pdv-grid-val">{assignedTo}</div>

                <div className="pdv-grid-label">PROC Current Status</div>
                <div className="pdv-grid-val">
                  <span className={`pdv-status-pill ${statusCls}`}>{statusLabel}</span>
                </div>

                <div className="pdv-grid-label">Product Count</div>
                <div className="pdv-grid-val">{productCount}</div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pdv-foot">
            <button type="button" className="pdv-btn pdv-btn-close" onClick={onClose}>Close</button>
            <button
              type="button"
              className="pdv-btn pdv-btn-primary"
              onClick={() => setShowProducts(true)}
              disabled={!details}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{marginRight: 4}}>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              View Products
            </button>
          </div>
        </div>
      </div>

      {/* ── SECONDARY MODAL — Products in Procurement ── */}
      {showProducts && details && createPortal((
        <div className="pdv-backdrop pdv-backdrop-2" onClick={() => setShowProducts(false)}>
          <div className="pdv-modal pdv-modal-products" onClick={(e) => e.stopPropagation()}>
            <div className="pdv-products-head">
              <span>Products in Procurement</span>
              <button className="pdv-close" onClick={() => setShowProducts(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="pdv-products-summary">
              <div className="pdv-products-summary-cell">
                <span className="pdv-products-summary-label">PROC ID</span>
                <span className="pdv-products-summary-val pdv-mono">{procCode}</span>
              </div>
              <div className="pdv-products-summary-cell">
                <span className="pdv-products-summary-label">PROC Date</span>
                <span className="pdv-products-summary-val">{procDate}</span>
              </div>
              <div className="pdv-products-summary-cell">
                <span className="pdv-products-summary-label">TAT</span>
                <span className="pdv-products-summary-val">{tatDate}</span>
              </div>
              <div className="pdv-products-summary-cell">
                <span className="pdv-products-summary-label">Created By</span>
                <span className="pdv-products-summary-val">{createdBy}</span>
              </div>
              <div className="pdv-products-summary-cell">
                <span className="pdv-products-summary-label">Assigned To</span>
                <span className="pdv-products-summary-val">{assignedTo}</span>
              </div>
            </div>

            <div className="pdv-products-table-wrap">
              <table className="pdv-products-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Sr No</th>
                    <th style={{ width: 120 }}>Product Code</th>
                    <th>Product Name</th>
                    <th style={{ width: 90 }}>Status</th>
                    <th style={{ width: 100 }}>Quantity</th>
                    <th style={{ width: 120 }}>Target Price</th>
                  </tr>
                </thead>
                <tbody>
                  {(details.products ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="pdv-empty">No products in this procurement.</td></tr>
                  ) : (details.products ?? []).map((p, idx) => {
                    const st = (p.product?.status ?? '').toLowerCase();
                    const stCls = st === 'active' ? 'pdv-st-active' : st === 'draft' ? 'pdv-st-draft' : st ? 'pdv-st-inactive' : '';
                    return (
                      <tr key={p.id}>
                        <td>{idx + 1}</td>
                        <td><span className="pdv-code">{p.product?.product_code ?? `P-${p.product_id}`}</span></td>
                        <td>{p.product?.name ?? '—'}</td>
                        <td>{st ? <span className={`pdv-st-pill ${stCls}`}>{st.charAt(0).toUpperCase() + st.slice(1)}</span> : '—'}</td>
                        <td>{p.qty != null ? Number(p.qty).toLocaleString() : '—'}</td>
                        <td>{p.target_price != null ? '$' + Number(p.target_price).toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pdv-foot">
              <button type="button" className="pdv-btn pdv-btn-close" onClick={() => setShowProducts(false)}>Close</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  ), document.body);
}

const SCOPED_CSS = `
.pdv-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.pdv-backdrop-2 { z-index: 1100; }

.pdv-modal {
  width: min(720px, 100%); max-height: 92vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.pdv-modal-products { width: min(920px, 100%); }

/* Parameter | Description header bar — deep-navy → royal-blue gradient */
.pdv-head {
  position: relative;
  display: grid; grid-template-columns: 1fr 1fr;
  background: linear-gradient(180deg, #1e2a5e 0%, #2f4d9e 100%);
  color: #fff;
  padding: 16px 22px;
  font-size: 14.5px; font-weight: 800;
}
.pdv-head-col { padding-right: 14px; letter-spacing: .01em; }
.pdv-head-col + .pdv-head-col { border-left: 1px solid rgba(255,255,255,.22); padding-left: 18px; }
.pdv-close {
  position: absolute; top: 14px; right: 14px;
  width: 30px; height: 30px;
  background: rgba(255,255,255,.18); border: none; cursor: pointer;
  color: #fff; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.pdv-close:hover { background: rgba(255,255,255,.32); }

.pdv-body { flex: 1; overflow-y: auto; padding: 0; background: #fff; }
.pdv-loading { padding: 36px 0; text-align: center; color: #64748b; font-style: italic; font-size: 13px; }

/* 2-col Parameter|Description grid rows */
.pdv-grid { display: grid; grid-template-columns: 1fr 1fr; }
.pdv-grid-label {
  padding: 13px 22px;
  font-size: 13px; font-weight: 700; color: #1e2a5e;
  border-bottom: 1px solid #e5e7eb;
}
.pdv-grid-val {
  padding: 13px 22px;
  font-size: 13px; color: #2f4d9e; font-weight: 600;
  border-bottom: 1px solid #e5e7eb;
}
.pdv-grid > :nth-last-child(-n+2) { border-bottom: none; }
.pdv-mono { font-family: 'Inter', monospace; font-weight: 800; }

.pdv-status-pill {
  display: inline-block; padding: 5px 14px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.pdv-status-done { background: #d1fae5; color: #047857; }
.pdv-status-prog { background: #dbeafe; color: #2f4d9e; }

/* Footer — clean white to match the screenshots */
.pdv-foot {
  padding: 16px 22px; display: flex; justify-content: center; gap: 14px;
  background: #fff; border-top: 1px solid #e5e7eb;
}
.pdv-btn {
  padding: 8px 22px; border-radius: 8px;
  font-family: inherit; font-weight: 700; font-size: 12.5px; cursor: pointer;
  border: 1.5px solid transparent;
  min-width: 110px;
  transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.pdv-btn-close {
  background: #fff; border-color: #e5e7eb; color: #1e293b;
}
.pdv-btn-close:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.pdv-btn-primary {
  background: linear-gradient(180deg, #2f4d9e, #1e2a5e); color: #fff;
  box-shadow: 0 3px 10px rgba(30,42,94,.30);
}
.pdv-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #3b5cb8, #2f4d9e);
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(30,42,94,.40);
}
.pdv-btn:disabled { opacity: .6; cursor: not-allowed; }

/* Products modal */
.pdv-products-head {
  position: relative;
  padding: 16px 22px;
  background: #fff;
  font-size: 16px; font-weight: 800; color: #1e2a5e;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid #e5e7eb;
}
.pdv-products-head .pdv-close {
  position: static;
  background: #f1f5f9; color: #475569;
}
.pdv-products-head .pdv-close:hover { background: #e5e7eb; color: #1e293b; }

.pdv-products-summary {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 0; padding: 16px 22px;
  background: #fff; border-bottom: 1px solid #e5e7eb;
}
.pdv-products-summary-cell { display: flex; flex-direction: column; gap: 5px; }
.pdv-products-summary-label { font-size: 11.5px; color: #64748b; font-weight: 600; }
.pdv-products-summary-val   { font-size: 14px; color: #1e2a5e; font-weight: 800; }

.pdv-products-table-wrap { overflow-x: auto; padding: 0 22px 16px; background: #fff; flex: 1; }
.pdv-products-table { width: 100%; border-collapse: collapse; min-width: 640px; }
.pdv-products-table thead th {
  padding: 13px 14px; text-align: left;
  font-size: 12px; font-weight: 800; color: #fff;
  background: #2f4d9e;
  white-space: nowrap;
}
.pdv-products-table thead th:first-child { border-top-left-radius: 8px; }
.pdv-products-table thead th:last-child  { border-top-right-radius: 8px; }
.pdv-products-table tbody td {
  padding: 13px 14px; font-size: 13px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.pdv-products-table tbody tr:last-child td { border-bottom: none; }
.pdv-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 22px; }
.pdv-code {
  font-family: 'Inter',monospace; font-size: 12px; font-weight: 800;
  background: #eff6ff; color: #2f4d9e; padding: 4px 12px; border-radius: 999px;
  border: 1.5px solid #bfdbfe;
}
.pdv-st-pill { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.pdv-st-active   { background: #d1fae5; color: #047857; }
.pdv-st-inactive { background: #fee2e2; color: #dc2626; }
.pdv-st-draft    { background: #fef3c7; color: #b45309; }

/* Dark mode */
[data-bs-theme="dark"] .pdv-modal { background: #14102a; }
[data-bs-theme="dark"] .pdv-body  { background: #14102a; }
[data-bs-theme="dark"] .pdv-grid-label,
[data-bs-theme="dark"] .pdv-grid-val {
  color: #ede9fe; border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .pdv-grid-label { color: #c4b5fd; }
[data-bs-theme="dark"] .pdv-loading { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .pdv-status-prog { background: rgba(30,64,175,.30); color: #93c5fd; }
[data-bs-theme="dark"] .pdv-foot {
  background: #1a1538; border-top-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .pdv-btn-close {
  background: #1f1845; border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
[data-bs-theme="dark"] .pdv-btn-close:hover:not(:disabled) { background: #2a2150; }
[data-bs-theme="dark"] .pdv-products-head {
  background: #1a1538; color: #93c5fd; border-bottom-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .pdv-products-head .pdv-close {
  background: rgba(124,58,237,.18); color: #c4b5fd;
}
[data-bs-theme="dark"] .pdv-products-summary {
  background: #1a1538; border-bottom-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .pdv-products-summary-label { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .pdv-products-summary-val   { color: #93c5fd; }
[data-bs-theme="dark"] .pdv-products-table-wrap { background: #14102a; }
[data-bs-theme="dark"] .pdv-products-table thead th {
  background: linear-gradient(135deg, #1e3a8a, #312e81);
}
[data-bs-theme="dark"] .pdv-products-table tbody td {
  color: #ede9fe; border-bottom-color: rgba(167,139,250,.18);
}
[data-bs-theme="dark"] .pdv-code {
  background: rgba(96,165,250,.18); color: #93c5fd; border-color: rgba(96,165,250,.40);
}

@media (max-width: 700px) {
  .pdv-head { grid-template-columns: 1fr; }
  .pdv-head-col + .pdv-head-col { border-left: none; padding-left: 0; }
  .pdv-grid { grid-template-columns: 1fr; }
  .pdv-grid-label { padding-bottom: 4px; border-bottom: none; }
  .pdv-products-summary { grid-template-columns: repeat(2, 1fr); gap: 10px; }
}
`;
