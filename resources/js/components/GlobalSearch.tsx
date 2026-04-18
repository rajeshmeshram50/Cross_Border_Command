import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { MENU_ITEMS } from '../constants';

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] || Icons.Circle;
}

interface Props {
  onNavigate: (id: string) => void;
  compact?: boolean;
}

export default function GlobalSearch({ onNavigate, compact }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  if (!user) return null;

  const pages = MENU_ITEMS.filter(m => m.id && !m.section && m.roles.includes(user.user_type));

  const filtered = query.trim()
    ? pages.filter(m => m.label.toLowerCase().includes(query.toLowerCase()))
    : pages;

  const handleSelect = (id: string) => {
    onNavigate(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search..."
          className={`pl-7 pr-8 py-1.5 rounded-lg border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted ${compact ? 'w-36' : 'w-44'}`}
        />
        {query ? (
          <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
            <X size={11} />
          </button>
        ) : (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-muted bg-surface-2 border border-border/50 px-1 rounded">
            Ctrl+K
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-64 bg-surface border border-border rounded-xl shadow-2xl z-[999] overflow-hidden"
          style={{ animation: 'scaleIn .15s cubic-bezier(.22,1,.36,1) both' }}>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-muted">
                <Search size={18} className="mx-auto mb-2 opacity-30" />
                No pages found
              </div>
            ) : (
              filtered.map(m => {
                const Icon = getIcon(m.icon);
                return (
                  <button key={m.id} onClick={() => handleSelect(m.id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-primary/5 transition-colors cursor-pointer">
                    <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
                      <Icon size={13} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-text">{m.label}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t border-border/50 bg-surface-2/50">
            <span className="text-[9px] text-muted">Navigate with arrow keys · Press Enter to select</span>
          </div>
        </div>
      )}
    </div>
  );
}
