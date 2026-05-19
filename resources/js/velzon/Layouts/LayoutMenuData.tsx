import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { MENU_ITEMS, HR_GROUPS, SALES_GROUPS } from "../../constants";
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
  IndianRupee: "ri-secure-payment-line",
  GitBranch: "ri-git-branch-line",
  UserCheck: "ri-user-settings-line",
  ShieldCheck: "ri-shield-check-line",
  Settings: "ri-settings-3-line",
  UserCircle: "ri-account-circle-line",
  Database: "ri-database-2-line",
  Users: "ri-team-line",
  CalendarCheck: "ri-calendar-check-line",
  TrendingUp: "ri-line-chart-line",
  Package: "ri-box-3-line",
  Store:   "ri-store-2-line",
};

const resolveIcon = (name?: string) => (name && iconMap[name]) || "ri-circle-line";

const slugToPath = (slug: string): string => {
  switch (slug) {
    case "dashboard":   return "/dashboard";
    case "clients":     return "/clients";
    case "plans":       return "/plans";
    case "payments":    return "/payments";
    case "clock-in":    return "/clock-in";
    case "branches":    return "/branches";
    case "my-plan":     return "/my-plan";
    case "permissions": return "/permissions";
    case "settings":    return "/settings";
    case "profile":     return "/profile";
    case "master":      return "/master";
    case "hr":          return "/hr";
    case "products":    return "/products";
    case "vendors":     return "/vendors";
    default:            return `/${slug}`;
  }
};

// Most HR leaves don't have dedicated pages yet — they fall back to the hub
// (/hr) so navigation stays graceful. As real per-leaf pages get built, add
// them to the switch below; the rest keep falling back to /hr.
const hrLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "hr.overview":    return "/hr/overview";
    case "hr.employee":    return "/hr/employees";
    case "hr.recruitment": return "/hr/recruitment";
    case "hr.exit":        return "/hr/exit-management";
    case "hr.onboarding":  return "/hr/employee-onboarding";
    case "hr.attendance":  return "/hr/attendance";
    case "hr.broadcast":   return "/hr/broadcast";
    case "hr.doc_templates": return "/hr/doc-templates";
    case "hr.custom_fields": return "/hr/custom-fields";
    case "hr.leave":       return "/hr/leave";
    case "hr.leave_approvals": return "/hr/leave-approvals";
    case "hr.expense":     return "/hr/expense";
    case "hr.payroll":     return "/hr/payroll";
    case "hr.pip":         return "/hr/pip";
    case "hr.calculation_master": return "/hr/calculation-master";
    // Attendance Master Management leaves — these live under the HR sidebar
    // (branch-only) but reuse the generic /master/:slug page shell because
    // they're standard MasterController-backed CRUD masters.
    case "master.leave_type": return "/master/leave_type";
    case "master.leave_plan": return "/master/leave_plan";
    // Trigger Point Master — lives under HR > Document & Evidence but reuses
    // the generic /master/:slug page shell. See masterConfigs.ts.
    case "master.trigger_point": return "/master/trigger_point";
    default:               return "/hr";
  }
};

// Sales Matrix leaves — wire each id to its real React page as it ships.
// Anything not listed falls back to /sales (which routes to /dashboard for
// now since /sales itself isn't built yet).
//
// Note: leaf IDs come from SALES_GROUPS in constants.ts. "sales.workplace"
// is the "My Workplace" sidebar entry and renders the Lead Worksheet page
// (the centerpiece port of the prototype's `lwPage`).
const salesLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "sales.customers":           return "/sales/customers";
    case "sales.consignee":           return "/sales/consignee";
    case "sales.lead_ack_master":     return "/sales/lead-ack-master";
    case "sales.workplace":           return "/sales/lead-worksheet";
    case "sales.analytics":           return "/sales/analytics";
    case "sales.productivity_tracker": return "/sales/todo";
    case "sales.quotation_vs_pi":     return "/sales/qpi";
    case "sales.p2p_summary":         return "/sales/p2p-summary";
    case "sales.diagnosis":           return "/sales/diagnosis";
    case "sales.resolution_center":   return "/sales/resolution-center";
    case "sales.performance":         return "/sales/performance";
    case "sales.lead_distribution":   return "/sales/lead-distribution";
    case "sales.lead_detail":         return "/sales/lead-detail";
    case "sales.enquiries":           return "/sales/enquiries";
    case "sales.leads_details":       return "/sales/leads-details";
    default:                          return "/sales";
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
  // clock-in is added to defaults so it surfaces even when the user has
  // zero module permissions — every employee can clock themselves in.
  const defaultSlugs = ["dashboard", "profile", "my-plan", "clock-in", "products", "vendors"];
  const roleOnlySlugs = ["clients", "plans", "payments", "settings", "permissions"];

  const hasAnyMasterView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("master.") && !!perms[slug]?.can_view
    );
  };

  // Sales Matrix is permission-gated end-to-end: the menu only surfaces if
  // the user has can_view on at least one sales.* leaf, matching the HR
  // pattern. Super_admin / client_admin are already filtered out by the role
  // check on the MENU_ITEMS entry — they hold perm rows only to cascade-grant
  // downstream, never to navigate into Sales themselves.
  const hasAnySalesView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("sales.") && !!perms[slug]?.can_view
    );
  };

  const hasAnyHrView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    // The Attendance Master Management group lives under HR in HR_GROUPS but
    // its leaves use `master.*` ids (so they reuse the generic MasterPage
    // shell). Include them in the "any HR view" check so a branch user with
    // ONLY these perms still sees the HR menu open up.
    const hrAttendanceLeafSlugs = new Set(['master.leave_type', 'master.leave_plan']);
    return Object.keys(perms).some(
      (slug) =>
        (slug.startsWith("hr.") || hrAttendanceLeafSlugs.has(slug)) &&
        !!perms[slug]?.can_view
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

  // Build the Sales Matrix dropdown (3 levels): Sales Matrix → categories →
  // leaves. Mirrors buildHrSubItems — leaves the user cannot view are
  // filtered out, and categories with no remaining leaves are dropped, so the
  // sidebar tree always reflects what was granted on the Permissions sheet.
  const buildSalesSubItems = () => {
    return SALES_GROUPS
      .map((g) => {
        const childItems = g.children
          .filter((c) => isSuperAdmin || perms[c.id]?.can_view)
          .map((c) => ({
            id: c.id,
            label: c.label,
            link: salesLeafLink(c.id),
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
    // Sales Matrix → 3-level nested dropdown, mirroring HR's structure.
    // The /sales hub page doesn't exist yet, so leaves all link to /sales (a
    // no-op until pages get built) and clicking "Sales Matrix" itself just
    // toggles the dropdown open/closed without navigating.
    if (m.id === "sales") {
      if (!hasAnySalesView()) continue;
      const subItems = buildSalesSubItems();
      if (subItems.length === 0) {
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
          // pathPrefix mirrors slugToPath but is rendered as `data-path-prefix`
          // on the trigger so the active-route matcher can highlight the
          // top-level entry when the URL is under /sales/*. We can't use
          // `link` here because the trigger is dropdown-only (clicking must
          // toggle, not navigate) — see the HR comment below.
          pathPrefix: slugToPath(m.id),
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggle(m.id); },
          subItems,
        });
      }
      continue;
    }

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
          // pathPrefix is surfaced as a `data-path-prefix` attribute on the
          // trigger anchor. We can't put `/hr` in `link` because that would
          // re-introduce the flash-open-then-collapse bug documented above —
          // the click handler must purely toggle the dropdown.
          pathPrefix: slugToPath(m.id),
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
