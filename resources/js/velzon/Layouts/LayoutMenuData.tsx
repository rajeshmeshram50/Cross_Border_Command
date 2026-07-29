import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { MENU_ITEMS, HR_GROUPS, SALES_GROUPS, CLM_GROUPS, P2P_GROUPS } from "../../constants";
import { isMenuOpen, toggleMenu, toggleTopMenu, toggleGroupMenu } from "./menuState";
import { moduleVisible } from "../../utils/menuAccess";

const iconMap: Record<string, string> = {
  LayoutGrid: "ri-dashboard-2-line ms-2",
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
  FileText: "ri-file-text-line",
  KeyRound: "ri-key-2-line",
  Compass:  "ri-compass-3-line",
  ShoppingBag: "ri-shopping-bag-3-line",
  Globe:    "ri-global-line",
  Boxes:    "ri-stack-line",
  // Sub-menu (leaf) icons — lucide names declared on *_GROUPS children,
  // mapped to the sidebar's Remix icon set so sub-items can show a tile.
  LayoutDashboard: "ri-dashboard-3-line",
  BarChart3: "ri-bar-chart-2-line",
  BarChart4: "ri-bar-chart-box-line",
  ClipboardCheck: "ri-task-line",
  UserSquare: "ri-account-box-line",
  Truck: "ri-truck-line",
  BadgeCheck: "ri-verified-badge-line",
  Activity: "ri-pulse-line",
  Tag: "ri-price-tag-3-line",
  UserPlus: "ri-user-add-line",
  User: "ri-user-3-line",
  LogOut: "ri-logout-box-r-line",
  CalendarOff: "ri-calendar-close-line",
  CalendarDays: "ri-calendar-event-line",
  Receipt: "ri-bill-line",
  Megaphone: "ri-megaphone-line",
  Star: "ri-star-line",
  Zap: "ri-flashlight-line",
  Stethoscope: "ri-stethoscope-line",
  Send: "ri-send-plane-line",
  CheckCircle: "ri-checkbox-circle-line",
  Award: "ri-award-line",
  CheckSquare: "ri-checkbox-line",
  Search: "ri-search-line",
  FileBadge: "ri-file-shield-2-line",
  PenSquare: "ri-edit-box-line",
  Hexagon: "ri-hexagon-line",
  List: "ri-list-check",
  BookOpen: "ri-book-open-line",
};

const resolveIcon = (name?: string) => (name && iconMap[name]) || "ri-circle-line";
// Leaf icon used inside a sub-menu tile — same map, minus the ms-2 spacer the
// top-level Dashboard entry carries (which would push the glyph off-centre in
// the centred tile).
const resolveLeafIcon = (name?: string) => resolveIcon(name).replace(" ms-2", "");

