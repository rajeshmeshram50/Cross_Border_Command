import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { moduleVisible } from '../../utils/menuAccess';
import { useTheme } from '../../contexts/ThemeContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { SALES_GROUPS, CLM_GROUPS, HR_GROUPS, P2P_GROUPS } from '../../constants';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import logoFallback from '../assets/images/igc-logo.png';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Resolve a lucide icon component by its name (the menu groups carry icon
// names like 'BarChart3', 'UserSquare', 'Truck'). Falls back to Circle.
const getLucide = (name?: string): LucideIcon =>
  (name && (LucideIcons as unknown as Record<string, LucideIcon>)[name]) || LucideIcons.Circle;

/* ─────────────────────────────────────────────────────────────────────────
 * IdimsHeader — horizontal top-bar header ported from the IDIMS HTML
 * prototype (CLM_Base_file). Two rows inside one sticky white nav:
 *   Row 1: logo · search · branch switcher · Default/Brand toggle · action
 *          icons (dark mode, fullscreen, mail, notifications, logout) · profile
 *   Row 2: horizontal nav (Dashboard, Credentials Vault, Project Navigator,
 *          HRMS, Sales Matrix▾, CLM▾, Procure to Pay, GTS, Inventory, Master)
 *
 * Sales Matrix + CLM open mega-dropdowns built from SALES_GROUPS / CLM_GROUPS.
 * Everything is wired to the real contexts (auth, branch, theme, navigation).
 * Rendered only in horizontal layout mode (see velzon/Layouts/index.tsx).
 * ───────────────────────────────────────────────────────────────────────── */

type Leaf = { id: string; label: string; icon?: string };
type Group = { id: string; label: string; children: Leaf[] };

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  client_admin: 'Client Admin',
  client_user: 'Client User',
  branch_user: 'Branch User',
  employee: 'Employee',
};

// Short descriptions shown under each dropdown leaf (mirrors the prototype /
// the modules table). Keep in sync when adding a menu leaf.
const LEAF_DESC: Record<string, string> = {
  // Sales Matrix
  'sales.analytics': 'Sales dashboard, Diagnosis View & Resolution Center.',
  'sales.productivity_tracker': 'Manage reminders, meetings & to-do activities.',
  'sales.customers': 'Manage customer master records.',
  'sales.consignee': 'Manage consignee master records.',
  'sales.lead_ack_master': 'Manage Lead Acknowledgement reasons.',
  'sales.workplace': 'Manage active sales opportunities.',
  'sales.quotation_vs_pi': 'Track quotation & PI conversion history.',
  'sales.sign_tracker': 'Track all documents sent for e-signature.',
  // Central CLM
  'clm.analytics': 'Track contract KPIs & legal performance.',
  'clm.diagnosis_resolution': 'Diagnose contract risks & drive resolution actions.',
  'clm.regulatory_defense': 'Read-only regulatory defense file repository.',
  'clm.buyer_profile': 'Manage Customer onboarding & agreements.',
  'clm.supplier_profile': 'Manage supplier contracts & compliance.',
  'clm.case_to_case': 'Manage one-time operational contracts.',
  'clm.agreements_sent': 'Track agreements sent for approval.',
  'clm.agreements_to_approve': 'Review and approve received agreements.',
  'clm.segment': 'Manage segment-wise contract structures.',
  'clm.authority': 'Manage certifying & issuing authorities.',
  'clm.quality_docs': 'Manage QC & compliance documents.',
  'clm.kyc': 'Manage customer & vendor KYC records.',
  'clm.due_diligence': 'Manage risk verification processes.',
  'clm.trade_licenses': 'Manage statutory license documents.',
  'clm.document_panel': 'Manage document rules & governance.',
  'clm.trade_documents': 'Manage declarations & trade papers.',
  'clm.agreements': 'Manage agreement templates & masters.',
  'clm.terms_conditions': 'Manage reusable legal T&C structures.',
  'clm.clause_library': 'Manage reusable legal clauses.',
  // HRMS
  'hr.overview': 'Headcount, joinings, exits & headline KPIs.',
  'hr.pip': 'Performance improvement plans.',
  'hr.reports': 'HR reports & analytics.',
  'hr.recruitment': 'Campaigns & candidate sourcing.',
  'hr.employee': 'Employee master, documents & permissions.',
  'hr.onboarding': 'Onboarding invites & profile capture.',
  'hr.exit': 'Exit & full-and-final processing.',
  'hr.payroll': 'Salary structures & payroll runs.',
  'hr.attendance': 'Face attendance & punch records.',
  'hr.leave': 'Leave requests & balances.',
  'hr.leave_approvals': 'Approve or reject leave requests.',
  'hr.holiday': 'Company holiday calendar.',
  'hr.expense': 'Expense claims & advances.',
  'hr.broadcast': 'Company-wide announcements.',
  'hr.doc_templates': 'Role-based document templates.',
  'hr.custom_fields': 'Tenant-defined custom fields.',
  'master.trigger_point': 'Lifecycle trigger modules.',
  'master.leave_type': 'Leave categories master.',
  'master.leave_plan': 'Leave plans & assignments.',
  // Procure to Pay (P2P)
  'p2p.analytics': 'Procurement KPIs & insights.',
  'p2p.diagnosis': 'Identify and resolve procurement issues.',
  'p2p.sales_summary': 'Track sourcing performance.',
  'p2p.product': 'Manage products & sourcing readiness.',
  'p2p.supplier': 'Manage supplier onboarding & compliance.',
  'p2p.bulk_sourcing': 'Manage bulk sourcing requests.',
  'p2p.case_to_case': 'Manage request-based sourcing.',
  'p2p.po': 'Create & track purchase orders.',
  'p2p.spi': 'Process supplier invoices & taxes.',
};

// Top-level slug → route.
function topPath(id: string): string {
  switch (id) {
    case 'dashboard':          return '/dashboard';
    case 'credentials-vault':  return '/credentials-vault';
    case 'project-navigator':  return '/project-navigator';
    case 'p2p':                return '/p2p';
    case 'gts':                return '/gts';
    case 'inventory':          return '/inventory';
    case 'developers':         return '/developers/shipment';
    case 'hr':                 return '/hr';
    case 'master':             return '/master';
    default:                   return `/${id}`;
  }
}

// Sales Matrix leaf → route (mirrors LayoutMenuData.salesLeafLink).
function salesLeafPath(id: string): string {
  switch (id) {
    case 'sales.customers':            return '/sales/customers';
    case 'sales.consignee':            return '/sales/consignee';
    case 'sales.lead_ack_master':      return '/sales/lead-ack-master';
    case 'sales.workplace':            return '/sales/lead-worksheet';
    case 'sales.analytics':            return '/sales/analytics';
    case 'sales.productivity_tracker': return '/sales/todo';
    case 'sales.quotation_vs_pi':      return '/sales/qpi';
    case 'sales.sign_tracker':         return '/sales/sign-tracker';
    default:                           return '/sales';
  }
}

// Central CLM leaf → route. URL uses dashes; ids use underscores.
function clmLeafPath(id: string): string {
  return `/clm/${id.replace(/^clm\./, '').replace(/_/g, '-')}`;
}

// HRMS leaf → route (mirrors LayoutMenuData.hrLeafLink). HR groups also carry
// a few master.* leaves (Attendance Master Mgmt) that reuse the /master shell.
function hrLeafPath(id: string): string {
  switch (id) {
    case 'hr.overview':        return '/hr/overview';
    case 'hr.employee':        return '/hr/employees';
    case 'hr.recruitment':     return '/hr/recruitment';
    case 'hr.exit':            return '/hr/exit-management';
    case 'hr.onboarding':      return '/hr/employee-onboarding';
    case 'hr.attendance':      return '/hr/attendance';
    case 'hr.broadcast':       return '/hr/broadcast';
    case 'hr.doc_templates':   return '/hr/doc-templates';
    case 'hr.custom_fields':   return '/hr/custom-fields';
    case 'hr.leave':           return '/hr/leave';
    case 'hr.leave_approvals': return '/hr/leave-approvals';
    case 'hr.holiday':         return '/hr/holiday';
    case 'hr.expense':         return '/hr/expense';
    case 'hr.payroll':         return '/hr/payroll';
    case 'hr.pip':             return '/hr/pip';
    case 'master.leave_type':  return '/master/leave_type';
    case 'master.leave_plan':  return '/master/leave_plan';
    case 'master.trigger_point': return '/master/trigger_point';
    default:                   return '/hr';
  }
}

// Procure to Pay leaf → route. Product reuses the product master, Supplier the
// vendor master (procurement sources from the existing vendor onboarding).
function p2pLeafPath(id: string): string {
  switch (id) {
    case 'p2p.product':       return '/products';
    case 'p2p.supplier':      return '/suppliers';
    case 'p2p.sales_summary': return '/sales/p2p-summary';
    // Under development — each lands on its own dark-mode-aware "Coming soon"
    // stub (ModuleStubPage) so the title is correct per leaf.
    case 'p2p.analytics':     return '/p2p/analytics';
    case 'p2p.diagnosis':     return '/p2p/diagnosis';
    case 'p2p.bulk_sourcing': return '/p2p/bulk-sourcing';
    case 'p2p.case_to_case':  return '/p2p/case-to-case';
    case 'p2p.po':            return '/p2p/purchase-order';
    case 'p2p.spi':           return '/p2p/supplier-purchase-invoice';
    default:                  return '/p2p';
  }
}

type DD = 'sales' | 'clm' | 'hr' | 'p2p';

