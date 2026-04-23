import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItemType {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  exiting?: boolean;
}

const config: Record<ToastType, { icon: typeof CheckCircle; bg: string; border: string; iconColor: string; titleColor: string; progressColor: string; stripeColor: string }> = {
  success: {
    icon: CheckCircle,
    bg: 'bg-white',
    border: 'border-emerald-200',
    iconColor: 'text-emerald-500',
    titleColor: 'text-emerald-800',
    progressColor: 'bg-emerald-500',
    stripeColor: 'bg-emerald-500',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-white',
    border: 'border-red-200',
    iconColor: 'text-red-500',
    titleColor: 'text-red-800',
    progressColor: 'bg-red-500',
    stripeColor: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-white',
    border: 'border-amber-200',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-800',
    progressColor: 'bg-amber-500',
    stripeColor: 'bg-amber-500',
  },
  info: {
    icon: Info,
    bg: 'bg-white',
    border: 'border-blue-200',
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-800',
    progressColor: 'bg-blue-500',
    stripeColor: 'bg-blue-500',
  },
};

export function ToasterRoot({ toasts, onDismiss }: { toasts: ToastItemType[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItemType; onClose: () => void }) {
  const c = config[toast.type];
  const Icon = c.icon;

  return (
    <div className={`pointer-events-auto ${toast.exiting ? 'slide-out-to-right' : 'slide-in-from-right'}`}>
      <div
        className={`relative overflow-hidden flex items-start gap-3 pl-4 pr-4 py-3.5 rounded-2xl border shadow-xl ${c.bg} ${c.border}`}
        style={{ boxShadow: '0 10px 40px -10px rgba(0,0,0,.12), 0 4px 12px -2px rgba(0,0,0,.06)' }}
      >
        <div className={`${c.stripeColor} absolute inset-y-0 left-0 w-1 rounded-l-2xl`} />
        <div className="relative flex-shrink-0 mt-0.5 ml-2">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${c.iconColor} bg-current/10`}>
            <Icon size={16} />
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <div className={`text-[13px] font-bold leading-tight ${c.titleColor}`}>{toast.title}</div>
          {toast.message && <div className="text-[11.5px] text-gray-600 mt-1 leading-relaxed">{toast.message}</div>}
        </div>

        <button
          onClick={onClose}
          className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-black/5 transition-all cursor-pointer mt-0.5"
        >
          <X size={13} />
        </button>

        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/5">
          <div className={`h-full ${c.progressColor} opacity-40 toast-progress rounded-full`} />
        </div>
      </div>
    </div>
  );
}
