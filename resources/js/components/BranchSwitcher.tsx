import { useState, useEffect, useRef } from 'react';
import { useBranchSwitcher } from '../contexts/BranchSwitcherContext';
import { useAuth } from '../contexts/AuthContext';
import { Building2, ChevronDown, Star, Check, Layers } from 'lucide-react';

export default function BranchSwitcher() {
  const { user } = useAuth();
  const { branches, selectedBranchId, selectedBranch, isMainBranchUser, setBranch } = useBranchSwitcher();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user || user.user_type === 'super_admin') return null;

  // Sub-branch user (non-main) — locked to their own branch, no dropdown
  if (user.user_type === 'branch_user' && !isMainBranchUser) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-[12px] font-medium text-text">
        <Building2 size={13} className="text-primary" />
        <span className="max-w-[160px] truncate">{user.branch_name || 'My Branch'}</span>
      </div>
    );
  }

  // Main branch user OR client admin — full dropdown
  const displayName = selectedBranch ? selectedBranch.name : 'All Branches';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 cursor-pointer"
      >
        <Building2 size={13} className="text-primary" />
        <span className="max-w-[160px] truncate hidden sm:inline">{displayName}</span>
        <ChevronDown size={10} className={`text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-[280px] bg-surface border border-border rounded-xl shadow-2xl z-[999] overflow-hidden slide-in-from-right"
          style={{ animation: 'scaleIn .2s cubic-bezier(.22,1,.36,1) both' }}>
          {/* Header */}
          <div className="px-3.5 py-2.5 border-b border-border/60 bg-surface-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Switch Branch</div>
          </div>

          {/* All Branches option */}
          <button
            onClick={() => { setBranch(null); setOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] transition-all duration-150 cursor-pointer ${
              selectedBranchId === null
                ? 'text-primary font-semibold bg-primary/5'
                : 'text-secondary hover:bg-primary/5 hover:text-primary'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Layers size={13} className="text-primary" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold">All Branches</div>
              <div className="text-[10px] text-muted">{branches.length} branches</div>
            </div>
            {selectedBranchId === null && <Check size={14} className="text-primary" />}
          </button>

          <div className="border-t border-border/40" />

          {/* Branch list */}
          <div className="max-h-[250px] overflow-y-auto py-1">
            {branches.map(b => (
              <button
                key={b.id}
                onClick={() => { setBranch(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-all duration-150 cursor-pointer ${
                  selectedBranchId === b.id
                    ? 'text-primary font-semibold bg-primary/5'
                    : 'text-secondary hover:bg-primary/5 hover:text-primary'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-white ${
                  b.is_main ? 'bg-gradient-to-br from-amber-500 to-yellow-400' : 'bg-gradient-to-br from-sky-500 to-cyan-400'
                }`}>
                  {b.code?.substring(0, 2) || b.name.charAt(0)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    {b.name}
                    {b.is_main && (
                      <span className="inline-flex items-center gap-0.5 text-[7px] font-extrabold px-1 py-px rounded-full bg-amber-100 text-amber-600 flex-shrink-0">
                        <Star size={6} /> MAIN
                      </span>
                    )}
                  </div>
                  {b.city && <div className="text-[10px] text-muted truncate">{b.city}{b.state ? `, ${b.state}` : ''}</div>}
                </div>
                {selectedBranchId === b.id && <Check size={14} className="text-primary flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
