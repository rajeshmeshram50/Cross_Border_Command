// `employee` was added when the HR module started provisioning login
// accounts for non-admin staff. They share the same permission/menu
// machinery as branch_users — visibility is decided by the per-module
// permission flags, not by user_type alone. `client_user` was already a
// valid backend type but had been missing from this enum.
export type UserRole = 'super_admin' | 'client_admin' | 'client_user' | 'branch_user' | 'employee';

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
  // Linked Employee row when this login is also an employee record. Both
  // forms are surfaced so the frontend can detect "is the profile I'm
  // viewing my own?" regardless of whether the URL slug carries the
  // numeric Employee.id or the EMP-### emp_code string.
  employee_id?: number | null;
  employee_code?: string | null;
  client_name?: string;
  branch_name?: string;
  client_logo?: string | null;
  branch_logo?: string | null;
  client_profile_photo?: string | null;
  branch_profile_photo?: string | null;
  user_profile_photo?: string | null;
  // Passport-size photo from employee onboarding (employee_documents,
  // document_key='photo'). Set when the login is linked to an Employee row.
  employee_profile_photo?: string | null;
  // Effective tenant theme — server already resolves branch → client fallback,
  // so the frontend just applies these directly. null = use app defaults.
  primary_color?: string | null;
  secondary_color?: string | null;
  is_main_branch?: boolean;
  // Computed server-side: true for any login that should see the My Team
  // dropdown (anyone with direct reports + every branch / client user).
  is_reporting_manager?: boolean;
  has_direct_reports?: boolean;
  // Snapshot count of pending signature tasks (rows where this user is the
  // next signer). Drives the badge on the profile dropdown's Inbox item.
  inbox_count?: number;
  status: string;
  designation?: string;
  phone?: string;
  avatar?: string;
  permissions: Record<string, ModulePermission>;
  plan?: {
    /** Plan id the Super Admin assigned to this client (used to highlight
     *  the recommended plan card on the My Plan / purchase page). */
    suggested_plan_id?: number | null;
    has_plan: boolean;
    expired: boolean;
    plan_name: string | null;
    plan_type: string | null;
    expires_at: string | null;
  };
}

export interface MenuChild {
  id: string;
  icon?: string;
  label: string;
}

export interface MenuGroup {
  id: string;
  label: string;
  icon?: string;
  children: MenuChild[];
}

export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  badge?: string;
  section?: string;
  roles: UserRole[];
  /**
   * When present, this item is a parent with a dropdown submenu.
   * Each group represents a category; each child has its own permission slug.
   */
  groups?: MenuGroup[];
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
  // Letterhead / export-house compliance fields — all optional, surface
  // on the Quotation/PI PDF when populated. Mirrors the columns
  // added by 2026_05_26_000100_add_letterhead_fields_to_branches_table.
  gst_state_code: string | null;
  cin: string | null;
  iec: string | null;
  drug_license: string | null;
  pcpndt_no: string | null;
  aeo_code: string | null;
  one_star_file_no: string | null;
  one_star_udin_no: string | null;
  // Authorized-signatory image (signature + stamp). Used by the
  // with-signature variant of Quotation / PI PDFs. The model also
  // exposes `signature_path_url` as an accessor so the frontend can
  // render the image directly without re-resolving the storage path.
  signature_path: string | null;
  signature_path_url?: string | null;
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
