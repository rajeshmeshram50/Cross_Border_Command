import Sidebar from './Sidebar';
import Topbar from './Topbar';
import TopNav from './TopNav';
import LayoutToggle from '../components/LayoutToggle';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import Avatar from '../components/ui/Avatar';
import BranchSwitcher from '../components/BranchSwitcher';
import GlobalSearch from '../components/GlobalSearch';
import { Moon, Sun, Bell, Menu, Maximize2, Minimize2 } from 'lucide-react';
import { useState, useCallback, useEffect, type ReactNode } from 'react';

interface Props {
  page: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
}

export default function AppLayout({ page, onNavigate, children }: Props) {
  const { mode, sidebarCollapsed, toggleSidebar, mobileOpen, setMobileOpen } = useLayout();

  const showSidebar = mode === 'both' || mode === 'sidebar';
  const showTopbar = mode === 'both';
  const showTopnav = mode === 'topnav';

  const handleNav = (id: string) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">

      {/* ═══ TOP NAV BAR (topnav mode) ═══ */}
      {showTopnav && (
        <TopNav current={page} onNavigate={handleNav} />
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ═══ MOBILE OVERLAY ═══ */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/40 z-[99] lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* ═══ SIDEBAR (both + sidebar modes) ═══ */}
        {showSidebar && (
          <>
            {/* Desktop */}
            <div className="hidden lg:flex transition-all duration-300">
              <Sidebar current={page} onNavigate={handleNav} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            </div>
            {/* Mobile slide-in */}
            <div className={`fixed inset-y-0 left-0 z-[100] lg:hidden transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <Sidebar current={page} onNavigate={handleNav} collapsed={false} />
            </div>
          </>
        )}

        {/* ═══ MAIN CONTENT AREA ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ═══ TOPBAR (both mode) ═══ */}
          {showTopbar && (
            <Topbar
              page={page}
              onToggleSidebar={() => {
                if (window.innerWidth < 1024) setMobileOpen(!mobileOpen);
                else toggleSidebar();
              }}
              onNavigate={handleNav}
            />
          )}

          {/* ═══ SIDEBAR-ONLY MODE: compact action bar ═══ */}
          {mode === 'sidebar' && (
            <SidebarTopStrip
              page={page}
              onToggleSidebar={() => {
                if (window.innerWidth < 1024) setMobileOpen(!mobileOpen);
                else toggleSidebar();
              }}
              onNavigate={handleNav}
            />
          )}

          {/* ═══ TOPNAV MODE: breadcrumb strip below topnav ═══ */}
          {showTopnav && (
            <TopnavBreadcrumb page={page} onNavigate={handleNav} />
          )}

          {/* ═══ PAGE CONTENT ═══ */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 pb-20">
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" key={page}>
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* ═══ LAYOUT MODE TOGGLE (floating pill) ═══ */}
      <LayoutToggle />
    </div>
  );
}

/* ────────────────────────────────────────────
   Sidebar-Only Mode: compact top strip
   Shows mobile hamburger + breadcrumb + controls
   ──────────────────────────────────────────── */
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);
  return { isFullscreen, toggle };
}

function SidebarTopStrip({ page, onToggleSidebar, onNavigate }: { page: string; onToggleSidebar: () => void; onNavigate: (id: string) => void }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const fullscreen = useFullscreen();
  const labels: Record<string, string> = {
    dashboard: 'Dashboard', clients: 'Clients', 'client-users': 'Client Users',
    plans: 'Plans', payments: 'Payments', permissions: 'Permissions',
    branches: 'Branches', 'branch-users': 'Branch Users', employees: 'Employees',
    settings: 'Settings', profile: 'Profile',
  };

  return (
    <div className="h-11 bg-surface border-b border-border/50 flex items-center px-3 gap-2 flex-shrink-0">
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
      <GlobalSearch onNavigate={onNavigate} compact />

      {/* Fullscreen */}
      <button onClick={fullscreen.toggle} title={fullscreen.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {fullscreen.isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>

      {/* Dark/Light */}
      <button onClick={toggle} className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
      </button>

      {/* Bell */}
      <button className="relative w-7 h-7 rounded-md border border-border flex items-center justify-center text-secondary hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
        <Bell size={13} />
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 border border-surface" />
      </button>

      {/* Avatar */}
      {user && (
        <button onClick={() => onNavigate('profile')} className="p-[2px] rounded-md border border-border hover:border-primary/40 transition-colors cursor-pointer">
          <Avatar initials={user.initials} size="sm" />
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   TopNav Mode: breadcrumb below the top nav
   ──────────────────────────────────────────── */
function TopnavBreadcrumb({ page, onNavigate }: { page: string; onNavigate: (id: string) => void }) {
  const labels: Record<string, string> = {
    dashboard: 'Dashboard', clients: 'Clients', 'client-users': 'Client Users',
    plans: 'Plans', payments: 'Payments', permissions: 'Permissions',
    branches: 'Branches', 'branch-users': 'Branch Users', employees: 'Employees',
    settings: 'Settings', profile: 'Profile',
  };

  return (
    <div className="h-9 bg-surface border-b border-border/40 flex items-center px-4 flex-shrink-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="cursor-pointer hover:text-text transition-colors font-medium" onClick={() => onNavigate('dashboard')}>Home</span>
        <span className="text-border">/</span>
        <span className="text-text font-semibold">{labels[page] || page}</span>
      </div>
    </div>
  );
}
