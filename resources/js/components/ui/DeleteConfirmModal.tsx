import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  clientName?: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function DeleteConfirmModal({ open, clientName, onClose, onConfirm, loading }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(99,102,241,0.08)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-[320px] p-7 text-center relative"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <X size={12} />
        </button>

        {/* Title */}
        <p className="text-[15px] font-bold text-gray-900 dark:text-gray-100 leading-snug mb-5">
          Do you really want to<br />delete{clientName ? ` "${clientName}"` : ' this'}?
        </p>

        {/* Illustration */}
        <div className="relative w-36 h-36 mx-auto mb-6 flex items-end justify-center">
          {/* Glow blob */}
          <div
            className="absolute top-1/2 left-1/2 w-28 h-28 rounded-full -translate-x-1/2 -translate-y-1/2"
            style={{ background: 'rgba(99,102,241,0.09)' }}
          />

          {/* Paper floats above can */}
          <div
            className="absolute z-10"
            style={{
              width: 36, height: 44, bottom: 70, left: '50%',
              transform: 'translateX(-42%) rotate(12deg)',
              animation: 'paperFloat 2.4s ease-in-out infinite',
              background: '#fff',
              borderRadius: 4,
              border: '2px solid #e5e7eb',
            }}
          >
            {[0, 5, 10, 15].map(t => (
              <div key={t} style={{ position: 'absolute', top: 8 + t, left: 6, right: 6, height: 2, background: '#d1d5db', borderRadius: 1 }} />
            ))}
          </div>

          {/* Lid */}
          <div
            className="absolute z-20"
            style={{
              width: 82, height: 22, bottom: 76, left: '50%',
              transformOrigin: '10% 100%',
              transform: 'translateX(-50%) rotate(-28deg)',
              animation: 'lidBounce 2.4s ease-in-out infinite',
            }}
          >
            <div style={{ width: 22, height: 8, background: '#6366f1', borderRadius: '4px 4px 0 0', position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)' }} />
            <div style={{ width: 82, height: 14, background: '#6366f1', borderRadius: 6 }} />
          </div>

          {/* Can */}
          <div className="relative z-10" style={{ width: 72, height: 68, flexShrink: 0 }}>
            <div style={{ width: 20, height: 8, border: '4px solid #2563eb', borderBottom: 'none', borderRadius: '8px 8px 0 0', position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)' }} />
            <div style={{ width: 76, height: 10, background: '#2563eb', borderRadius: 4, position: 'absolute', top: 0, left: -2 }} />
            <div style={{ width: 72, height: 60, background: '#3b82f6', borderRadius: '0 0 12px 12px', position: 'absolute', bottom: 0, overflow: 'hidden' }}>
              {[16, 28, 40, 52].map(l => (
                <div key={l} style={{ position: 'absolute', top: 10, bottom: 10, left: l, width: 4, background: 'rgba(255,255,255,0.18)', borderRadius: 2 }} />
              ))}
            </div>
          </div>
        </div>

        {/* Keyframes */}
        <style>{`
          @keyframes lidBounce {
            0%,100%{transform:translateX(-50%) rotate(-28deg)}
            50%{transform:translateX(-50%) rotate(-20deg)}
          }
          @keyframes paperFloat {
            0%,100%{transform:translateX(-42%) rotate(12deg) translateY(0)}
            50%{transform:translateX(-42%) rotate(12deg) translateY(-6px)}
          }
        `}</style>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="py-2.5 rounded-xl text-[12px] font-bold text-white transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-60"
            style={{ background: '#ef4444' }}
          >
            {loading ? 'Deleting…' : 'Yes, delete it'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="py-2.5 rounded-xl text-[12px] font-bold transition-all hover:-translate-y-0.5 active:scale-95"
            style={{ background: '#eff6ff', color: '#3b82f6', border: '1.5px solid #bfdbfe' }}
          >
            Cancel, this time
          </button>
        </div>
      </div>
    </div>
  );
}
