import { Menu, Moon, Sun, Bell, Maximize2, Minimize2, Settings, User as UserIcon, LogOut, ChevronDown, Check, Inbox } from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import GlobalSearch from '../components/GlobalSearch';
import Avatar from '../components/ui/Avatar';
import BranchSwitcher from '../components/BranchSwitcher';
import ThemeCustomizer from '../components/ThemeCustomizer';
import api from '../api';

// ─────────────────────────────────────────────────────────────────────────────
// In-app notification record — mirrors what /api/notifications returns.
// `data` is the toArray() payload from each notification class; the Leave
// notifications populate kind/employee_name/leave_type/from_date/etc.
// ─────────────────────────────────────────────────────────────────────────────
interface InAppNotification {
  id: string;
  type: string;
  data: {
    kind?: string;
    employee_name?: string;
    leave_type?: string;
    from_date?: string;
    to_date?: string;
    days?: number;
    status?: string;
    comment?: string | null;
    action_url?: string;
    subject?: string;
    [key: string]: any;
  };
  read_at: string | null;
  created_at: string;
}

interface Props {
  page: string;
  onToggleSidebar: () => void;
  onNavigate: (id: string) => void;
}

const labels: Record<string, string> = {
  dashboard: 'Dashboard', clients: 'Clients', 'client-form': 'Add / Edit Client',
  'client-users': 'Client Users', plans: 'Subscription Plans', payments: 'Payments',
  permissions: 'Permissions', branches: 'Branches', 'branch-form': 'Add / Edit Branch',
  employees: 'Employees', settings: 'Settings', profile: 'Profile',
};

function useFullscreen() {
  const [isFs, setIsFs] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);
  return { isFs, toggle };
}

export default function Topbar({ page, onToggleSidebar, onNavigate }: Props) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const fs = useFullscreen();
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  return (
    <header className="h-[50px] bg-surface border-b border-border flex items-center px-4 gap-2 flex-shrink-0 z-40">
      {/* Mobile hamburger */}
      <button onClick={onToggleSidebar} className="lg:hidden w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary transition-colors cursor-pointer">
        <Menu size={16} />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <span className="cursor-pointer hover:text-text transition-colors font-medium" onClick={() => onNavigate('dashboard')}>Home</span>
        <span className="text-border">/</span>
        <span className="text-text font-semibold">{labels[page] || page}</span>
      </div>

      <div className="flex-1" />

      {/* Branch Switcher */}
      <BranchSwitcher />

      {/* Search */}
      <GlobalSearch onNavigate={onNavigate} />

      {/* Fullscreen */}
      <button onClick={fs.toggle} title={fs.isFs ? 'Exit Fullscreen' : 'Fullscreen'}
        className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {fs.isFs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {/* Theme Toggle */}
      <button onClick={toggle} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {/* Theme Customizer */}
      <button onClick={() => setCustomizerOpen(true)} title="Theme Customizer"
        className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        <Settings size={14} />
      </button>

      {/* Notifications (Velzon-style dropdown) */}
      <NotificationsDropdown open={notifOpen} setOpen={setNotifOpen} />

      {/* User dropdown (Velzon-style with name, role, menu) */}
      {user && (
        <UserDropdown
          open={userOpen}
          setOpen={setUserOpen}
          onNavigate={onNavigate}
        />
      )}

      <ThemeCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} />
    </header>
  );
}

/* ───────────────────────────────────────────
   Notifications Dropdown (Velzon pattern)
   ─────────────────────────────────────────── */
