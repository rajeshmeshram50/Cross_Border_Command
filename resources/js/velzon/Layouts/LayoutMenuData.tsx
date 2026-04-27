import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { MENU_ITEMS } from "../../constants";

/**
 * Velzon's Layout reads `navdata().props.children` — an array of menu items.
 *
 * Master shows up as a SINGLE flat link in the nav; the `/master` page itself
 * renders all 50 sub-masters as a card grid (filtered by permission).
 * No dropdown in the sidebar/topnav.
 */

const iconMap: Record<string, string> = {
  LayoutGrid: "ri-dashboard-2-line",
  Building2: "ri-building-line",
  CreditCard: "ri-bank-card-line",
  IndianRupee: "ri-money-rupee-circle-line",
  GitBranch: "ri-git-branch-line",
  UserCheck: "ri-user-settings-line",
  ShieldCheck: "ri-shield-check-line",
  Settings: "ri-settings-3-line",
  UserCircle: "ri-account-circle-line",
  Database: "ri-database-2-line",
};

const resolveIcon = (name?: string) => (name && iconMap[name]) || "ri-circle-line";

const slugToPath = (slug: string): string => {
  switch (slug) {
    case "dashboard":   return "/dashboard";
    case "clients":     return "/clients";
    case "plans":       return "/plans";
    case "payments":    return "/payments";
    case "branches":    return "/branches";
    case "employees":   return "/employees";
    case "my-plan":     return "/my-plan";
    case "permissions": return "/permissions";
    case "settings":    return "/settings";
    case "profile":     return "/profile";
    case "master":      return "/master";
    default:            return `/${slug}`;
  }
};

const Navdata = () => {
  const { user } = useAuth();

  const isSuperAdmin = user?.user_type === "super_admin";
  const isClient = user?.user_type === "client_admin" || user?.user_type === "branch_user";
  const planExpiredOrMissing =
    isClient && user?.plan && (!user.plan.has_plan || user.plan.expired);
  const perms = user?.permissions || {};
  // Slugs that are visible purely by role (no per-user grant needed).
  // Dashboard/Profile/My-Plan are always visible to their role;
  // Clients/Plans/Payments/Settings/Permissions are admin-level modules
  // that are never grantable — role alone decides visibility.
  const defaultSlugs = ["dashboard", "profile", "my-plan"];
  const roleOnlySlugs = ["clients", "plans", "payments", "settings", "permissions"];

  // Master is visible if user has at least one master.* permission (any can_view = true)
  const hasAnyMasterView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("master.") && !!perms[slug]?.can_view
    );
  };

  const menuItems: any[] = [];

  // Determine if this branch user is the MAIN branch user. Sub-branch users
  // never see the Permissions menu even though "branch_user" is in its roles
  // list — only main-branch users can manage perms for their own branch.
  const isMainBranchUser = user?.user_type === 'branch_user' && user.is_main_branch === true;

  for (const m of MENU_ITEMS) {
    if (!user || !m.roles.includes(user.user_type)) continue;

    // Permissions menu visible only to: super_admin, client_admin, OR main-branch user
    if (m.id === 'permissions' && user.user_type === 'branch_user' && !isMainBranchUser) {
      continue;
    }

    // Section header
    if (m.section) {
      menuItems.push({ label: m.section, isHeader: true });
      continue;
    }

    // Master → single flat link (no dropdown). Visibility: any master.* view.
    if (m.id === "master") {
      if (!hasAnyMasterView()) continue;
      menuItems.push({
        id: m.id,
        label: m.label,
        icon: resolveIcon(m.icon),
        link: slugToPath(m.id),
      });
      continue;
    }

    // Plain permission-gated items
    if (!isSuperAdmin) {
      if (!defaultSlugs.includes(m.id) && !roleOnlySlugs.includes(m.id)) {
        if (planExpiredOrMissing) continue;
        if (!perms[m.id]?.can_view) continue;
      }
    }

    menuItems.push({
      id: m.id,
      label: m.label,
      icon: resolveIcon(m.icon),
      link: slugToPath(m.id),
    });
  }

  // Drop orphan section headers
  const cleaned: any[] = [];
  for (let i = 0; i < menuItems.length; i++) {
    const it = menuItems[i];
    if (it.isHeader) {
      const next = menuItems[i + 1];
      if (!next || next.isHeader) continue;
    }
    cleaned.push(it);
  }

  return <React.Fragment>{cleaned as any}</React.Fragment>;
};

export default Navdata;
