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
  FileInput: "ri-file-download-line",
  KeyRound: "ri-key-2-line",
  Compass:  "ri-compass-3-line",
  ShoppingBag: "ri-shopping-bag-3-line",
  Globe:    "ri-global-line",
  Boxes:    "ri-stack-line",
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
  Wrench: "ri-tools-line",
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
const resolveLeafIcon = (name?: string) => resolveIcon(name).replace(" ms-2", "");

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
  "clm.terms_conditions": "Manage reusable legal Terms and Conditions structures.",
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
  "p2p.service": "Manage services & service catalogue.",
  "p2p.bulk_sourcing": "Manage bulk sourcing requests.",
  "p2p.sourcing_tracker": "Assign sourcing targets and manage Requests for Quotation (RFQs).",
  "p2p.case_to_case": "Manage request-based sourcing.",
  "p2p.order": "Create & track purchase orders.",
  "p2p.invoice": "Capture supplier invoices, match against POs, and track payment.",
  "p2p.payment_request": "Review and action every pending PO payment request.",
  "p2p.advance_refund": "Adjust refunds against advances already released.",
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
    case "p2p":               return "/p2p";
    case "credentials-vault": return "/credentials-vault";
    case "project-navigator": return "/project-navigator";
    case "gts":               return "/gts";
    case "inventory":         return "/inventory";
    case "developers":        return "/developers/shipment";
    default:            return `/${slug}`;
  }
};

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
    case "master.leave_type": return "/master/leave_type";
    case "master.leave_plan": return "/master/leave_plan";
    case "master.trigger_point": return "/master/trigger_point";
    default:               return "/hr";
  }
};

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
    default:                          return "/sales";
  }
};

const p2pLeafLink = (leafId: string): string => {
  switch (leafId) {
    case "p2p.product":       return "/products";
    case "p2p.supplier":      return "/suppliers";
    case "p2p.service":       return "/p2p/service-management";
    case "p2p.sales_summary": return "/sales/p2p-summary";
    case "p2p.analytics":     return "/p2p/analytics";
    case "p2p.diagnosis":     return "/p2p/diagnosis";
    case "p2p.bulk_sourcing": return "/p2p/bulk-sourcing";
    case "p2p.sourcing_tracker": return "/p2p/sourcing-tracker";
    case "p2p.case_to_case":  return "/p2p/case-to-case";
    case "p2p.invoice":       return "/p2p/supplier-purchase-invoice";
    case "p2p.order":         return "/p2p/order";
    case "p2p.payment_request": return "/p2p/payment-request";
    case "p2p.advance_refund":  return "/p2p/advance-refund-adjustment";
    default:                  return "/p2p";
  }
};

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

  if (user?.user_type === "employee" && (user as any)?.onboarding_pending) {
    return (
      <React.Fragment>
        {[{ id: "inbox", label: "Inbox", icon: "ri-inbox-line", link: "/inbox" }] as any}
      </React.Fragment>
    );
  }

  const isOpen = isMenuOpen;
  const toggle = toggleMenu;
  const toggleTop = toggleTopMenu;
  const toggleGroup = toggleGroupMenu;

  const isSuperAdmin = user?.user_type === "super_admin";
  const isTenantUser = user?.user_type === "client_admin"
    || user?.user_type === "client_user"
    || user?.user_type === "branch_user"
    || user?.user_type === "employee";
  const planExpiredOrMissing =
    isTenantUser && user?.plan && (!user.plan.has_plan || user.plan.expired);
  const perms = user?.permissions || {};
  const defaultSlugs = ["dashboard", "profile", "my-plan", "clock-in", "products", "vendors"];
  const roleOnlySlugs = ["clients", "plans", "payments", "settings", "permissions"];

  const hasAnyMasterView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("master.") && !!perms[slug]?.can_view
    );
  };

  const hasAnySalesView = () => {
    if (isSuperAdmin) return true;
    if (planExpiredOrMissing) return false;
    return Object.keys(perms).some(
      (slug) => slug.startsWith("sales.") && !!perms[slug]?.can_view
    );
  };

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
    const hrAttendanceLeafSlugs = new Set(['master.leave_type', 'master.leave_plan']);
    return Object.keys(perms).some(
      (slug) =>
        (slug.startsWith("hr.") || hrAttendanceLeafSlugs.has(slug)) &&
        !!perms[slug]?.can_view
    );
  };

  const hasAnyP2pView = () => moduleVisible(perms, "p2p", isSuperAdmin, planExpiredOrMissing);

  const buildHrSubItems = () => {
    return HR_GROUPS
      .map((g) => {
        const childItems = g.children
          .filter((c) => isSuperAdmin || perms[c.id]?.can_view
            || (c.id === 'hr.devices' && !!perms['hr.attendance']?.can_view)
            || (c.id === 'p2p.advance_refund' && !!perms['p2p.order']?.can_view))
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

  const buildSalesSubItems = () => {
    return SALES_GROUPS
      .map((g) => {
        const childItems = g.children
          .filter((c) => {
            if (isSuperAdmin) return true;
            if (c.id === 'sales.sign_tracker') return !!perms['sales.quotation_vs_pi']?.can_view;
            if (c.id === 'p2p.advance_refund') return !!perms['p2p.order']?.can_view;
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

  const adminMenu: Record<string, string[]> = {
    super_admin: ["dashboard", "clients", "plans", "payments", "master", "permissions", "dev-tools", "settings", "profile"],
    client_admin: ["dashboard", "branches", "master", "permissions", "my-plan", "dev-tools", "profile"],
  };
  const adminAllowed = user ? adminMenu[user.user_type] : undefined;

  for (const m of MENU_ITEMS) {
    if (!user || !m.roles.includes(user.user_type)) continue;
    if (adminAllowed && !m.section && !adminAllowed.includes(m.id)) continue;
    if (m.id === "master" && user.user_type === "client_admin") {
      menuItems.push({ id: m.id, label: m.label, icon: resolveIcon(m.icon), link: slugToPath(m.id) });
      continue;
    }

    if (m.section) {
      menuItems.push({ label: m.section, isHeader: true });
      continue;
    }

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
          pathPrefix: slugToPath(m.id),
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
          subItems,
        });
      }
      continue;
    }

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
          pathPrefix: slugToPath(m.id),
          stateVariables: isOpen(m.id),
          click: (e: any) => { e.preventDefault(); toggleTop(m.id); },
          subItems,
        });
      }
      continue;
    }

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
