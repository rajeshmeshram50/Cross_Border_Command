/* The notifications drawer, and the unread count that feeds a bell badge.
 *
 * One panel, shared by every header: the bell opens a drawer down the right
 * edge listing what arrived, and a row opens the thing itself — a PO waiting
 * for a senior's approval opens its review page. It used to be a 360px
 * dropdown on a header that is no longer the live one, so the bell people
 * actually click went straight to /inbox and the list was never seen.
 *
 * Reads /notifications (list), /notifications/unread-count (badge),
 * /notifications/{id}/read and /notifications/read-all. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Inbox, X } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { canAccessPath } from '../utils/routeAccess';

/** One in-app notification — the toArray() payload of the notification class. */
export interface InAppNotification {
  id: string;
  type: string;
  data: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

/** Unread count for a bell badge, refreshed every 60s and on tab focus. */
export function useUnreadNotifications(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (document.hidden) return;
    api.get('/notifications/unread-count')
      .then((r) => setCount(r.data?.data?.count ?? 0))
      .catch(() => { /* a badge is not worth a toast */ });
  }, []);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);
  return { count, refresh };
}

export default function NotificationsDrawer({ open, onClose, onCountChange }: {
  open: boolean;
  onClose: () => void;
  /** The header's badge follows what happens in here (read / read all). */
  onCountChange?: (count: number) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  // Fresh every time it opens — cheap, and the list is the point of opening it.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/notifications', { params: { limit: 30 } })
      .then((r) => setItems(r.data?.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Escape closes it, like every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const unread = items.filter((i) => !i.read_at).length;
  const visible = tab === 'unread' ? items.filter((i) => !i.read_at) : items;

  const openItem = async (n: InAppNotification) => {
    onClose();
    if (!n.read_at) {
      try {
        await api.post(`/notifications/${n.id}/read`);
        setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it)));
        onCountChange?.(Math.max(0, unread - 1));
      } catch { /* opening it matters more than the read flag */ }
    }
    const url = n.data?.action_url ?? n.data?.url;
    if (!url) return;
    // Strip scheme + host so the SPA router takes the path.
    const path = String(url).replace(/^https?:\/\/[^/]+/, '') || '/';
    /* A notification names a page its recipient may not be allowed to open.
       A reporting manager is asked to decide their team's leave, but the
       approvals page under HRMS needs an hr.leave_approvals grant they often
       do not hold — following their own "Action required" notification landed
       them on Access Denied. The Inbox carries the same approvals, scoped to
       whoever is looking, and every role can open it. */
    navigate(canAccessPath(path.split('?')[0], user) ? path : '/inbox');
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      const now = new Date().toISOString();
      setItems((prev) => prev.map((it) => ({ ...it, read_at: it.read_at ?? now })));
      onCountChange?.(0);
    } catch { /* silent */ }
  };

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1200] bg-black/20" onMouseDown={onClose} />
      <aside
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-[1201] w-[420px] max-w-[92vw] bg-surface border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="Notifications"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h5 className="text-[19px] font-bold text-text leading-tight">Notifications</h5>
          <div className="flex items-center gap-3">
            {/* The unread filter as a switch, where it is looked for. */}
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Only show unread">
              <span className="text-[11.5px] text-muted">Only show unread</span>
              {/* An explicit off colour: the border token is nearly the panel's
                  own white, which left the switch looking like an empty outline. */}
              <span
                onClick={() => setTab(tab === 'unread' ? 'all' : 'unread')}
                className={`relative w-[34px] h-[18px] rounded-full transition-colors ${tab === 'unread' ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${tab === 'unread' ? 'left-[18px]' : 'left-[2px]'}`} />
              </span>
            </label>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="w-7 h-7 rounded-md text-muted hover:text-text hover:bg-surface-2 flex items-center justify-center cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-5 px-5 border-b border-border">
          {([['all', `All (${items.length})`], ['unread', `Unread (${unread})`]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`py-2 text-[12.5px] font-semibold transition-colors cursor-pointer border-b-2 ${tab === key ? 'text-primary border-primary' : 'text-muted border-transparent hover:text-text'}`}
            >
              {label}
            </button>
          ))}
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="ml-auto text-[11.5px] text-primary hover:underline cursor-pointer">
              Mark all read
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-[12px]">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Inbox size={22} className="text-primary" />
              </div>
              <h6 className="text-[13px] font-semibold text-text">{tab === 'unread' ? 'Nothing unread' : 'No new notifications'}</h6>
              <p className="text-[11px] text-muted mt-1">You&rsquo;re all caught up.</p>
            </div>
          ) : (
            groupByDay(visible).map(([label, group]) => (
              <div key={label}>
                <div className="px-5 pt-4 pb-1 text-[11.5px] font-bold text-muted uppercase tracking-wide">{label}</div>
                {group.map((n) => <NotificationRow key={n.id} item={n} onClick={() => openItem(n)} />)}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => { onClose(); navigate('/inbox'); }}
            className="text-[12px] font-semibold text-primary hover:underline cursor-pointer"
          >
            Show all in Inbox
          </button>
        </div>
      </aside>
    </>,
    document.body,
  );
}

