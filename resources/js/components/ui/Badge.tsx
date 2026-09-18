import type { ReactNode } from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'muted' | 'gold' | 'dark';

/** soft = flat tinted background (default). outline = gradient background + coloured border. */
export type BadgeAppearance = 'soft' | 'outline';

const styles: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-500',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  primary: 'bg-primary/10 text-primary',
  muted: 'bg-muted/20 text-muted',
  gold: 'bg-yellow-500/15 text-amber-700 dark:text-yellow-300',
  dark: 'bg-slate-700 text-slate-50',
};

// Border uses border-solid + border-[1px] (not "border"): Bootstrap's .border class is !important.
const outlineStyles: Record<BadgeVariant, string> = {
  danger:
    'bg-linear-to-b from-[#fff1f1] to-[#fee2e2] border-[#fca5a5] text-[#b91c1c] [&_svg]:text-[#dc2626] '
    + 'dark:bg-none dark:bg-[rgba(239,68,68,.14)] dark:border-[rgba(239,68,68,.40)] dark:text-[#fca5a5] dark:[&_svg]:text-[#f87171]',
  warning:
    'bg-linear-to-b from-[#fffbeb] to-[#fef3c7] border-[#fcd97a] text-[#b45309] '
    + 'dark:bg-none dark:bg-[rgba(245,158,11,.14)] dark:border-[rgba(245,158,11,.40)] dark:text-[#fcd34d]',
  success:
    'bg-linear-to-b from-[#f4fdf7] to-[#dcfce7] border-[#a7ecc0] text-[#15803d] '
    + 'dark:bg-none dark:bg-[rgba(34,197,94,.14)] dark:border-[rgba(34,197,94,.38)] dark:text-[#86efac]',
  info:
    'bg-linear-to-b from-[#f5f9ff] to-[#dbeafe] border-[#a8c9f5] text-[#1d4ed8] '
    + 'dark:bg-none dark:bg-[rgba(59,130,246,.16)] dark:border-[rgba(59,130,246,.40)] dark:text-[#93c5fd]',
  gold:
    'bg-linear-to-b from-[#fffbeb] to-[#fde68a] border-[#f0c14b] text-[#92400e] [&_svg]:text-[#d97706] '
    + 'dark:bg-none dark:bg-[rgba(234,179,8,.16)] dark:border-[rgba(234,179,8,.45)] dark:text-[#fde68a] dark:[&_svg]:text-[#fbbf24]',
  dark:
    'bg-linear-to-b from-[#334155] to-[#0f172a] border-[#0f172a] text-[#f8fafc] '
    + 'dark:bg-none dark:bg-[#334155] dark:border-[rgba(148,163,184,.40)] dark:text-[#e2e8f0]',
  primary: 'bg-primary/10 border-primary/30 text-primary',
  muted: 'bg-muted/20 border-muted/40 text-muted',
};

export default function Badge({ variant = 'muted', appearance = 'soft', dot, icon, className, title, children }: {
  variant?: BadgeVariant;
  appearance?: BadgeAppearance;
  dot?: boolean;
  /** Optional leading icon (an SVG). */
  icon?: ReactNode;
  /** Extra classes, e.g. a page-specific size. */
  className?: string;
  /** Native tooltip text. */
  title?: string;
  children: ReactNode;
}) {
  const look = appearance === 'outline'
    ? `border-solid border-[1px] font-extrabold ${outlineStyles[variant]}`
    : `font-bold ${styles[variant]}`;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wide ${look}${className ? ` ${className}` : ''}`}
      title={title}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}
