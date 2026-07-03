import { useAuth } from '../contexts/AuthContext';
import { Building2 } from 'lucide-react';

export default function BranchSwitcher() {
  const { user } = useAuth();

  if (!user || user.user_type === 'super_admin') return null;

  if (user.user_type === 'client_admin' || user.user_type === 'client_user') return null;

  
  const isEmployeeRole = user.user_type === 'employee';
  return (
    <div
      className="branch-switcher-pill flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-[12px] font-medium text-text"
      title={isEmployeeRole ? 'Branch switching is not available for employees' : undefined}
    >
      <Building2 size={13} className="text-primary" />
      <span className="max-w-[160px] truncate">{user.branch_name || 'My Branch'}</span>
    </div>
  );
}