/** Today / Yesterday / a date, the way a notification list reads. */
function groupByDay(items: InAppNotification[]): [string, InAppNotification[]][] {
  const out = new Map<string, InAppNotification[]>();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const n of items) {
    const d = new Date(n.created_at);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    const label = isNaN(d.getTime()) ? 'Earlier'
      : diff <= 0 ? 'Today'
        : diff === 1 ? 'Yesterday'
          : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    out.set(label, [...(out.get(label) ?? []), n]);
  }
  return [...out.entries()];
}

/** One row: what happened and when, then the thing itself, then its reference. */
/* Where a notification came from. The notification class is the reliable
   marker — each module writes its own rows — so the list can say "P2P · PO
   approval" or "HR · Leave" instead of leaving every line looking alike. */
function sourceOf(type: string): { module: string; what: string; icon: string; bg: string; fg: string } {
  switch ((type || '').split('\\').pop()) {
    case 'PoGstApproval':
      return { module: 'P2P', what: 'PO approval', icon: 'ri-file-shield-2-line', bg: '#cffafe', fg: '#0e7490' };
    case 'PoPaymentRequest':
      return { module: 'P2P', what: 'Payment request', icon: 'ri-wallet-3-line', bg: '#d1fae5', fg: '#047857' };
    case 'LeaveRequestNotification':
      return { module: 'HR', what: 'Leave request', icon: 'ri-calendar-check-line', bg: '#ede9fe', fg: '#5a3fd1' };
    case 'HrSignatureReminder':
      return { module: 'HR', what: 'Signature', icon: 'ri-quill-pen-line', bg: '#fef3c7', fg: '#b45309' };
    default:
      return { module: 'Update', what: '', icon: 'ri-notification-3-line', bg: '#eef2f6', fg: '#374151' };
  }
}

function NotificationRow({ item, onClick }: { item: InAppNotification; onClick: () => void }) {
  const kind = item.data?.kind ?? '';
  const isUnread = !item.read_at;
  const src = sourceOf(item.type);
  /* What happened to it, separate from where it came from: one says P2P · PO
     approval, the other says whether it is waiting on you or already decided. */
  const state = (() => {
    switch (kind) {
      case 'submitted_to_approver': return { label: 'Waiting on you', cls: 'text-amber-700 dark:text-amber-400' };
      case 'cc_submitted': return { label: 'For information', cls: 'text-muted' };
      case 'approved': return { label: 'Approved', cls: 'text-emerald-700 dark:text-emerald-400' };
      case 'rejected': return { label: 'Rejected', cls: 'text-red-700 dark:text-red-400' };
      case 'cancelled': return { label: 'Cancelled', cls: 'text-muted' };
      case 'hr_signature_reminder': return { label: 'Signature needed', cls: 'text-amber-700 dark:text-amber-400' };
      default: return { label: '', cls: 'text-muted' };
    }
  })();
  const meta = { icon: src.icon, bg: src.bg, fg: src.fg, label: state.label || src.what };

  const summary = item.data?.subject
    ?? item.data?.message
    ?? (item.data?.template ? `${item.data.action ?? 'Sign'}: ${item.data.template}` : 'New notification');

  const sentence = (() => {
    if (kind === 'hr_signature_reminder') {
      return [item.data?.code, item.data?.sender_name ? `from ${item.data.sender_name}` : null].filter(Boolean).join(' · ');
    }
    const { from_date: from, to_date: to, days } = item.data ?? {};
    if (from && to) {
      const f = new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const t = new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      return `${item.data?.leave_type ?? 'Leave'} · ${f}${f !== t ? ` – ${t}` : ''} · ${days ?? 0} day${days === 1 ? '' : 's'}`;
    }
    return item.data?.message ?? item.data?.leave_type ?? '';
  })();

  const when = (() => {
    const d = new Date(item.created_at);
    if (isNaN(d.getTime())) return '';
    const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  })();

  /* The code the notification is about — "PO/2026-27/007 needs your GST
     approval" — so the row carries its own reference line. */
  const ref = /([A-Z]{2,}\/[0-9-]+\/[0-9]+|[A-Z]{2,}-[0-9]+)/.exec(String(item.data?.subject ?? ''))?.[1] ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-surface-2 transition-colors cursor-pointer"
    >
      <span className="rounded-full flex-shrink-0 flex items-center justify-center" style={{ width: 32, height: 32, background: meta.bg, color: meta.fg }}>
        <i className={meta.icon} style={{ fontSize: 15 }} />
      </span>
      <div className="min-w-0 flex-grow">
        {/* Where it came from, before what it says: a leave request, a PO
            approval and a payment request all read alike otherwise. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ background: src.bg, color: src.fg }}
          >
            {src.module}{src.what ? ` · ${src.what}` : ''}
          </span>
          {state.label && <span className={`text-[10.5px] font-semibold ${state.cls}`}>{state.label}</span>}
          <span className="text-[10.5px] text-muted ml-auto">{when}</span>
        </div>
        <div className="mt-1 text-[12.5px] font-semibold text-primary truncate">{summary}</div>
        <div className="text-[11.5px] text-muted leading-snug mt-0.5">{sentence}</div>
        {ref && <div className="text-[10.5px] text-muted mt-0.5 font-mono truncate">{ref}</div>}
      </div>
      {isUnread && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" title="Unread" />}
    </button>
  );
}
