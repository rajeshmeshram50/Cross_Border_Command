import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { MENU_ITEMS } from '../constants';
import Avatar from '../components/ui/Avatar';
import Logo from '../components/Logo';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
}

interface Props {
  current: string;
  onNavigate: (id: string) => void;
}

export default function TopNav({ current, onNavigate }: Props) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  if (!user) return null;

  const navItems = MENU_ITEMS.filter(m => m.roles.includes(user.user_type) && !m.section && m.id);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (!(e.target as HTMLElement).closest('.notif-wrap')) setNotifOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <header className="h-14 bg-sidebar flex items-center px-4 gap-0 flex-shrink-0 z-50 border-b border-white/[.04]"
      style={{ background: 'linear-gradient(90deg, #0C1322 0%, #111827 100%)' }}>
      {/* Logo — compact for topnav */}
      <div className="mr-4 flex-shrink-0">
        <Logo variant="topnav" />
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-white/10 mx-2.5 flex-shrink-0" />

      {/* Nav Items */}
      <nav ref={menuRef} className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden">
        {navItems.map(m => {
          const Icon = getIcon(m.icon);
          const active = current === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onNavigate(m.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 cursor-pointer ${
                active
                  ? 'bg-primary text-white font-semibold shadow-md shadow-primary/35'
                  : 'text-sidebar-text hover:bg-white/[.06] hover:text-slate-300'
              }`}
            >
              <Icon size={13} className={`flex-shrink-0 ${active ? 'opacity-100' : 'opacity-60'}`} />
              <span className="hidden md:inline">{m.label}</span>
              {m.badge && <span className="bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">{m.badge}</span>}
            </button>
          );
        })}
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2.5">
        {/* Branch Switch (client only) */}
        {user.user_type === 'client_admin' && (
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/12 text-[12px] font-medium text-white/80 hover:bg-white/[.06] hover:border-white/25 transition-all cursor-pointer">
            <Icons.Building2 size={13} className="text-violet-300" />
            <span className="hidden sm:inline">All Branches</span>
            <Icons.ChevronDown size={10} className="opacity-60" />
          </button>
        )}

        {/* Dark Mode */}
        <button
          onClick={toggle}
          className="w-8 h-8 rounded-md border border-white/12 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[.06] hover:border-white/25 transition-all cursor-pointer"
        >
          {theme === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
        </button>

        {/* Notifications */}
        <div className="relative notif-wrap">
          <button
            onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen); }}
            className="relative w-8 h-8 rounded-md border border-white/12 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[.06] hover:border-white/25 transition-all cursor-pointer"
          >
            <Icons.Bell size={14} />
            <span className="absolute top-1.5 right-1.5 w-[5px] h-[5px] rounded-full bg-red-500 border border-sidebar" />
          </button>

          {/* Notification Dropdown */}
          {notifOpen && (
            <div className="absolute top-full right-0 mt-2 w-[340px] bg-surface border border-border rounded-xl shadow-2xl z-[999] overflow-hidden animate-in">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h4 className="text-sm font-bold text-text">Notifications</h4>
                <button className="text-[11px] font-semibold text-primary hover:underline cursor-pointer">Mark all read</button>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {[
                  { icon: Icons.UserPlus, bg: 'bg-primary/10 text-primary', text: '<b>New client</b> Acme Corp registered', time: '2 minutes ago', unread: true },
                  { icon: Icons.CheckCircle, bg: 'bg-emerald-500/10 text-emerald-500', text: 'Branch <b>North Region</b> activated', time: '15 minutes ago', unread: true },
                  { icon: Icons.AlertTriangle, bg: 'bg-amber-500/10 text-amber-500', text: 'API usage at <b>85%</b> of limit', time: '1 hour ago', unread: false },
                ].map((n, i) => (
                  <div key={i} className={`flex gap-3 px-4 py-3 border-b border-border/50 cursor-pointer hover:bg-primary/5 transition-colors ${n.unread ? 'bg-sky-500/5' : ''}`}>
                    <div className={`w-9 h-9 rounded-full ${n.bg} flex items-center justify-center flex-shrink-0`}>
                      <n.icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-text leading-snug" dangerouslySetInnerHTML={{ __html: n.text }} />
                      <span className="text-[11px] text-muted mt-0.5 block">{n.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <button
          onClick={() => onNavigate('profile')}
          className="flex items-center gap-1.5 py-1 px-1 pr-2.5 rounded-md border border-white/12 hover:bg-white/[.06] hover:border-white/20 transition-all cursor-pointer"
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-300 to-indigo-300 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
            {user.initials}
          </div>
          <span className="text-[12px] font-semibold text-slate-200 hidden sm:block">{user.name.split(' ')[0]}</span>
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          className="w-8 h-8 rounded-md border border-red-500/20 bg-red-500/[.07] flex items-center justify-center text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-all cursor-pointer"
          title="Logout"
        >
          <Icons.LogOut size={13} />
        </button>
      </div>
    </header>
  );
}
