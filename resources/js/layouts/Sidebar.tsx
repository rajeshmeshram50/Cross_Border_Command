import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { MENU_ITEMS } from '../constants';
import Avatar from '../components/ui/Avatar';
import Logo from '../components/Logo';
import { LogOut, Maximize2, Minimize2, Moon, Sun, Bell, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
}

interface Props {
  current: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ current, onNavigate, collapsed, onToggle }: Props) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { theme, toggle: themeToggle } = useTheme();
  const [, setFsState] = useState(false);
  useEffect(() => {
    const h = () => setFsState(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  if (!user) return null;

  const isSuperAdmin = user.user_type === 'super_admin';
  const perms = user.permissions || {};
  const defaultSlugs = ['dashboard', 'profile', 'my-plan'];
  const isClient = user.user_type === 'client_admin' || user.user_type === 'branch_user';
  const planExpiredOrMissing = isClient && user.plan && (!user.plan.has_plan || user.plan.expired);

  const items = MENU_ITEMS.filter(m => {
    if (!m.roles.includes(user.user_type)) return false;
    if (m.section) return true;
    if (isSuperAdmin) return true;
    if (defaultSlugs.includes(m.id)) return true;
    // If plan expired/missing, only show defaults
    if (planExpiredOrMissing) return false;
    return !!perms[m.id]?.can_view;
  }).filter((m, i, arr) => {
    if (!m.section) return true;
    const next = arr[i + 1];
    return next && !next.section;
  });

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-[230px]'} bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 flex flex-col flex-shrink-0 transition-all duration-300 z-50 h-full overflow-hidden`}>
      <div className="px-4 py-3 border-b border-white/[.06] flex items-center justify-between">
        <Logo variant={collapsed ? 'sidebarCollapsed' : 'sidebar'} />
        {onToggle && (
          <button onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all cursor-pointer flex-shrink-0">
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
        {items.map((m, i) => {
          if (m.section) {
            return !collapsed ? (
              <div key={`s-${i}`} className="px-2.5 pt-4 pb-1 text-[9px] font-bold tracking-[.08em] uppercase text-white/[.18]">
                {m.section}
              </div>
            ) : <div key={`s-${i}`} className="h-4" />;
          }
          const Icon = getIcon(m.icon);
          const active = current === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onNavigate(m.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150 whitespace-nowrap ${
                active
                  ? 'bg-gradient-to-r from-primary/100 to-primary/80 text-white font-semibold shadow-md shadow-primary/30 border-l-2 border-white/50 pl-2'
                  : 'text-sidebar-text hover:bg-white/[.06] hover:text-slate-300 hover:translate-x-0.5'
              }`}
            >
              <Icon size={14} className={`flex-shrink-0 ${active ? 'opacity-100' : 'opacity-50'}`} />
              {!collapsed && <span>{m.label}</span>}
              {!collapsed && m.badge && (
                <span className="ml-auto bg-red-500 text-white text-[9.5px] font-bold px-1.5 py-0.5 rounded-full leading-none">{m.badge}</span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => { toast.info('Logged Out', 'You have been signed out'); logout(); }}
          className="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium text-red-400 hover:bg-red-500/10 transition-colors mt-4 cursor-pointer"
        >
          <LogOut size={14} className="opacity-70" />
          {!collapsed && <span>Logout</span>}
        </button>
      </nav>

      <div className="p-3 border-t border-white/[.05] space-y-2">
        {/* Controls Row */}
        <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'gap-1.5 px-1'}`}>
          <button onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }}
            title="Fullscreen"
            className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-sidebar-text hover:text-white hover:bg-white/10 transition-all cursor-pointer">
            {document.fullscreenElement ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={themeToggle}
            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-sidebar-text hover:text-white hover:bg-white/10 transition-all cursor-pointer">
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
          <button title="Notifications"
            className="relative w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-sidebar-text hover:text-white hover:bg-white/10 transition-all cursor-pointer">
            <Bell size={13} />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
          </button>
        </div>

        {/* Profile Row */}
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[.06] cursor-pointer transition-colors" onClick={() => onNavigate('profile')}>
          <Avatar initials={user.initials} size="sm" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-slate-200 truncate">{user.name}</div>
              <div className="text-[10px] text-sidebar-text">{user.user_type.replace('_', ' ')}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
