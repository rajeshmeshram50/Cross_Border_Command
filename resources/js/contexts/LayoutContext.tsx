import { createContext, useContext, useState, type ReactNode } from 'react';

export type LayoutMode = 'both' | 'sidebar' | 'topnav';

interface LayoutCtx {
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  showLayoutToggle: boolean;
  setShowLayoutToggle: (v: boolean) => void;
}

const Ctx = createContext<LayoutCtx>({
  mode: 'both',
  setMode: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  showLayoutToggle: true,
  setShowLayoutToggle: () => {},
});

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LayoutMode>(() => (localStorage.getItem('cbc_layout') as LayoutMode) || 'both');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLayoutToggle, setShowLayoutToggle] = useState(() => localStorage.getItem('cbc_layout_toggle') !== 'hidden');

  const handleSetMode = (m: LayoutMode) => {
    setMode(m);
    localStorage.setItem('cbc_layout', m);
  };

  const handleToggleVisibility = (v: boolean) => {
    setShowLayoutToggle(v);
    localStorage.setItem('cbc_layout_toggle', v ? 'visible' : 'hidden');
  };

  return (
    <Ctx.Provider value={{
      mode,
      setMode: handleSetMode,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed(c => !c),
      mobileOpen,
      setMobileOpen,
      showLayoutToggle,
      setShowLayoutToggle: handleToggleVisibility,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useLayout = () => useContext(Ctx);
