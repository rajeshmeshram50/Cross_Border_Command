import type { LucideIcon } from 'lucide-react';

type Color = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'sky';

const iconBg: Record<Color, string> = {
  blue: 'bg-indigo-500/10 text-indigo-500',
  green: 'bg-emerald-500/10 text-emerald-500',
  amber: 'bg-amber-500/10 text-amber-500',
  red: 'bg-red-500/10 text-red-500',
  purple: 'bg-purple-500/10 text-purple-500',
  sky: 'bg-sky-500/10 text-sky-500',
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
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-default">
      <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 ${iconBg[color]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">{label}</div>
        <div className="text-xl font-extrabold text-text tracking-tight">{value}</div>
        {change && (
          <div className={`text-[10.5px] font-semibold mt-0.5 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
            {up ? '↑' : '↓'} {change}
          </div>
        )}
      </div>
    </div>
  );
}
