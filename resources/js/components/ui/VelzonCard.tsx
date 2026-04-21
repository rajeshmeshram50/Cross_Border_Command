import { type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   Velzon-style Card primitives
   - VelzonCard: wrapper with optional header (title + actions)
   - VelzonStatCard: small KPI card (label, big number, icon, trend)
   ═══════════════════════════════════════════════════════════════ */

interface VelzonCardProps {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  accent?: string;
}

export function VelzonCard({ title, subtitle, right, children, className = '', bodyClassName = '', accent }: VelzonCardProps) {
  return (
    <div className={`bg-surface border border-border rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden ${className}`}>
      {accent && <div className="h-0.5" style={{ background: accent }} />}
      {(title || right) && (
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="min-w-0">
            {title && <h5 className="text-[13.5px] font-bold text-text truncate">{title}</h5>}
            {subtitle && <p className="text-[10.5px] text-muted mt-0.5 truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1">{right}</div>
        </div>
      )}
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

/* ─── Three-dot action menu button (Velzon signature) ─── */
export function CardMenuButton({ onClick, title = 'Options' }: { onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md text-muted hover:text-primary hover:bg-primary/5 flex items-center justify-center transition-colors cursor-pointer"
    >
      <MoreVertical size={14} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Velzon Stat Card — signature KPI widget
   ═══════════════════════════════════════════════════════════════ */

export type Trend = 'up' | 'down' | 'neutral';

interface VelzonStatCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  iconColor?: string;
  trend?: Trend;
  change?: string;
  changeText?: string;
  accent?: string;
  onClick?: () => void;
}

export function VelzonStatCard({
  label,
  value,
  icon,
  iconColor = '#5A51E8',
  trend = 'neutral',
  change,
  changeText,
  accent,
  onClick,
}: VelzonStatCardProps) {
  const trendColor =
    trend === 'up'   ? 'text-emerald-500'
    : trend === 'down' ? 'text-red-500'
    : 'text-muted';

  const trendBg =
    trend === 'up'   ? 'bg-emerald-500/10'
    : trend === 'down' ? 'bg-red-500/10'
    : 'bg-muted/10';

  const trendArrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '●';

  return (
    <div
      onClick={onClick}
      className={`group relative bg-surface border border-border rounded-lg p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
    >
      {accent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: accent }} />}

      <div className="flex items-start justify-between gap-3">
        {/* Left: label + value + change */}
        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1.5 truncate">{label}</p>
          <h4 className="text-[22px] font-black text-text leading-tight mb-2 truncate">{value}</h4>

          {(change || changeText) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {change && (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${trendBg} ${trendColor}`}>
                  <span className="text-[8px]">{trendArrow}</span>
                  {change}
                </span>
              )}
              {changeText && (
                <span className="text-[10.5px] text-muted truncate">{changeText}</span>
              )}
            </div>
          )}
        </div>

        {/* Right: soft icon box (Velzon signature) */}
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200"
          style={{ backgroundColor: `${iconColor}18`, color: iconColor }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
