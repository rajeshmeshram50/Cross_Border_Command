type Variant = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'muted';

const styles: Record<Variant, string> = {
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-500',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  primary: 'bg-primary/10 text-primary',
  muted: 'bg-muted/20 text-muted',
};

export default function Badge({ variant = 'muted', dot, children }: { variant?: Variant; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${styles[variant]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
