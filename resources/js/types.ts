export type UserRole = 'super_admin' | 'client_admin' | 'branch_user';

export interface ModulePermission {
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  can_import: boolean;
  can_approve: boolean;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  user_type: UserRole;
  initials: string;
  client_id?: number;
  branch_id?: number;
  client_name?: string;
  branch_name?: string;
  status: string;
  designation?: string;
  phone?: string;
  avatar?: string;
  permissions: Record<string, ModulePermission>;
}

export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  badge?: string;
  section?: string;
  roles: UserRole[];
}

export interface Client {
  id: number;
  org_name: string;
  unique_number: string;
  email: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  pincode: string | null;
  country: string | null;
  org_type: string;
  sports: string | null;
  industry: string | null;
  gst_number: string | null;
  pan_number: string | null;
  plan_id: number | null;
  plan_type: string;
  status: string;
  plan_expires_at: string | null;
  primary_color: string;
  secondary_color: string;
  logo: string | null;
  favicon: string | null;
  notes: string | null;
  created_by: number | null;
  branches_count?: number;
  users_count?: number;
  plan?: { id: number; name: string; price: number };
  created_at: string;
}

export interface Branch {
  id: number;
  client_id: number;
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  contact_person: string | null;
  branch_type: string | null;
  industry: string | null;
  description: string | null;
  gst_number: string | null;
  pan_number: string | null;
  registration_number: string | null;
  logo: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  taluka: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  is_main: boolean;
  max_users: number;
  established_at: string | null;
  status: string;
  notes: string | null;
  users_count?: number;
  departments_count?: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}
