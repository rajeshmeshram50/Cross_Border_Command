import { useAuth } from '../contexts/AuthContext';
import { MENU_ITEMS } from '../constants';
import Avatar from '../components/ui/Avatar';
import Logo from '../components/Logo';
import { LogOut } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
}

interface Props {
  current: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
}

export default function Sidebar({ current, onNavigate, collapsed }: Props) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const isSuperAdmin = user.user_type === 'super_admin';
  const perms = user.permissions || {};
  const defaultSlugs = ['dashboard', 'profile'];

  const items = MENU_ITEMS.filter(m => {
    if (!m.roles.includes(user.user_type)) return false;
    if (m.section) return true; // section headers filtered later
    if (isSuperAdmin) return true;
    if (defaultSlugs.includes(m.id)) return true;
    // Check permission
    return !!perms[m.id]?.can_view;
  }).filter((m, i, arr) => {
    // Remove section headers with no items after them
    if (!m.section) return true;
    const next = arr[i + 1];
    return next && !next.section;
  });

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-[230px]'} bg-sidebar flex flex-col flex-shrink-0 transition-all duration-300 z-50 h-full overflow-hidden`}>
      {/* Logo — compact for sidebar */}
      <div className="px-4 py-3 border-b border-white/[.06]">
        <Logo variant={collapsed ? 'sidebarCollapsed' : 'sidebar'} />
      </div>

      {/* Menu */}
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
                  ? 'bg-gradient-to-r from-primary/85 to-primary/50 text-white font-semibold shadow-md shadow-primary/30 border-l-2 border-white/50 pl-2'
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

        {/* Logout */}
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium text-red-400 hover:bg-red-500/10 transition-colors mt-4 cursor-pointer"
        >
          <LogOut size={14} className="opacity-70" />
          {!collapsed && <span>Logout</span>}
        </button>
      </nav>

      {/* User Footer */}
      <div className="p-3 border-t border-white/[.05]">
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
