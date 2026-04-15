import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastCtx {
  toast: (type: ToastType, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const Ctx = createContext<ToastCtx>({
  toast: () => {}, success: () => {}, error: () => {}, warning: () => {}, info: () => {},
});

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => remove(id), 4000);
  }, [remove]);

  const ctx: ToastCtx = {
    toast,
    success: (t, m) => toast('success', t, m),
    error: (t, m) => toast('error', t, m),
    warning: (t, m) => toast('warning', t, m),
    info: (t, m) => toast('info', t, m),
  };

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {/* Toast Container — top right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-[380px] w-full">
        {toasts.map((t, i) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} index={i} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

const config: Record<ToastType, { icon: typeof CheckCircle; bg: string; border: string; iconColor: string; titleColor: string }> = {
  success: { icon: CheckCircle, bg: 'bg-emerald-50', border: 'border-emerald-200', iconColor: 'text-emerald-500', titleColor: 'text-emerald-800' },
  error: { icon: AlertCircle, bg: 'bg-red-50', border: 'border-red-200', iconColor: 'text-red-500', titleColor: 'text-red-800' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-500', titleColor: 'text-amber-800' },
  info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', iconColor: 'text-blue-500', titleColor: 'text-blue-800' },
};

function ToastItem({ toast: t, onClose, index }: { toast: Toast; onClose: () => void; index: number }) {
  const c = config[t.type];
  const Icon = c.icon;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-xl border shadow-lg ${c.bg} ${c.border} animate-in slide-in-from-right-5 fade-in duration-300`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <Icon size={16} className={`${c.iconColor} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[12.5px] font-bold ${c.titleColor}`}>{t.title}</div>
        {t.message && <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{t.message}</div>}
      </div>
      <button onClick={onClose} className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-muted hover:text-text transition-colors cursor-pointer">
        <X size={12} />
      </button>
    </div>
  );
}

export const useToast = () => useContext(Ctx);