// Short description shown under each sub-menu leaf — mirrors IdimsHeader's
// LEAF_DESC so the sidebar and the horizontal mega-menu read identically.
// Keep in sync when adding a menu leaf.
const LEAF_DESC: Record<string, string> = {
  "sales.analytics": "Sales dashboard, Diagnosis View & Resolution Center.",
  "sales.productivity_tracker": "Manage reminders, meetings & to-do activities.",
  "sales.customers": "Manage customer master records.",
  "sales.consignee": "Manage consignee master records.",
  "sales.lead_ack_master": "Manage Lead Acknowledgement reasons.",
  "sales.workplace": "Manage active sales opportunities.",
  "sales.quotation_vs_pi": "Track quotation & PI conversion history.",
  "sales.sign_tracker": "Track all documents sent for e-signature.",
  "clm.analytics": "Track contract KPIs & legal performance.",
  "clm.diagnosis_resolution": "Diagnose contract risks & drive resolution actions.",
  "clm.regulatory_defense": "Read-only regulatory defense file repository.",
  "clm.buyer_profile": "Manage Customer onboarding & agreements.",
  "clm.supplier_profile": "Manage supplier contracts & compliance.",
  "clm.case_to_case": "Manage one-time operational contracts.",
  "clm.agreements_sent": "Track agreements sent for approval.",
  "clm.agreements_to_approve": "Review and approve received agreements.",
  "clm.segment": "Manage segment-wise contract structures.",
  "clm.authority": "Manage certifying & issuing authorities.",
  "clm.quality_docs": "Manage QC & compliance documents.",
  "clm.kyc": "Manage customer & vendor KYC records.",
  "clm.due_diligence": "Manage risk verification processes.",
  "clm.trade_licenses": "Manage statutory license documents.",
  "clm.document_panel": "Manage document rules & governance.",
  "clm.trade_documents": "Manage declarations & trade papers.",
  "clm.agreements": "Manage agreement templates & masters.",
  "clm.terms_conditions": "Manage reusable legal T&C structures.",
  "clm.clause_library": "Manage reusable legal clauses.",
  "hr.overview": "Headcount, joinings, exits & headline KPIs.",
  "hr.pip": "Performance improvement plans.",
  "hr.reports": "HR reports & analytics.",
  "hr.recruitment": "Campaigns & candidate sourcing.",
  "hr.employee": "Employee master, documents & permissions.",
  "hr.onboarding": "Onboarding invites & profile capture.",
  "hr.exit": "Exit & full-and-final processing.",
  "hr.payroll": "Salary structures & payroll runs.",
  "hr.attendance": "Face attendance & punch records.",
  "hr.devices": "Biometric device terminals (eSSL).",
  "hr.leave": "Leave requests & balances.",
  "hr.leave_approvals": "Approve or reject leave requests.",
  "hr.holiday": "Company holiday calendar.",
  "hr.expense": "Expense claims & advances.",
  "hr.broadcast": "Company-wide announcements.",
  "hr.doc_templates": "Role-based document templates.",
  "hr.custom_fields": "Tenant-defined custom fields.",
  "master.trigger_point": "Lifecycle trigger modules.",
  "master.leave_type": "Leave categories master.",
  "master.leave_plan": "Leave plans & assignments.",
  "p2p.analytics": "Procurement KPIs & insights.",
  "p2p.diagnosis": "Identify and resolve procurement issues.",
  "p2p.sales_summary": "Track sourcing performance.",
  "p2p.product": "Manage products & sourcing readiness.",
  "p2p.supplier": "Manage supplier onboarding & compliance.",
  "p2p.bulk_sourcing": "Manage bulk sourcing requests.",
  "p2p.case_to_case": "Manage request-based sourcing.",
  "p2p.po": "Create & track purchase orders.",
  "p2p.spi": "Process supplier invoices & taxes.",
  "p2p.debit_note": "Issue & track supplier debit notes for returns & adjustments.",
};

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
    case "vendors":     return "/suppliers";
    // New top-level header modules. P2P reuses the existing Sales P2P
    // Summary page; the rest render the shared permission-gated stub.
    case "p2p":               return "/p2p";
    case "credentials-vault": return "/credentials-vault";
    case "project-navigator": return "/project-navigator";
    case "gts":               return "/gts";
    case "inventory":         return "/inventory";
    case "developers":        return "/developers/shipment";
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
    case "hr.devices":     return "/hr/devices";
    case "hr.broadcast":   return "/hr/broadcast";
    case "hr.doc_templates": return "/hr/doc-templates";
    case "hr.custom_fields": return "/hr/custom-fields";
    case "hr.leave":       return "/hr/leave";
    case "hr.leave_approvals": return "/hr/leave-approvals";
    case "hr.holiday":     return "/hr/holiday";
    case "hr.expense":     return "/hr/expense";
    case "hr.payroll":     return "/hr/payroll";
    case "hr.pip":         return "/hr/pip";
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
    case "sales.sign_tracker":        return "/sales/sign-tracker";
    case "sales.p2p_summary":         return "/sales/p2p-summary";
    case "sales.diagnosis":           return "/sales/diagnosis";
    case "sales.resolution_center":   return "/sales/resolution-center";
    case "sales.performance":         return "/sales/performance";
    /* Lead Distribution / Lead Detail / Enquiries / Leads Details were
     * removed from the menu (May-26 cleanup). Their cases are gone too
     * — any stale link falls through to the /sales default. */
    default:                          return "/sales";
  }
};

// Procure to Pay (P2P) leaves → routes. Product/Supplier reuse the existing
// masters; Sales Summary the P2P summary page. The rest are under development
// and land on the P2P hub until their own pages ship (mirrors p2pLeafPath in
// IdimsHeader).
const p2pLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "p2p.product":       return "/products";
    case "p2p.supplier":      return "/suppliers";
    case "p2p.sales_summary": return "/sales/p2p-summary";
    case "p2p.analytics":     return "/p2p/analytics";
    case "p2p.diagnosis":     return "/p2p/diagnosis";
    case "p2p.bulk_sourcing": return "/p2p/bulk-sourcing";
    case "p2p.case_to_case":  return "/p2p/case-to-case";
    case "p2p.po":            return "/p2p/purchase-order";
    case "p2p.spi":           return "/p2p/supplier-purchase-invoice";
    case "p2p.debit_note":    return "/p2p/debit-note";
    default:                  return "/p2p";
  }
};

