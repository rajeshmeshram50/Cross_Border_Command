import { useLayout, type LayoutMode } from '../contexts/LayoutContext';
import { PanelLeft, PanelTop, Columns2, X, LayoutGrid } from 'lucide-react';

const modes: { id: LayoutMode; icon: typeof PanelLeft; label: string }[] = [
  { id: 'both', icon: Columns2, label: 'Both' },
  { id: 'sidebar', icon: PanelLeft, label: 'Sidebar' },
  { id: 'topnav', icon: PanelTop, label: 'Top Bar' },
];

export default function LayoutToggle() {
  const { mode, setMode, showLayoutToggle, setShowLayoutToggle } = useLayout();

  // Collapsed: show small button to re-open
  if (!showLayoutToggle) {
    return (
      <button
        onClick={() => setShowLayoutToggle(true)}
        title="Show layout switcher"
        className="fixed bottom-5 right-5 z-[200] w-9 h-9 bg-surface border border-border rounded-xl shadow-lg flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer"
      >
        <LayoutGrid size={15} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[200] flex items-center gap-1 p-1.5 bg-surface border border-border rounded-xl shadow-lg animate-in">
      {modes.map((m, i) => (
        <div key={m.id} className="flex items-center">
          {i > 0 && <div className="w-px h-5 bg-border mx-0.5" />}
          <button
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer ${
              mode === m.id
                ? 'bg-primary text-white shadow-md shadow-primary/30'
                : 'text-secondary hover:bg-primary/5 hover:text-primary'
            }`}
            title={`${m.label} layout`}
          >
            <m.icon size={14} />
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        </div>
      ))}
      <div className="w-px h-5 bg-border mx-0.5" />
      <button
        onClick={() => setShowLayoutToggle(false)}
        title="Hide layout switcher"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
      >
        <X size={13} />
      </button>
    </div>
  );
}
