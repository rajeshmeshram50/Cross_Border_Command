import { Menu, Moon, Sun, Bell, Maximize2, Minimize2, Settings, User as UserIcon, LogOut, ChevronDown, Check, Users, BookOpen, Palette } from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import GlobalSearch from '../components/GlobalSearch';
import Avatar from '../components/ui/Avatar';
import BranchSwitcher from '../components/BranchSwitcher';
import ThemeCustomizer from '../components/ThemeCustomizer';
import NotificationsDrawer, { useUnreadNotifications } from '../components/NotificationsDrawer';

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
          onOpenCustomizer={() => setCustomizerOpen(true)}
        />
      )}

      <ThemeCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} />
    </header>
  );
}

/* ───────────────────────────────────────────
   Notifications — the bell, with the shared drawer behind it. The panel, the
   list and the rows live in components/NotificationsDrawer so this header and
   the live IdimsHeader open exactly the same thing.
   ─────────────────────────────────────────── */
function NotificationsDropdown({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { count, refresh } = useUnreadNotifications();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        className={`relative w-8 h-8 rounded-md border flex items-center justify-center transition-all cursor-pointer ${open ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5'}`}
      >
        <Bell size={14} />
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-[1.5px] border-surface"
            title={`${count} unread`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <NotificationsDrawer open={open} onClose={() => setOpen(false)} onCountChange={refresh} />
    </div>
  );
}

/* ───────────────────────────────────────────
   User Dropdown (Velzon pattern)
   ─────────────────────────────────────────── */
function UserDropdown({ open, setOpen, onNavigate, onOpenCustomizer }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onNavigate: (id: string) => void;
  /* The customizer's open state lives on Topbar (it owns <ThemeCustomizer>),
     so the menu item asks the parent to open it rather than keeping a second
     copy of that state down here. */
  onOpenCustomizer: () => void;
}) {
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
            {/* Same items, same order as the horizontal header's profile menu
                (velzon/Layouts/IdimsHeader.tsx). The two layouts render
                different components, so this list had drifted — My Team,
                Documentation Guide and Theme Customizer existed on horizontal
                only, and switching layout silently took them away. */}
            <DropdownItem icon={<UserIcon size={14} />} label="Profile" onClick={() => { setOpen(false); onNavigate('profile'); }} />
            <DropdownItem icon={<Users size={14} />} label="My Team" onClick={() => { setOpen(false); onNavigate('my-team'); }} />
            {user.user_type === 'client_admin' && (
              <DropdownItem icon={<Check size={14} />} label="My Plan" onClick={() => { setOpen(false); onNavigate('my-plan'); }} />
            )}
            <DropdownItem icon={<Settings size={14} />} label="Settings" onClick={() => { setOpen(false); onNavigate('settings'); }} />
            <DropdownItem icon={<BookOpen size={14} />} label="Documentation Guide" onClick={() => { setOpen(false); onNavigate('documentation'); }} />
            <DropdownItem icon={<Palette size={14} />} label="Theme Customizer" onClick={() => { setOpen(false); onOpenCustomizer(); }} />
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