export default function IdimsHeader() {
  const navigate = useNavigate();
  const { user, logout, tenantThemeEnabled, toggleTenantTheme } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { selectedBranch } = useBranchSwitcher();

  const [openDD, setOpenDD] = useState<DD | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpand, setMobileExpand] = useState<DD | null>(null);
  // Overflow "More" menu — collapses nav items that don't fit on one row
  // (instead of horizontal scrolling) into a dropdown.
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreExpand, setMoreExpand] = useState<DD | null>(null);
  const [visibleCount, setVisibleCount] = useState(99);
  const navItemsRef = useRef<HTMLDivElement | null>(null);
  const navGhostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* ── Permission helpers (mirror LayoutMenuData) ── */
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};
  const planExpired = !!(user?.plan && (!user.plan.has_plan || user.plan.expired)) &&
    user?.user_type !== 'super_admin';

  // Clock-In is an attendance action — only users with an actual employee
  // record can punch in. Hidden for super-admin / client / branch logins
  // (mirrors the `isEmployee` guard in components/App.tsx).
  const isEmployee = user?.user_type === 'employee' && !!user?.employee_id;
  const can = (slug: string) => isSuperAdmin || (!planExpired && !!perms[slug]?.can_view);
  const hasGroupView = (prefix: string) =>
    isSuperAdmin || (!planExpired && Object.keys(perms).some(s => s.startsWith(prefix) && perms[s]?.can_view));

  /* ── Logo ── */
  const rawLogo = user?.branch_logo || user?.client_logo || null;
  const logoSrc = rawLogo ? resolveFileUrl(rawLogo) : logoFallback;
  // Dark-mode logo: same file with a "-dark" suffix (a recoloured variant whose
  // dark ink is turned light so it reads on the dark nav, no box). If that file
  // doesn't exist for a tenant, onError flips to the original on a soft pill.
  const darkRaw = rawLogo && /\.(png|jpe?g|webp)$/i.test(rawLogo)
    ? rawLogo.replace(/\.(png|jpe?g|webp)$/i, '-dark.png')
    : null;
  const darkLogoSrc = darkRaw ? resolveFileUrl(darkRaw) : null;
  const [logoDarkMissing, setLogoDarkMissing] = useState(false);
  useEffect(() => { setLogoDarkMissing(false); }, [rawLogo]);
  const showDarkLogo = theme === 'dark' && !!darkLogoSrc && !logoDarkMissing;
  // The bundled fallback logo (no tenant upload) is already transparent with
  // light colours that read fine on the dark nav, so it needs no pill. Only an
  // uploaded logo that lacks a -dark variant falls back to the soft pill.
  const logoNeedsPill = theme === 'dark' && !showDarkLogo && !!rawLogo;

  /* ── Profile photo ── */
  const rawPhoto = user?.user_profile_photo || user?.employee_profile_photo
    || user?.branch_profile_photo || user?.client_profile_photo || null;
  const photoSrc = rawPhoto ? resolveFileUrl(rawPhoto) : null;

  /* ── Branch label ── */
  const branchName = selectedBranch?.name || user?.branch_name || user?.client_name || 'All Branches';

  /* ── Close popovers on outside click / Escape ── */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenDD(null); setBranchOpen(false); setProfileOpen(false); setSearchOpen(false); setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenDD(null); setBranchOpen(false); setProfileOpen(false); setLogoutOpen(false); setSearchOpen(false); setMoreOpen(false); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const go = (path: string) => { setOpenDD(null); setMobileOpen(false); setMoreOpen(false); setMoreExpand(null); navigate(path); };
  const toggleFs = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  /* ── Visible top-level nav items in prototype order ── */
  const navItems = useMemo(() => {
    const items: { id: string; label: string; icon: JSX.Element; dd?: DD }[] = [];
    const role = user?.user_type;
    items.push({ id: 'dashboard', label: 'Dashboard', icon: IC.grid });

    // Super-admin runs the SaaS itself — it sees ONLY the platform-management
    // modules (Clients, Plans, Payments, Master, Permissions), never the
    // tenant business modules (HRMS / Sales / CLM / P2P / GTS / Inventory).
    if (role === 'super_admin') {
      items.push({ id: 'clients', label: 'Clients', icon: IC.building });
      items.push({ id: 'plans', label: 'Plans', icon: IC.card });
      items.push({ id: 'payments', label: 'Payments', icon: IC.rupee });
      items.push({ id: 'master', label: 'Master', icon: IC.db });
      items.push({ id: 'permissions', label: 'Permissions', icon: IC.shield });
      return items;
    }

    // Client-admin manages the tenant account — it sees ONLY the account
    // modules (Branches, Master, Permissions, My Plan), not the day-to-day
    // business modules (HRMS / Sales / CLM / P2P / GTS / Inventory) that
    // branch users and employees operate.
    if (role === 'client_admin') {
      items.push({ id: 'branches', label: 'Branches', icon: IC.branch });
      items.push({ id: 'master', label: 'Master', icon: IC.db });
      items.push({ id: 'permissions', label: 'Permissions', icon: IC.shield });
      items.push({ id: 'my-plan', label: 'My Plan', icon: IC.card });
      return items;
    }
    if (can('credentials-vault')) items.push({ id: 'credentials-vault', label: 'Credentials Vault', icon: IC.lock });
    if (can('project-navigator')) items.push({ id: 'project-navigator', label: 'Project Navigator', icon: IC.compass });
    if (hasGroupView('hr.')) items.push({ id: 'hr', label: 'HRMS', icon: IC.users, dd: 'hr' });
    if (hasGroupView('sales.')) items.push({ id: 'sales', label: 'Sales Matrix', icon: IC.trend, dd: 'sales' });
    if (hasGroupView('clm.')) items.push({ id: 'clm', label: 'CLM', icon: IC.file, dd: 'clm' });
    // Shared rule (see utils/menuAccess) — parent grant OR any p2p.* leaf.
    if (moduleVisible(perms, 'p2p', isSuperAdmin, planExpired)) items.push({ id: 'p2p', label: 'Procure to Pay (P2P)', icon: IC.cart, dd: 'p2p' });
    if (can('gts')) items.push({ id: 'gts', label: 'GTS (E-Docs)', icon: IC.globe });
    if (can('inventory')) items.push({ id: 'inventory', label: 'Inventory Management System', icon: IC.box });
    // Developers → Shipment (Business Task). Direct-link tab, gated on the
    // developers.shipment permission. (id 'developers' maps to /developers/shipment.)
    if (can('developers.shipment')) items.push({ id: 'developers', label: 'Dev Tools', icon: IC.layers });
    if (hasGroupView('master.')) items.push({ id: 'master', label: 'Master', icon: IC.db });
    // Permissions — branch admins manage their team's access (employees do
    // not; they can't grant permissions). Super-admin / client-admin already
    // returned above with their own Permissions entry.
    if (role === 'branch_user') {
      items.push({ id: 'permissions', label: 'Permissions', icon: IC.shield });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);


  /* ── Overflow measurement ─────────────────────────────────────────────
     A hidden "ghost" row renders every nav item at full width so we can
     measure how many fit on a single line. Anything past that collapses
     into the "More" dropdown — no horizontal scrolling. Recomputed on
     resize (ResizeObserver) and whenever the item list changes. */
  useLayoutEffect(() => {
    const compute = () => {
      const box = navItemsRef.current;
      const ghost = navGhostRef.current;
      if (!box || !ghost) return;
      const avail = box.clientWidth;
      const widths = (Array.from(ghost.children) as HTMLElement[]).map(c => c.offsetWidth + 4);
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) { setVisibleCount(widths.length); return; }
      const MORE_W = 104; // reserve room for the "More" button
      let used = 0, count = 0;
      for (const w of widths) {
        if (used + w <= avail - MORE_W) { used += w; count++; } else break;
      }
      setVisibleCount(Math.max(1, count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (navItemsRef.current) ro.observe(navItemsRef.current);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [navItems]);

  const visibleNav = navItems.slice(0, visibleCount);
  const overflowNav = navItems.slice(visibleCount);

  /* ── Mega-menu column layouts ── */
  const salesCols: Group[][] = useMemo(
    () => (SALES_GROUPS as Group[]).map(g => [g]),
    [],
  );
  const clmGroups = CLM_GROUPS as Group[];
  const clmCols: Group[][] = useMemo(() => {
    const byId = (id: string) => clmGroups.find(g => g.id === id);
    return [
      [byId('clm.command')].filter(Boolean) as Group[],
      [byId('clm.ops_with'), byId('clm.ops_without')].filter(Boolean) as Group[],
      [byId('clm.compliance')].filter(Boolean) as Group[],
      [byId('clm.documents')].filter(Boolean) as Group[],
    ];
  }, [clmGroups]);
  const hrGroups = HR_GROUPS as unknown as Group[];
  // One group per column so every HR sub-module sits side-by-side in a single
  // row (like CLM), instead of being stacked two-per-column.
  const hrCols: Group[][] = useMemo(() => {
    const order = ['hr.command', 'hr.core', 'hr.time_pay', 'hr.documents', 'master.attendance'];
    return order.map(id => hrGroups.filter(g => g.id === id)).filter(c => c.length);
  }, [hrGroups]);

  // P2P has no per-leaf permission slugs — the whole module is gated by
  // can('p2p'), so every leaf shows whenever P2P is accessible. Four-column
  // layout mirrors the Figma: Intelligence Hub · Master Management ·
  // Procurement Management · Purchase Management. Leaves without their own page
  // yet are wired (in p2pLeafPath) to the P2P hub until those screens ship.
  // One group per column (shared P2P_GROUPS drives the sidebar too).
  const p2pCols: Group[][] = useMemo(() => P2P_GROUPS.map(g => [g as unknown as Group]), []);

  const colsFor = (dd: DD): Group[][] =>
    dd === 'sales' ? salesCols : dd === 'hr' ? hrCols : dd === 'p2p' ? p2pCols : clmCols;

  const leafPath = (id: string, kind: DD) =>
    kind === 'sales' ? salesLeafPath(id)
      : kind === 'hr' ? hrLeafPath(id)
      : kind === 'p2p' ? p2pLeafPath(id)
      : clmLeafPath(id);

  /* ── Search index — modules + sub-modules only ──────────────────────────
     Flattens the accessible top-level nav items and their dropdown leaves
     into a single searchable list. Permission gating mirrors the menu render
     (super-admin sees all; P2P leaves follow the module-level can('p2p')
     grant; every other leaf needs perms[id].can_view). The header search
     intentionally covers ONLY modules/sub-modules — no parties/documents. */
  type SearchEntry = { id: string; label: string; parent?: string; path: string; icon: JSX.Element };
  const searchIndex = useMemo(() => {
    const out: SearchEntry[] = [];
    navItems.forEach(item => {
      out.push({ id: item.id, label: item.label, path: topPath(item.id), icon: item.icon });
      if (item.dd) {
        colsFor(item.dd).flat().forEach(g => {
          g.children.forEach(leaf => {
            const visible = item.dd === 'p2p' || isSuperAdmin || !!perms[leaf.id]?.can_view;
            if (!visible) return;
            out.push({ id: leaf.id, label: leaf.label, parent: item.label, path: leafPath(leaf.id, item.dd!), icon: item.icon });
          });
        });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navItems]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter(e => e.label.toLowerCase().includes(q) || (e.parent?.toLowerCase().includes(q)))
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchIndex]);

  const runSearchNav = (path: string) => {
    setSearchQuery('');
    setSearchOpen(false);
    go(path);
  };

  const renderLeaf = (leaf: Leaf, kind: DD, accent: string, bg: string) => {
    // Sign Document Tracker has no permission slug of its own — it's a
    // read-only view of the same sign requests, so it rides on the
    // Quotation Vs PI permission.
    const leafVisible = leaf.id === 'sales.sign_tracker'
      ? !!perms['sales.quotation_vs_pi']?.can_view
      : !!perms[leaf.id]?.can_view;
    // P2P leaves carry no per-leaf permission — module-level can('p2p') gates them.
    if (kind !== 'p2p' && !(isSuperAdmin || leafVisible)) return null;
    const path = leafPath(leaf.id, kind);
    const Icon = getLucide(leaf.icon);
    return (
      <button key={leaf.id} type="button" className="idims-dd-item" style={{ '--ac': accent } as React.CSSProperties}
        onClick={() => go(path)}>
        <span className="idims-dd-item-ico" style={{ background: bg, color: accent }}>
          <Icon size={16} strokeWidth={2} />
        </span>
        <span className="idims-dd-item-text">
          <span className="idims-dd-item-label">{leaf.label}</span>
          {LEAF_DESC[leaf.id] && <span className="idims-dd-item-desc">{LEAF_DESC[leaf.id]}</span>}
        </span>
      </button>
    );
  };

  const renderCol = (groups: Group[], kind: DD, accent: string, bg: string, key?: number) => (
    <div key={key} className="idims-dd-col" style={{ borderTop: `3px solid ${accent}` }}>
      {groups.map(g => (
        <div key={g.id} className="idims-dd-group">
          <div className="idims-dd-section-label" style={{ color: accent }}>
            <span className="dd-sl-dot" style={{ background: accent }} />{g.label}
          </div>
          {g.children.map(leaf => renderLeaf(leaf, kind, accent, bg))}
        </div>
      ))}
    </div>
  );

  // Smaller nested leaf (the Agreements children under "Without Shipment ID").
  const renderClmChild = (leaf: Leaf, accent: string, bg: string) => {
    if (!(isSuperAdmin || perms[leaf.id]?.can_view)) return null;
    const Icon = getLucide(leaf.icon);
    return (
      <button key={leaf.id} type="button" className="idims-clm-child" onClick={() => go(clmLeafPath(leaf.id))}>
        <span className="idims-clm-child-ico" style={{ background: bg, color: accent }}><Icon size={12} strokeWidth={2} /></span>
        <span className="idims-dd-item-text">
          <span className="idims-clm-child-label">{leaf.label}</span>
          {LEAF_DESC[leaf.id] && <span className="idims-dd-item-desc">{LEAF_DESC[leaf.id]}</span>}
        </span>
      </button>
    );
  };

  // CLM mega-menu — matches the prototype: 3 sections (Command Center,
  // Operations, Master Management); Operations + Master Management each split
  // into two sub-columns with sub-headers, and Without-Shipment-ID nests the
  // Agreements leaves under Case to Case.
  const renderClmMega = () => {
    const g = (id: string) => clmGroups.find(x => x.id === id);
    const P = '#7C3AED', PB = '#F5F3FF';   // Command Center
    const S = '#0EA5E9', SB = '#F0F9FF';   // Operations
    const T = '#0D9488', TB = '#F0FDFA';   // Master Management
    const visible = (grp?: Group) => !!grp && grp.children.some(l => isSuperAdmin || perms[l.id]?.can_view);

    const cmd = g('clm.command');
    const ow = g('clm.ops_with');
    const won = g('clm.ops_without');
    const comp = g('clm.compliance');
    const doc = g('clm.documents');
    const wonParent = won?.children.find(l => l.id === 'clm.case_to_case');
    const wonKids = (won?.children || []).filter(l => l.id === 'clm.agreements_sent' || l.id === 'clm.agreements_to_approve');

    const subHead = (label: string, color: string) =>
      <div className="idims-clm-subhead" style={{ color, borderColor: color }}><span className="dd-sl-dot" style={{ background: color }} />{label}</div>;

    return (
      <div className="idims-clm-grid">
        {/* Command Center */}
        <div className="idims-dd-col" style={{ borderTop: `3px solid ${P}` }}>
          <div className="idims-dd-section-label" style={{ color: P }}><span className="dd-sl-dot" style={{ background: P }} />CLM Command Center</div>
          {cmd?.children.map(l => renderLeaf(l, 'clm', P, PB))}
        </div>
        {/* Operations */}
        <div className="idims-dd-col" style={{ borderTop: `3px solid ${S}` }}>
          <div className="idims-dd-section-label" style={{ color: S }}><span className="dd-sl-dot" style={{ background: S }} />CLM Operations</div>
          <div className="idims-clm-sub">
            <div className="idims-clm-subcol">
              {visible(ow) && subHead('With Shipment ID', S)}
              {ow?.children.map(l => renderLeaf(l, 'clm', S, SB))}
            </div>
            <div className="idims-clm-subcol">
              {visible(won) && subHead('Without Shipment ID', S)}
              {wonParent && renderLeaf(wonParent, 'clm', S, SB)}
              {wonKids.length > 0 && (
                <div className="idims-clm-children">{wonKids.map(l => renderClmChild(l, S, SB))}</div>
              )}
            </div>
          </div>
        </div>
        {/* Master Management */}
        <div className="idims-dd-col" style={{ borderTop: `3px solid ${T}` }}>
          <div className="idims-dd-section-label" style={{ color: T }}><span className="dd-sl-dot" style={{ background: T }} />CLM Master Management</div>
          <div className="idims-clm-sub">
            <div className="idims-clm-subcol">
              {visible(comp) && subHead('Compliance & Regulatory', T)}
              {comp?.children.map(l => renderLeaf(l, 'clm', T, TB))}
            </div>
            <div className="idims-clm-subcol">
              {visible(doc) && subHead('Contract & Document Masters', T)}
              {doc?.children.map(l => renderLeaf(l, 'clm', T, TB))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // In brand mode, expose the tenant primary colour as a CSS var so the
  // .idims-brand rules can use it for hover / active accents (replacing the
  // default violet). Topbar stays white — only the accent colour changes.
  const brandVars = tenantThemeEnabled
    ? ({ '--bp': user?.primary_color || '#6D28D9' } as React.CSSProperties)
    : undefined;

  return (
    <div ref={rootRef} style={brandVars}
      className={`idims-shell ${theme === 'dark' ? 'idims-dark' : ''} ${tenantThemeEnabled ? 'idims-brand' : ''}`}>
      <style>{IDIMS_CSS}</style>
      {/* Blurred backdrop behind an open mega-dropdown (page content only —
          the nav bar + dropdown stack above it). Click to close. */}
      {openDD && <div className="idims-dd-backdrop" onClick={() => setOpenDD(null)} />}
      <nav className="idims-nav">
        <div className={`idims-logo ${logoNeedsPill ? 'idims-logo-pill' : ''}`} onClick={() => go('/dashboard')}>
          <img className="idims-logo-full" src={showDarkLogo ? darkLogoSrc! : logoSrc} alt="logo"
            onError={() => { if (showDarkLogo) setLogoDarkMissing(true); }} />
        </div>
        <div className="idims-divider" />
        <div className="idims-nav-stack">

          {/* ── Row 1 ── */}
          <div className="idims-nav-row idims-row-top">
            {/* Hamburger — only visible ≤1024px; toggles the mobile nav panel. */}
            <button type="button" className="idims-hamburger" aria-label="Menu"
              onClick={() => setMobileOpen(o => !o)}>
              {mobileOpen ? IC.close : IC.menu}
            </button>
            <div className="idims-search">
              <span className="idims-search-ico">{IC.search}</span>
              <input className="idims-search-input" type="text"
                placeholder="Search modules & sub-modules..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => { setOpenDD(null); setBranchOpen(false); setProfileOpen(false); setMoreOpen(false); setSearchOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); if (searchResults[0]) runSearchNav(searchResults[0].path); }
                }} />
              {searchQuery
                ? <button type="button" className="idims-search-clear" aria-label="Clear search"
                    onClick={() => { setSearchQuery(''); setSearchOpen(false); }}>{IC.close}</button>
                : <span className="idims-search-kbd">⌘K</span>}
              {searchOpen && searchQuery.trim() && (
                <div className="idims-search-results">
                  {searchResults.length === 0 ? (
                    <div className="idims-search-empty">No modules match “{searchQuery.trim()}”</div>
                  ) : searchResults.map(r => (
                    <button type="button" key={`${r.parent || ''}:${r.id}`} className="idims-search-result"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => runSearchNav(r.path)}>
                      <span className="idims-search-result-ico">{r.icon}</span>
                      <span className="idims-search-result-text">
                        <span className="idims-search-result-label">{r.label}</span>
                        <span className="idims-search-result-sub">{r.parent ? `${r.parent} · Sub-module` : 'Module'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="idims-nav-right">
              {/* Default / Brand theme switch */}
              <div className="idims-theme-switch" title="Switch brand theme">
                <span className="idims-theme-switch-label">{tenantThemeEnabled ? 'Brand' : 'Default'}</span>
                <button type="button" className="idims-theme-toggle" aria-label="Toggle brand theme"
                  onClick={() => toggleTenantTheme?.()} />
              </div>

              <div className="idims-actions">
                <button type="button" className="idims-action-btn" title="Toggle theme" onClick={() => toggleTheme()}>
                  {theme === 'dark' ? IC.sun : IC.moon}
                </button>
                <button type="button" className="idims-action-btn idims-fs-btn" title="Fullscreen" onClick={toggleFs}>
                  {isFs ? IC.minimize : IC.maximize}
                </button>
                {isEmployee && (
                  <button type="button" className="idims-action-btn idims-clock-btn" title="Clock In / Out" onClick={() => go('/clock-in')}>
                    {IC.clock}
                  </button>
                )}
                <button type="button" className="idims-action-btn idims-mail-btn" title="Gmail" onClick={() => go('/gmail')}>
                  {IC.mail}
                </button>
                <button type="button" className="idims-action-btn" title="Inbox" onClick={() => go('/inbox')}>
                  {IC.bell}
                  {!!user?.inbox_count && <span className="idims-action-badge" />}
                </button>
                <button type="button" className="idims-action-btn idims-logout-btn" title="Logout" onClick={() => setLogoutOpen(true)}>
                  {IC.logout}
                </button>
              </div>
              <span className="idims-action-sep" />

              {/* Profile */}
              <div className="idims-profile-wrap">
                <button type="button" className="idims-profile-icon" title="Profile" onClick={() => { setOpenDD(null); setBranchOpen(false); setMoreOpen(false); setProfileOpen(o => !o); }}>
                  {photoSrc
                    ? <img src={photoSrc} alt="profile" />
                    : <span className="idims-profile-initials">{user?.initials || (user?.name || '?').slice(0, 2).toUpperCase()}</span>}
                  <span className="idims-online-dot" />
                </button>
                <div className={`idims-profile-panel ${profileOpen ? 'open' : ''}`}>
                  <div className="idims-profile-head">
                    <div className="idims-profile-head-avatar">
                      {photoSrc
                        ? <img src={photoSrc} alt="" />
                        : <span className="idims-profile-initials lg">{user?.initials || (user?.name || '?').slice(0, 2).toUpperCase()}</span>}
                      <span className="idims-profile-head-dot" />
                    </div>
                    <div className="idims-profile-head-info">
                      <div className="idims-profile-head-name">{user?.name || 'User'}</div>
                      <span className="idims-profile-head-badge">{IC.shield}{ROLE_LABEL[user?.user_type || ''] || 'User'}</span>
                      <div className="idims-profile-head-branch">{IC.building}<span>{branchName}</span></div>
                    </div>
                  </div>
                  <div className="idims-profile-menu">
                    <button type="button" className="idims-profile-item" onClick={() => { setProfileOpen(false); go('/profile'); }}>
                      <span className="idims-profile-item-ico" style={{ background: 'linear-gradient(135deg,#A78BFA,#7C3AED)' }}>{IC.user}</span>
                      <span className="idims-profile-item-label">Profile</span>{IC.chevR}
                    </button>
                    <button type="button" className="idims-profile-item" onClick={() => { setProfileOpen(false); go('/my-team'); }}>
                      <span className="idims-profile-item-ico" style={{ background: 'linear-gradient(135deg,#34D399,#059669)' }}>{IC.users}</span>
                      <span className="idims-profile-item-label">My Team</span>{IC.chevR}
                    </button>
                    <button type="button" className="idims-profile-item" onClick={() => { setProfileOpen(false); go('/settings'); }}>
                      <span className="idims-profile-item-ico" style={{ background: 'linear-gradient(135deg,#94A3B8,#64748B)' }}>{IC.gear}</span>
                      <span className="idims-profile-item-label">Settings</span>{IC.chevR}
                    </button>
                    <div className="idims-profile-divider" />
                    <button type="button" className="idims-profile-item idims-profile-logout" onClick={() => { setProfileOpen(false); setLogoutOpen(true); }}>
                      <span className="idims-profile-item-ico" style={{ background: 'linear-gradient(135deg,#FB7185,#E11D48)' }}>{IC.logout}</span>
                      <span className="idims-profile-item-label">Logout</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 2: nav items ── */}
          <div className="idims-nav-row idims-row-bottom">
            {/* Hidden ghost row — measures every item's natural width so the
                overflow calc knows how many fit before collapsing to "More". */}
            <div className="idims-nav-ghost" ref={navGhostRef} aria-hidden="true">
              {navItems.map(item => (
                <span className="idims-nav-btn" key={item.id}>
                  <span className="idims-ico">{item.icon}</span>{item.label}
                  {item.dd && <span className="dd-chev">{IC.chevSm}</span>}
                </span>
              ))}
            </div>
            <div className="idims-nav-items" ref={navItemsRef}>
              {visibleNav.map(item => (
                item.dd ? (
                  <div className="idims-dd-wrap" key={item.id}>
                    <button type="button" className={`idims-nav-btn ${openDD === item.dd ? 'dd-open' : ''}`}
                      onClick={() => { setBranchOpen(false); setProfileOpen(false); setMoreOpen(false); setOpenDD(o => o === item.dd ? null : item.dd!); }}>
                      <span className="idims-ico">{item.icon}</span>{item.label}
                      <span className="dd-chev">{IC.chevSm}</span>
                    </button>
                    {openDD === item.dd && (
                      <div className={`idims-dropdown ${item.dd === 'clm' || item.dd === 'hr' ? 'idims-dd-wide' : ''}${item.dd === 'p2p' ? 'idims-dd-p2p' : ''}`}>
                        <div className="idims-dd-topbar" />
                        <div className="idims-dd-inner">
                          {item.dd === 'clm' ? renderClmMega() : (
                            <div className="idims-dd-grid"
                              style={{ gridTemplateColumns: `repeat(${colsFor(item.dd!).length}, 1fr)` }}>
                              {colsFor(item.dd!).map((groups, i) => {
                                // P2P carries its own Figma palette; other mega-menus
                                // cycle the shared accent set.
                                const acc = item.dd === 'p2p' ? P2P_ACCENT : COL_ACCENT;
                                const bgs = item.dd === 'p2p' ? P2P_BG : COL_BG;
                                return renderCol(groups, item.dd!, acc[i], bgs[i], i);
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button type="button" className="idims-nav-btn" key={item.id} onClick={() => go(topPath(item.id))}>
                    <span className="idims-ico">{item.icon}</span>{item.label}
                  </button>
                )
              ))}

              {/* Overflow "More" dropdown — holds items that don't fit. */}
              {overflowNav.length > 0 && (
                <div className="idims-dd-wrap idims-more-wrap">
                  <button type="button" className={`idims-nav-btn ${moreOpen ? 'dd-open' : ''}`}
                    onClick={() => { setBranchOpen(false); setProfileOpen(false); setOpenDD(null); setMoreOpen(o => !o); }}>
                    <span className="idims-ico">{IC.more}</span>More
                    <span className="dd-chev">{IC.chevSm}</span>
                  </button>
                  {moreOpen && (
                    <div className="idims-more-panel">
                      {overflowNav.map(item => (
                        item.dd ? (
                          <div key={item.id} className="idims-more-group">
                            <button type="button" className={`idims-more-item ${moreExpand === item.dd ? 'open' : ''}`}
                              onClick={() => setMoreExpand(e => e === item.dd ? null : item.dd!)}>
                              <span className="idims-ico">{item.icon}</span><span className="idims-more-label">{item.label}</span>
                              <span className="idims-more-chev">{IC.chevSm}</span>
                            </button>
                            {moreExpand === item.dd && (
                              <div className="idims-more-sub">
                                {colsFor(item.dd).flat().map(g => {
                                  const leaves = item.dd === 'p2p'
                                    ? g.children
                                    : g.children.filter(l => isSuperAdmin || perms[l.id]?.can_view);
                                  if (!leaves.length) return null;
                                  return (
                                    <div key={g.id} className="idims-more-subgroup">
                                      <div className="idims-more-sub-label">{g.label}</div>
                                      {leaves.map(l => (
                                        <button type="button" key={l.id} className="idims-more-sub-item"
                                          onClick={() => go(leafPath(l.id, item.dd!))}>{l.label}</button>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button type="button" key={item.id} className="idims-more-item"
                            onClick={() => go(topPath(item.id))}>
                            <span className="idims-ico">{item.icon}</span><span className="idims-more-label">{item.label}</span>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile nav panel (≤1024px) ── */}
      {mobileOpen && (
        <>
          <div className="idims-mob-backdrop" onClick={() => setMobileOpen(false)} />
          <div className="idims-mobile-panel">
            {isEmployee && (
              <button type="button" className="idims-mob-item"
                onClick={() => go('/clock-in')}>
                <span className="idims-ico">{IC.clock}</span><span className="idims-mob-label">Clock In / Out</span>
              </button>
            )}
            {navItems.map(item => (
              item.dd ? (
                <div key={item.id} className="idims-mob-group">
                  <button type="button" className={`idims-mob-item ${mobileExpand === item.dd ? 'open' : ''}`}
                    onClick={() => setMobileExpand(e => e === item.dd ? null : item.dd!)}>
                    <span className="idims-ico">{item.icon}</span><span className="idims-mob-label">{item.label}</span>
                    <span className="idims-mob-chev">{IC.chevSm}</span>
                  </button>
                  {mobileExpand === item.dd && (
                    <div className="idims-mob-sub">
                      {colsFor(item.dd).flat().map(g => {
                        const leaves = item.dd === 'p2p'
                          ? g.children
                          : g.children.filter(l => isSuperAdmin || perms[l.id]?.can_view);
                        if (!leaves.length) return null;
                        return (
                          <div key={g.id} className="idims-mob-subgroup">
                            <div className="idims-mob-sub-label">{g.label}</div>
                            {leaves.map(l => (
                              <button type="button" key={l.id} className="idims-mob-sub-item"
                                onClick={() => go(leafPath(l.id, item.dd!))}>{l.label}</button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <button type="button" key={item.id} className="idims-mob-item"
                  onClick={() => go(topPath(item.id))}>
                  <span className="idims-ico">{item.icon}</span><span className="idims-mob-label">{item.label}</span>
                </button>
              )
            ))}
          </div>
        </>
      )}

      {/* Logout confirm modal */}
      {logoutOpen && (
        <div className="idims-logout-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setLogoutOpen(false); }}>
          <div className="idims-logout-modal" role="dialog" aria-modal="true">
            <div className="idims-logout-icon">{IC.logoutBig}</div>
            <div className="idims-logout-title">Log out?</div>
            <div className="idims-logout-text">Are you sure you want to log out? You'll need to sign in again to continue.</div>
            <div className="idims-logout-actions">
              <button type="button" className="idims-btn-cancel" onClick={() => setLogoutOpen(false)}>Cancel</button>
              <button type="button" className="idims-btn-confirm" onClick={() => { setLogoutOpen(false); logout(); }}>Log Out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const COL_ACCENT = ['#7C3AED', '#0EA5E9', '#0D9488', '#7C3AED', '#0EA5E9', '#0D9488'];
const COL_BG = ['#F5F3FF', '#F0F9FF', '#F0FDFA', '#F5F3FF', '#F0F9FF', '#F0FDFA'];
// P2P uses its own per-column palette to match the Figma: Intelligence Hub &
// Master Management in violet, Procurement Management in amber, Purchase
// Management in teal.
const P2P_ACCENT = ['#7C3AED', '#7C3AED', '#F59E0B', '#0D9488'];
const P2P_BG = ['#F5F3FF', '#F5F3FF', '#FFFBEB', '#F0FDFA'];

/* ── Inline SVG icon set (named IC to avoid clashing with lucide imports) ── */
const IC = {
  grid: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8zM3 13h8v8H3v-8z" /></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  lock: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-9-2a3 3 0 0 1 6 0v2H9V6zm4 9.73V18h-2v-2.27a2 2 0 1 1 2 0z" /></svg>,
  compass: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm4.24-14.24l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" /></svg>,
  users: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>,
  trend: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z" /></svg>,
  file: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" /></svg>,
  cart: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" /></svg>,
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>,
  rupee: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 8h12M9 3c3.5 0 5.5 2 5.5 5S12.5 13 9 13H6l7 8" /></svg>,
  branch: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>,
  more: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  globe: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>,
  box: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 1.95l9.05 4.52v11.06L12 22.05l-9.05-4.52V6.47L12 1.95zm0 2.24L5.66 7.36 12 10.53l6.34-3.17L12 4.19zM4.95 9.03v7.25L11 19.3v-7.25L4.95 9.03zm14.1 0L13 12.05v7.25l6.05-3.02V9.03z" /></svg>,
  db: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7.58 2 4 3.57 4 5.5S7.58 9 12 9s8-1.57 8-3.5S16.42 2 12 2zM4 7.97v4.53C4 14.43 7.58 16 12 16s8-1.57 8-3.5V7.97c-1.72 1.4-4.66 2.13-8 2.13s-6.28-.73-8-2.13zm0 7v3.53C4 20.43 7.58 22 12 22s8-1.57 8-3.5V14.97c-1.72 1.4-4.66 2.13-8 2.13s-6.28-.73-8-2.13z" /></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></svg>,
  chev: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>,
  chevSm: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>,
  chevR: <svg className="idims-profile-item-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>,
  layers: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>,
  maximize: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></svg>,
  minimize: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>,
  mail: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  logoutBig: <svg viewBox="0 0 24 24" fill="none" stroke="#E11D48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 32, height: 32 }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5l-8-3z" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  dot: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>,
};

/* ── Scoped CSS (ported from the IDIMS prototype, header only) ── */
const IDIMS_CSS = `
/* The shell carries the sticky (not the nav): its containing block is the
   full-height #layout-wrapper, so it pins to the top across the whole page.
   Sticking the nav directly failed — its containing block (the shell) was
   only nav-height tall, so it had no travel and scrolled away. */
.idims-shell { font-family: var(--font-sans); position: sticky; top: 0; z-index: 1030; }
.idims-nav {
  height: 110px; background: #fff; border-bottom: 1px solid #E4E7EF;
  box-shadow: 0 1px 3px rgba(15,23,42,.06); padding: 0 14px 0 10px;
  display: flex; align-items: center; gap: 0;
  position: relative; z-index: 2; overflow-x: clip; overflow-y: visible;
}
/* Backdrop sits inside the (sticky) shell — above page content but below the
   nav (z-index:2) and the dropdown — so only the page gets blurred. */
.idims-dd-backdrop { position: fixed; inset: 0; z-index: 1; background: rgba(15,23,42,.10); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: idimsFade .18s ease; }
.idims-dark .idims-dd-backdrop { background: rgba(0,0,0,.35); }
.idims-logo { display: flex; align-items: center; flex-shrink: 0; cursor: pointer; border-radius: 12px; transition: background .2s ease, box-shadow .2s ease, padding .2s ease; }
.idims-logo-full { height: 52px; width: auto; display: block; object-fit: contain; filter: drop-shadow(0 2px 5px rgba(120,53,15,.18)); transition: transform .18s ease; }
.idims-logo:hover .idims-logo-full { transform: scale(1.03); }
/* Dark mode — preferred path: a recoloured "-dark" logo variant blends straight
   into the nav with no box (see darkLogoSrc). Fallback for tenants without a
   dark variant: a soft translucent white pill so the original logo stays legible
   and keeps its colours. Light mode is untouched. */
.idims-logo-pill { background: #fff; padding: 4px 10px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.55); }
.idims-dark .idims-logo-full { filter: none; }
.idims-divider { width: 1px; height: 56px; background: #E4E7EF; flex-shrink: 0; margin: 0 12px 0 10px; }
.idims-nav-stack { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: column; }
.idims-nav-row { display: flex; align-items: center; min-width: 0; }
.idims-row-top { flex: 1.08; gap: 12px; padding: 8px 0 4px 0; border-bottom: 1px solid #EEF1F7; }
.idims-row-bottom { position: relative; flex: 1; padding: 6px 0 10px 0; min-width: 0; }
/* No horizontal scroll — items that don't fit collapse into "More". */
.idims-row-bottom .idims-nav-items { gap: 2px; overflow: visible; flex-wrap: nowrap; }
/* Hidden measuring row: laid out flat off-screen, never visible/clickable. */
.idims-nav-ghost { position: absolute; top: 0; left: 0; display: flex; gap: 2px; flex-wrap: nowrap;
  white-space: nowrap; visibility: hidden; pointer-events: none; height: 0; overflow: hidden; }

/* Overflow "More" dropdown panel */
.idims-more-wrap { position: relative; flex-shrink: 0; }
.idims-more-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 1200; min-width: 240px; max-width: 320px;
  max-height: 70vh; overflow-y: auto; background: #fff; border: 1px solid #E7EAF3; border-radius: 12px;
  box-shadow: 0 12px 34px rgba(15,23,42,.16); padding: 6px; }
.idims-more-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent;
  padding: 9px 11px; border-radius: 12px; cursor: pointer; text-align: left; font-size: 13px; font-weight: 400; color: #0F172A; transition: background .14s; }
.idims-more-item:hover { background: #F5F3FF; }
.idims-more-item.open { background: #F5F3FF; }
.idims-more-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-more-chev { display: flex; align-items: center; color: #9AA2B8; transition: transform .18s; }
.idims-more-item.open .idims-more-chev { transform: rotate(180deg); }
.idims-more-sub { padding: 2px 0 6px 12px; margin-left: 10px; border-left: 2px solid #EEF1F8; }
.idims-more-subgroup { margin-top: 4px; }
.idims-more-sub-label { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #94A0B8; padding: 5px 10px 2px; }
.idims-more-sub-item { display: block; width: 100%; border: none; background: transparent; text-align: left;
  padding: 6px 10px; border-radius: 7px; cursor: pointer; font-size: 12.5px; color: #475569; transition: background .14s, color .14s; }
.idims-more-sub-item:hover { background: #F5F3FF; color: #7C3AED; }

/* Search */
.idims-search { position: relative; width: 440px; flex-shrink: 0; height: 40px; display: flex; align-items: center; gap: 10px;
  background: linear-gradient(180deg,#FFF,#F7F8FC); border: 1.5px solid #E7EAF3; border-radius: 12px; padding: 0 6px 0 13px;
  box-shadow: inset 0 1px 2px rgba(15,23,42,.04); transition: border-color .18s, box-shadow .18s, background .18s; }
.idims-search-clear { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px;
  border: none; background: transparent; color: #9AA2B8; border-radius: 6px; cursor: pointer; padding: 0; transition: background .15s, color .15s; }
.idims-search-clear svg { width: 13px; height: 13px; }
.idims-search-clear:hover { background: #EEF1F8; color: #475569; }
.idims-search-results { position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 1200;
  background: #fff; border: 1px solid #E7EAF3; border-radius: 12px; box-shadow: 0 12px 34px rgba(15,23,42,.16);
  padding: 6px; max-height: 380px; overflow-y: auto; }
.idims-search-empty { padding: 14px 12px; font-size: 12.5px; color: #9AA2B8; text-align: center; }
.idims-search-result { display: flex; align-items: center; gap: 11px; width: 100%; border: none; background: transparent;
  padding: 8px 10px; border-radius: 9px; cursor: pointer; text-align: left; transition: background .14s; }
.idims-search-result:hover { background: #F5F3FF; }
.idims-search-result-ico { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border-radius: 8px; background: #F1F0FB; color: #7C3AED; }
.idims-search-result-ico svg { width: 15px; height: 15px; }
.idims-search-result-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.idims-search-result-label { font-size: 13px; font-weight: 400; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-search-result-sub { font-size: 11px; color: #94A0B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-search:hover { border-color: #D6DBEC; }
.idims-search:focus-within { background: #fff; border-color: #C4B5FD; box-shadow: 0 0 0 4px rgba(139,92,246,.15); }
.idims-search-ico { display: flex; align-items: center; color: #A0A8BD; flex-shrink: 0; transition: color .18s; }
.idims-search:focus-within .idims-search-ico { color: #7C3AED; }
.idims-search-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-family: inherit; font-size: 13px; color: #0F172A; }
.idims-search-input::placeholder { color: #9AA2B8; }
.idims-search-kbd { flex-shrink: 0; font-size: 10.5px; font-weight: 400; color: #6B7280; background: linear-gradient(180deg,#FFF,#F1F3F9); border: 1px solid #E2E6F0; border-bottom-width: 2px; border-radius: 7px; padding: 3px 8px; line-height: 1; }

/* Branch switcher */
.idims-branch-wrap { position: relative; flex-shrink: 0; margin-left: auto; }
.idims-branch-btn { display: flex; align-items: center; gap: 9px; height: 40px; padding: 0 11px 0 12px; border-radius: 12px;
  background: linear-gradient(180deg,#FFF,#F7F8FC); border: 1.5px solid #E7EAF3; font-family: inherit;
  box-shadow: inset 0 1px 2px rgba(15,23,42,.03); transition: border-color .18s, box-shadow .18s; width: 300px; }
.idims-branch-btn:hover { border-color: #DDD6FE; }
.idims-branch-btn.dd-open { border-color: #C4B5FD; box-shadow: 0 0 0 4px rgba(139,92,246,.13); background: #fff; }
.idims-branch-ico { width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg,#A78BFA,#7C3AED); box-shadow: 0 2px 5px rgba(124,58,237,.3); }
.idims-branch-ico svg { width: 14px; height: 14px; }
.idims-branch-meta { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; gap: 2px; text-align: left; }
.idims-branch-name { font-size: 12.5px; font-weight: 700; color: #1E293B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px; }
.idims-branch-tag { align-self: flex-start; margin-top: 2px; font-size: 8px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; color: #6D28D9; background: linear-gradient(135deg,#EDE9FE,#DDD6FE); border: 1px solid #DDD6FE; border-radius: 5px; padding: 1.5px 6px; line-height: 1; }
.idims-branch-chev { color: #94A3B8; flex-shrink: 0; margin-left: auto; transition: transform .2s; }
.idims-branch-btn.dd-open .idims-branch-chev { transform: rotate(180deg); color: #7C3AED; }
.idims-branch-panel { position: absolute; top: calc(100% + 10px); left: 0; right: 0; z-index: 1040; border-radius: 16px; overflow: hidden; background: #fff; border: 1px solid #EAECF3; box-shadow: 0 18px 48px rgba(15,23,42,.16); opacity: 0; transform: translateY(-8px) scale(.98); pointer-events: none; transform-origin: top left; transition: opacity .18s ease, transform .2s cubic-bezier(.22,1,.36,1); }
.idims-branch-panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
.idims-branch-panel-bar { height: 4px; background: linear-gradient(90deg,#94A3B8,#8B5CF6 55%,#7C3AED); }
.idims-branch-head { padding: 12px 16px 10px; font-size: 10.5px; font-weight: 700; letter-spacing: .8px; color: #94A3B8; border-bottom: 1px solid #F1F3F9; }
.idims-branch-list { padding: 8px; max-height: 320px; overflow-y: auto; }
.idims-branch-item { display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 11px; cursor: pointer; transition: background .14s, transform .14s; }
.idims-branch-item:hover { background: #F5F3FF; transform: translateX(2px); }
.idims-branch-item.active { background: #F5F3FF; }
.idims-branch-avatar { width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; box-shadow: 0 2px 6px rgba(15,23,42,.18); }
.idims-branch-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; text-align: left; }
.idims-branch-item-name { font-size: 12.5px; font-weight: 700; color: #6D28D9; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-branch-item-sub { font-size: 10px; font-weight: 400; color: #94A3B8; }
.idims-branch-name-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.idims-branch-main-badge { flex-shrink: 0; font-size: 8.5px; font-weight: 800; letter-spacing: .4px; color: #6D28D9; background: linear-gradient(135deg,#EDE9FE,#DDD6FE); border: 1px solid #DDD6FE; border-radius: 5px; padding: 2px 6px; line-height: 1; text-transform: uppercase; }
.idims-branch-check { color: #7C3AED; flex-shrink: 0; opacity: 0; transition: opacity .14s; }
.idims-branch-item.active .idims-branch-check { opacity: 1; }
.idims-branch-all { border-bottom: 1px solid #F1F3F9; border-radius: 0; margin-bottom: 4px; }
.idims-branch-all .idims-branch-avatar { background: linear-gradient(135deg,#EDE9FE,#DDD6FE); color: #7C3AED; box-shadow: none; border: 1px solid #DDD6FE; }
.idims-branch-all .idims-branch-item-name { color: #4338CA; }

/* Right controls */
.idims-nav-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin-left: auto; }
.idims-theme-switch { display: flex; align-items: center; gap: 9px; flex-shrink: 0; padding: 4px 10px 4px 11px; border-radius: 999px; background: linear-gradient(180deg,#FFF,#F7F8FC); border: 1.5px solid #E7EAF3; }
.idims-theme-switch-label { font-size: 11.5px; font-weight: 400; color: #6B7280; user-select: none; white-space: nowrap; }
.idims-brand .idims-theme-switch-label { color: var(--bp, #7C3AED); }
.idims-theme-toggle { position: relative; width: 42px; height: 22px; border-radius: 999px; border: none; cursor: pointer; flex-shrink: 0; padding: 0; background: linear-gradient(135deg,#CBD5E1,#94A3B8); box-shadow: inset 0 1px 3px rgba(15,23,42,.18); transition: background .25s ease; }
.idims-theme-toggle::after { content: ''; position: absolute; top: 2.5px; left: 2.5px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.3); transition: transform .28s cubic-bezier(.34,1.56,.64,1); }
.idims-brand .idims-theme-toggle { background: var(--bp, #7C3AED); }
.idims-brand .idims-theme-toggle::after { transform: translateX(20px); }

/* Brand mode — swap the default violet hover/active accents for the tenant
   primary colour (topbar stays white). Covers nav buttons + the top-right
   action icons + the active underline + the mobile menu rows. */
/* !important so brand wins over the dark-theme hover rule (.idims-dark
   .idims-nav-btn:hover) which has equal specificity but comes later — without
   it the icon/underline turn primary in dark+brand but the text stays grey. */
.idims-brand .idims-nav-btn:hover, .idims-brand .idims-nav-btn.dd-open { color: var(--bp) !important; }
.idims-brand .idims-nav-btn:hover .idims-ico, .idims-brand .idims-nav-btn.dd-open .idims-ico { color: var(--bp) !important; }
.idims-brand .idims-nav-btn::after { background: var(--bp); }
.idims-brand .idims-action-btn:hover { color: var(--bp); background: color-mix(in srgb, var(--bp) 10%, transparent); }
.idims-brand .idims-mob-item:hover, .idims-brand .idims-mob-item.open { color: var(--bp); background: color-mix(in srgb, var(--bp) 10%, transparent); }
.idims-brand .idims-mob-item:hover .idims-ico, .idims-brand .idims-mob-item.open .idims-ico { color: var(--bp); }
/* Branch switcher + profile accents → primary in brand mode. */
.idims-brand .idims-branch-ico { background: var(--bp); box-shadow: 0 2px 5px color-mix(in srgb, var(--bp) 40%, transparent); }
.idims-brand .idims-branch-btn.dd-open { border-color: var(--bp); box-shadow: 0 0 0 4px color-mix(in srgb, var(--bp) 16%, transparent); }
.idims-brand .idims-branch-btn.dd-open .idims-branch-chev { color: var(--bp); }
.idims-brand .idims-branch-tag, .idims-brand .idims-branch-main-badge { color: var(--bp); background: color-mix(in srgb, var(--bp) 14%, transparent); border-color: color-mix(in srgb, var(--bp) 32%, transparent); }
.idims-brand .idims-branch-panel-bar { background: var(--bp); }
.idims-brand .idims-branch-item:hover, .idims-brand .idims-branch-item.active { background: color-mix(in srgb, var(--bp) 8%, transparent); }
.idims-brand .idims-branch-item-name { color: var(--bp); }
.idims-brand .idims-branch-check { color: var(--bp); }
.idims-brand .idims-branch-list .idims-branch-item:not(.idims-branch-all) .idims-branch-avatar { background: var(--bp) !important; }
.idims-brand .idims-profile-icon::before { background: var(--bp); }
.idims-brand .idims-search:focus-within { border-color: var(--bp); box-shadow: 0 0 0 4px color-mix(in srgb, var(--bp) 15%, transparent); }
.idims-brand .idims-search:focus-within .idims-search-ico { color: var(--bp); }
.idims-actions { display: flex; align-items: center; gap: 2px; }
.idims-action-btn { position: relative; width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: #64748B; flex-shrink: 0; transition: color .18s, background .18s; }
.idims-action-btn:hover { color: #7C3AED; background: #F5F3FF; }
.idims-logout-btn { color: #E11D48; }
.idims-logout-btn:hover { background: #FFF1F2; color: #E11D48; }
.idims-action-btn svg { width: 18px; height: 18px; display: block; }
.idims-action-badge { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: #7C3AED; border: 2px solid #fff; }
.idims-action-sep { width: 1px; height: 20px; flex-shrink: 0; background: #E7EAF3; }

/* Profile */
.idims-profile-wrap { position: relative; flex-shrink: 0; }
.idims-profile-icon { position: relative; width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; cursor: pointer; padding: 0; background: none; border: none; transition: transform .2s; }
.idims-profile-icon::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(135deg,#94A3B8,#8B5CF6 55%,#7C3AED); padding: 2px; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.idims-profile-icon:hover { transform: scale(1.06); }
.idims-profile-icon img { position: relative; z-index: 1; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; padding: 3px; box-sizing: border-box; }
.idims-profile-initials { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg,#8B5CF6,#6D28D9); color: #fff; font-size: 14px; font-weight: 800; }
.idims-profile-initials.lg { font-size: 18px; }
.idims-online-dot { position: absolute; bottom: 2px; right: 2px; z-index: 2; width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle at 35% 30%,#4ADE80,#16A34A); border: 2.5px solid #fff; }
.idims-profile-panel { position: absolute; top: calc(100% + 12px); right: 0; z-index: 1040; width: 290px; border-radius: 18px; overflow: hidden; background: #fff; border: 1px solid #ECECF6; box-shadow: 0 24px 60px rgba(76,29,149,.2); opacity: 0; transform: translateY(-10px) scale(.96); pointer-events: none; transform-origin: top right; transition: opacity .2s ease, transform .24s cubic-bezier(.22,1,.36,1); }
.idims-profile-panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
.idims-profile-head { display: flex; align-items: center; gap: 13px; padding: 18px 18px 16px; background: linear-gradient(135deg,#1E1B4B 0%,#4338CA 55%,#6D28D9 100%); position: relative; overflow: hidden; }
.idims-profile-head-avatar { position: relative; width: 48px; height: 48px; flex-shrink: 0; z-index: 1; }
.idims-profile-head-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 2.5px solid rgba(255,255,255,.7); }
.idims-profile-head-avatar .idims-profile-initials { border: 2.5px solid rgba(255,255,255,.7); }
.idims-profile-head-dot { position: absolute; bottom: 1px; right: 1px; width: 11px; height: 11px; border-radius: 50%; background: radial-gradient(circle at 35% 30%,#4ADE80,#16A34A); border: 2.5px solid #312E81; }
.idims-profile-head-info { min-width: 0; z-index: 1; }
.idims-profile-head-name { font-size: 15px; font-weight: 800; color: #fff; line-height: 1.2; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-profile-head-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; color: #E9D5FF; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.25); border-radius: 999px; padding: 3px 9px 3px 7px; }
.idims-profile-head-badge svg { width: 11px; height: 11px; }
.idims-profile-head-branch { display: flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 11px; font-weight: 400; color: rgba(255,255,255,.85); max-width: 165px; }
.idims-profile-head-branch svg { width: 12px; height: 12px; flex-shrink: 0; opacity: .85; }
.idims-profile-head-branch span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idims-profile-menu { padding: 8px; }
.idims-profile-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 12px; cursor: pointer; width: 100%; background: none; border: none; font-family: inherit; transition: background .14s, transform .14s; }
.idims-profile-item:hover { background: #F5F3FF; transform: translateX(2px); }
.idims-profile-item-ico { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(15,23,42,.18); }
.idims-profile-item-ico svg { width: 16px; height: 16px; }
.idims-profile-item-label { flex: 1; font-size: 13.5px; font-weight: 500; color: #1E293B; text-align: left; }
.idims-profile-item-arrow { width: 14px; height: 14px; color: #C4C9D6; flex-shrink: 0; transition: transform .15s, color .15s; }
.idims-profile-item:hover .idims-profile-item-arrow { transform: translateX(2px); color: #7C3AED; }
.idims-profile-item:hover .idims-profile-item-label { color: #6D28D9; }
.idims-profile-divider { height: 1px; background: #F1F3F9; margin: 6px 8px; }
.idims-profile-logout:hover { background: #FFF1F2; }
.idims-profile-logout:hover .idims-profile-item-label { color: #E11D48; }

/* Nav buttons */
.idims-nav-items { display: flex; align-items: center; flex: 1; min-width: 0; gap: 2px; }
.idims-dd-wrap { position: relative; flex-shrink: 0; }
.idims-nav-btn { position: relative; height: 36px; padding: 0 9px; border-radius: 9px; display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: #5B6478; background: transparent; border: none; cursor: pointer; font-family: inherit; transition: color .2s ease; white-space: nowrap; flex-shrink: 0; }
.idims-nav-btn .idims-ico { display: flex; align-items: center; flex-shrink: 0; color: #A2ABBD; transition: color .2s ease, transform .25s cubic-bezier(.34,1.56,.64,1); }
.idims-nav-btn::after { content: ''; position: absolute; left: 50%; bottom: 2px; width: 0; height: 2.5px; border-radius: 99px; transform: translateX(-50%); background: linear-gradient(90deg,#94A3B8 0%,#8B5CF6 55%,#7C3AED 100%); opacity: 0; transition: width .26s cubic-bezier(.22,1,.36,1), opacity .2s ease; }
.idims-nav-btn:hover { color: #6D28D9; }
.idims-nav-btn:hover .idims-ico { color: #8B5CF6; transform: scale(1.12); }
.idims-nav-btn:hover::after { width: 100%; opacity: 1; }
.idims-nav-btn.dd-open { font-weight: 500; color: #6D28D9; }
.idims-nav-btn.dd-open .idims-ico { color: #8B5CF6; }
.idims-nav-btn.dd-open::after { width: 100%; opacity: 1; }
.dd-chev { display: flex; align-items: center; opacity: .45; transition: transform .18s, opacity .13s; margin-left: 2px; }
.idims-nav-btn.dd-open .dd-chev { transform: rotate(180deg); opacity: .9; }

/* Dropdown / mega menu.
   position: fixed + centered so the panel escapes the .idims-nav-items
   horizontal scroll container (which would otherwise clip it vertically). */
.idims-dropdown { position: fixed; top: 116px; left: 50%; transform: translateX(-50%); width: min(1060px, calc(100vw - 48px)); max-height: calc(100vh - 128px); display: flex; flex-direction: column; background: #fff; border: 1.5px solid #E8ECF5; border-radius: 18px; box-shadow: 0 24px 70px rgba(15,23,42,.28); z-index: 1050; overflow: hidden; animation: idimsDD .18s cubic-bezier(.22,1,.36,1) both; }
.idims-dd-wide { width: min(1480px, calc(100vw - 28px)); }
/* P2P has 4 columns but compact content — narrower than the CLM/HR wide menu,
   yet roomy enough that the longer labels don't crowd. */
.idims-dd-p2p { width: min(1260px, calc(100vw - 28px)); }
.idims-dd-med { width: min(620px, calc(100vw - 28px)); }
/* CLM mega layout — 3 sections; Operations + Master Management each split into
   two sub-columns with sub-headers; Without-Shipment nests its agreements. */
.idims-clm-grid { display: grid; grid-template-columns: 290px 1.1fr 1.35fr; align-items: stretch; }
.idims-clm-sub { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 2px; }
.idims-clm-subcol { padding: 0 16px 0 0; min-width: 0; }
.idims-clm-subcol + .idims-clm-subcol { padding: 0 0 0 16px; border-left: 1px solid #EFF2F8; }
.idims-clm-subhead { font-size: 8px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px; padding: 0 0 7px 2px; border-bottom: 1.5px solid; opacity: .85; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.idims-clm-children { margin: 0 0 6px 12px; padding-left: 10px; border-left: 2px solid #BAE6FD; }
.idims-clm-child { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 6px 8px; background: none; border: none; font-family: inherit; cursor: pointer; border-radius: 8px; text-align: left; transition: background .13s, transform .13s; }
.idims-clm-child:hover { background: #F5F3FF; transform: translateX(2px); }
.idims-clm-child-ico { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
.idims-clm-child-label { font-size: 12px; font-weight: 400; color: #1E293B; white-space: nowrap; line-height: 1.2; }
.idims-clm-child:hover .idims-clm-child-label { color: #0EA5E9; }
.idims-dark .idims-clm-subcol + .idims-clm-subcol { border-left-color: #262B38; }
.idims-dark .idims-clm-children { border-left-color: rgba(56,189,248,.45); }
.idims-dark .idims-clm-child:hover { background: rgba(167,139,250,.12); }
.idims-dark .idims-clm-child-label { color: #E5E7EB; }
.idims-dark .idims-clm-child-ico { background: rgba(148,163,184,.14) !important; }
@keyframes idimsDD { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.idims-dd-topbar { height: 4px; flex-shrink: 0; background: linear-gradient(90deg,#7C3AED 0%,#A78BFA 28%,#0EA5E9 52%,#38BDF8 68%,#0D9488 84%,#2DD4BF 100%); }
/* flex:1 + min-height:0 lets the content scroll within the height-capped panel
   so a tall mega-menu (CLM) never spills below the viewport and gets clipped. */
.idims-dd-inner { padding: 8px 12px 14px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
.idims-dd-inner::-webkit-scrollbar { width: 9px; }
.idims-dd-inner::-webkit-scrollbar-track { background: transparent; }
.idims-dd-inner::-webkit-scrollbar-thumb { background: #D7DBEA; border-radius: 8px; border: 2px solid #fff; background-clip: padding-box; }
.idims-dd-inner::-webkit-scrollbar-thumb:hover { background: #C0C6DC; background-clip: padding-box; }
.idims-dark .idims-dd-inner::-webkit-scrollbar-thumb { background: #3A4150; border-color: #171A23; }
/* align-items: stretch so every column fills the tallest column's height —
   then the border-right dividers run the full panel height (like the
   prototype) instead of stopping at each column's own content. */
.idims-dd-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: stretch; gap: 0; }
.idims-dd-col { padding: 18px 24px 22px 20px; border-right: 1px solid #E6EAF3; }
.idims-dd-col:last-child { border-right: none; }
.idims-dd-group + .idims-dd-group { margin-top: 14px; }
.idims-dd-section-label { font-size: 8px; font-weight: 600; letter-spacing: 1.1px; text-transform: uppercase; padding: 0 0 10px 12px; margin-bottom: 10px; border-bottom: 1px solid #F1F4FB; display: flex; align-items: center; gap: 7px; white-space: nowrap; position: relative; }
/* Small standing color bar on the left of each section header (matches Figma).
   currentColor = the column accent set inline on the label. */
.idims-dd-section-label::before { content: ''; position: absolute; left: 0; top: 0; bottom: 11px; width: 3px; border-radius: 2px; background: currentColor; }
.dd-sl-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.idims-dd-item { display: flex; align-items: flex-start; gap: 13px; padding: 9px 11px; cursor: pointer; border-radius: 11px; width: 100%; background: none; border: none; font-family: inherit; transition: background .13s, transform .13s; margin-bottom: 4px; text-align: left; }
.idims-dd-item:hover { transform: translateX(2px); background: #F5F3FF; }
.idims-dd-item:hover .idims-dd-item-label { color: var(--ac, #4F46E5); }
.idims-dd-item-ico { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; transition: transform .13s; }
.idims-dd-item-ico svg { width: 16px; height: 16px; }
.idims-dd-item:hover .idims-dd-item-ico { transform: scale(1.08); }
.idims-dd-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.idims-dd-item-label { font-size: 12px; font-weight: 400; color: #1E293B; white-space: nowrap; line-height: 1.2; transition: color .13s; }
.idims-dd-item-desc { font-size: 9px;  color: #94A3B8; line-height： 1.4; white-space： normal； opacity： .85； }

/* Logout modal */
.idims-logout-overlay { position: fixed; inset: 0; z-index： 1060； display： flex； align-items： center； justify-content： center； padding： 20px； background： rgba(15,23,42,.42)； backdrop-filter： blur(5px)； animation： idimsFade .2s ease； }
@keyframes idimsFade { from { opacity： 0； } to { opacity： 1； } }
.idims-logout-modal { width: 100%; max-width: 380px; border-radius: 22px; overflow: hidden; background: #fff; text-align: center; padding: 30px 28px 24px; box-shadow: 0 30px 80px rgba(15,23,42,.32); position: relative; animation: idimsPop .32s cubic-bezier(.34,1.56,.64,1); }
@keyframes idimsPop { from { opacity: 0; transform: translateY(14px) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
.idims-logout-modal::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg,#FB7185,#F43F5E 55%,#E11D48); }
.idims-logout-icon { width: 70px; height: 70px; border-radius: 20px; margin: 4px auto 18px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#FFE4E6,#FECDD3); box-shadow: 0 8px 22px rgba(244,63,94,.22); }
.idims-logout-title { font-size: 18px; font-weight: 800; color: #0F172A; margin-bottom: 7px; }
.idims-logout-text { font-size: 13px; color: #64748B; line-height: 1.5; margin-bottom: 24px; }
.idims-logout-actions { display: flex; gap: 12px; }
.idims-logout-actions button { flex: 1; height: 46px; border-radius: 13px; font-family: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; border: none; transition: transform .14s, box-shadow .18s, background .18s; }
.idims-logout-actions button:active { transform: scale(.97); }
.idims-btn-cancel { background: #F1F3F9; color: #475569; border: 1.5px solid #E7EAF3 !important; }
.idims-btn-cancel:hover { background: #E9ECF3; color: #1E293B; }
.idims-btn-confirm { color: #fff; background: linear-gradient(135deg,#F43F5E,#E11D48); box-shadow: 0 6px 16px rgba(225,29,72,.35); }
.idims-btn-confirm:hover { box-shadow: 0 8px 22px rgba(225,29,72,.45); transform: translateY(-1px); }

/* Dark theme */
.idims-dark .idims-nav { background: #171A23; border-bottom-color: #262B38; }
.idims-dark .idims-row-top { border-bottom-color: #262B38; }
.idims-dark .idims-divider { background: #262B38; }
.idims-dark .idims-search { background: linear-gradient(180deg,#1E2230,#1A1D29); border-color: #2C3242; }
.idims-dark .idims-search-input { color: #E5E7EB; }
.idims-dark .idims-search-kbd { background: #1E2230; border-color: #2C3242; color: #9CA3AF; }
.idims-dark .idims-search-clear:hover { background: #2C3242; color: #CBD5E1; }
.idims-dark .idims-search-results { background: #1A1D29; border-color: #2C3242; box-shadow: 0 12px 34px rgba(0,0,0,.5); }
.idims-dark .idims-search-result:hover { background: #252A3A; }
.idims-dark .idims-search-result-ico { background: #252A3A; color: #A78BFA; }
.idims-dark .idims-search-result-label { color: #E5E7EB; }
.idims-dark .idims-search-result-sub { color: #7E8AA3; }
.idims-dark .idims-search-empty { color: #7E8AA3; }
.idims-dark .idims-more-panel { background: #1A1D29; border-color: #2C3242; box-shadow: 0 12px 34px rgba(0,0,0,.5); }
.idims-dark .idims-more-item { color: #E5E7EB; }
.idims-dark .idims-more-item:hover, .idims-dark .idims-more-item.open { background: #252A3A; }
.idims-dark .idims-more-sub { border-left-color: #2C3242; }
.idims-dark .idims-more-sub-label { color: #7E8AA3; }
.idims-dark .idims-more-sub-item { color: #AEB7CC; }
.idims-dark .idims-more-sub-item:hover { background: #252A3A; color: #A78BFA; }
.idims-dark .idims-nav-btn { color: #9CA3AF; }
.idims-dark .idims-nav-btn:hover, .idims-dark .idims-nav-btn.dd-open { color: #C4B5FD; }
.idims-dark .idims-action-btn { color: #9CA3AF; }
.idims-dark .idims-action-btn:hover { color: #C4B5FD; background: #221E36; }
/* Keep the logout icon RED in dark mode too (the generic action-btn rule
 * above otherwise greys it out). Brighter rose so it reads on the dark nav. */
.idims-dark .idims-logout-btn { color: #FB7185; }
.idims-dark .idims-logout-btn:hover { color: #FDA4AF; background: rgba(244,63,94,.16); }
.idims-dark .idims-action-sep { background: #2C3242; }
.idims-dark .idims-theme-switch, .idims-dark .idims-branch-btn { background: linear-gradient(180deg,#1E2230,#1A1D29); border-color: #2C3242; }
.idims-dark .idims-branch-name { color: #E5E7EB; }
.idims-dark .idims-branch-panel, .idims-dark .idims-profile-panel, .idims-dark .idims-dropdown, .idims-dark .idims-logout-modal { background: #171A23; border-color: #262B38; }
.idims-dark .idims-branch-head, .idims-dark .idims-branch-all { border-color: #262B38; }
.idims-dark .idims-branch-item:hover, .idims-dark .idims-branch-item.active, .idims-dark .idims-profile-item:hover { background: #221E36; }
.idims-dark .idims-dd-item-label, .idims-dark .idims-profile-item-label { color: #E5E7EB; }
.idims-dark .idims-dd-item:hover { background: rgba(167,139,250,.12); }
.idims-dark .idims-dd-item:hover .idims-dd-item-label { color: #C4B5FD; }
/* The leaf icon chips use light tints inline; dim them for the dark panel
   so they don't read as bright white dots. The accent-coloured dot stays. */
.idims-dark .idims-dd-item-ico { background: rgba(148,163,184,.14) !important; }
.idims-dark .idims-dd-col { border-right-color: #262B38; }
.idims-dark .idims-dd-section-label { border-bottom-color: #262B38; }
.idims-dark .idims-logout-title { color: #F1F5F9; }
.idims-dark .idims-logout-text { color: #9CA3AF; }
.idims-dark .idims-btn-cancel { background: #232838; color: #CBD5E1; border-color: #2C3242 !important; }

/* Hamburger + mobile panel (hidden on desktop) */
.idims-hamburger { display: none; width: 38px; height: 38px; flex-shrink: 0; border: 1.5px solid #E7EAF3; background: linear-gradient(180deg,#FFF,#F7F8FC); border-radius: 10px; color: #5B6478; align-items: center; justify-content: center; cursor: pointer; }
.idims-hamburger svg { width: 20px; height: 20px; }
.idims-dark .idims-hamburger { background: #1E2230; border-color: #2C3242; color: #C4B5FD; }
.idims-mob-backdrop { position: fixed; inset: 0; top: 0; z-index: 1041; background: rgba(15,23,42,.35); animation: idimsFade .18s ease; }
.idims-mobile-panel { position: absolute; left: 0; right: 0; top: 100%; z-index: 1042; background: #fff; border-bottom: 1px solid #E4E7EF; box-shadow: 0 20px 50px rgba(15,23,42,.22); padding: 10px; max-height: calc(100vh - 120px); overflow-y: auto; animation: idimsDDdown .2s cubic-bezier(.22,1,.36,1) both; }
@keyframes idimsDDdown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
.idims-mob-item { display: flex; align-items: center; gap: 11px; width: 100%; padding: 12px 12px; border: none; background: none; font-family: inherit; font-size: 14px; font-weight: 600; color: #1E293B; cursor: pointer; border-radius: 11px; text-align: left; }
.idims-mob-item:hover, .idims-mob-item.open { background: #F5F3FF; color: #6D28D9; }
.idims-mob-item .idims-ico { display: flex; color: #8B5CF6; }
.idims-mob-label { flex: 1; }
.idims-mob-chev { display: flex; transition: transform .18s; opacity: .5; }
.idims-mob-item.open .idims-mob-chev { transform: rotate(180deg); opacity: .9; }
.idims-mob-sub { padding: 2px 0 8px 14px; margin-left: 14px; border-left: 2px solid #EDE9FE; }
.idims-mob-subgroup { margin: 6px 0; }
.idims-mob-sub-label { font-size: 8.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #94A3B8; padding: 6px 10px 4px; }
.idims-mob-sub-item { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; border-radius: 8px; }
.idims-mob-sub-item:hover { background: #F5F3FF; color: #6D28D9; }
.idims-dark .idims-mobile-panel { background: #171A23; border-bottom-color: #262B38; }
.idims-dark .idims-mob-item { color: #E5E7EB; }
.idims-dark .idims-mob-item:hover, .idims-dark .idims-mob-item.open, .idims-dark .idims-mob-sub-item:hover { background: #221E36; color: #C4B5FD; }
.idims-dark .idims-mob-sub { border-left-color: #2C3242; }
.idims-dark .idims-mob-sub-item { color: #9CA3AF; }

/* ── Responsive ──────────────────────────────────────────────────────────
   Four tiers:
   · ≥1281        full two-row desktop bar
   · 1025–1280    laptop — same two rows, search narrows, nav row scrolls if tight
   · 641–1024     tablet — single compact row, nav moves into hamburger panel
   · ≤640         phone  — search + branch hidden; just logo + icons + profile
   ───────────────────────────────────────────────────────────────────────── */

/* Laptop: keep the two-row layout but tighten the top row so nothing clips. */
@media (max-width: 1280px) {
  .idims-search { width: 300px; }
  .idims-branch-btn { width: auto; min-width: 0; max-width: 230px; }
  .idims-nav-right { gap: 9px; }
}
@media (max-width: 1120px) {
  .idims-search { width: 240px; }
  .idims-theme-switch-label { display: none; }
  .idims-theme-switch { padding: 4px 8px; }
}

/* Tablet + phone share the collapse to a hamburger-driven single bar. */
@media (max-width: 1024px) {
  .idims-nav { height: auto; padding: 9px 12px; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
  .idims-divider { display: none; }
  .idims-logo { order: 0; }
  .idims-logo-full { height: 38px; }
  .idims-logo-pill { padding: 5px 11px; }
  .idims-nav-stack { gap: 8px; }
  .idims-row-top { border-bottom: none; padding: 0; gap: 8px 10px; flex-wrap: wrap; align-items: center; }
  .idims-row-bottom { display: none; }
  .idims-hamburger { display: flex; order: 0; }
  /* line 1: controls pinned to the right of the hamburger */
  .idims-nav-right { order: 1; margin-left: auto; gap: 8px; }
  /* line 2: search grows, branch sits beside it */
  .idims-search { order: 5; flex: 1 1 60%; min-width: 170px; width: auto; }
  .idims-branch-wrap { order: 6; margin-left: 0; flex: 0 0 auto; }
  .idims-branch-btn { width: auto; min-width: 0; max-width: 210px; }
  .idims-branch-name { max-width: 140px; }
  .idims-theme-switch-label { display: inline; }
  .idims-theme-switch { padding: 4px 10px 4px 11px; }
}

/* Phone: too narrow for a usable search box or branch pill, so hide both —
   the header becomes one clean row (logo · hamburger · icons · profile).
   Branch switching stays reachable on tablet/desktop; search via the menu. */
@media (max-width: 640px) {
  .idims-nav { padding: 9px 12px; gap: 8px; align-items: center; flex-wrap: nowrap; }
  .idims-search { display: none; }
  .idims-branch-wrap { display: none; }
  .idims-theme-switch { display: none; }
  .idims-fs-btn { display: none; }
  /* One tidy single row: [logo] ............ [☰ · icons · profile].
     nowrap keeps the icons from dropping to a second line; the auto-margin on
     the hamburger pushes the whole right cluster to the right edge. */
  .idims-row-top { gap: 8px; flex-wrap: nowrap; }
  .idims-hamburger { margin-left: auto; flex-shrink: 0; }
  .idims-nav-right { margin-left: 6px; flex-shrink: 0; }
  .idims-actions { gap: 2px; }
  .idims-action-btn { width: 36px; height: 36px; }
  .idims-action-sep { display: none; }
  .idims-profile-panel { width: min(290px, calc(100vw - 24px)); }
}
@media (max-width: 380px) {
  .idims-logo-full { height: 32px; }
  .idims-logo-pill { padding: 4px 9px; }
  .idims-action-btn { width: 33px; height: 33px; }
  .idims-action-btn svg { width: 17px; height: 17px; }
}
`;