function NotificationsDropdown({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Poll the unread count every 60s so the badge stays fresh without
  // the user having to open the dropdown. Cheap query — counts only.
  // Skipped while the tab is in the background to be polite.
  useEffect(() => {
    let alive = true;
    const fetchCount = () => {
      if (document.hidden) return;
      api.get('/notifications/unread-count')
        .then(r => { if (alive) setUnreadCount(r.data?.data?.count ?? 0); })
        .catch(() => { /* silent */ });
    };
    fetchCount();
    const t = window.setInterval(fetchCount, 60_000);
    const onVis = () => { if (!document.hidden) fetchCount(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Hydrate the list whenever the dropdown opens (cheap and always fresh).
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/notifications', { params: { limit: 20 } })
      .then(r => setItems(r.data?.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Outside-click closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  const visibleItems = tab === 'unread' ? items.filter(i => !i.read_at) : items;

  const onItemClick = async (n: InAppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      try {
        await api.post(`/notifications/${n.id}/read`);
        setItems(prev => prev.map(it => it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it));
        setUnreadCount(c => Math.max(0, c - 1));
      } catch { /* keep going — navigation is more important */ }
    }
    const url = n.data?.action_url ?? n.data?.url;
    if (url) {
      // Strip any leading scheme + host so the SPA router handles the path.
      const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
      navigate(path);
    }
  };

  const onMarkAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      const now = new Date().toISOString();
      setItems(prev => prev.map(it => ({ ...it, read_at: it.read_at ?? now })));
      setUnreadCount(0);
    } catch { /* silent */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        className={`relative w-8 h-8 rounded-md border flex items-center justify-center transition-all cursor-pointer ${open ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5'}`}
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-[1.5px] border-surface"
            title={`${unreadCount} unread`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] rounded-xl bg-surface border border-border shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 z-50">
          <div className="bg-primary text-white px-4 py-3 flex items-center justify-between">
            <div>
              <h5 className="text-[13px] font-bold leading-tight">Notifications</h5>
              <p className="text-[10.5px] opacity-80 mt-0.5">
                You have {unreadCount} unread message{unreadCount === 1 ? '' : 's'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[10.5px] underline opacity-90 hover:opacity-100 cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="flex border-b border-border bg-surface-2">
            <button
              onClick={() => setTab('all')}
              className={`flex-1 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${tab === 'all' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-text'}`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setTab('unread')}
              className={`flex-1 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${tab === 'unread' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-text'}`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted text-[12px]">
                Loading…
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Inbox size={22} className="text-primary" />
                </div>
                <h6 className="text-[13px] font-semibold text-text">No new notifications</h6>
                <p className="text-[11px] text-muted mt-1">You're all caught up.</p>
              </div>
            ) : visibleItems.map(n => (
              <NotificationRow key={n.id} item={n} onClick={() => onItemClick(n)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NotificationRow — single dropdown entry. Picks an icon + accent based on
// the notification kind so the user can scan the list at a glance.
// ─────────────────────────────────────────────────────────────────────────────
function NotificationRow({ item, onClick }: { item: InAppNotification; onClick: () => void }) {
  const k = item.data?.kind ?? '';
  const isUnread = !item.read_at;
  const meta = (() => {
    switch (k) {
      case 'submitted_to_approver': return { icon: 'ri-time-line',          bg: '#ede9fe', fg: '#5a3fd1', label: 'Approval needed' };
      case 'cc_submitted':          return { icon: 'ri-mail-line',           bg: '#dbeafe', fg: '#0c63b0', label: 'FYI' };
      case 'approved':              return { icon: 'ri-checkbox-circle-line', bg: '#d1fae5', fg: '#065f46', label: 'Approved' };
      case 'rejected':              return { icon: 'ri-close-circle-line',   bg: '#fee2e2', fg: '#b91c1c', label: 'Rejected' };
      case 'cancelled':             return { icon: 'ri-prohibited-line',     bg: '#f3f4f6', fg: '#374151', label: 'Cancelled' };
      case 'hr_signature_reminder': return { icon: 'ri-quill-pen-line',     bg: '#ede9fe', fg: '#5a3fd1', label: 'Signature' };
      default:                      return { icon: 'ri-notification-3-line', bg: '#eef2f6', fg: '#374151', label: 'Update' };
    }
  })();
  const summary = item.data?.subject
    ?? item.data?.message
    ?? (item.data?.template ? `${item.data.action ?? 'Sign'}: ${item.data.template}` : 'New notification');
  const subline = (() => {
    // Signature reminders carry the doc code + who sent it, not leave dates.
    if (k === 'hr_signature_reminder') {
      const code = item.data?.code;
      const sender = item.data?.sender_name;
      return [code, sender ? `from ${sender}` : null].filter(Boolean).join(' · ');
    }
    const days = item.data?.days;
    const from = item.data?.from_date;
    const to = item.data?.to_date;
    if (from && to) {
      const f = new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const t = new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      return `${item.data?.leave_type ?? 'Leave'} · ${f}${f !== t ? ` – ${t}` : ''} · ${days ?? 0} day${days === 1 ? '' : 's'}`;
    }
    return item.data?.leave_type ?? '';
  })();
  const when = (() => {
    const d = new Date(item.created_at);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-3 border-b border-border text-left hover:bg-surface-2 transition-colors cursor-pointer ${isUnread ? 'bg-primary/5' : ''}`}
    >
      <span
        className="rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ width: 36, height: 36, background: meta.bg, color: meta.fg }}
      >
        <i className={meta.icon} style={{ fontSize: 16 }} />
      </span>
      <div className="min-w-0 flex-grow">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ background: meta.bg, color: meta.fg }}
          >
            {meta.label}
          </span>
          {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
        </div>
        <div className="text-[13px] font-semibold text-text mt-1 truncate">{summary}</div>
        {subline && <div className="text-[11px] text-muted truncate mt-0.5">{subline}</div>}
        <div className="text-[10px] text-muted mt-1">{when}</div>
      </div>
    </button>
  );
}

/* ───────────────────────────────────────────
   User Dropdown (Velzon pattern)
   ─────────────────────────────────────────── */
function UserDropdown({ open, setOpen, onNavigate }: { open: boolean; setOpen: (v: boolean) => void; onNavigate: (id: string) => void }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  if (!user) return null;

  const roleLabel = user.user_type.replace(/_/g, ' ');
  // Super admin's display name often equals the role string ("Super Admin"),
  // so showing both stacks the same text twice. If they match (case-insensitive),
  // show only the name on the chip and reveal the role inside the dropdown.
  const nameMatchesRole = user.name.trim().toLowerCase() === roleLabel.toLowerCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`group flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border transition-all cursor-pointer ${
          open
            ? 'border-transparent shadow-md shadow-primary/20 ring-1 ring-primary/30'
            : 'border-border hover:border-transparent hover:shadow-md hover:shadow-primary/15 hover:-translate-y-px'
        }`}
        style={{
          backgroundImage: open
            ? 'linear-gradient(135deg, rgba(64,81,137,0.10), rgba(10,179,156,0.10))'
            : undefined,
        }}
      >
        {/* Avatar with gradient ring + online dot */}
        <span className="relative inline-flex rounded-full p-[2px]" style={{ backgroundImage: 'linear-gradient(135deg,#405189,#0ab39c)' }}>
          <span className="rounded-full p-[1.5px] bg-surface">
            <Avatar initials={user.initials} size="sm" />
          </span>
          <span className="absolute bottom-[1px] right-[1px] w-2 h-2 rounded-full bg-emerald-500 ring-[1.5px] ring-surface" />
        </span>

        <div className="hidden md:flex flex-col items-start leading-tight max-w-[140px]">
          <span
            className="text-[12px] font-bold truncate w-full"
            style={{
              backgroundImage: 'linear-gradient(135deg,#405189,#0ab39c)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {user.name}
          </span>
          {!nameMatchesRole && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wide truncate w-full text-muted">
              {roleLabel}
            </span>
          )}
        </div>
        <ChevronDown size={12} className={`text-muted transition-transform ${open ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[260px] rounded-xl bg-surface border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 z-50">
          {/* Gradient header with avatar */}
          <div
            className="px-4 py-3.5 text-white relative overflow-hidden"
            style={{ backgroundImage: 'linear-gradient(135deg,#405189 0%,#6691e7 50%,#0ab39c 100%)' }}
          >
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.5), transparent 50%)',
            }} />
            <div className="relative flex items-center gap-2.5">
              <span className="relative inline-flex rounded-full p-[2px] bg-white/30">
                <span className="rounded-full bg-white/90 p-[1px]">
                  <Avatar initials={user.initials} size="sm" />
                </span>
                <span className="absolute bottom-[1px] right-[1px] w-2 h-2 rounded-full bg-emerald-400 ring-[1.5px] ring-white" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold truncate leading-tight text-white">{user.name}</p>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide mt-0.5 leading-tight text-white/85">{roleLabel}</p>
              </div>
            </div>
          </div>

          {/* Menu */}
          <div className="py-1">
            <DropdownItem icon={<UserIcon size={14} />} label="Profile" onClick={() => { setOpen(false); onNavigate('profile'); }} />
            {user.user_type === 'client_admin' && (
              <DropdownItem icon={<Check size={14} />} label="My Plan" onClick={() => { setOpen(false); onNavigate('my-plan'); }} />
            )}
            <DropdownItem icon={<Settings size={14} />} label="Settings" onClick={() => { setOpen(false); onNavigate('settings'); }} />
            <div className="h-px bg-border my-1" />
            <DropdownItem
              icon={<LogOut size={14} />}
              label="Logout"
              danger
              onClick={() => { setOpen(false); toast.info('Logged Out', 'You have been signed out'); logout(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DropdownItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2 text-[12px] font-medium transition-colors cursor-pointer ${danger ? 'text-red-500 hover:bg-red-500/10' : 'text-text hover:bg-primary/5 hover:text-primary'}`}
    >
      <span className="opacity-70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
