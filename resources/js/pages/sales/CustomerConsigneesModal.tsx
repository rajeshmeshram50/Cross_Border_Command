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
  /* Header title — defaults to "Consignees". The Sales Matrix opens
   * this same popup with "Manage Consignees" from its toolbar button. */
  title?: string;
}

const ROWS_PER_PAGE = 5;

export default function CustomerConsigneesModal({ open, customer, onClose, title = 'Consignees' }: Props) {
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

  // Scroll lock — lock BOTH <html> and <body> so the page behind can't scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

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
                <div className="ccm-title">{title}</div>
                <div className="ccm-sub">Manage consignee identity, shipment delivery ownership, compliance readiness &amp; customer-linked destination mapping</div>
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
                    <th>SAME AS CUSTOMER</th>
                    <th>CONTACT PERSON</th>
                    <th>EMAIL</th>
                    <th>CONTACT NO</th>
                    <th>LOCATION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="ccm-empty"><td colSpan={11}>
                      <div className="ccm-empty-state">
                        <span className="ccm-empty-spinner" />
                        <span>Loading consignees…</span>
                      </div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr className="ccm-empty">
                      <td colSpan={11}>
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
                        <td><span className="ccm-srno">{(page - 1) * ROWS_PER_PAGE + i + 1}</span></td>
                        <td><span className="ccm-id-chip">{c.id}</span></td>
                        <td className="ccm-company">{c.company || '—'}</td>
                        <td>{c.segment ? <span className="ccm-seg">{c.segment}</span> : '—'}</td>
                        <td><span className={`ccm-pill ${riskColor}`}>{c.risk || '—'}</span></td>
                        <td><span className={`ccm-sac ${c.same_as_customer ? 'is-yes' : 'is-no'}`}>{c.same_as_customer ? 'Yes' : 'No'}</span></td>
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
  background: linear-gradient(135deg, #064e3b 0%, #047857 50%, #059669 100%);
  color: #fff;
  overflow: hidden;
}
/* Subtle radial highlights — same flavour as the AddCustomerModal
   header so the two popups feel like one design family. */
.ccm-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 15% 50%, rgba(52,211,153,0.28) 0%, transparent 55%),
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
/* Horizontal pill rail (Figma): "CONSIGNEES FOR" label + each value as its
   own translucent capsule pill, inside a soft rounded container. */
.ccm-link-chip {
  display: inline-flex; flex-direction: row; align-items: center; gap: 10px;
  padding: 6px 10px 6px 14px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: 999px;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  color: #fff;
}
.ccm-link-chip-lbl  { font-weight: 700; letter-spacing: .08em; font-size: 9.5px; opacity: .80; text-transform: uppercase; white-space: nowrap; }
.ccm-link-chip-row  { display: inline-flex; align-items: center; gap: 7px; }
.ccm-link-chip-code,
.ccm-link-chip-name,
.ccm-link-chip-country {
  display: inline-flex; align-items: center;
  padding: 3px 11px; border-radius: 999px;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.35);
  font-weight: 700; font-size: 11px; white-space: nowrap;
}
.ccm-link-chip-code { font-family: ui-monospace, 'JetBrains Mono', monospace; font-weight: 800; }
.ccm-link-chip-name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.ccm-link-chip-country { font-weight: 600; }
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
  background: #f0fdf9;
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
.ccm-search input:focus { outline: none; border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,.15); }
.ccm-toolbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.ccm-count {
  font-size: 12.5px; color: #047857; font-weight: 700;
  padding: 6px 12px;
  background: #f5f3ff; border: 1px solid rgba(52,211,153,.40);
  border-radius: 999px;
}
.ccm-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #059669 0%, #065f46 100%);
  color: #fff;
  border: none; border-radius: 10px;
  font-weight: 700; font-size: 13px;
  cursor: pointer; transition: all .15s ease;
  box-shadow: 0 4px 10px rgba(5,150,105,.30);
}
.ccm-add-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(5,150,105,.40); }

