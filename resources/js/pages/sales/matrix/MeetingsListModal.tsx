import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import MeetingsForLeadModal from './MeetingsForLeadModal';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Meetings Directory — list of every meeting against the current
 * opportunity, with a header "+ Add Meeting" button that opens the
 * focused Add form. Styled identically to ProductDirectoryModal.
 * ───────────────────────────────────────────────────────────────────────── */

type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';
type MeetingType   = 'virtual' | 'physical';

type Meeting = {
  id:           number;
  meeting_code: string | null;
  type:         MeetingType;
  opp_id:       string | null;
  customer:     string;
  email:        string | null;
  contact:      string | null;
  platform:     string | null;
  date:         string;
  start_time:   string;
  end_time:     string;
  link:         string | null;
  venue:        string | null;
  agenda:       string;
  status:       MeetingStatus;
};

type Props = {
  open:    boolean;
  oppId:   string | undefined;
  oppDate?: string;
  defaultCustomer?: string;
  defaultContact?:  string;
  defaultEmail?:    string;
  onClose: () => void;
};

export default function MeetingsListModal({
  open, oppId, oppDate, defaultCustomer, defaultContact, defaultEmail, onClose,
}: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    if (!oppId) return;
    setLoading(true);
    api.get<Meeting[]>('/sales/meetings', { params: { scope: 'mine', search: oppId } })
      .then(({ data }) => setRows((data ?? []).filter(m => m.opp_id === oppId)))
      .catch(() => toast.error('Load failed', 'Could not load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) { setRows([]); setAddOpen(false); return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, oppId]);

  // Body scroll lock — keep the page behind the modal from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const setStatus = async (m: Meeting, next: MeetingStatus) => {
    try {
      await api.patch(`/sales/meetings/${m.id}/status`, { status: next });
      setRows(prev => prev.map(x => x.id === m.id ? { ...x, status: next } : x));
      toast.success('Status updated', `Meeting marked ${next}`);
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not change status');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const m = pendingDelete;
    setDeleting(true);
    try {
      await api.delete(`/sales/meetings/${m.id}`);
      setRows(prev => prev.filter(x => x.id !== m.id));
      toast.success('Deleted', 'Meeting removed');
      setPendingDelete(null);
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete meeting');
    } finally {
      setDeleting(false);
    }
  };

  const fmtDate = (s: string) => {
    if (!s) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    return s;
  };
  const fmtTime = (s: string) => (s ?? '').slice(0, 5);

  const statusPillClass = (st: MeetingStatus) =>
    st === 'Done'        ? 'mlm-status-done'
  : st === 'In Progress' ? 'mlm-status-prog'
  : st === 'Postponed'   ? 'mlm-status-pp'
                         : 'mlm-status-cncl';

  return createPortal((
    <>
      <div className="mlm-backdrop">
        <style>{MLM_CSS}</style>
        <div className="mlm-modal">
          <div className="mlm-head">
            <div className="mlm-head-left">
              <div className="mlm-head-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div>
                <div className="mlm-head-title">Meetings</div>
                <div className="mlm-head-sub">
                  {oppId ? `${oppId} · ` : ''}{rows.length} {rows.length === 1 ? 'meeting' : 'meetings'}
                </div>
              </div>
            </div>
            <div className="mlm-head-actions">
              <button className="mlm-add-btn" onClick={() => setAddOpen(true)} disabled={!oppId}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Meeting
              </button>
              <button className="mlm-close" onClick={onClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mlm-body">
            <div className="mlm-table-wrap">
              <table className="mlm-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th style={{ width: 100 }}>TYPE</th>
                    <th>CUSTOMER</th>
                    <th style={{ width: 160 }}>DATE · TIME</th>
                    <th style={{ width: 140 }}>PLATFORM</th>
                    <th style={{ width: 130 }}>STATUS</th>
                    <th style={{ width: 130 }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} className="mlm-status">Loading meetings…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="mlm-status">
                        No meetings yet — click <strong>+ Add Meeting</strong> to add the first.
                      </td>
                    </tr>
                  )}
                  {rows.map((m, i) => (
                    <tr key={m.id}>
                      <td><span className="mlm-num">{i + 1}</span></td>
                      <td>
                        <span className={`mlm-type-pill mlm-type-${m.type}`}>
                          {m.type === 'virtual' ? '💻 Virtual' : '🏢 Physical'}
                        </span>
                      </td>
                      <td>
                        <div className="mlm-cust-cell">
                          <span className="mlm-cust">{m.customer}</span>
                          {m.contact && <span className="mlm-contact">{m.contact}</span>}
                        </div>
                      </td>
                      <td className="mlm-date">
                        <div>{fmtDate(m.date)}</div>
                        <div className="mlm-time">{fmtTime(m.start_time)} – {fmtTime(m.end_time)}</div>
                      </td>
                      <td>{m.platform ? <span className="mlm-plat">{m.platform}</span> : <span className="mlm-muted">—</span>}</td>
                      <td>
                        <span className={`mlm-status-pill ${statusPillClass(m.status)}`}>
                          <span className="mlm-status-dot" /> {m.status}
                        </span>
                      </td>
                      <td>
                        <div className="mlm-act-cell">
                          {m.status !== 'Done' && (
                            <button
                              className="mlm-row-btn mlm-row-btn-done"
                              onClick={() => void setStatus(m, 'Done')}
                              title="Mark Done"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Done
                            </button>
                          )}
                          {/* Delete is disabled once a meeting is marked Done —
                              completed meetings are a record and shouldn't be
                              removed from the row tools (CBC-184). */}
                          <button
                            className="mlm-row-btn mlm-row-btn-del"
                            onClick={() => { if (m.status !== 'Done') setPendingDelete(m); }}
                            disabled={m.status === 'Done'}
                            title={m.status === 'Done' ? 'Completed meetings cannot be deleted' : 'Delete'}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1.5 14a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
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

      {/* Child Add Meeting form — refreshes the list on close. */}
      <MeetingsForLeadModal
        open={addOpen}
        oppId={oppId}
        oppDate={oppDate}
        defaultCustomer={defaultCustomer}
        defaultContact={defaultContact}
        defaultEmail={defaultEmail}
        onClose={() => { setAddOpen(false); refresh(); }}
      />

      {/* Themed delete confirmation */}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Meeting"
        itemName={pendingDelete?.customer ?? ''}
        subMessage="This meeting will be permanently removed from this opportunity."
        loading={deleting}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  ), document.body);
}

const MLM_CSS = `
.mlm-backdrop {
  position: fixed; inset: 0; z-index: 1070;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.mlm-modal {
  width: min(1060px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .28);
  overflow: hidden; display: flex; flex-direction: column;
}
.mlm-head {
  /* Lighter 4-stop violet sweep matching the prototype + the rest of
     the matrix modals (Product Directory family). */
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-shrink: 0;
  padding: 16px 22px; color: #fff;
  position: relative; overflow: hidden;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
}
.mlm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mlm-head-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255, 255, 255, .18);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.mlm-head-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
.mlm-head-sub   { font-size: 11.5px; opacity: .85; margin-top: 3px; }
.mlm-head-actions { display: flex; gap: 8px; align-items: center; }
.mlm-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px; border: none;
  background: rgba(255, 255, 255, .20); color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s;
  font-family: inherit;
}
.mlm-add-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .32); }
.mlm-add-btn:disabled { opacity: .55; cursor: not-allowed; }
.mlm-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.mlm-close:hover { background: rgba(255, 255, 255, .32); }

.mlm-body { flex: 1; overflow-y: auto; padding: 14px 20px; background: #faf5ff; }
.mlm-table-wrap {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: auto;
}
.mlm-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 880px; }
/* Table header — gradient lives on the tr so a single 90° sweep
   spans the whole row instead of each th rendering its own copy
   (which caused visible stitch lines between columns). */
.mlm-table thead tr {
  background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
}
.mlm-table thead th {
  background: transparent;
  color: #fff;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  text-align: left; padding: 11px 12px;
  position: sticky; top: 0; z-index: 2;
  white-space: nowrap;
}
.mlm-table tbody tr { border-bottom: 1px solid #f1f5f9; }
.mlm-table tbody tr:last-child { border-bottom: none; }
.mlm-table tbody tr:hover { background: #faf5ff; }
.mlm-table tbody td { padding: 10px 12px; color: #1e293b; vertical-align: middle; }

.mlm-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border: 1px solid #c4b5fd;
  color: #5b21b6;
  font-size: 9.5px; font-weight: 800;
}
.mlm-type-pill {
  display: inline-block;
  padding: 2px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  border: 1px solid;
  white-space: nowrap;
}
.mlm-type-virtual  { background: #ede9fe; border-color: #c4b5fd; color: #5b21b6; }
.mlm-type-physical { background: #fef3c7; border-color: #fcd34d; color: #92400e; }

.mlm-cust-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mlm-cust    { font-size: 12.5px; font-weight: 700; color: #1e1b4b; line-height: 1.25; }
.mlm-contact {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #64748b;
}
.mlm-date { line-height: 1.3; }
.mlm-date > div:first-child {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; color: #5b21b6; font-weight: 600;
}
.mlm-time {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #64748b; margin-top: 2px;
}
.mlm-plat {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  background: #f5f3ff; color: #6d28d9; font-size: 10.5px; font-weight: 600;
}
.mlm-muted { color: #94a3b8; font-style: italic; }

.mlm-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  border: 1px solid;
}
.mlm-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 4px currentColor; }
.mlm-status-prog { background: #fffbeb; border-color: #fde68a; color: #b45309; }
.mlm-status-done { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
.mlm-status-pp   { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.mlm-status-cncl { background: #fef2f2; border-color: #fecaca; color: #dc2626; }

.mlm-act-cell { display: flex; gap: 6px; }
.mlm-row-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border: 1.5px solid #cbd5e1;
  background: #fff; color: #475569;
  border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: all .12s;
  font-family: inherit;
}
.mlm-row-btn:hover:not(:disabled) { background: #f1f5f9; }
/* Disabled row button (e.g. Delete on a completed meeting) — greyed, no
   pointer, no hover feedback. */
.mlm-row-btn:disabled { opacity: .4; cursor: not-allowed; }
.mlm-row-btn-done { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.mlm-row-btn-done:hover { background: #dcfce7; border-color: #86efac; }
.mlm-row-btn-del  { color: #dc2626; border-color: #fecaca; padding: 5px 8px; }
.mlm-row-btn-del:hover:not(:disabled) { background: #fee2e2; }

.mlm-status {
  text-align: center; padding: 24px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* ── Dark mode ── */
[data-bs-theme="dark"] .mlm-modal { background: #14102a; }
[data-bs-theme="dark"] .mlm-body  { background: #1a1538; }
[data-bs-theme="dark"] .mlm-table-wrap {
  background: #14102a;
  border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .mlm-table thead th {
  background: linear-gradient(135deg, #20184a, #2a2150);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .mlm-table tbody tr { border-color: rgba(167, 139, 250, .18); }
[data-bs-theme="dark"] .mlm-table tbody tr:hover { background: rgba(124, 58, 237, .14); }
[data-bs-theme="dark"] .mlm-table tbody td { color: #ede9fe; }
[data-bs-theme="dark"] .mlm-cust           { color: #ede9fe; }
[data-bs-theme="dark"] .mlm-contact        { color: #a78bfa; }
[data-bs-theme="dark"] .mlm-date > div:first-child { color: #c4b5fd; }
[data-bs-theme="dark"] .mlm-time           { color: #a78bfa; }
[data-bs-theme="dark"] .mlm-num {
  background: linear-gradient(135deg, #2a2150, #3b2f6e);
  border-color: rgba(167, 139, 250, .35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .mlm-plat {
  background: rgba(167, 139, 250, .18); color: #d8b4fe;
}
[data-bs-theme="dark"] .mlm-type-virtual {
  background: rgba(124, 58, 237, .18);
  border-color: rgba(167, 139, 250, .40);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .mlm-type-physical {
  background: rgba(245, 158, 11, .16);
  border-color: rgba(252, 211, 77, .40);
  color: #fbbf24;
}
[data-bs-theme="dark"] .mlm-status-prog { background: rgba(245, 158, 11, .16); border-color: rgba(252, 211, 77, .40); color: #fbbf24; }
[data-bs-theme="dark"] .mlm-status-done { background: rgba(34, 197, 94, .16);  border-color: rgba(74, 222, 128, .40);  color: #86efac; }
[data-bs-theme="dark"] .mlm-status-pp   { background: rgba(59, 130, 246, .16); border-color: rgba(147, 197, 253, .40); color: #93c5fd; }
[data-bs-theme="dark"] .mlm-status-cncl { background: rgba(239, 68, 68, .14);  border-color: rgba(252, 165, 165, .40); color: #fca5a5; }
[data-bs-theme="dark"] .mlm-status      { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .mlm-row-btn-done {
  background: rgba(34, 197, 94, .16); border-color: rgba(74, 222, 128, .40); color: #86efac;
}
[data-bs-theme="dark"] .mlm-row-btn-done:hover { background: rgba(34, 197, 94, .25); }
[data-bs-theme="dark"] .mlm-row-btn-del {
  background: rgba(239, 68, 68, .14); border-color: rgba(252, 165, 165, .40); color: #fca5a5;
}
[data-bs-theme="dark"] .mlm-row-btn-del:hover:not(:disabled) { background: rgba(239, 68, 68, .25); border-color: #fca5a5; }

@media (max-width: 640px) {
  .mlm-backdrop { padding: 0; }
  .mlm-modal { border-radius: 0; max-height: 100vh; }
}
`;
