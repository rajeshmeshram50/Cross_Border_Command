import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface Props {
  open: boolean;
  clientName?: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function DeleteConfirmModal({ open, clientName, onClose, onConfirm, loading = false }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, loading]);

  if (!open) return null;

  const itemName = clientName ? `"${clientName}"` : 'this item';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      {/* Dialog */}
      <div
        className="relative bg-surface w-full max-w-md rounded-2xl shadow-2xl border border-border overflow-hidden"
        style={{ animation: 'scaleIn .25s cubic-bezier(.22,1,.36,1) both' }}
        onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} disabled={loading}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted hover:text-red-500 hover:border-red-300 hover:bg-red-50 transition-all cursor-pointer z-10">
          <X size={14} />
        </button>

        {/* Content */}
        <div className="px-8 pt-8 pb-6 text-center">
          {/* Icon */}
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
              <AlertTriangle size={28} className="text-red-500" />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-[18px] font-bold text-text mb-2">Delete Client</h2>

          {/* Message */}
          <p className="text-[14px] text-secondary leading-relaxed">
            Are you sure you want to delete {itemName}?
          </p>
          <p className="text-[13px] text-muted mt-1">
            This action cannot be undone. All branches, users, and data will be permanently removed.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-8 pb-7">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold border border-border bg-surface text-text hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin" /> Deleting...</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
