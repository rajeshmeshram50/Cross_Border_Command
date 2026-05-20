import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
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
 *   🗑 Delete Consignee  → DeleteConfirmModal then DELETE /consignees/{id}.
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

export default function CustomerConsigneesModal({ open, customer, onClose }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ConsigneeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ConsigneeRow | null>(null);
  const [delTarget, setDelTarget] = useState<ConsigneeRow | null>(null);

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

  const handleDelete = async () => {
    if (!delTarget?.db_id) { setDelTarget(null); return; }
    try {
      await api.delete(`/consignees/${delTarget.db_id}`);
      toast.success('Consignee deleted', delTarget.company);
      setDelTarget(null);
      fetchRows();
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Please try again.');
    }
  };

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
              <div>
                <div className="ccm-title">Consignees</div>
                <div className="ccm-sub">
                  Every consignee linked to this customer — shipment delivery ownership, compliance readiness &amp; destination mapping.
                </div>
              </div>
            </div>
            <div className="ccm-header-right">
              <div className="ccm-link-chip">
                <span className="ccm-link-chip-lbl">CONSIGNEES FOR</span>
                <span className="ccm-link-chip-code">{customer.id}</span>
                <span className="ccm-link-chip-name">{customer.company}</span>
                {customer.country && <span className="ccm-link-chip-country">{customer.country}</span>}
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
                    <th>CUSTOMER ID</th>
                    <th>COMPANY NAME</th>
                    <th>SEGMENT</th>
                    <th>RISK LEVEL</th>
                    <th>CONTACT PERSON</th>
                    <th>EMAIL</th>
                    <th>CONTACT NO</th>
                    <th>COUNTRY</th>
                    <th>STATE</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="ccm-empty"><td colSpan={12}>Loading consignees…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr className="ccm-empty">
                      <td colSpan={12}>
                        {q ? 'No consignees match your search.' : <>No consignees mapped to <strong>{customer.id}</strong> yet. Click <strong>+ Add Consignee</strong> to create the first one.</>}
                      </td>
                    </tr>
                  ) : filtered.map((c, i) => {
                    const riskColor = String(c.risk).toLowerCase() === 'high'
                      ? 'ccm-pill-high'
                      : String(c.risk).toLowerCase() === 'medium'
                        ? 'ccm-pill-med'
                        : 'ccm-pill-low';
                    return (
                      <tr key={c.id}>
                        <td>{i + 1}</td>
                        <td><span className="ccm-id-chip">{c.id}</span></td>
                        <td><span className="ccm-cust-chip">{c.customerId}</span></td>
                        <td className="ccm-company">{c.company || '—'}</td>
                        <td>{c.segment || '—'}</td>
                        <td><span className={`ccm-pill ${riskColor}`}>{c.risk || '—'}</span></td>
                        <td>{c.contact || '—'}</td>
                        <td className="ccm-email">{c.email || '—'}</td>
                        <td className="ccm-mono">{c.phone || '—'}</td>
                        <td>{c.country || '—'}</td>
                        <td>{c.countryDetail || '—'}</td>
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
                            <Tooltip label="Delete Consignee">
                              <button
                                type="button"
                                className="ccm-row-btn ccm-row-btn-del"
                                aria-label="Delete"
                                onClick={() => setDelTarget(c)}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
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
          </div>
        </div>
      </div>

      {/* Embedded Add/Edit Consignee — pre-locked to this customer */}
      <AddConsigneeModal
        open={addOpen}
        consignee={editing}
        preselectedCustomerId={customer.id}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSaved={() => fetchRows()}
      />

      <DeleteConfirmModal
        open={!!delTarget}
        title="Delete Consignee"
        itemName={delTarget?.company}
        subMessage="This will permanently delete the consignee and all linked addresses. The action cannot be undone."
        onClose={() => setDelTarget(null)}
        onConfirm={handleDelete}
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
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
  color: #fff;
}
.ccm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ccm-header-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); color: #fff;
  flex-shrink: 0;
}
.ccm-title { font-size: 18px; font-weight: 800; letter-spacing: .01em; }
.ccm-sub   { font-size: 12.5px; color: rgba(255,255,255,.85); margin-top: 2px; max-width: 640px; line-height: 1.4; }
.ccm-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.ccm-link-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.24);
  border-radius: 999px;
  font-size: 12px; color: #fff;
}
.ccm-link-chip-lbl  { font-weight: 700; letter-spacing: .06em; font-size: 10px; opacity: .8; }
.ccm-link-chip-code { font-family: ui-monospace, 'JetBrains Mono', monospace; font-weight: 700; background: rgba(255,255,255,.22); padding: 2px 8px; border-radius: 6px; }
.ccm-link-chip-name { font-weight: 700; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccm-link-chip-country { padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,.22); font-weight: 600; }
.ccm-close {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); color: #fff; border: none;
  cursor: pointer; transition: background .15s ease;
}
.ccm-close:hover { background: rgba(255,255,255,.30); }

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

.ccm-body { flex: 1; overflow: auto; padding: 0; }
.ccm-table-wrap { overflow-x: auto; }
.ccm-table {
  width: 100%; border-collapse: collapse;
  font-size: 12.5px; color: #1f2937;
}
.ccm-table thead tr {
  background: linear-gradient(180deg, #f5f0ff 0%, #ede9fe 100%);
  border-bottom: 2px solid rgba(167,139,250,.40);
}
.ccm-table thead th {
  padding: 12px;
  text-align: left;
  font-weight: 700; font-size: 11px; letter-spacing: .06em;
  color: #4338ca; text-transform: uppercase;
  white-space: nowrap;
}
.ccm-table tbody td {
  padding: 12px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
  white-space: nowrap;
}
.ccm-table tbody tr:hover { background: #faf7ff; }
.ccm-empty td {
  text-align: center;
  padding: 40px 16px !important;
  color: #6b7280; font-size: 13px;
  white-space: normal;
}
.ccm-empty td strong { color: #6d28d9; }
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
[data-bs-theme="dark"] .ccm-card { background: #1e1b4b; }
[data-bs-theme="dark"] .ccm-toolbar { background: #2e1065; border-bottom-color: rgba(167,139,250,.20); }
[data-bs-theme="dark"] .ccm-search input { background: #1e1b4b; border-color: rgba(167,139,250,.25); color: #ede9fe; }
[data-bs-theme="dark"] .ccm-count { background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-table thead tr { background: linear-gradient(180deg, rgba(124,58,237,.20) 0%, rgba(124,58,237,.10) 100%); border-bottom-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .ccm-table thead th { color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.15); }
[data-bs-theme="dark"] .ccm-table tbody tr:hover { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .ccm-empty td { color: #94a3b8; }
[data-bs-theme="dark"] .ccm-empty td strong { color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-id-chip { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .ccm-cust-chip { background: rgba(167,139,250,.20); color: #c4b5fd; border-color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .ccm-company { color: #ede9fe; }
[data-bs-theme="dark"] .ccm-email { color: #93c5fd; }
[data-bs-theme="dark"] .ccm-pill-low  { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .ccm-pill-med  { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .ccm-pill-high { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .ccm-row-btn { background: #2e1065; border-color: rgba(167,139,250,.25); color: #94a3b8; }
[data-bs-theme="dark"] .ccm-row-btn:hover { background: rgba(124,58,237,.18); border-color: #7c3aed; color: #c4b5fd; }
[data-bs-theme="dark"] .ccm-row-btn-del:hover { background: rgba(239,68,68,.18); border-color: #ef4444; color: #fca5a5; }
`;
