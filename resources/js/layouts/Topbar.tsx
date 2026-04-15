import { useState, useEffect } from 'react';
import { Menu, Moon, Sun, Bell, Search, Building2, ChevronDown } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import Avatar from '../components/ui/Avatar';

interface Props {
  page: string;
  onToggleSidebar: () => void;
  onNavigate: (id: string) => void;
}

const labels: Record<string, string> = {
  dashboard: 'Dashboard', clients: 'Clients', 'client-form': 'Add / Edit Client',
  'client-users': 'Client Users', plans: 'Subscription Plans', payments: 'Payments',
  permissions: 'Permissions', branches: 'Branches', 'branch-users': 'Branch Users',
  employees: 'Employees', settings: 'Settings', profile: 'Profile',
};

export default function Topbar({ page, onToggleSidebar, onNavigate }: Props) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = () => { setNotifOpen(false); setBranchOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <header className="h-[50px] bg-surface border-b border-border/50 flex items-center px-4 gap-2 flex-shrink-0 z-40">
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

      {/* Branch Switch (client admin only) */}
      {user?.user_type === 'client_admin' && (
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setBranchOpen(!branchOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-[12px] font-medium text-text hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
          >
            <Building2 size={13} className="text-primary" />
            <span>All Branches</span>
            <ChevronDown size={10} className="text-muted" />
          </button>
          {branchOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-[220px] bg-surface border border-border rounded-xl shadow-xl z-[999] overflow-hidden animate-in">
              {['All Branches', 'Main Branch — HQ', 'North Region', 'South Region'].map((b, i) => (
                <button key={b} onClick={() => setBranchOpen(false)}
                  className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-secondary hover:bg-primary/5 hover:text-primary transition-colors cursor-pointer ${i === 0 ? 'text-primary font-semibold bg-primary/5' : ''}`}>
                  {i === 0 ? <Building2 size={14} /> : <Building2 size={14} className="opacity-40" />}
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="hidden sm:flex items-center relative">
        <Search size={11} className="absolute left-2.5 text-muted" />
        <input
          placeholder="Search..."
          className="pl-7 pr-3 py-1.5 w-44 rounded-md border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted"
        />
      </div>

      {/* Theme Toggle */}
      <button onClick={toggle} className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {/* Notifications */}
      <div className="relative" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setNotifOpen(!notifOpen)}
          className="relative w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
        >
          <Bell size={14} />
          <span className="absolute top-[7px] right-[7px] w-1.5 h-1.5 rounded-full bg-red-500 border-[1.5px] border-surface" />
        </button>

        {notifOpen && (
          <div className="absolute top-full right-0 mt-2 w-[340px] bg-surface border border-border rounded-xl shadow-2xl z-[999] overflow-hidden animate-in">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h4 className="text-sm font-bold text-text">Notifications</h4>
              <button className="text-[11px] font-semibold text-primary hover:underline cursor-pointer">Mark all read</button>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {[
                { color: 'bg-primary/10 text-primary', text: '<b>New client</b> Acme Corp registered', time: '2 min ago', unread: true },
                { color: 'bg-emerald-500/10 text-emerald-500', text: 'Branch <b>North Region</b> activated', time: '15 min ago', unread: true },
                { color: 'bg-amber-500/10 text-amber-500', text: 'API usage at <b>85%</b> of limit', time: '1 hour ago', unread: false },
                { color: 'bg-red-500/10 text-red-500', text: 'User <b>john@test.com</b> soft deleted', time: '3 hours ago', unread: false },
              ].map((n, i) => (
                <div key={i} className={`flex gap-3 px-4 py-3 border-b border-border/40 cursor-pointer hover:bg-primary/5 transition-colors ${n.unread ? 'bg-sky-500/5' : ''}`}>
                  <div className={`w-9 h-9 rounded-full ${n.color} flex items-center justify-center flex-shrink-0`}>
                    <div className="w-2.5 h-2.5 rounded-full bg-current opacity-80" />
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
      {user && (
        <button onClick={() => onNavigate('profile')} className="p-[3px] rounded-md border border-border hover:border-primary/40 transition-colors cursor-pointer">
          <Avatar initials={user.initials} size="sm" />
        </button>
      )}
    </header>
  );
}
