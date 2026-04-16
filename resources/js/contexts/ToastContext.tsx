import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { ToasterRoot, type ToastItemType } from '../components/ui/Toaster';

type ToastType = 'success' | 'error' | 'warning' | 'info';

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
  const [toasts, setToasts] = useState<ToastItemType[]>([]);

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
      <ToasterRoot toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
