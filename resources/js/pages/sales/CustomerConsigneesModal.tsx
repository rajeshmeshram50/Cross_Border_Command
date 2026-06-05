import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import AddConsigneeModal, { type ConsigneeRow } from './AddConsigneeModal';

/* ────────────────────────────────────────────────────────────────────────────
 * CustomerConsigneesModal — the "Map Consignee" popup.
 *
 * Opened from the SalesCustomers table when the user clicks the team icon
 * next to a customer. Shows every consignee linked to that customer,
 * scoped server-side via `GET /consignees?customer_id={db_id}`.
 *
 * Actions:
 *   + Add Consignee     → opens AddConsigneeModal with the customer
 *                         already locked in (preselectedCustomerId).
 *   ✎ Edit Consignee    → opens AddConsigneeModal in edit mode.
 *
 * Tenant scope is enforced by the backend; the modal itself is
 * presentation-only.
 * ──────────────────────────────────────────────────────────────────────── */

export interface CustomerLite {
  id: string;          // C-001 display code
  db_id: number;       // numeric primary key
  company: string;
  country?: string;
}

interface Props {
  open: boolean;
  customer: CustomerLite | null;
  onClose: () => void;
}

const ROWS_PER_PAGE = 5;

export default function CustomerConsigneesModal({ open, customer, onClose }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ConsigneeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);
  /* Client-side pagination — 5 rows per page. Reset to page 1 whenever
   * the search term or underlying row set changes so the user never
   * lands on an empty page beyond the new last page. */
  const [page, setPage] = useState(1);

  const fetchRows = useCallback(async () => {
    if (!customer?.db_id) return;
    setLoading(true);
    try {
      const r = await api.get('/consignees', { params: { customer_id: customer.db_id } });
      const data: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
      setRows(data.map((d: any): ConsigneeRow => ({
        id:             String(d.id ?? ''),
        db_id:          typeof d.db_id === 'number' ? d.db_id : undefined,
        customerId:     String(d.customer_code ?? d.customer_id ?? ''),
        customer_db_id: typeof d.customer_id === 'number' ? d.customer_id : undefined,
        company:        d.company ?? '',
        segment:        d.segment ?? '',
        risk:           d.riskLevel ?? 'Low',
        contact:        d.contact ?? '',
        email:          d.email ?? '',
        phone:          d.phone ?? '',
        country:        d.country ?? '',
        countryDetail:  d.city ?? '',
        // Pull the mirror flag so we can compute the live "already-
        // mirrored" count and pass it to AddConsigneeModal as the
        // source of truth. The popup's data is always fresh (we
        // refetch on every save), so this beats relying on the
        // /customers withCount which may lag behind during a session.
        same_as_customer: !!d.same_as_customer,
      })));
    } catch (e: any) {
      toast.error('Failed to load consignees', e?.response?.data?.message ?? 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.db_id]);

  useEffect(() => {
    if (open) fetchRows();
    else { setQ(''); setRows([]); }
  }, [open, fetchRows]);

  // Filter client-side so the search feels instant — the server-side
  // result is already scoped to the customer, so the list stays small.
  const filtered = useMemo(() => {
    if (!q) return rows;
    const lo = q.toLowerCase();
    return rows.filter(c =>
      c.company.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.contact.toLowerCase().includes(lo) ||
      c.email.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo) ||
      c.country.toLowerCase().includes(lo) ||
      String(c.risk).toLowerCase().includes(lo),
    );
  }, [q, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  useEffect(() => { setPage(1); }, [q, rows]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);


  if (!open || !customer) return null;

  /* Render via portal so the modal isn't clipped by SalesCustomers'
   * table overflow / z-index, and stacks above the rest of the page. */
  return createPortal(
    <>
      <div className="ccm-overlay" onMouseDown={onClose}>
        <style>{SCOPED_CSS}</style>
        <div className="ccm-card" onMouseDown={e => e.stopPropagation()}>
          {/* Header */}
          <div className="ccm-header">
            <div className="ccm-header-left">
              <div className="ccm-header-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="ccm-header-text">
                <div className="ccm-title">Consignees</div>
                <div className="ccm-sub">Every consignee linked to this customer — destination &amp; delivery mapping.</div>
              </div>
            </div>
            <div className="ccm-header-right">
              {/* Customer chip — slimmer two-row layout (label on top,
                 code + name below) so the long company names don't push
                 the close button off-screen on tablets. */}
              <div className="ccm-link-chip">
                <span className="ccm-link-chip-lbl">Consignees for</span>
                <div className="ccm-link-chip-row">
                  <span className="ccm-link-chip-code">{customer.id}</span>
                  <span className="ccm-link-chip-name" title={customer.company}>{customer.company}</span>
                  {customer.country && <span className="ccm-link-chip-country">{customer.country}</span>}
                </div>
              </div>
              <button type="button" className="ccm-close" onClick={onClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="ccm-toolbar">
            <div className="ccm-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="search"
                placeholder="Search consignees…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <div className="ccm-toolbar-right">
              <span className="ccm-count">{filtered.length} {filtered.length === 1 ? 'consignee' : 'consignees'}</span>
              <button
                type="button"
                className="ccm-add-btn"
                onClick={() => { setEditing(null); setAddOpen(true); }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Consignee
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="ccm-body">
            <div className="ccm-table-wrap">
              <table className="ccm-table">
                <thead>
                  <tr>
                    <th>SR NO</th>
                    <th>CONSIGNEE ID</th>
                    <th>COMPANY NAME</th>
                    <th>SEGMENT</th>
                    <th>RISK LEVEL</th>
                    <th>CONTACT PERSON</th>
                    <th>EMAIL</th>
                    <th>CONTACT NO</th>
                    <th>LOCATION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="ccm-empty"><td colSpan={10}>
                      <div className="ccm-empty-state">
                        <span className="ccm-empty-spinner" />
                        <span>Loading consignees…</span>
                      </div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr className="ccm-empty">
                      <td colSpan={10}>
                        {q ? 'No consignees match your search.' : <>No consignees mapped to <strong>{customer.id}</strong> yet. Click <strong>+ Add Consignee</strong> to create the first one.</>}
                      </td>
                    </tr>
                  ) : pageRows.map((c, i) => {
                    const riskColor = String(c.risk).toLowerCase() === 'high'
                      ? 'ccm-pill-high'
                      : String(c.risk).toLowerCase() === 'medium'
                        ? 'ccm-pill-med'
                        : 'ccm-pill-low';
                    const location = [c.countryDetail, c.country].filter(Boolean).join(', ') || '—';
                    return (
                      <tr key={c.id}>
                        <td>{(page - 1) * ROWS_PER_PAGE + i + 1}</td>
                        <td><span className="ccm-id-chip">{c.id}</span></td>
                        <td className="ccm-company">{c.company || '—'}</td>
                        <td>{c.segment || '—'}</td>
                        <td><span className={`ccm-pill ${riskColor}`}>{c.risk || '—'}</span></td>
                        <td>{c.contact || '—'}</td>
                        <td className="ccm-email">{c.email || '—'}</td>
                        <td className="ccm-mono">{c.phone || '—'}</td>
                        <td>{location}</td>
                        <td>
                          <div className="ccm-row-actions">
                            <Tooltip label="Edit Consignee">
                              <button
                                type="button"
                                className="ccm-row-btn"
                                aria-label="Edit"
                                onClick={() => { setEditing(c); setAddOpen(true); }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="ccm-pag">
                <span className="ccm-pag-info">
                  Showing <b>{(page - 1) * ROWS_PER_PAGE + 1}</b>–<b>{Math.min(page * ROWS_PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b>
                </span>
                <div className="ccm-pag-btns">
                  <button
                    type="button"
                    className="ccm-pag-btn"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Previous page"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  {Array.from({ length: totalPages }, (_, n) => n + 1).map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`ccm-pag-btn ${n === page ? 'is-active' : ''}`}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ccm-pag-btn"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    aria-label="Next page"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Add/Edit Consignee — pre-locked to this customer.
          existingMirrorCount is the source of truth for the "max 1
          same-as-customer per customer" guard because we just
          refreshed the consignee list here — no stale-data race
          window like the /customers withCount can have. */}
      <AddConsigneeModal
        open={addOpen}
        consignee={editing}
        preselectedCustomerId={customer.id}
        existingMirrorCount={rows.filter(r => r.same_as_customer).length}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSaved={() => fetchRows()}
      />

    </>,
    document.body,
  );
}

/* ─── Scoped CSS ─── */
/* Purple palette throughout — this popup is opened from the Customer
 * list (which is purple-themed) and represents the customer's
 * relationship with its consignees, so it owns the customer's
 * palette, not the consignee module's emerald. */
const SCOPED_CSS = `
.ccm-overlay {
  position: fixed; inset: 0;
  background: rgba(46, 16, 101, .50);
  backdrop-filter: blur(6px);
  /* Sits below AddConsigneeModal (z-index 1095) so the consignee
   * form launched from inside this popup stacks above it. */
  z-index: 1090;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
}
.ccm-card {
  width: min(1280px, 100%);
  max-height: calc(100vh - 48px);
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(46, 16, 101, .30);
}
.ccm-header {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #7c3aed 100%);
  color: #fff;
  overflow: hidden;
}
/* Subtle radial highlights — same flavour as the AddCustomerModal
   header so the two popups feel like one design family. */
.ccm-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 15% 50%, rgba(167,139,250,0.28) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 50%, rgba(139,92,246,0.18) 0%, transparent 55%);
}
.ccm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1 1 auto; position: relative; z-index: 1; }
.ccm-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); color: #fff;
  border: 1.5px solid rgba(255,255,255,.30);
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
}
.ccm-header-text { min-width: 0; }
.ccm-title { font-size: 17px; font-weight: 800; letter-spacing: -.2px; line-height: 1.2; }
.ccm-sub   { font-size: 12px; color: rgba(255,255,255,.80); margin-top: 3px; max-width: 520px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccm-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; position: relative; z-index: 1; }
/* Stacked chip: small label on top, then a single row with the
   customer code, company name and country. Cleaner than the previous
   single-line layout where the long company name was crowding the
   close button. */
.ccm-link-chip {
  display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px;
  padding: 7px 12px;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.28);
  border-radius: 12px;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  color: #fff;
}
.ccm-link-chip-lbl  { font-weight: 700; letter-spacing: .08em; font-size: 9.5px; opacity: .80; text-transform: uppercase; }
.ccm-link-chip-row  { display: inline-flex; align-items: center; gap: 6px; }
.ccm-link-chip-code { font-family: ui-monospace, 'JetBrains Mono', monospace; font-weight: 800; background: rgba(255,255,255,.20); padding: 2px 8px; border-radius: 6px; font-size: 11px; }
.ccm-link-chip-name { font-weight: 700; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; }
.ccm-link-chip-country { padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,.20); font-weight: 600; font-size: 11px; }
.ccm-close {
  width: 34px; height: 34px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.12); color: #fff;
  border: 1.5px solid rgba(255,255,255,.30);
  cursor: pointer; transition: all .25s;
}
.ccm-close:hover { background: rgba(255,255,255,.28); transform: rotate(90deg); }

.ccm-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  background: #faf5ff;
  border-bottom: 1px solid #e9d5ff;
}
.ccm-search {
  flex: 1; max-width: 380px; position: relative;
  display: flex; align-items: center;
}
.ccm-search svg { position: absolute; left: 12px; color: #9ca3af; }
.ccm-search input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid #d1d5db; border-radius: 10px;
  font-size: 13px; background: #fff;
}
.ccm-search input:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
.ccm-toolbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.ccm-count {
  font-size: 12.5px; color: #6d28d9; font-weight: 700;
  padding: 6px 12px;
  background: #f5f3ff; border: 1px solid rgba(167,139,250,.40);
  border-radius: 999px;
}
.ccm-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
  color: #fff;
  border: none; border-radius: 10px;
  font-weight: 700; font-size: 13px;
  cursor: pointer; transition: all .15s ease;
  box-shadow: 0 4px 10px rgba(124,58,237,.30);
}
.ccm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(124,58,237,.40); }

.ccm-body { flex: 1; overflow: auto; padding: 0; background: #fafafd; }
.ccm-table-wrap { overflow-x: auto; padding: 12px 18px 18px; }
.ccm-table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  font-size: 12.5px; color: #1f2937;
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(109,40,217,.06);
}
.ccm-table thead tr {
  background: linear-gradient(180deg, #faf7ff 0%, #f5efff 100%);
}
.ccm-table thead th {
  padding: 12px 14px;
  text-align: left;
  font-weight: 800; font-size: 10px; letter-spacing: .08em;
  color: #5b21b6; text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 1px solid #ede9fe;
}
.ccm-table tbody td {
  padding: 13px 14px;
  border-bottom: 1px solid #f5f3ff;
  vertical-align: middle;
  white-space: nowrap;
  color: #3b0764;
}
.ccm-table tbody tr:last-child td { border-bottom: none; }
.ccm-table tbody tr:hover td { background: #faf7ff; }
.ccm-empty td {
  text-align: center;
  padding: 48px 16px !important;
  color: #6b7280; font-size: 13px;
  white-space: normal;
  background: #fff;
}
.ccm-empty td strong { color: #6d28d9; }
.ccm-empty-state { display: inline-flex; align-items: center; gap: 10px; color: #6d28d9; font-weight: 600; }
.ccm-empty-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2.5px solid rgba(124,58,237,0.22);
  border-top-color: #7c3aed;
  animation: ccm-spin .8s linear infinite;
}
@keyframes ccm-spin { to { transform: rotate(360deg); } }
.ccm-id-chip {
  display: inline-block; padding: 3px 10px; border-radius: 6px;
  background: #ecfdf5; color: #047857;
  border: 1px solid rgba(16,185,129,.30);
  font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
}
.ccm-cust-chip {
  display: inline-block; padding: 3px 10px; border-radius: 6px;
  background: #ede9fe; color: #6d28d9;
  border: 1px solid rgba(167,139,250,.40);
  font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
}
.ccm-company { font-weight: 700; color: #111827; }
.ccm-email   { color: #2563eb; }
.ccm-mono    { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11.5px; }
.ccm-pill {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700;
}
.ccm-pill-low  { background: #ecfdf5; color: #047857; }
.ccm-pill-med  { background: #fffbeb; color: #b45309; }
.ccm-pill-high { background: #fef2f2; color: #b91c1c; }

.ccm-row-actions { display: inline-flex; gap: 6px; }
.ccm-row-btn {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #6b7280;
  border: 1px solid #e5e7eb;
  cursor: pointer; transition: all .15s ease;
}
.ccm-row-btn:hover { background: #f5f3ff; border-color: #7c3aed; color: #6d28d9; }
.ccm-row-btn-del:hover { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }

/* Dark mode */
[data-bs-theme="dark"] .ccm-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .ccm-card { background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%); border: 1px solid rgba(167,139,250,0.20); }
[data-bs-theme="dark"] .ccm-body { background: #0c1322; }
[data-bs-theme="dark"] .ccm-toolbar { background: #11182a; border-bottom-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .ccm-search input { background: #131c33; border-color: rgba(167,139,250,.40); color: #ede9fe; }
[data-bs-theme="dark"] .ccm-search input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .ccm-search svg { color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-count { background: rgba(124,58,237,.20); border-color: rgba(167,139,250,.35); color: #ddd6fe; }
[data-bs-theme="dark"] .ccm-table { background: #1a2236; border-color: rgba(167,139,250,0.22); box-shadow: 0 4px 18px rgba(0,0,0,0.45); }
[data-bs-theme="dark"] .ccm-table thead tr { background: linear-gradient(180deg, rgba(124,58,237,.28) 0%, rgba(124,58,237,.16) 100%); }
[data-bs-theme="dark"] .ccm-table thead th { color: #ddd6fe; border-bottom-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .ccm-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.12); }
[data-bs-theme="dark"] .ccm-table tbody tr:hover td { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .ccm-empty td { color: #94a3b8; background: #1a2236; }
[data-bs-theme="dark"] .ccm-empty td strong { color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-empty-state { color: #c4b5fd; }

/* Pagination footer — sits under the table inside .ccm-body. Matches
 * the customers-list pagination aesthetic: pill info chip on the left,
 * uniform 32×32 buttons on the right with the active page filled. */
.ccm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px 14px;
  gap: 10px; flex-wrap: wrap;
}
.ccm-pag-info {
  font-size: 12px; color: #6d28d9; font-weight: 600;
  padding: 5px 12px;
  background: #f5f3ff; border: 1px solid rgba(167,139,250,.30);
  border-radius: 999px;
}
.ccm-pag-info b { color: #4c1d95; font-weight: 800; }
.ccm-pag-btns { display: inline-flex; align-items: center; gap: 4px; }
.ccm-pag-btn {
  height: 32px; min-width: 32px; padding: 0;
  border-radius: 8px;
  border: 1px solid #e0d9f7;
  background: #fff;
  color: #6d28d9;
  font-size: 12.5px; font-weight: 700;
  font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .22s ease;
}
.ccm-pag-btn:hover:not(:disabled):not(.is-active) {
  background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6;
}
.ccm-pag-btn.is-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: #7c3aed; color: #fff;
  box-shadow: 0 2px 6px rgba(109,40,217,.30);
  cursor: default;
}
.ccm-pag-btn:disabled { opacity: .4; cursor: not-allowed; }

[data-bs-theme="dark"] .ccm-pag-info {
  background: rgba(124,58,237,.20);
  border-color: rgba(167,139,250,.35);
  color: #ddd6fe;
}
[data-bs-theme="dark"] .ccm-pag-info b { color: #ede9fe; }
[data-bs-theme="dark"] .ccm-pag-btn {
  background: #131c33;
  border-color: rgba(167,139,250,.30);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .ccm-pag-btn:hover:not(:disabled):not(.is-active) {
  background: rgba(124,58,237,.20);
  border-color: rgba(167,139,250,.50);
  color: #ede9fe;
}
[data-bs-theme="dark"] .ccm-pag-btn.is-active {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  border-color: #7c3aed; color: #fff;
  box-shadow: 0 2px 8px rgba(124,58,237,.45);
}
[data-bs-theme="dark"] .ccm-empty-spinner { border-color: rgba(167,139,250,0.30); border-top-color: #a78bfa; }
[data-bs-theme="dark"] .ccm-id-chip { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .ccm-cust-chip { background: rgba(167,139,250,.20); color: #c4b5fd; border-color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .ccm-company { color: #ffffff; }
[data-bs-theme="dark"] .ccm-email { color: #93c5fd; }
[data-bs-theme="dark"] .ccm-pill-low  { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-pill-med  { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .ccm-pill-high { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .ccm-row-btn { background: rgba(255,255,255,0.04); border-color: rgba(167,139,250,.25); color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-row-btn:hover { background: rgba(124,58,237,.22); border-color: #a78bfa; color: #fff; }
[data-bs-theme="dark"] .ccm-row-btn-del:hover { background: rgba(239,68,68,.20); border-color: #fca5a5; color: #fca5a5; }

/* ============================================================
 *  RESPONSIVE — tablet & mobile
 *  The popup is a wide 12-column table by default. On smaller
 *  viewports it eats the side padding and lets the table scroll
 *  horizontally (rather than forcing a card stack), so the user
 *  can still see all columns at a glance — just scroll.
 * ============================================================ */
@media (max-width: 1024px) {
  .ccm-overlay { padding: 12px; }
  .ccm-card { max-height: calc(100vh - 24px); }
  .ccm-link-chip-name { max-width: 140px; }
}
@media (max-width: 640px) {
  .ccm-overlay { padding: 0; align-items: stretch; }
  .ccm-card {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
    width: 100vw;
  }
  /* Header: stack chip + close below the title block */
  .ccm-header { flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 16px; }
  .ccm-header-left { align-items: flex-start; }
  .ccm-title { font-size: 16px; }
  .ccm-sub   { font-size: 11.5px; }
  .ccm-header-right { width: 100%; flex-wrap: wrap; gap: 8px; }
  .ccm-link-chip { flex: 1 1 auto; min-width: 0; flex-wrap: wrap; }
  .ccm-link-chip-name { max-width: 100%; }
  .ccm-close { position: absolute; top: 12px; right: 12px; }
  /* Toolbar: search above, controls below */
  .ccm-toolbar { flex-direction: column; align-items: stretch; gap: 10px; padding: 12px; }
  .ccm-search { max-width: 100%; }
  .ccm-toolbar-right { width: 100%; justify-content: space-between; }
  .ccm-add-btn { flex: 0 0 auto; padding: 8px 14px; font-size: 12.5px; }
  /* Table scrolls horizontally — keep all 12 cols visible just slide
     left/right with thumb on mobile. */
  .ccm-table { font-size: 11.5px; }
  .ccm-table thead th, .ccm-table tbody td { padding: 10px 8px; }
}
`;
