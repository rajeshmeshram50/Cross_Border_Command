import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  clientName?: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function DeleteConfirmModal({
  open,
  clientName,
  onClose,
  onConfirm,
  loading = false,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, loading]);

  if (!open) return null;

  const itemName = clientName ? `"${clientName}"` : 'this item';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
<div className="bg-white dark:bg-zinc-900 w-full max-w-[360px] max-h-[270px] rounded-3xl shadow-3xl overflow-hidden">

  {/* Icon */}
  <div className="flex justify-center pt-4 pb-2">
    <div className="relative flex items-center justify-center">
      {/* Glow */}
      <div className="absolute w-16 h-16 bg-red-500/20 rounded-full blur-xl" />
      
      {/* Circle */}
      <div className="w-12 h-12 bg-red-100 dark:bg-red-950 rounded-full flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-500" />
      </div>
    </div>
  </div>

  {/* Text */}
  <div className="px-8 text-center pb-7">
    <h2 className="text-[20px] font-semibold text-gray-900 dark:text-white">
      Delete article
    </h2>

    <p className="mt-3 text-[14.5px] text-gray-500 dark:text-zinc-400 leading-relaxed">
      Are you sure you want to delete {itemName}?
    </p>

    <p className="mt-1 text-[13.5px] text-gray-400 dark:text-zinc-500">
      This action cannot be undone.
    </p>
  </div>

  {/* Buttons */}
  <div className="flex gap-3 px-5 pb-5">
    <button
      onClick={onClose}
      disabled={loading}
      className="flex-1 py-3 rounded-xl text-sm font-medium 
                 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300
                 hover:bg-gray-200 dark:hover:bg-zinc-700 transition"
    >
      Cancel
    </button>

    <button
      onClick={onConfirm}
      disabled={loading}
      className="flex-1 py-2 rounded-xl text-sm font-medium text-white 
                 bg-red-600 hover:bg-red-700 active:bg-red-800 transition"
    >
      {loading ? 'Deleting...' : 'Delete'}
    </button>
  </div>
</div>
    </div>
  );
}