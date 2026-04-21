import { type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  iconColor?: string;
  actions?: ReactNode;
}

/* Velzon-style page title box */
export function PageHeader({ title, subtitle, icon, iconColor = 'var(--color-primary)', actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${iconColor}18`, color: iconColor }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold text-text tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-[11.5px] text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
