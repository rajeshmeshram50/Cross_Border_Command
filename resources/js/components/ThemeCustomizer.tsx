import { useEffect } from 'react';
import { X, Check, Sun, Moon, Monitor, PanelLeft, PanelTop } from 'lucide-react';
import { useVariant, VARIANTS, type Variant } from '../contexts/VariantContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLayout, type LayoutMode } from '../contexts/LayoutContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ThemeCustomizer({ open, onClose }: Props) {
  const { variant, setVariant } = useVariant();
  const { theme, toggle: toggleTheme } = useTheme();
  const { mode, setMode } = useLayout();

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[200] bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Offcanvas panel */}
      <aside
        className={`fixed top-0 right-0 z-[201] h-full w-[320px] sm:w-[360px] bg-surface border-l border-border shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-label="Theme customizer"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-primary text-white">
          <div>
            <h3 className="text-[14px] font-bold leading-tight">Theme Customizer</h3>
            <p className="text-[11px] opacity-80 mt-0.5">Personalize your dashboard</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-white/15 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close customizer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Color Mode */}
          <section>
            <h4 className="text-[12px] font-bold text-text uppercase tracking-wide mb-2.5">Color Mode</h4>
            <div className="grid grid-cols-2 gap-2">
              <ModeTile active={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()} icon={<Sun size={16} />} label="Light" />
              <ModeTile active={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()} icon={<Moon size={16} />} label="Dark" />
            </div>
          </section>

          {/* Layout */}
          <section>
            <h4 className="text-[12px] font-bold text-text uppercase tracking-wide mb-2.5">Layout</h4>
            <div className="grid grid-cols-3 gap-2">
              <LayoutTile active={mode === 'both'}    onClick={() => setMode('both' as LayoutMode)}    icon={<Monitor size={16} />}    label="Both" />
              <LayoutTile active={mode === 'sidebar'} onClick={() => setMode('sidebar' as LayoutMode)} icon={<PanelLeft size={16} />}  label="Sidebar" />
              <LayoutTile active={mode === 'topnav'}  onClick={() => setMode('topnav' as LayoutMode)}  icon={<PanelTop size={16} />}   label="Topnav" />
            </div>
          </section>

          {/* Color Variant */}
          <section>
            <h4 className="text-[12px] font-bold text-text uppercase tracking-wide mb-1">Color Scheme</h4>
            <p className="text-[11px] text-muted mb-3">Pick a primary accent inspired by Velzon.</p>
            <div className="grid grid-cols-2 gap-2">
              {VARIANTS.map(v => (
                <VariantTile
                  key={v.id}
                  id={v.id}
                  label={v.label}
                  swatch={v.swatch}
                  active={variant === v.id}
                  onClick={() => setVariant(v.id)}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 text-[11px] text-muted">
          Preferences saved automatically.
        </div>
      </aside>
    </>
  );
}

/* ── Small tile components ─────────────────── */

function ModeTile({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border-2 transition-all cursor-pointer ${active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 text-secondary'}`}
    >
      {icon}
      <span className="text-[12px] font-semibold">{label}</span>
      {active && (
        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
          <Check size={10} className="text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function LayoutTile({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 transition-all cursor-pointer ${active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 text-secondary'}`}
    >
      {icon}
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
}

function VariantTile({ id, label, swatch, active, onClick }: { id: Variant; label: string; swatch: string; active: boolean; onClick: () => void; }) {
  return (
    <button
      onClick={onClick}
      title={label}
      data-variant-id={id}
      className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-lg border-2 transition-all cursor-pointer text-left ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
    >
      <span
        className="w-7 h-7 rounded-md flex-shrink-0 ring-1 ring-black/10"
        style={{ backgroundColor: swatch }}
      />
      <span className={`text-[11.5px] font-semibold truncate ${active ? 'text-primary' : 'text-text'}`}>{label}</span>
      {active && (
        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
          <Check size={10} className="text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
