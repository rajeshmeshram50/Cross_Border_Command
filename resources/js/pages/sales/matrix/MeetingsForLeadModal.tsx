import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Meetings for this lead — toolbar pill drawer.
 *
 * Read-only list view filtered to the current opp_id. Adding a meeting
 * requires the venue/link/time fields that the existing Sales To-Do
 * page already collects, so the "+ New Meeting" button deep-links to
 * `/sales/todo?tab=meetings&opp=OPP-####` instead of embedding the full
 * form here. Status toggles fire the existing PATCH endpoint inline.
 * ───────────────────────────────────────────────────────────────────────── */

/* Server status values are the exact constants on SalesMeeting (capitalised
 * strings with spaces). Keep them as-is so PATCH /status doesn't 422. */
type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';

type Meeting = {
  id:         number;
  meeting_code: string | null;
  type:       'virtual' | 'physical';
  opp_id:     string | null;
  customer:   string;
  email:      string | null;
  contact:    string | null;
  platform:   string | null;
  date:       string;
  start_time: string;
  end_time:   string;
  link:       string | null;
  venue:      string | null;
  agenda:     string;
  status:     MeetingStatus;
};

const STATUS_META: Record<MeetingStatus, { label: string; pill: string }> = {
  'In Progress': { label: 'In Progress', pill: 'mfl-pill-sch'  },
  'Done':        { label: 'Done',        pill: 'mfl-pill-done' },
  'Postponed':   { label: 'Postponed',   pill: 'mfl-pill-sch'  },
  'Cancelled':   { label: 'Cancelled',   pill: 'mfl-pill-cncl' },
};

type Props = {
  open:    boolean;
  oppId:   string | undefined;
  onClose: () => void;
  /** Forwarded to the page navigator so + New Meeting can deep-link out. */
  onAddNew?: () => void;
};