// Central CLM leaves — every leaf currently routes to the same stub page
// (/clm/<dash-slug>). The slug after /clm/ is what ClmStubPage reads to
// render the right title + breadcrumb. As real pages ship, swap each
// case to its dedicated route.
const clmLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "clm.analytics":             return "/clm/analytics";
    case "clm.diagnosis_resolution":  return "/clm/diagnosis-resolution";
    case "clm.regulatory_defense":    return "/clm/regulatory-defense";
    case "clm.buyer_profile":         return "/clm/buyer-profile";
    case "clm.supplier_profile":      return "/clm/supplier-profile";
    case "clm.case_to_case":          return "/clm/case-to-case";
    case "clm.agreements_sent":       return "/clm/agreements-sent";
    case "clm.agreements_to_approve": return "/clm/agreements-to-approve";
    case "clm.segment":               return "/clm/segment";
    case "clm.authority":             return "/clm/authority";
    case "clm.quality_docs":          return "/clm/quality-docs";
    case "clm.kyc":                   return "/clm/kyc";
    case "clm.due_diligence":         return "/clm/due-diligence";
    case "clm.trade_licenses":        return "/clm/trade-licenses";
    case "clm.document_panel":        return "/clm/document-panel";
    case "clm.trade_documents":       return "/clm/trade-documents";
    case "clm.agreements":            return "/clm/agreements";
    case "clm.terms_conditions":      return "/clm/terms-conditions";
    case "clm.clause_library":        return "/clm/clause-library";
    default:                          return "/clm";
  }
};

