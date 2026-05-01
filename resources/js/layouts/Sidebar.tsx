import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { MENU_ITEMS } from '../constants';
import type { MenuGroup, MenuItem } from '../types';
import Avatar from '../components/ui/Avatar';
import Logo from '../components/Logo';
import { LogOut, Maximize2, Minimize2, Moon, Sun, Bell, ChevronsLeft, ChevronsRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function getIcon(name?: string): LucideIcon {
  if (!name) return Icons.Circle;
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
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const h = () => setFsState(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};
  const defaultSlugs = ['dashboard', 'profile', 'my-plan'];
  // Any non-super tenant user — client_admin, client_user, branch_user, or
  // employee. They all inherit the organization's plan, so when the plan
  // lapses they all lose access in the same way.
  const isTenantUser = user?.user_type === 'client_admin'
    || user?.user_type === 'client_user'
    || user?.user_type === 'branch_user'
    || user?.user_type === 'employee';
  const planExpiredOrMissing = isTenantUser && user?.plan && (!user.plan.has_plan || user.plan.expired);

  const canView = (id: string) => {
    if (!id) return false;
    if (isSuperAdmin) return true;
    if (defaultSlugs.includes(id)) return true;
    if (planExpiredOrMissing) return false;
    return !!perms[id]?.can_view;
  };

  // Filter groups/children by permission; keep only groups with at least one visible child
  const filterGroups = (groups: MenuGroup[] | undefined): MenuGroup[] => {
    if (!groups) return [];
    return groups
      .map(g => ({ ...g, children: g.children.filter(c => canView(c.id)) }))
      .filter(g => g.children.length > 0);
  };

  // Compute visible items, attaching filtered groups for parents
  const items = useMemo(() => {
    if (!user) return [];
    const out: (MenuItem & { _filteredGroups?: MenuGroup[] })[] = [];
    MENU_ITEMS.forEach(m => {
      if (!m.roles.includes(user.user_type)) return;
      if (m.section) { out.push(m); return; }
      if (m.groups) {
        const filteredGroups = filterGroups(m.groups);
        if (filteredGroups.length === 0) return; // hide parent with no visible children
        out.push({ ...m, _filteredGroups: filteredGroups });
        return;
      }
      if (!canView(m.id)) return;
      out.push(m);
    });
    // Drop empty section headers (section with no visible item before next section)
    return out.filter((m, i, arr) => {
      if (!m.section) return true;
      const next = arr[i + 1];
      return next && !next.section;
    });
  }, [user, perms, planExpiredOrMissing]);

  // Auto-open parent containing the current page
  useEffect(() => {
    const parent = items.find(m => m._filteredGroups?.some(g => g.children.some(c => c.id === current)));
    if (parent && !openParents[parent.id]) {
      setOpenParents(prev => ({ ...prev, [parent.id]: true }));
    }
  }, [current, items]);

  if (!user) return null;

  const toggleParent = (id: string) => setOpenParents(p => ({ ...p, [id]: !p[id] }));
  const toggleGroup = (id: string) => setOpenGroups(p => ({ ...p, [id]: !p[id] }));

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
          const hasGroups = (m._filteredGroups?.length || 0) > 0;
          const parentActive = current === m.id || !!m._filteredGroups?.some(g => g.children.some(c => c.id === current));
          const parentOpen = !!openParents[m.id];

          if (hasGroups) {
            // Parent with submenu (e.g. Master)
            return (
              <div key={m.id}>
                <button
                  onClick={() => collapsed ? onNavigate(m._filteredGroups![0].children[0].id) : toggleParent(m.id)}
                  title={collapsed ? m.label : undefined}
                  className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150 whitespace-nowrap ${
                    parentActive
                      ? 'bg-primary/15 text-white font-semibold'
                      : 'text-sidebar-text hover:bg-white/[.06] hover:text-slate-300'
                  }`}
                >
                  <Icon size={14} className={`flex-shrink-0 ${parentActive ? 'opacity-100 text-primary' : 'opacity-50'}`} />
                  {!collapsed && <span className="flex-1 text-left">{m.label}</span>}
                  {!collapsed && (parentOpen ? <ChevronDown size={13} className="opacity-50" /> : <ChevronRight size={13} className="opacity-50" />)}
                </button>
                {!collapsed && parentOpen && (
                  <div className="ml-2 mt-0.5 border-l border-white/[.08] pl-1.5 space-y-0.5">
                    {m._filteredGroups!.map(group => {
                      const groupOpen = openGroups[group.id] !== false; // default open
                      const GroupIcon = getIcon(group.icon);
                      const activeInGroup = group.children.some(c => c.id === current);
                      return (
                        <div key={group.id}>
                          <button
                            onClick={() => toggleGroup(group.id)}
                            className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded-md text-[11px] font-semibold uppercase tracking-wide cursor-pointer transition-colors ${
                              activeInGroup ? 'text-primary' : 'text-white/40 hover:text-white/70'
                            }`}
                          >
                            <GroupIcon size={11} className="flex-shrink-0 opacity-70" />
                            <span className="flex-1 text-left truncate">{group.label}</span>
                            <span className="text-[9px] bg-white/10 px-1.5 rounded-full leading-[14px]">{group.children.length}</span>
                            {groupOpen ? <ChevronDown size={11} className="opacity-40" /> : <ChevronRight size={11} className="opacity-40" />}
                          </button>
                          {groupOpen && (
                            <div className="space-y-0.5 mt-0.5 mb-1">
                              {group.children.map(child => {
                                const CIcon = getIcon(child.icon);
                                const active = current === child.id;
                                return (
                                  <button
                                    key={child.id}
                                    onClick={() => onNavigate(child.id)}
                                    className={`w-full flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[11.5px] cursor-pointer transition-all duration-150 ${
                                      active
                                        ? 'bg-primary text-white font-semibold shadow-sm'
                                        : 'text-white/60 hover:bg-white/[.06] hover:text-slate-200'
                                    }`}
                                  >
                                    <CIcon size={11} className={`flex-shrink-0 ${active ? 'opacity-100' : 'opacity-50'}`} />
                                    <span className="truncate">{child.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const active = current === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onNavigate(m.id)}
              title={collapsed ? m.label : undefined}
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

        {/* Profile Row — gradient-ringed avatar + online dot, gradient name, dedupe
            when the display name equals the role label (super admin case). */}
        {(() => {
          const roleLabel = user.user_type.replace(/_/g, ' ');
          const nameMatchesRole = user.name.trim().toLowerCase() === roleLabel.toLowerCase();
          return (
            <div
              className="group flex items-center gap-2.5 px-2 py-2 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-px"
              style={{
                backgroundImage: 'linear-gradient(135deg, rgba(64,81,137,0.14), rgba(10,179,156,0.12))',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
              onClick={() => onNavigate('profile')}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 18px rgba(64,81,137,0.25)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
            >
              <span className="relative inline-flex rounded-full p-[2px] flex-shrink-0" style={{ backgroundImage: 'linear-gradient(135deg,#405189,#0ab39c)' }}>
                <span className="rounded-full p-[1.5px] bg-sidebar">
                  <Avatar initials={user.initials} size="sm" />
                </span>
                <span className="absolute bottom-[1px] right-[1px] w-2 h-2 rounded-full bg-emerald-500 ring-[1.5px] ring-sidebar" />
              </span>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[12.5px] font-bold truncate leading-tight"
                    style={{
                      backgroundImage: 'linear-gradient(135deg,#e2ecff,#a6efe0)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    {user.name}
                  </div>
                  {!nameMatchesRole && (
                    <div className="text-[9.5px] text-sidebar-text uppercase tracking-wide mt-[1px] truncate">
                      {roleLabel}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </aside>
  );
}
