import type { MenuItem } from './types';

export const MENU_ITEMS: MenuItem[] = [
  { id: '', section: 'MAIN', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard', roles: ['super_admin', 'client_admin', 'branch_user'] },

  { id: '', section: 'MANAGEMENT', label: '', icon: '', roles: ['super_admin'] },
  { id: 'clients', icon: 'Building2', label: 'Clients', roles: ['super_admin'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['super_admin'] },
  { id: 'plans', icon: 'CreditCard', label: 'Plans', roles: ['super_admin'] },
  { id: 'payments', icon: 'IndianRupee', label: 'Payments', roles: ['super_admin'] },

  { id: '', section: 'OPERATIONS', label: '', icon: '', roles: ['client_admin', 'branch_user'] },
  { id: 'branches', icon: 'GitBranch', label: 'Branches', roles: ['client_admin'] },
  { id: 'employees', icon: 'UserCheck', label: 'Employees', roles: ['client_admin', 'branch_user'] },

  { id: '', section: 'ACCESS CONTROL', label: '', icon: '', roles: ['super_admin', 'client_admin'] },
  { id: 'permissions', icon: 'ShieldCheck', label: 'Permissions', roles: ['super_admin', 'client_admin'] },

  { id: '', section: 'SYSTEM', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  { id: 'settings', icon: 'Settings', label: 'Settings', roles: ['super_admin'] },
  { id: 'profile', icon: 'UserCircle', label: 'Profile', roles: ['super_admin', 'client_admin', 'branch_user'] },
];