export default function MeetingsForLeadModal({ open, oppId, onClose, onAddNew }: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    if (!oppId) return;
    setLoading(true);
    api.get<Meeting[]>('/sales/meetings', { params: { scope: 'mine', search: oppId } })
      .then(({ data }) => setRows((data ?? []).filter(m => m.opp_id === oppId)))
      .catch(() => toast.error('Load failed', 'Could not load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, oppId]);

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

  return createPortal((
    <div className="mfl-backdrop" onClick={onClose}>
      <style>{CSS}</style>
      <div className="mfl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mfl-head">
          <div className="mfl-head-left">
            <div className="mfl-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <div className="mfl-head-title">Meetings</div>
              <div className="mfl-head-sub">Opp ID: {oppId ?? '—'} · {rows.length} {rows.length === 1 ? 'meeting' : 'meetings'}</div>
            </div>
          </div>
          <div className="mfl-head-actions">
            {onAddNew && (
              <button className="mfl-add-btn" onClick={onAddNew}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Meeting
              </button>
            )}
            <button className="mfl-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mfl-body">
          {loading && <div className="mfl-status">Loading meetings…</div>}
          {!loading && rows.length === 0 && (
            <div className="mfl-status">
              No meetings for this opportunity yet — click <strong>+ New Meeting</strong> to schedule one.
            </div>
          )}
          {rows.map(m => (
            <div key={m.id} className={`mfl-row mfl-row-${m.status.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="mfl-row-main">
                <div className="mfl-row-head">
                  <span className="mfl-row-code">{m.meeting_code ?? `MTG-${m.id}`}</span>
                  <span className={`mfl-type mfl-type-${m.type}`}>{m.type === 'virtual' ? '🔗 Virtual' : '📍 Physical'}</span>
                  <span className={`mfl-pill ${STATUS_META[m.status]?.pill ?? 'mfl-pill-sch'}`}>
                    {STATUS_META[m.status]?.label ?? m.status}
                  </span>
                </div>
                <div className="mfl-row-title">{m.customer}</div>
                <div className="mfl-row-meta">
                  <span>📅 {new Date(m.date).toLocaleDateString('en-GB')}</span>
                  <span>· {m.start_time}–{m.end_time}</span>
                  {m.platform && <span>· {m.platform}</span>}
                  {m.type === 'physical' && m.venue && <span>· {m.venue}</span>}
                  {m.type === 'virtual'  && m.link  && (
                    <a className="mfl-row-link" href={m.link} target="_blank" rel="noreferrer">Join</a>
                  )}
                </div>
                <div className="mfl-row-agenda">{m.agenda}</div>
              </div>
              <div className="mfl-row-actions">
                {(m.status === 'In Progress' || m.status === 'Postponed') && (
                  <>
                    <button className="mfl-row-btn" onClick={() => void setStatus(m, 'Done')}>Done</button>
                    <button className="mfl-row-btn mfl-row-btn-x" onClick={() => void setStatus(m, 'Cancelled')}>Cancel</button>
                  </>
                )}
                {(m.status === 'Done' || m.status === 'Cancelled') && (
                  <button className="mfl-row-btn" onClick={() => void setStatus(m, 'In Progress')}>Reopen</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}

const CSS = `
.mfl-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.mfl-modal {
  width: min(660px, 100%); max-height: 88vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.mfl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; color: #fff;
  background: linear-gradient(135deg, #0ea5e9 0%, #1e40af 100%);
}
.mfl-head-left { display: flex; align-items: center; gap: 12px; }
.mfl-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.mfl-head-title { font-size: 15px; font-weight: 700; }
.mfl-head-sub   { font-size: 11px; opacity: .85; margin-top: 3px; }
.mfl-head-actions { display: flex; gap: 8px; align-items: center; }
.mfl-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 13px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.18); color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.mfl-add-btn:hover { background: rgba(255,255,255,.30); }
.mfl-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.mfl-close:hover { background: rgba(255,255,255,.32); }

.mfl-body { flex: 1; overflow-y: auto; padding: 14px 18px; background: #f0f9ff; display: flex; flex-direction: column; gap: 8px; }
.mfl-status { text-align: center; padding: 26px 12px; color: #0c4a6e; font-style: italic; font-size: 12px; }

.mfl-row {
  display: flex; gap: 12px; align-items: flex-start;
  background: #fff; border: 1.5px solid #bae6fd; border-radius: 10px;
  padding: 11px 14px;
}
.mfl-row-main  { flex: 1; min-width: 0; }
.mfl-row-head  { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
.mfl-row-code  {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #0c4a6e; font-weight: 700;
  background: #e0f2fe; padding: 1px 8px; border-radius: 5px;
}
.mfl-type {
  font-size: 10.5px; padding: 2px 9px; border-radius: 999px;
  font-weight: 700;
}
.mfl-type-virtual  { background: #e0e7ff; color: #4338ca; }
.mfl-type-physical { background: #dcfce7; color: #166534; }
.mfl-pill { font-size: 10px; padding: 2px 9px; border-radius: 999px; font-weight: 700; }
.mfl-pill-sch  { background: #fef3c7; color: #b45309; }
.mfl-pill-done { background: #dcfce7; color: #166534; }
.mfl-pill-cncl { background: #fee2e2; color: #b91c1c; }
.mfl-row-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.mfl-row-meta {
  display: flex; flex-wrap: wrap; gap: 6px;
  font-size: 11px; color: #475569; margin-top: 3px;
}
.mfl-row-link { color: #1e40af; font-weight: 600; text-decoration: none; }
.mfl-row-link:hover { text-decoration: underline; }
.mfl-row-agenda { font-size: 11.5px; color: #334155; margin-top: 5px; line-height: 1.45; }
.mfl-row-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.mfl-row-btn { padding: 5px 12px; border: 1.5px solid #bae6fd; background: #fff; color: #0c4a6e; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; }
.mfl-row-btn:hover { background: #e0f2fe; }
.mfl-row-btn-x { color: #b91c1c; border-color: #fecaca; }
.mfl-row-btn-x:hover { background: #fee2e2; }

/* Dark mode */
[data-bs-theme="dark"] .mfl-modal { background: #0f172a; }
[data-bs-theme="dark"] .mfl-body  { background: #0b1226; }
[data-bs-theme="dark"] .mfl-row   { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .mfl-row-title { color: #f1f5f9; }
[data-bs-theme="dark"] .mfl-row-meta  { color: #cbd5e1; }
[data-bs-theme="dark"] .mfl-row-agenda { color: #94a3b8; }
[data-bs-theme="dark"] .mfl-row-btn { background: #0f172a; border-color: #334155; color: #67e8f9; }

@media (max-width: 520px) {
  .mfl-row { flex-direction: column; }
  .mfl-row-actions { flex-direction: row; justify-content: flex-end; width: 100%; }
}
`;
