import { Menu, Moon, Sun, Bell, Search, Maximize2, Minimize2 } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import Avatar from '../components/ui/Avatar';
import BranchSwitcher from '../components/BranchSwitcher';

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
      <div className="hidden sm:flex items-center relative">
        <Search size={11} className="absolute left-2.5 text-muted" />
        <input
          placeholder="Search..."
          className="pl-7 pr-3 py-1.5 w-44 rounded-md border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted"
        />
      </div>

      {/* Fullscreen */}
      <button onClick={fs.toggle} title={fs.isFs ? 'Exit Fullscreen' : 'Fullscreen'}
        className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {fs.isFs ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {/* Theme Toggle */}
      <button onClick={toggle} className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {/* Notifications */}
      <button className="relative w-8 h-8 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        <Bell size={14} />
        <span className="absolute top-[7px] right-[7px] w-1.5 h-1.5 rounded-full bg-red-500 border-[1.5px] border-surface" />
      </button>

      {/* Profile */}
      {user && (
        <button onClick={() => onNavigate('profile')} className="p-[3px] rounded-md border border-border hover:border-primary/40 transition-colors cursor-pointer">
          <Avatar initials={user.initials} size="sm" />
        </button>
      )}
    </header>
  );
}
