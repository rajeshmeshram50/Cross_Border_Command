import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type Color = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'sky';

const iconBg: Record<Color, string> = {
  blue: 'bg-indigo-500/10 text-indigo-500',
  green: 'bg-emerald-500/10 text-emerald-500',
  amber: 'bg-amber-500/10 text-amber-500',
  red: 'bg-red-500/10 text-red-500',
  purple: 'bg-purple-500/10 text-purple-500',
  sky: 'bg-sky-500/10 text-sky-500',
};

const iconBorder: Record<Color, string> = {
  blue: 'group-hover:border-indigo-200',
  green: 'group-hover:border-emerald-200',
  amber: 'group-hover:border-amber-200',
  red: 'group-hover:border-red-200',
  purple: 'group-hover:border-purple-200',
  sky: 'group-hover:border-sky-200',
};

interface Props {
  icon: LucideIcon;
  color: Color;
  label: string;
  value: string | number;
  change?: string;
  up?: boolean;
}

export default function StatCard({ icon: Icon, color, label, value, change, up }: Props) {
  return (
    <div className={`group bg-surface border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-default ${iconBorder[color]}`}>
      <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${iconBg[color]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">{label}</div>
        <div className="text-xl font-extrabold text-text tracking-tight">{value}</div>
        {change && (
          <div className={`text-[10.5px] font-semibold mt-0.5 flex items-center gap-1 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
            {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {change}
          </div>
        )}
      </div>
    </div>
  );
}
