import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import RemindersForLeadModal from './RemindersForLeadModal';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import Tooltip from '../../../../components/ui/Tooltip';

/* ─────────────────────────────────────────────────────────────────────────
 * Reminders Directory — list of every reminder against the current
 * opportunity, with a header "+ Add Reminder" button that opens the
 * focused Add form. Styled identically to ProductDirectoryModal.
 * ───────────────────────────────────────────────────────────────────────── */

type ReminderStatus = 'In Progress' | 'Done';

type Reminder = {
  id:        number;
  subject:   string;
  set_date:  string;
  tat?:      string | null;
  remark?:   string | null;
  opp_id?:   string | null;
  opp_date?: string | null;
  status:    ReminderStatus;
};

type Props = {
  open:    boolean;
  oppId:   string | undefined;
  oppDate?: string;
  onClose: () => void;
};

export default function RemindersListModal({ open, oppId, oppDate, onClose }: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Reminder | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    if (!oppId) return;
    setLoading(true);
    api.get<Reminder[]>('/sales/reminders', { params: { scope: 'mine', search: oppId } })
      .then(({ data }) => setRows((data ?? []).filter(r => r.opp_id === oppId)))
      .catch(() => toast.error('Load failed', 'Could not load reminders'))
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

  const toggleStatus = async (r: Reminder) => {
    const next: ReminderStatus = r.status === 'Done' ? 'In Progress' : 'Done';
    try {
      await api.patch(`/sales/reminders/${r.id}/status`, { status: next });
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, status: next } : x));
      toast.success('Status updated', `Marked ${next}`);
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not change status');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const r = pendingDelete;
    setDeleting(true);
    try {
      await api.delete(`/sales/reminders/${r.id}`);
      setRows(prev => prev.filter(x => x.id !== r.id));
      toast.success('Deleted', 'Reminder removed');
      setPendingDelete(null);
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete reminder');
    } finally {
      setDeleting(false);
    }
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (s: string) => {
    if (!s) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-');
      // DD-Mon-YYYY (e.g. 04-Jul-2026)
      return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y}`;
    }
    return s;
  };

  return createPortal((
    <>
      <div className="rlm-backdrop">
        <style>{RLM_CSS}</style>
        <div className="rlm-modal">
          <div className="rlm-head">
            <div className="rlm-head-left">
              <div className="rlm-head-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </div>
              <div>
                <div className="rlm-head-title">Reminders</div>
                <div className="rlm-head-sub">
                  {oppId ? `${oppId} · ` : ''}{rows.length} {rows.length === 1 ? 'reminder' : 'reminders'}
                </div>
              </div>
            </div>
            <div className="rlm-head-actions">
              <button className="rlm-add-btn" onClick={() => setAddOpen(true)} disabled={!oppId}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Reminder
              </button>
              <button className="rlm-close" onClick={onClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="rlm-body">
            <div className="rlm-table-wrap">
              <table className="rlm-table">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>SR NO</th>
                    <th>SUBJECT</th>
                    <th style={{ width: 120 }}>SET DATE</th>
                    <th style={{ width: 100 }}>TAT</th>
                    <th style={{ width: 130 }}>STATUS</th>
                    <th style={{ width: 130 }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="rlm-sk-row">
                      <td><span className="rlm-sk rlm-sk-num" /></td>
                      <td>
                        <span className="rlm-sk rlm-sk-line" style={{ width: '68%' }} />
                        <span className="rlm-sk rlm-sk-line rlm-sk-sub" style={{ width: '42%' }} />
                      </td>
                      <td><span className="rlm-sk rlm-sk-line" style={{ width: 74 }} /></td>
                      <td><span className="rlm-sk rlm-sk-pill" /></td>
                      <td><span className="rlm-sk rlm-sk-pill" /></td>
                      <td><span className="rlm-sk rlm-sk-btn" /></td>
                    </tr>
                  ))}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="rlm-status">
                        No reminders yet — click <strong>+ Add Reminder</strong> to add the first.
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => {
                    const done = r.status === 'Done';
                    return (
                      <tr key={r.id}>
                        <td><span className="rlm-num">{i + 1}</span></td>
                        <td>
                          <div className="rlm-subj-cell">
                            <Tooltip label={r.subject}><span className="rlm-subj">{r.subject}</span></Tooltip>
                            {r.remark && <Tooltip label={r.remark}><span className="rlm-remark">{r.remark}</span></Tooltip>}
                          </div>
                        </td>
                        <td className="rlm-date">{fmtDate(r.set_date)}</td>
                        <td>{r.tat ? <span className="rlm-tat-pill">{r.tat}</span> : <span className="rlm-muted">—</span>}</td>
                        <td>
                          <span className={`rlm-status-pill ${done ? 'rlm-status-done' : 'rlm-status-prog'}`}>
                            <span className="rlm-status-dot" /> {r.status}
                          </span>
                        </td>
                        <td>
                          <div className="rlm-act-cell">
                            <button
                              className={`rlm-row-btn ${done ? 'rlm-row-btn-undo' : 'rlm-row-btn-done'}`}
                              onClick={() => void toggleStatus(r)}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                                {done
                                  ? <path d="M3 12a9 9 0 0 1 17.66-2.5M3 7v5h5" />
                                  : <polyline points="20 6 9 17 4 12" />}
                              </svg>
                              {done ? 'Reopen' : 'Done'}
                            </button>
                            <Tooltip label="Delete"><button className="rlm-row-btn rlm-row-btn-del" onClick={() => setPendingDelete(r)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1.5 14a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button></Tooltip>
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

      {/* Child Add Reminder form — refreshes the list on close. */}
      <RemindersForLeadModal
        open={addOpen}
        oppId={oppId}
        oppDate={oppDate}
        onClose={() => { setAddOpen(false); refresh(); }}
      />

      {/* Themed delete confirmation */}
      <DeleteConfirmModal
        open={!!pendingDelete}
        title="Delete Reminder"
        itemName={pendingDelete?.subject ?? ''}
        subMessage="This reminder will be permanently removed from this opportunity."
        loading={deleting}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  ), document.body);
}

const RLM_CSS = `
.rlm-backdrop {
  position: fixed; inset: 0; z-index: 1070;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.rlm-modal {
  width: min(960px, 100%); max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .28);
  overflow: hidden; display: flex; flex-direction: column;
}
.rlm-head {
  /* Lighter 4-stop violet sweep matching the prototype + the rest of
     the matrix modals (Product Directory family). */
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-shrink: 0;
  padding: 16px 22px; color: #fff;
  position: relative; overflow: hidden;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
}
.rlm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rlm-head-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255, 255, 255, .18);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.rlm-head-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
.rlm-head-sub   { font-size: 11.5px; opacity: .85; margin-top: 3px; }
.rlm-head-actions { display: flex; gap: 8px; align-items: center; }
.rlm-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px; border: none;
  background: rgba(255, 255, 255, .20); color: #fff;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s;
  font-family: inherit;
}
.rlm-add-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .32); }
.rlm-add-btn:disabled { opacity: .55; cursor: not-allowed; }
.rlm-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.rlm-close:hover { background: rgba(255, 255, 255, .32); }

