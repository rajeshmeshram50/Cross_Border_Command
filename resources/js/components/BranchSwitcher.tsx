import { useAuth } from '../contexts/AuthContext';
import { Building2 } from 'lucide-react';

export default function BranchSwitcher() {
  const { user } = useAuth();

  if (!user || user.user_type === 'super_admin') return null;

  // Client Admins and Client Users operate at the tenant (whole-client) level
  // — they see every branch's data by default and don't need a per-branch
  // filter cluttering the topbar. Hide the switcher entirely for them. The
  // default selectedBranchId for these roles is null (= "All Branches"), so
  // API calls already return cross-branch data without any UI control.
  if (user.user_type === 'client_admin' || user.user_type === 'client_user') return null;

  // Branch users and employees are hard-locked to their assigned branch —
  // every branch is an isolated peer, so there's no cross-branch switching.
  // Render a static read-only badge so the user can still see WHICH branch
  // they're scoped to, but cannot change it.
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