.ccm-body { flex: 1; overflow: auto; padding: 0; background: #fafafd; }
.ccm-table-wrap { overflow-x: auto; padding: 12px 18px 18px; }
.ccm-table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  font-size: 12.5px; color: #1f2937;
  background: #fff;
  border: 1px solid #d1fae5;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(4,120,87,.06);
}
.ccm-table thead tr {
  background: linear-gradient(110deg, #059669 0%, #047857 55%, #065f46 100%);
}
.ccm-table thead th {
  padding: 11px 14px;
  text-align: left;
  font-weight: 700; font-size: 10px; letter-spacing: .08em;
  color: #ffffff; text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 0;
}
.ccm-table tbody tr { background: #ffffff; }
.ccm-table tbody tr:nth-child(even) { background: #f6fefb; }
.ccm-table tbody td {
  padding: 13px 14px;
  border-bottom: 1px solid #dcf5ec;
  vertical-align: middle;
  white-space: nowrap;
  color: #064e3b;
  background: transparent;
}
.ccm-table tbody tr:last-child td { border-bottom: none; }
.ccm-table tbody tr:hover { background: #ecfdf5; }
/* SR No — purple rounded-square badge. */
.ccm-srno {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #059669, #065f46);
  color: #fff; font-weight: 800; font-size: 11px;
  box-shadow: 0 2px 6px rgba(4,120,87,0.30);
}
/* Segment — soft lavender pill with a dot. */
.ccm-seg {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; color: #065f46;
  background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 20px;
  padding: 3px 10px; white-space: nowrap;
}
.ccm-seg::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.ccm-empty td {
  text-align: center;
  padding: 48px 16px !important;
  color: #6b7280; font-size: 13px;
  white-space: normal;
  background: #fff;
}
.ccm-empty td strong { color: #047857; }
.ccm-empty-state { display: inline-flex; align-items: center; gap: 10px; color: #047857; font-weight: 600; }
.ccm-empty-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2.5px solid rgba(5,150,105,0.22);
  border-top-color: #059669;
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
  background: #d1fae5; color: #047857;
  border: 1px solid rgba(52,211,153,.40);
  font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
}
.ccm-company { font-weight: 700; color: #111827; }
.ccm-email   { color: #2563eb; }
.ccm-mono    { font-family: ui-monospace, 'JetBrains Mono', monospace; font-size: 11.5px; }
.ccm-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; border: 1px solid transparent;
}
.ccm-pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
/* Same-as-Customer Yes/No pill. */
.ccm-sac { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.ccm-sac.is-yes { background: rgba(16,185,129,.14); color: #059669; }
.ccm-sac.is-no  { background: rgba(100,116,139,.12); color: #64748b; }
.ccm-pill-low  { background: #ecfdf5; color: #047857; border-color: #6ee7b7; }
.ccm-pill-med  { background: #fffbeb; color: #b45309; border-color: #fed7aa; }
.ccm-pill-high { background: #fef2f2; color: #b91c1c; border-color: #fca5a5; }

.ccm-row-actions { display: inline-flex; gap: 6px; }
/* Edit action — green/teal to match the consignee table theme. */
.ccm-row-btn {
  width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ecfdf5; color: #0d9488;
  border: 1.5px solid #5eead4;
  cursor: pointer; transition: all .18s cubic-bezier(.22,1,.36,1);
}
.ccm-row-btn:hover {
  background: linear-gradient(135deg, #0d9488, #065f46); color: #fff; border-color: transparent;
  box-shadow: 0 4px 14px rgba(13,148,136,.4); transform: translateY(-2px) scale(1.08);
}
.ccm-row-btn-del:hover { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }

/* Dark mode */
[data-bs-theme="dark"] .ccm-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .ccm-card { background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%); border: 1px solid rgba(52,211,153,0.20); }
[data-bs-theme="dark"] .ccm-body { background: #0c1322; }
[data-bs-theme="dark"] .ccm-toolbar { background: #11182a; border-bottom-color: rgba(52,211,153,.20); }
[data-bs-theme="dark"] .ccm-search input { background: #131c33; border-color: rgba(52,211,153,.40); color: #d1fae5; }
[data-bs-theme="dark"] .ccm-search input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .ccm-search svg { color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-count { background: rgba(5,150,105,.20); border-color: rgba(52,211,153,.35); color: #a7f3d0; }
[data-bs-theme="dark"] .ccm-table { background: #1a2236; border-color: rgba(52,211,153,0.22); box-shadow: 0 4px 18px rgba(0,0,0,0.45); }
[data-bs-theme="dark"] .ccm-table thead tr { background: linear-gradient(110deg, #065f46 0%, #064e3b 55%, #053d2e 100%); }
[data-bs-theme="dark"] .ccm-table thead th { color: #ffffff; border-bottom: 0; }
[data-bs-theme="dark"] .ccm-table tbody tr { background: transparent; }
[data-bs-theme="dark"] .ccm-table tbody tr:nth-child(even) { background: rgba(52,211,153,.05); }
[data-bs-theme="dark"] .ccm-table tbody td { color: #d1fae5; border-bottom-color: rgba(52,211,153,.12); }
[data-bs-theme="dark"] .ccm-table tbody tr:hover { background: rgba(52,211,153,.10); }
[data-bs-theme="dark"] .ccm-seg { background: rgba(5,150,105,.16); color: #6ee7b7; border-color: rgba(52,211,153,.30); }
[data-bs-theme="dark"] .ccm-empty td { color: #94a3b8; background: #1a2236; }
[data-bs-theme="dark"] .ccm-empty td strong { color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-empty-state { color: #6ee7b7; }

/* Pagination footer — sits under the table inside .ccm-body. Matches
 * the customers-list pagination aesthetic: pill info chip on the left,
 * uniform 32×32 buttons on the right with the active page filled. */
.ccm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px 14px;
  gap: 10px; flex-wrap: wrap;
}
.ccm-pag-info {
  font-size: 12px; color: #047857; font-weight: 600;
  padding: 5px 12px;
  background: #f5f3ff; border: 1px solid rgba(52,211,153,.30);
  border-radius: 999px;
}
.ccm-pag-info b { color: #064e3b; font-weight: 800; }
.ccm-pag-btns { display: inline-flex; align-items: center; gap: 4px; }
.ccm-pag-btn {
  height: 32px; min-width: 32px; padding: 0;
  border-radius: 8px;
  border: 1px solid #e0d9f7;
  background: #fff;
  color: #047857;
  font-size: 12.5px; font-weight: 700;
  font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .22s ease;
}
.ccm-pag-btn:hover:not(:disabled):not(.is-active) {
  background: #f5f3ff; border-color: #6ee7b7; color: #065f46;
}
.ccm-pag-btn.is-active {
  background: linear-gradient(135deg, #059669, #047857);
  border-color: #059669; color: #fff;
  box-shadow: 0 2px 6px rgba(4,120,87,.30);
  cursor: default;
}
.ccm-pag-btn:disabled { opacity: .4; cursor: not-allowed; }

[data-bs-theme="dark"] .ccm-pag-info {
  background: rgba(5,150,105,.20);
  border-color: rgba(52,211,153,.35);
  color: #a7f3d0;
}
[data-bs-theme="dark"] .ccm-pag-info b { color: #d1fae5; }
[data-bs-theme="dark"] .ccm-pag-btn {
  background: #131c33;
  border-color: rgba(52,211,153,.30);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .ccm-pag-btn:hover:not(:disabled):not(.is-active) {
  background: rgba(5,150,105,.20);
  border-color: rgba(52,211,153,.50);
  color: #d1fae5;
}
[data-bs-theme="dark"] .ccm-pag-btn.is-active {
  background: linear-gradient(135deg, #047857, #064e3b);
  border-color: #059669; color: #fff;
  box-shadow: 0 2px 8px rgba(5,150,105,.45);
}
[data-bs-theme="dark"] .ccm-empty-spinner { border-color: rgba(52,211,153,0.30); border-top-color: #34d399; }
[data-bs-theme="dark"] .ccm-id-chip { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .ccm-cust-chip { background: rgba(52,211,153,.20); color: #6ee7b7; border-color: rgba(52,211,153,.40); }
[data-bs-theme="dark"] .ccm-company { color: #ffffff; }
[data-bs-theme="dark"] .ccm-email { color: #93c5fd; }
[data-bs-theme="dark"] .ccm-pill-low  { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-pill-med  { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .ccm-pill-high { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .ccm-row-btn { background: rgba(255,255,255,0.04); border-color: rgba(52,211,153,.25); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-row-btn:hover { background: rgba(5,150,105,.22); border-color: #34d399; color: #fff; }
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