.rlm-body { flex: 1; overflow-y: auto; padding: 14px 20px; background: #faf5ff; }
.rlm-table-wrap {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: auto;
}
.rlm-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 720px; }
/* Table header — gradient lives on the tr so a single 90° sweep
   spans the whole row instead of each th rendering its own copy
   (which caused visible stitch lines between columns). */
.rlm-table thead tr {
  background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
}
.rlm-table thead th {
  background: transparent;
  color: #fff;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  text-align: left; padding: 11px 12px;
  position: sticky; top: 0; z-index: 2;
  white-space: nowrap;
}
.rlm-table tbody tr { border-bottom: 1px solid #f1f5f9; }
.rlm-table tbody tr:last-child { border-bottom: none; }
.rlm-table tbody tr:hover { background: #faf5ff; }
.rlm-table tbody td { padding: 10px 12px; color: #1e293b; vertical-align: middle; }

.rlm-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border: 1px solid #c4b5fd;
  color: #5b21b6;
  font-size: 9.5px; font-weight: 800;
}
/* Cap the subject column so a long reason can't stretch the table / cause
   horizontal overflow — truncate with an ellipsis and show the full text on
   hover (title attr) instead. */
.rlm-subj-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 360px; }
.rlm-subj { font-size: 12.5px; font-weight: 700; color: #1e1b4b; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Skeleton shimmer shown in the table while reminders fetch (no "Loading…" text). */
.rlm-sk {
  display: inline-block; border-radius: 6px;
  background: linear-gradient(90deg, #ece9f6 25%, #f6f4fc 50%, #ece9f6 75%);
  background-size: 400px 100%;
  animation: rlm-shimmer 1.15s ease-in-out infinite;
}
@keyframes rlm-shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
.rlm-sk-line { display: block; height: 12px; }
.rlm-sk-sub  { height: 9px; margin-top: 6px; opacity: .7; }
.rlm-sk-num  { width: 22px; height: 22px; border-radius: 7px; }
.rlm-sk-pill { width: 74px; height: 20px; border-radius: 999px; }
.rlm-sk-btn  { width: 62px; height: 28px; border-radius: 7px; }
[data-bs-theme="dark"] .rlm-sk {
  background: linear-gradient(90deg, #241c48 25%, #2e2557 50%, #241c48 75%);
  background-size: 400px 100%;
}
.rlm-remark {
  font-size: 10.5px; color: #64748b;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 360px;
}
.rlm-date {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; color: #5b21b6; font-weight: 600;
}
.rlm-tat-pill {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  background: #ede9fe; color: #6d28d9;
  font-size: 10.5px; font-weight: 700;
}
.rlm-muted { color: #94a3b8; font-style: italic; }

.rlm-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700;
  border: 1px solid;
}
.rlm-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 4px currentColor; }
.rlm-status-prog { background: #fffbeb; border-color: #fde68a; color: #b45309; }
.rlm-status-done { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }

.rlm-act-cell { display: flex; gap: 6px; }
.rlm-row-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border: 1.5px solid #cbd5e1;
  background: #fff; color: #475569;
  border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: all .12s;
  font-family: inherit;
}
.rlm-row-btn:hover:not(:disabled) { background: #f1f5f9; }
/* Fixed width so the toggle button reads the same whether it says "Done" or
   "Reopen" — the action buttons never shift position when the status flips. */
.rlm-row-btn-done, .rlm-row-btn-undo { min-width: 96px; justify-content: center; }
.rlm-row-btn-done { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.rlm-row-btn-done:hover { background: #dcfce7; border-color: #86efac; }
.rlm-row-btn-undo { color: #b45309; border-color: #fde68a; background: #fffbeb; }
.rlm-row-btn-undo:hover { background: #fef3c7; border-color: #fcd34d; }
.rlm-row-btn-del  { color: #dc2626; border-color: #fecaca; padding: 5px 8px; }
.rlm-row-btn-del:hover { background: #fee2e2; }

.rlm-status {
  text-align: center; padding: 24px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* ── Dark mode ── */
[data-bs-theme="dark"] .rlm-modal { background: #14102a; }
[data-bs-theme="dark"] .rlm-body  { background: #1a1538; }
[data-bs-theme="dark"] .rlm-table-wrap {
  background: #14102a;
  border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .rlm-table thead th {
  background: linear-gradient(135deg, #20184a, #2a2150);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .rlm-table tbody tr { border-color: rgba(167, 139, 250, .18); }
[data-bs-theme="dark"] .rlm-table tbody tr:hover { background: rgba(124, 58, 237, .14); }
[data-bs-theme="dark"] .rlm-table tbody td { color: #ede9fe; }
[data-bs-theme="dark"] .rlm-subj           { color: #ede9fe; }
[data-bs-theme="dark"] .rlm-remark         { color: #a78bfa; }
[data-bs-theme="dark"] .rlm-date           { color: #c4b5fd; }
[data-bs-theme="dark"] .rlm-num {
  background: linear-gradient(135deg, #2a2150, #3b2f6e);
  border-color: rgba(167, 139, 250, .35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .rlm-tat-pill {
  background: rgba(167, 139, 250, .18);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .rlm-status-prog {
  background: rgba(245, 158, 11, .16); border-color: rgba(252, 211, 77, .40); color: #fbbf24;
}
[data-bs-theme="dark"] .rlm-status-done {
  background: rgba(34, 197, 94, .16); border-color: rgba(74, 222, 128, .40); color: #86efac;
}
[data-bs-theme="dark"] .rlm-status      { color: rgba(196, 181, 253, .55); }
[data-bs-theme="dark"] .rlm-row-btn-done {
  background: rgba(34, 197, 94, .16); border-color: rgba(74, 222, 128, .40); color: #86efac;
}
[data-bs-theme="dark"] .rlm-row-btn-done:hover { background: rgba(34, 197, 94, .25); }
[data-bs-theme="dark"] .rlm-row-btn-undo {
  background: rgba(245, 158, 11, .16); border-color: rgba(252, 211, 77, .40); color: #fbbf24;
}
[data-bs-theme="dark"] .rlm-row-btn-undo:hover { background: rgba(245, 158, 11, .25); }
[data-bs-theme="dark"] .rlm-row-btn-del {
  background: rgba(239, 68, 68, .14); border-color: rgba(252, 165, 165, .40); color: #fca5a5;
}
[data-bs-theme="dark"] .rlm-row-btn-del:hover { background: rgba(239, 68, 68, .25); border-color: #fca5a5; }

@media (max-width: 640px) {
  .rlm-backdrop { padding: 0; }
  .rlm-modal { border-radius: 0; max-height: 100vh; }
}
`;
