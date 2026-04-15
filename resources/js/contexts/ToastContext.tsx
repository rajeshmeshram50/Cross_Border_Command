import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  exiting?: boolean;
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

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  const toast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

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
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 pointer-events-none w-[380px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

const config: Record<ToastType, { icon: typeof CheckCircle; bg: string; border: string; iconColor: string; titleColor: string; progressColor: string }> = {
  success: { icon: CheckCircle, bg: 'bg-white', border: 'border-emerald-200', iconColor: 'text-emerald-500', titleColor: 'text-emerald-800', progressColor: 'bg-emerald-500' },
  error: { icon: AlertCircle, bg: 'bg-white', border: 'border-red-200', iconColor: 'text-red-500', titleColor: 'text-red-800', progressColor: 'bg-red-500' },
  warning: { icon: AlertTriangle, bg: 'bg-white', border: 'border-amber-200', iconColor: 'text-amber-500', titleColor: 'text-amber-800', progressColor: 'bg-amber-500' },
  info: { icon: Info, bg: 'bg-white', border: 'border-blue-200', iconColor: 'text-blue-500', titleColor: 'text-blue-800', progressColor: 'bg-blue-500' },
};

function ToastItem({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  const c = config[t.type];
  const Icon = c.icon;

  return (
    <div className={`pointer-events-auto ${t.exiting ? 'slide-out-to-right' : 'slide-in-from-right'}`}>
      <div className={`relative overflow-hidden flex items-start gap-3 px-4 py-3.5 rounded-2xl border shadow-xl ${c.bg} ${c.border}`}
        style={{ boxShadow: '0 10px 40px -10px rgba(0,0,0,.12), 0 4px 12px -2px rgba(0,0,0,.06)' }}>
        {/* Icon with pulse ring */}
        <div className="relative flex-shrink-0 mt-0.5">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.iconColor} bg-current/10`}>
            <Icon size={15} />
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className={`text-[13px] font-bold ${c.titleColor} leading-tight`}>{t.title}</div>
          {t.message && <div className="text-[11.5px] text-secondary mt-1 leading-relaxed">{t.message}</div>}
        </div>
        {/* Close */}
        <button onClick={onClose} className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-black/5 transition-all cursor-pointer mt-0.5">
          <X size={13} />
        </button>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/5">
          <div className={`h-full ${c.progressColor} opacity-40 toast-progress rounded-full`} />
        </div>
      </div>
    </div>
  );
}

export const useToast = () => useContext(Ctx);
