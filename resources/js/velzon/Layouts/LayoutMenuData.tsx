import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { MENU_ITEMS, HR_GROUPS } from "../../constants";
import { isMenuOpen, toggleMenu } from "./menuState";

/**
 * Velzon's vertical Layout reads `navdata().props.children` — an array of
 * menu items. Items with `subItems` render as collapsible dropdowns; items
 * with `subItems[].isChildItem` + `childItems` render as nested 3-level
 * dropdowns (matching Velzon's stock support — see VerticalLayouts/index.tsx).
 *
 * Master shows up as a SINGLE flat link in the nav; the `/master` page itself
 * renders all 50 sub-masters as a card grid.
 *
 * HR has TWO views: a 3-level NESTED DROPDOWN in the sidebar (showing all 6
 * categories with their leaves, like the IDIMS mega-menu), AND a hub page at
 * `/hr` that shows the same content as a card grid (like /master). Clicking
 * "HR" itself in the sidebar navigates to /hr; clicking the chevron expands
 * the dropdown.
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
  Users: "ri-team-line",
};

const resolveIcon = (name?: string) => (name && iconMap[name]) || "ri-circle-line";

const slugToPath = (slug: string): string => {
  switch (slug) {
    case "dashboard":   return "/dashboard";
    case "clients":     return "/clients";
    case "plans":       return "/plans";
    case "payments":    return "/payments";
    case "branches":    return "/branches";
    case "my-plan":     return "/my-plan";
    case "permissions": return "/permissions";
    case "settings":    return "/settings";
    case "profile":     return "/profile";
    case "master":      return "/master";
    case "hr":          return "/hr";
    default:            return `/${slug}`;
  }
};

// Most HR leaves don't have dedicated pages yet — they fall back to the hub
// (/hr) so navigation stays graceful. As real per-leaf pages get built, add
// them to the switch below; the rest keep falling back to /hr.
const hrLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "hr.employee":    return "/hr/employees";
    case "hr.recruitment": return "/hr/recruitment";
    case "hr.exit":        return "/hr/exit-management";
    case "hr.onboarding":  return "/hr/employee-onboarding";
    case "hr.attendance":  return "/hr/attendance";
    default:               return "/hr";
  }
};

const Navdata = () => {
  const { user } = useAuth();

  // Collapse state for HR parent + categories lives in a module-level Set
  // (see ./menuState). Necessary because Navdata is called as a function from
  // VerticalLayout — `useState` here resets on every parent render. The Layout
  // re-renders via `subscribeMenu()` whenever `toggleMenu()` fires.
  const isOpen = isMenuOpen;
  const toggle = toggleMenu;

  const isSuperAdmin = user?.user_type === "super_admin";
  // Any non-super tenant user — they all inherit the org's plan, so an
  // expired plan blocks all of them equally. Includes employees + client
  // users that were previously omitted.
  const isTenantUser = user?.user_type === "client_admin"
    || user?.user_type === "client_user"
    || user?.user_type === "branch_user"
    || user?.user_type === "employee";
  const planExpiredOrMissing =
    isTenantUser && user?.plan && (!user.plan.has_plan || user.plan.expired);
  const perms = user?.permissions || {};
  const defaultSlugs = ["dashboard", "profile", "my-plan"];
  const roleOnlySlugs = ["clients", "plans", "payments", "settings", "permissions"];

  const hasAnyMasterView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("master.") && !!perms[slug]?.can_view
    );
  };

  const hasAnyHrView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("hr.") && !!perms[slug]?.can_view
    );
  };

  // Build the HR dropdown (3 levels): HR → categories → leaves.
  // Each category becomes a `subItem` with `isChildItem:true` so Velzon's
  // VerticalLayouts renderer expands it as a collapsible group with its own
  // childItems[]. Leaves the user cannot view are filtered out; categories
  // with no remaining leaves are dropped entirely.
  const buildHrSubItems = () => {
    return HR_GROUPS
      .map((g) => {
        const childItems = g.children
          .filter((c) => isSuperAdmin || perms[c.id]?.can_view)
          .map((c) => ({
            id: c.id,
            label: c.label,
            link: hrLeafLink(c.id),
          }));
        if (childItems.length === 0) return null;
        return {
          id: g.id,
          label: g.label,
          isChildItem: true,
          stateVariables: isOpen(g.id),
          click: (e: any) => { e.preventDefault(); toggle(g.id); },
          childItems,
        };
      })
      .filter(Boolean);
  };

  const menuItems: any[] = [];

  const isMainBranchUser = user?.user_type === 'branch_user' && user.is_main_branch === true;

  for (const m of MENU_ITEMS) {
    if (!user || !m.roles.includes(user.user_type)) continue;

    if (m.id === 'permissions' && user.user_type === 'branch_user' && !isMainBranchUser) {
      continue;
    }

    if (m.section) {
      menuItems.push({ label: m.section, isHeader: true });
      continue;
    }

    // Master → single flat link
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

    // HR → pure 3-level nested dropdown. Clicking the parent toggles the
    // dropdown only (no navigation). The /hr hub page is still reachable
    // through any leaf — they all route to /hr via hrLeafLink. Mixing a real
    // link with `data-bs-toggle="collapse"` caused the submenu to flash open
    // then immediately collapse: the path change triggered the layout's
    // initMenu() effect which strips `.show` off active menu-link siblings,
    // and Reactstrap's Collapse never re-applied it because its isOpen state
    // hadn't changed.
    if (m.id === "hr") {
      if (!hasAnyHrView()) continue;
      const subItems = buildHrSubItems();
      if (subItems.length === 0) {
        // Defensive fallback: hub-only link (no dropdown)
        menuItems.push({
          id: m.id,
          label: m.label,
          icon: resolveIcon(m.icon),
          link: slugToPath(m.id),
        });
      } else {
        menuItems.push({
          id: m.id,
          label: m.label,
          icon: resolveIcon(m.icon),
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggle(m.id); },
          subItems,
        });
      }
      continue;
    }

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
