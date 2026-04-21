import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { MENU_ITEMS } from "../../constants";

/**
 * Velzon's VerticalLayout reads `navdata().props.children` — an array of
 * menu item objects with shape:
 *   { id, label, icon, link, isHeader?, subItems? }
 *
 * We build that shape from CBC's MENU_ITEMS (with role + permission filtering).
 */

// Map CBC icon names (lucide) → Velzon's Remix Icons (ri-*)
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
};

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
  const defaultSlugs = ["dashboard", "profile", "my-plan"];

  const menuItems: any[] = [];

  for (const m of MENU_ITEMS) {
    if (!user || !m.roles.includes(user.user_type)) continue;

    // Section header → Velzon isHeader style
    if (m.section) {
      menuItems.push({
        label: m.section,
        isHeader: true,
      });
      continue;
    }

    // Permissions filter
    if (!isSuperAdmin) {
      if (!defaultSlugs.includes(m.id)) {
        if (planExpiredOrMissing) continue;
        if (!perms[m.id]?.can_view) continue;
      }
    }

    menuItems.push({
      id: m.id,
      label: m.label,
      icon: iconMap[m.icon] || "ri-circle-line",
      link: slugToPath(m.id),
    });
  }

  // Clean up orphan section headers (header with no items below before next header)
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
