import { Loader2 } from 'lucide-react';

interface LoaderProps {
  size?: number;
  text?: string;
  variant?: 'block' | 'inline';
  className?: string;
}

export default function Loader({ size = 20, text = 'Loading...', variant = 'block', className = '' }: LoaderProps) {
  const wrapper = variant === 'inline' ? 'inline-flex' : 'flex';
  const padding = variant === 'inline' ? 'py-0 px-0' : 'py-10';

  return (
    <div className={`${wrapper} items-center justify-center gap-3 text-secondary ${padding} ${className}`}>
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border bg-surface text-primary shadow-sm">
        <Loader2 size={size} className="animate-spin" />
      </div>
      {text && <span className="text-sm font-medium text-secondary">{text}</span>}
    </div>
  );
}
