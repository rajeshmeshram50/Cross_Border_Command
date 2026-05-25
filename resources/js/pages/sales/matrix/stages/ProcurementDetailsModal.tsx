import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Procurement Details modal.
 *
 *   Ported from IDIMS ProcurementDetailsModal.tsx (lightweight version).
 *   Opens when the user clicks a PROC-### pill on the Stage 3 → Sourcing
 *   Required tab. Shows the procurement summary on top and the linked
 *   products beneath. Read-only.
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
  lead?: { id: number; unique_query_id?: string | null } | null;
  assignee?: { id: number; name: string | null } | null;
  products?: ProductLine[];
};

function formatDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB');
}

export default function ProcurementDetailsModal({ open, procurementId, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading]     = useState(false);
  const [details, setDetails]     = useState<ProcurementDetails | null>(null);

  useEffect(() => {
    if (!open || !procurementId) { setDetails(null); return; }
    setLoading(true);
    api.get<{ status: boolean; data: ProcurementDetails }>(`/procurements/${procurementId}`)
      .then(({ data }) => setDetails(data.data ?? null))
      .catch(() => toast.error('Load failed', 'Could not fetch procurement details'))
      .finally(() => setLoading(false));
  }, [open, procurementId, toast]);

  if (!open) return null;

  const statusLabel = details?.status === 'done' ? 'Completed' : details?.status === 'inprogress' ? 'In Progress' : (details?.status ?? '—');
  const statusCls   = details?.status === 'done' ? 'pdv-status-done' : 'pdv-status-prog';

  return createPortal((
    <div className="pdv-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="pdv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdv-head">
          <div className="pdv-head-left">
            <div className="pdv-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <div>
              <div className="pdv-head-title">Procurement Details</div>
              <div className="pdv-head-sub">{details ? `PROC-${String(details.id).padStart(3, '0')}` : 'Loading…'}</div>
            </div>
          </div>
          <button className="pdv-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="pdv-body">
          {loading ? (
            <div className="pdv-loading">Loading procurement…</div>
          ) : !details ? (
            <div className="pdv-loading">No data found</div>
          ) : (
            <>
              <div className="pdv-summary">
                <div className="pdv-summary-row"><span className="pdv-summary-label">Opportunity ID</span><span className="pdv-summary-val">{details.lead?.unique_query_id ?? (details.lead_id ? `LEAD-${details.lead_id}` : '—')}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">PROC ID</span><span className="pdv-summary-val">PROC-{String(details.id).padStart(3, '0')}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">PROC Date / TAT</span><span className="pdv-summary-val">{formatDate(details.procurement_date)}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">Assigned To</span><span className="pdv-summary-val">{details.assignee?.name ?? '—'}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">Created</span><span className="pdv-summary-val">{formatDate(details.created_at)}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">Status</span><span className={`pdv-status-pill ${statusCls}`}>{statusLabel}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">Product Count</span><span className="pdv-summary-val">{details.products?.length ?? 0}</span></div>
                <div className="pdv-summary-row"><span className="pdv-summary-label">Attachments</span><span className="pdv-summary-val">{details.attachments?.length ?? 0}</span></div>
              </div>

              <div className="pdv-prods">
                <div className="pdv-prods-head">Products in this procurement</div>
                <div className="pdv-prods-wrap">
                  <table className="pdv-prods-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>SR</th>
                        <th style={{ width: 100 }}>CODE</th>
                        <th>PRODUCT NAME</th>
                        <th style={{ width: 90 }}>STATUS</th>
                        <th style={{ width: 90 }}>QTY</th>
                        <th style={{ width: 110 }}>TARGET PRICE</th>
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
                            <td>{st ? <span className={`pdv-st-pill ${stCls}`}>● {st.charAt(0).toUpperCase() + st.slice(1)}</span> : '—'}</td>
                            <td>{p.qty != null ? Number(p.qty).toLocaleString() : '—'}</td>
                            <td>{p.target_price != null ? Number(p.target_price).toLocaleString() : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="pdv-foot">
          <button type="button" className="pdv-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.pdv-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.pdv-modal {
  width: min(820px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.pdv-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
}
.pdv-head-left { display: flex; align-items: center; gap: 12px; }
.pdv-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.pdv-head-title { font-size: 15px; font-weight: 700; }
.pdv-head-sub   { font-size: 11px; opacity: .85; margin-top: 2px; font-family: 'Inter',monospace; letter-spacing: .04em; }
.pdv-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.pdv-close:hover { background: rgba(255,255,255,.32); }

.pdv-body { flex: 1; overflow-y: auto; padding: 16px 20px; background: #eef2ff; }
.pdv-loading { padding: 24px 0; text-align: center; color: #4f46e5; font-style: italic; font-size: 12.5px; }

.pdv-summary {
  display: grid; grid-template-columns: 1fr 1fr;
  background: #fff; border: 1px solid #c7d2fe; border-radius: 12px;
  overflow: hidden; margin-bottom: 14px;
}
.pdv-summary-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px;
  border-right: 1px solid #e0e7ff; border-bottom: 1px solid #e0e7ff;
  background: #f5f3ff;
  font-size: 12px;
}
.pdv-summary-row:nth-child(4n+3),
.pdv-summary-row:nth-child(4n+4) { background: #fff; }
.pdv-summary-row:nth-child(2n)   { border-right: none; }
.pdv-summary-row:nth-last-child(-n+2):nth-child(2n+1),
.pdv-summary-row:nth-last-child(1) { border-bottom: none; }
.pdv-summary-label { font-size: 10.5px; font-weight: 800; color: #4338ca; text-transform: uppercase; letter-spacing: .06em; }
.pdv-summary-val   { font-size: 12px; font-weight: 700; color: #1e293b; }
.pdv-status-pill {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800;
}
.pdv-status-done { background: #d1fae5; color: #047857; }
.pdv-status-prog { background: #fef3c7; color: #92400e; }

.pdv-prods {
  background: #fff; border: 1px solid #c7d2fe; border-radius: 12px; overflow: hidden;
}
.pdv-prods-head {
  padding: 10px 14px; font-size: 11.5px; font-weight: 800; color: #4338ca;
  background: #eef2ff; border-bottom: 1px solid #c7d2fe;
  text-transform: uppercase; letter-spacing: .06em;
}
.pdv-prods-wrap { overflow-x: auto; }
.pdv-prods-table { width: 100%; border-collapse: collapse; min-width: 640px; }
.pdv-prods-table thead th {
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6366f1;
  background: #f5f3ff; border-bottom: 1px solid #c7d2fe; white-space: nowrap;
}
.pdv-prods-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.pdv-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 22px 14px; }
.pdv-code {
  font-family: 'Inter',monospace; font-size: 10.5px; font-weight: 700;
  background: #eef2ff; color: #4338ca; padding: 2px 8px; border-radius: 7px;
  border: 1px solid #c7d2fe;
}
.pdv-st-pill { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 800; }
.pdv-st-active   { background: #d1fae5; color: #047857; }
.pdv-st-inactive { background: #fee2e2; color: #dc2626; }
.pdv-st-draft    { background: #fef3c7; color: #b45309; }

.pdv-foot {
  padding: 12px 20px; display: flex; justify-content: flex-end;
  background: #e0e7ff; border-top: 1.5px solid #c7d2fe;
}
.pdv-btn {
  padding: 7px 18px; border-radius: 8px;
  background: #fff; border: 1.5px solid #c7d2fe; color: #4338ca;
  font-family: inherit; font-weight: 700; font-size: 12px; cursor: pointer;
}
.pdv-btn:hover { background: #eef2ff; }

/* Dark mode */
[data-bs-theme="dark"] .pdv-modal { background: #14102a; }
[data-bs-theme="dark"] .pdv-body  { background: #1a1538; }
[data-bs-theme="dark"] .pdv-summary,
[data-bs-theme="dark"] .pdv-prods {
  background: #14102a; border-color: rgba(99,102,241,.35);
}
[data-bs-theme="dark"] .pdv-summary-row {
  background: rgba(99,102,241,.10);
  border-right-color: rgba(99,102,241,.25);
  border-bottom-color: rgba(99,102,241,.25);
}
[data-bs-theme="dark"] .pdv-summary-row:nth-child(4n+3),
[data-bs-theme="dark"] .pdv-summary-row:nth-child(4n+4) { background: rgba(99,102,241,.04); }
[data-bs-theme="dark"] .pdv-summary-label { color: #a5b4fc; }
[data-bs-theme="dark"] .pdv-summary-val   { color: #ede9fe; }
[data-bs-theme="dark"] .pdv-prods-head { background: rgba(99,102,241,.14); color: #a5b4fc; border-bottom-color: rgba(99,102,241,.35); }
[data-bs-theme="dark"] .pdv-prods-table thead th {
  background: rgba(99,102,241,.10); color: #a5b4fc; border-bottom-color: rgba(99,102,241,.35);
}
[data-bs-theme="dark"] .pdv-prods-table tbody td { color: #ede9fe; border-bottom-color: rgba(99,102,241,.18); }
[data-bs-theme="dark"] .pdv-code {
  background: rgba(99,102,241,.18); color: #a5b4fc; border-color: rgba(99,102,241,.40);
}
[data-bs-theme="dark"] .pdv-foot {
  background: rgba(99,102,241,.12); border-top-color: rgba(99,102,241,.35);
}
[data-bs-theme="dark"] .pdv-btn {
  background: #1f1845; border-color: rgba(99,102,241,.40); color: #a5b4fc;
}
[data-bs-theme="dark"] .pdv-btn:hover { background: #2a2150; }
[data-bs-theme="dark"] .pdv-loading { color: #a5b4fc; }
`;
