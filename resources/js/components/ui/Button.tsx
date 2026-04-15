import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'success' | 'danger' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/35 hover:brightness-110',
  success: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25 hover:shadow-lg hover:brightness-110',
  danger: 'bg-red-500 text-white shadow-md shadow-red-500/25 hover:shadow-lg hover:brightness-110',
  outline: 'border border-border bg-surface text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 hover:shadow-sm',
  ghost: 'text-secondary hover:text-primary hover:bg-primary/5',
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-[11px] rounded-lg gap-1',
  md: 'px-3.5 py-1.5 text-xs rounded-lg gap-1.5',
  lg: 'px-5 py-2.5 text-sm rounded-xl gap-2',
};

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none focus-ring ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