const Navdata = () => {
  const { user } = useAuth();

  // Onboarding gate — an employee whose onboarding isn't finished yet may only
  // reach the Inbox (to sign their pending documents). Hide every other nav
  // item until HR completes onboarding and `onboarding_pending` clears. Mirror
  // of the route guard in App.tsx so the navbar can't even offer a dead link.
  if (user?.user_type === "employee" && (user as any)?.onboarding_pending) {
    return (
      <React.Fragment>
        {[{ id: "inbox", label: "Inbox", icon: "ri-inbox-line", link: "/inbox" }] as any}
      </React.Fragment>
    );
  }

  // Collapse state for HR parent + categories lives in a module-level Set
  // (see ./menuState). Necessary because Navdata is called as a function from
  // VerticalLayout — `useState` here resets on every parent render. The Layout
  // re-renders via `subscribeMenu()` whenever `toggleMenu()` fires.
  const isOpen = isMenuOpen;
  const toggle = toggleMenu;
  const toggleTop = toggleTopMenu;
  const toggleGroup = toggleGroupMenu;

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

  // Central CLM is now permission-gated end-to-end, matching HR + Sales: the
  // menu only surfaces if the user holds can_view on at least one clm.* leaf.
  // (The rollout bypass that surfaced CLM for every branch_user / employee
  // regardless of grants has been removed — visibility follows the Permissions
  // sheet just like the other modules.)
  const hasAnyClmView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("clm.") && !!perms[slug]?.can_view
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

  // P2P is a PARENT module with a real p2p.* leaf subtree, so permission rows
  // live on the leaves — perms['p2p'] (the parent slug) is never saved. Gate on
  // any p2p.* leaf view, mirroring HR/Sales/CLM above.
  // Shared rule (see utils/menuAccess) so the sidebar and header never drift.
  const hasAnyP2pView = () => moduleVisible(perms, "p2p", isSuperAdmin, planExpiredOrMissing);

  // Build the HR dropdown (3 levels): HR → categories → leaves.
  // Each category becomes a `subItem` with `isChildItem:true` so Velzon's
  // VerticalLayouts renderer expands it as a collapsible group with its own
  // childItems[]. Leaves the user cannot view are filtered out; categories
  // with no remaining leaves are dropped entirely.
  const buildHrSubItems = () => {
    return HR_GROUPS
      .map((g) => {
        const childItems = g.children
          // hr.devices rides on the hr.attendance grant (no separate permission
          // leaf) — same pattern as sales.sign_tracker.
          .filter((c) => isSuperAdmin || perms[c.id]?.can_view
            || (c.id === 'hr.devices' && !!perms['hr.attendance']?.can_view))
          .map((c) => ({
            id: c.id,
            label: c.label,
            link: hrLeafLink(c.id),
            icon: resolveLeafIcon((c as any).icon),
            desc: LEAF_DESC[c.id],
          }));
        if (childItems.length === 0) return null;
        return {
          id: g.id,
          label: g.label,
          isChildItem: true,
          stateVariables: isOpen(g.id),
          click: (e: any) => { e.preventDefault(); toggleGroup(g.id); },
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
          .filter((c) => {
            if (isSuperAdmin) return true;
            // Sign Document Tracker has no permission slug of its own — it's a
            // read-only view of the same Quotation/PI/agreement sign requests,
            // so it rides on the Quotation Vs PI permission.
            if (c.id === 'sales.sign_tracker') return !!perms['sales.quotation_vs_pi']?.can_view;
            return !!perms[c.id]?.can_view;
          })
          .map((c) => ({
            id: c.id,
            label: c.label,
            link: salesLeafLink(c.id),
            icon: resolveLeafIcon((c as any).icon),
            desc: LEAF_DESC[c.id],
          }));
        if (childItems.length === 0) return null;
        return {
          id: g.id,
          label: g.label,
          isChildItem: true,
          stateVariables: isOpen(g.id),
          click: (e: any) => { e.preventDefault(); toggleGroup(g.id); },
          childItems,
        };
      })
      .filter(Boolean);
  };

  // Central CLM dropdown (3 levels): CLM → categories → leaves. Same shape
  // as buildSalesSubItems — leaves the user cannot view are filtered out and
  // categories with no remaining leaves are dropped, so the sidebar tree
  // always reflects exactly what was granted on the Permissions sheet.
  const buildClmSubItems = () => {
    return CLM_GROUPS
      .map((g) => {
        const childItems = g.children
          .filter((c) => isSuperAdmin || perms[c.id]?.can_view)
          .map((c) => ({
            id: c.id,
            label: c.label,
            link: clmLeafLink(c.id),
            icon: resolveLeafIcon((c as any).icon),
            desc: LEAF_DESC[c.id],
          }));
        if (childItems.length === 0) return null;
        return {
          id: g.id,
          label: g.label,
          isChildItem: true,
          stateVariables: isOpen(g.id),
          click: (e: any) => { e.preventDefault(); toggleGroup(g.id); },
          childItems,
        };
      })
      .filter(Boolean);
  };

  // Procure to Pay (P2P) dropdown (3 levels): P2P → categories → leaves.
  // The menu surfaces when the user holds any p2p.* leaf view (hasAnyP2pView);
  // once in, every leaf shows — matching the header mega-menu. Built from the
  // shared P2P_GROUPS so both menus stay in sync.
  const buildP2pSubItems = () => {
    return P2P_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      isChildItem: true,
      stateVariables: isOpen(g.id),
      click: (e: any) => { e.preventDefault(); toggleGroup(g.id); },
      childItems: g.children.map((c) => ({
        id: c.id,
        label: c.label,
        link: p2pLeafLink(c.id),
        icon: resolveLeafIcon((c as any).icon),
        desc: LEAF_DESC[c.id],
      })),
    }));
  };

  const menuItems: any[] = [];

  for (const m of MENU_ITEMS) {
    if (!user || !m.roles.includes(user.user_type)) continue;

    // Permissions menu is visible to every branch_user. A branch user can
    // grant module access to employees in their own branch — see
    // PermissionController::manageableUsers / savePermissions for the
    // back-end scope guards (every branch is an isolated peer).

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
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
          subItems,
        });
      }
      continue;
    }

    // Central CLM → 3-level nested dropdown. Same trigger semantics as
    // Sales Matrix: clicking the parent toggles the dropdown only (no
    // navigation), and the active-route highlight is driven by the
    // `pathPrefix` data-attribute so any /clm/* URL keeps the parent lit.
    if (m.id === "clm") {
      if (!hasAnyClmView()) continue;
      const subItems = buildClmSubItems();
      if (subItems.length === 0) {
        menuItems.push({
          id: m.id,
          label: m.label,
          icon: resolveIcon(m.icon),
          link: "/clm",
        });
      } else {
        menuItems.push({
          id: m.id,
          label: m.label,
          icon: resolveIcon(m.icon),
          pathPrefix: "/clm",
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
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
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
          subItems,
        });
      }
      continue;
    }

    // Developers → single flat link to its only leaf (Shipment / Business
    // Task). The permission lives on the LEAF slug `developers.shipment`, not
    // the parent `developers`, so gate on that (the generic fallback below
    // would wrongly check perms['developers']).
    if (m.id === "developers") {
      if (!isSuperAdmin && (planExpiredOrMissing || !perms["developers.shipment"]?.can_view)) continue;
      menuItems.push({
        id: m.id,
        label: m.label,
        icon: resolveIcon(m.icon),
        link: slugToPath(m.id),
      });
      continue;
    }

    // Procure to Pay (P2P) → 3-level nested dropdown like Sales/CLM/HR. Gated on
    // any p2p.* leaf view (perms['p2p'] is a parent slug and never saved); once
    // in, every leaf shows (matches the header mega-menu). Clicking the parent
    // only toggles the dropdown.
    if (m.id === "p2p") {
      if (!hasAnyP2pView()) continue;
      const subItems = buildP2pSubItems();
      if (subItems.length === 0) {
        menuItems.push({ id: m.id, label: m.label, icon: resolveIcon(m.icon), link: slugToPath(m.id) });
      } else {
        menuItems.push({
          id: m.id,
          label: m.label,
          icon: resolveIcon(m.icon),
          pathPrefix: slugToPath(m.id),
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
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
