import type { ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   Velzon-style Table primitives
   - Table: wrapper with header row
   - Td: cell with Velzon padding + typography
   ═══════════════════════════════════════════════════════════════ */

interface TableProps {
  headers: string[];
  children: ReactNode;
  /** minWidth of the scrollable table. Default 680px */
  minWidth?: number;
  /** Align column headers: 'left' (default), or per-column string[] */
  align?: ('left' | 'center' | 'right')[];
  className?: string;
}

export function Table({ headers, children, minWidth = 680, align, className = '' }: TableProps) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth }}>
          <thead>
            <tr className="bg-surface-2 border-y border-border">
              {headers.map((h, i) => (
                <th
                  key={h + i}
                  className={`px-3 py-2.5 text-[10px] font-bold tracking-wider uppercase text-secondary whitespace-nowrap ${align?.[i] === 'right' ? 'text-right' : align?.[i] === 'center' ? 'text-center' : 'text-left'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Velzon row: subtle hover, bottom border separator ── */
export function Tr({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-border last:border-b-0 hover:bg-primary/[0.03] transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = '', align }: { children: ReactNode; className?: string; align?: 'left' | 'center' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  return <td className={`px-3 py-2.5 text-[12px] text-secondary whitespace-nowrap ${alignClass} ${className}`}>{children}</td>;
}
