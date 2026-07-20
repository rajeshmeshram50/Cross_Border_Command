import { useEffect, useState } from 'react';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';

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
  vendor_count?: number;
};

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDmy(d);
}

export default function ProcurementDetailsModal({ open, procurementId, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading]   = useState(false);
  const [details, setDetails]   = useState<ProcurementDetails | null>(null);

  useEffect(() => {
    if (!open || !procurementId) { setDetails(null); return; }
    setLoading(true);
    api.get<{ status: boolean; data: ProcurementDetails }>(`/procurements/${procurementId}`)
      .then(({ data }) => setDetails(data.data ?? null))
      .catch(() => toast.error('Load failed', 'Could not fetch procurement details'))
      .finally(() => setLoading(false));
  }, [open, procurementId, toast]);

  /* Freeze background scroll while the popup is open. Called before the early
     return so the hook runs on every render (rules of hooks); it locks BOTH
     <html> and <body> — locking body alone doesn't stop this layout's page
     scroll, it happens on <html>. */
  useScrollLock(open);

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
  const vendorCount  = details?.vendor_count ?? 0;

  return createPortal((
    <>
      {/* ── PRIMARY MODAL — Parameter | Description grid ── */}
      <div className="pdv-backdrop" onClick={onClose}>
        <style>{SCOPED_CSS}</style>
        <div className="pdv-modal" onClick={(e) => e.stopPropagation()}>
          {/* Header — purple gradient with icon tile + title (figma) */}
          <div className="pdv-head">
            <div className="pdv-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h4" />
              </svg>
            </div>
            <div className="pdv-head-text">
              <div className="pdv-head-title">Procurement Details</div>
              <div className="pdv-head-sub">Read-only view</div>
            </div>
            <button className="pdv-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="pdv-body">
            {loading ? (
              <div className="pdv-rows smd-fade-in">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={`pdv-skl-${i}`} className="pdv-row">
                    <span className="smd-skel" style={{ height: 13, maxWidth: 110 }} />
                    <span className="smd-skel" style={{ height: 13, maxWidth: 150 }} />
                  </div>
                ))}
              </div>
            ) : !details ? (
              <div className="pdv-loading">No data found</div>
            ) : (
              <div className="pdv-rows smd-fade-in">
                <div className="pdv-row"><span className="pdv-row-label">Opp ID</span><span className="pdv-row-val">{oppId}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">Opp Date</span><span className="pdv-row-val">{oppDate}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">PROC ID</span><span className="pdv-row-val"><span className="pdv-chip">{procCode}</span></span></div>
                <div className="pdv-row"><span className="pdv-row-label">PROC Date</span><span className="pdv-row-val">{procDate}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">TAT</span><span className="pdv-row-val">{tatDate}</span></div>
                <div className="pdv-row pdv-row-hl"><span className="pdv-row-label">Created By</span><span className="pdv-row-val">{createdBy}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">Assigned To</span><span className="pdv-row-val">{assignedTo}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">PROC Current Status</span><span className="pdv-row-val"><span className={`pdv-status-pill ${statusCls}`}>{statusLabel}</span></span></div>
                <div className="pdv-row"><span className="pdv-row-label">Product Count</span><span className="pdv-row-val">{productCount}</span></div>
                <div className="pdv-row"><span className="pdv-row-label">Vendor Count</span><span className="pdv-row-val">{vendorCount}</span></div>
              </div>
            )}
          </div>

          {/* Footer — Close only (figma has no "View Products"). */}
          <div className="pdv-foot">
            <button type="button" className="pdv-btn pdv-btn-close" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
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

/* Header — purple gradient with an icon tile + title/subtitle (figma). */
.pdv-head {
  position: relative;
  display: flex; align-items: center; gap: 13px;
  background: linear-gradient(110deg, #7c3aed 0%, #8b5cf6 55%, #a78bfa 100%);
  color: #fff;
  padding: 16px 20px;
}
.pdv-head-icon {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.pdv-head-text { flex: 1; min-width: 0; }
.pdv-head-title { font-size: 16px; font-weight: 800; letter-spacing: .01em; }
.pdv-head-sub   { font-size: 11.5px; color: rgba(255,255,255,.82); margin-top: 2px; }
.pdv-close {
  width: 30px; height: 30px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: none; cursor: pointer;
  color: #fff; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.pdv-close:hover { background: rgba(255,255,255,.32); }

.pdv-body { flex: 1; overflow-y: auto; padding: 14px 18px; background: #faf9ff; }
.pdv-loading { padding: 36px 0; text-align: center; color: #64748b; font-style: italic; font-size: 13px; }

/* Accent rows — label + value, yellow left-border, Created By highlighted. */
.pdv-rows { display: flex; flex-direction: column; gap: 8px; }
.pdv-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  background: #fff;
  border: 1px solid #ede9fe; border-left: 3px solid #f59e0b;
  border-radius: 9px;
  padding: 11px 14px;
}
.pdv-row-hl { background: #fffbeb; border-color: #fde68a; border-left-color: #f59e0b; }
.pdv-row-label { font-size: 12.5px; font-weight: 700; color: #475569; }
.pdv-row-val   { font-size: 13px; font-weight: 700; color: #1e293b; text-align: right; }
.pdv-chip {
  font-family: 'Inter', monospace; font-size: 12px; font-weight: 800;
  background: #fef3c7; color: #b45309; border: 1.5px solid #fcd34d;
  padding: 3px 11px; border-radius: 999px;
}
.pdv-mono { font-family: 'Inter', monospace; font-weight: 800; }

.pdv-status-pill {
  display: inline-block; padding: 5px 14px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.pdv-status-done { background: #d1fae5; color: #047857; }
.pdv-status-prog { background: #ede9fe; color: #6d28d9; }

/* Footer — clean white to match the screenshots */
.pdv-foot {
  padding: 16px 22px; display: flex; justify-content: flex-end; gap: 14px;
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
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,.32);
}
.pdv-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(124,58,237,.42);
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
[data-bs-theme="dark"] .pdv-row {
  background: #1a1538; border-color: rgba(167,139,250,.22); border-left-color: #f59e0b;
}
[data-bs-theme="dark"] .pdv-row-hl { background: rgba(245,158,11,.12); border-color: rgba(252,191,36,.35); }
[data-bs-theme="dark"] .pdv-row-label { color: #c4b5fd; }
[data-bs-theme="dark"] .pdv-row-val   { color: #ede9fe; }
[data-bs-theme="dark"] .pdv-chip { background: rgba(252,191,36,.18); color: #fde68a; border-color: rgba(252,191,36,.45); }
[data-bs-theme="dark"] .pdv-loading { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .pdv-status-prog { background: rgba(124,58,237,.25); color: #c4b5fd; }
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
