import type { HTMLAttributes } from 'react';

interface ShimmerProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'table' | 'list';
  count?: number;
  rows?: number;
  columns?: number;
}

const shimmerBase = 'rounded-2xl bg-surface-2 overflow-hidden border border-border';
const shimmerBlock = 'h-3.5 rounded-full bg-surface animate-shimmer';

export default function Shimmer({ variant = 'card', count = 3, rows = 4, columns = 4, className = '', ...props }: ShimmerProps) {
  if (variant === 'table') {
    return (
      <div className={`${shimmerBase} ${className}`} {...props}>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: columns }).map((_, index) => (
              <div key={index} className={`${shimmerBlock} h-4`} />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-4 gap-3">
              {Array.from({ length: columns }).map((_, colIndex) => (
                <div key={colIndex} className={`${shimmerBlock} h-10`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={`${shimmerBase} ${className}`} {...props}>
        <div className="space-y-3 p-4">
          {Array.from({ length: count }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-surface animate-shimmer" />
              <div className="flex-1 space-y-2">
                <div className={`${shimmerBlock} w-3/5`} />
                <div className={`${shimmerBlock} w-2/5`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`${shimmerBase} ${className}`} {...props}>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="space-y-4 p-4 rounded-3xl border border-border bg-white/80 shadow-sm">
            <div className="h-40 rounded-3xl bg-surface animate-shimmer" />
            <div className="space-y-2">
              <div className={`${shimmerBlock} w-2/3`} />
              <div className={`${shimmerBlock} w-1/2`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={`${shimmerBlock} h-9`} />
              <div className={`${shimmerBlock} h-9`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
