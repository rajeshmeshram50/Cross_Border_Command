import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export default function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className={`bg-surface rounded-2xl w-full ${widths[size]} max-h-[90vh] flex flex-col shadow-2xl border border-border animate-in zoom-in-95`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-text">{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-muted hover:text-red-500 hover:border-red-300 transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-border bg-surface-2 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
