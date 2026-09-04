import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
import type { SupplierScope } from './SupplierScopeGate';
import type { SupplierVaultTarget } from './SupplierEvidenceVaultModal';

import { ShimmerTable, ShimmerClmMaster } from '../../../../components/ui/Shimmer';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import {
  readVendorMasterBundle,
  writeVendorMasterBundle,
} from './vendorBundleCache';
import './supplier-management.css';

/* LAZY, not static. These three are only ever rendered behind a click, but a
   static import pulls them into the module graph the moment the list route
   loads — the browser downloaded the whole wizard, the whole vault (and its
   jszip + file-saver) before the table had a single row on it.

   Conditional RENDERING (which was already here) does not help: it decides
   what to mount, not what to fetch. Only a dynamic import moves the code out
   of this route's chunk, which is what Vite splits on.

   MappedProductsViewPopup is a named export of AddVendorModal, so it is
   mapped onto .default — both specifiers resolve to the SAME module, so the
   wizard chunk is fetched once and shared, not twice. */
const AddVendorModal = lazy(() => import('./AddVendorModal'));
const MappedProductsViewPopup = lazy(() =>
  import('./AddVendorModal').then(m => ({ default: m.MappedProductsViewPopup })));
const SupplierScopeGate = lazy(() => import('./SupplierScopeGate'));
const SupplierEvidenceVaultModal = lazy(() => import('./SupplierEvidenceVaultModal'));

/* Hover-prefetch. Making the wizard lazy moves its ~45 KB (gzipped) off page
   load, but it has to arrive sometime — and 'sometime' would otherwise be
   after the click, as a visible pause. Pointer-enter on the Add button fires
   the same import ~300ms early, so the chunk is usually cached by the time the
   click lands. Fire-and-forget: the import is idempotent and React.lazy reuses
   the very same promise, so an in-flight prefetch is awaited rather than
   repeated, and a failure here is retried by lazy() at render time. */
const warmVendorWizard = () => { void import('./AddVendorModal'); };

/* ────────────────────────────────────────────────────────────────────────────
 * Vendors — front-end only master list
 *
 * Mirrors the Clients master shell:
 *   • White surface card wrapping the page (no purple gradient hero)
 *   • Active / Inactive status filter pills
 *   • Velzon table chrome (table-card border rounded, table-light thead)
 *   • Add Vendor button → opens a 4-step wizard modal
 *
 * No API: vendors live in component state. When the backend ships, swap
 * SEED + the modal's submit handler for real fetch / POST calls.
 * ──────────────────────────────────────────────────────────────────────── */

export type Vendor = {
  id: number;
  code: string;
  companyName: string;
  legalName: string;
  type: string;
  state: string;
  stateCode?: string | null;
  city: string;
  contactName: string;
  designation: string;
  phone: string;
  email: string;
  status: 'Active' | 'Inactive';
  /* Number of distinct opportunities (leads) this supplier's mapped
     products have been pulled into. 0 → Fresh, ≥1 → Recurring. */
  opportunityCount: number;
  segment?: string;
  segments?: string[];
  risk?: string;
  /* Compliance Behaviour master value ("Compliant", "Under Review",
     "Flagged", …) — rendered as the Compliant Status pill. */
  compliance?: string;
  /* vendor_product_mappings row count for this supplier (withCount on
     GET /vendors). Drives the Mapped Products badge + its popup. */
  mappedProducts: number;
  website?: string;
  address?: string;
  country?: string;
  pincode?: string;
  /* All contact persons (primary first). Drives the "+N" badge + the
     Contact Persons popup on the list. */
  contacts: SupplierContact[];
};

export type SupplierContact = {
  name: string;
  role: string;   // "Primary" for the primary address, else the designation
  phone: string;
  email: string;
  isPrimary: boolean;
};

/* Fresh vs Recurring tab key. Fresh = newly onboarded supplier with no
   opportunity yet; Recurring = at least one opportunity created against it. */
type SupplierTab = 'all' | 'fresh' | 'recurring';

/* Shape of an item in the paginated GET /api/vendors response. Only
 * the fields the list page actually renders are typed — anything else
 * the backend ships is ignored. */
type ApiVendor = {
  id: number;
  vendor_code: string | null;
  company_name: string;
  legal_name: string | null;
  status: string;
  primary_email: string | null;
  vendor_type?: { id: number; name: string | null } | null;
  segment?: { id: number; name: string | null } | null;
  segments?: { id: number; name: string | null }[] | null;
  risk_level?: { id: number; name: string | null } | null;
  /* Compliance Behaviour master row — eager-loaded by VendorController::index
     for the Compliant Status column. */
  compliance_behaviour?: { id: number; name: string | null } | null;
  /* withCount('productMappings') on the index query. Arrives as a number or a
     numeric string depending on the driver, so it's coerced on map. */
  product_mappings_count?: number | string | null;
  /* Correlated-subquery count from VendorController::index — drives the
     Fresh / Recurring split. May arrive as a number or a numeric string
     depending on the driver, so it's coerced on map. */
  opportunity_count?: number | string | null;
  primary_address?: {
    city: string | null;
    country_id: number | null;
    state_id: number | null;
    state_code: string | null;
    /* Resolved state name from the master_states relation (VendorController
       index eager-loads primaryAddress.state:id,name). Falls back to code. */
    state?: { id: number; name: string | null } | null;
    /* Resolved country name (primaryAddress.country:id,name). */
    country?: { id: number; name: string | null } | null;
    contact_name: string | null;
    email: string | null;
    contact_no: string | null;
  } | null;
  /* All address-contacts (primary + extras) for the "+N" badge / popup. */
  addresses?: Array<{
    is_primary?: boolean | number | null;
    contact_name: string | null;
    designation: string | null;
    contact_no: string | null;
    email: string | null;
  }> | null;
};

/* Map a supplier type label to one of the Figma pill colour kinds:
 *   logistics → cyan, services → amber, everything else → purple (material).
 * Matching is loose so variants like "Logistic" / "Service Provider" land
 * on the right colour. */
function typeKind(type: string): 'material' | 'logistics' | 'services' {
  const t = (type || '').toLowerCase();
  if (t.includes('logist')) return 'logistics';
  if (t.includes('service')) return 'services';
  return 'material';
}

/* ── Supplier Flag ────────────────────────────────────────────────────────
 * The Figma column reads "Genuine" / "High Risk". There is no dedicated flag
 * column on `vendors`; the field that actually carries this judgement is the
 * Risk Level master (Low / High) set on the supplier's Identity step. So the
 * pill is derived from it rather than from a new column nobody fills in.
 *
 * An unassessed supplier (risk_level_id null) renders a dash, NOT "Genuine" —
 * the prototype defaults to Genuine, but calling a supplier nobody has vetted
 * "Genuine" is exactly the claim this column exists to make carefully.
 * (Vendor Behaviour was the other candidate; its master holds performance
 * ratings — Excellent / Good / Delayed — not a trust flag.) */
function supplierFlag(risk?: string): { label: string; cls: string } | null {
  const r = (risk || '').trim().toLowerCase();
  if (!r) return null;
  if (r.includes('high') || r.includes('critical') || r.includes('severe')) {
    return { label: 'High Risk', cls: 'sl-flag--highrisk' };
  }
  if (r.includes('medium') || r.includes('moderate')) {
    return { label: 'Medium Risk', cls: 'sl-flag--medium' };
  }
  return { label: 'Genuine', cls: 'sl-flag--genuine' };
}

/* ── Compliant Status ─────────────────────────────────────────────────────
 * The prototype renders a boolean (Compliant / Non Compliant). The real
 * Compliance Behaviour master is not boolean — it holds ten states (Compliant,
 * Cleared, Approved, Exempt, Conditionally Compliant, Under Review, Pending,
 * Flagged, Watchlist, Non-Compliant). Collapsing those to a yes/no pill would
 * report "Non Compliant" for a supplier who is merely still Under Review, so
 * the real value is shown and only the TONE is bucketed: green for settled-OK,
 * red for settled-bad, amber for still-in-flight. */
function complianceTone(status?: string): { label: string; cls: string } | null {
  const s = (status || '').trim();
  if (!s) return null;
  const k = s.toLowerCase();
  if (k.includes('non-compliant') || k.includes('non compliant') || k.includes('flag') || k.includes('watchlist')) {
    return { label: s, cls: 'sl-compliant--no' };
  }
  if (k.includes('review') || k.includes('pending')) {
    return { label: s, cls: 'sl-compliant--pending' };
  }
  return { label: s, cls: 'sl-compliant--yes' };
}

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  /* The facet Filter (the two-pane PartyFilterModal the Customer list uses)
     was removed from this page. Search plus the Fresh/Recurring and
     Domestic/International tabs are the whole narrowing story here now. */
  const [tab, setTab] = useState<SupplierTab>('all');
  /* Scope tabs on the "What We Are Doing Here" strip. Same split the Add
     Supplier gate asks about, applied to the list: a supplier is domestic
     when its country is India and international otherwise — the same rule the
     form derives GST and State Code from.
     Two tabs, no "All": the list is always looking at one side or the other,
     and Domestic is the landing state because it is the larger book. */
  const [scopeTab, setScopeTab] = useState<'domestic' | 'international'>('domestic');
  const [addOpen, setAddOpen] = useState(false);
  /* Domestic / International is asked BEFORE the form opens, because the
     answer changes what the form may OFFER — Country, and the GST block that
     hangs off it — rather than being one more field inside it. Null while the
     gate is up, set the moment a scope is chosen.
     Only the Add path goes through the gate: an existing supplier's scope is
     already settled by the country on record, and the deep-link path above
     (opening a row by id) is an edit too. */
  const [scopeGateOpen, setScopeGateOpen] = useState(false);
  const [addScope, setAddScope] = useState<SupplierScope | null>(null);
  /* Edit vs Add — same modal, just seeded with an existing vendor id.
     Reset to null on close so the next "+ Add Vendor" click opens a
     blank form. */
  const [editingId, setEditingId] = useState<number | null>(null);
  /* When set, the wizard opens directly on that step — used by
     "Map Products" so the user doesn't have to re-walk Steps 1-3
     just to add a product mapping. */
  // Supplier wizard is 3 steps now (Trade Document Management / Evidence
  // Vault step removed): Identity → KYC → Map Products.
  const [editingStep, setEditingStep] = useState<1 | 2 | 3 | null>(null);
  /* Deep-link: /suppliers?edit=<vendorId> opens that supplier's edit wizard
     straight away. Used by the "Edit" action on a Master supplier in the Bulk
     Sourcing → Mapped Suppliers popup, which redirects here. The param is
     consumed once and stripped so a refresh/back doesn't reopen it. */
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  /* Where to send the user once the deep-linked edit is completed. Set from
     the ?return=<path> param (e.g. Bulk Sourcing sends its own URL). Held in a
     ref so it survives the wizard's step changes; consumed only on a real save
     (handleSave), cleared on cancel so it can't leak into a later manual edit. */
  const returnToRef = useRef<string | null>(null);
  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (!editParam) return;
    const id = Number(editParam);
    const ret = searchParams.get('return');
    const returnPath = ret && ret.startsWith('/') ? ret : null;
    // Strip the params up-front so a refresh / back never reopens this.
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    next.delete('return');
    setSearchParams(next, { replace: true });

    if (!Number.isFinite(id) || id <= 0) return;
    // Validate the supplier is visible/editable in THIS branch catalog before
    // opening the wizard. A mapped supplier from a sibling branch (or a deleted
    // vendor) 404s on GET /vendors/{id} — without this guard the user lands on
    // the supplier list with a raw "No query results for model Vendor" error
    // instead of the edit form (Bulk Sourcing → Mapped Suppliers → Edit bug).
    let cancelled = false;
    api.get(`/vendors/${id}`)
      .then(() => {
        if (cancelled) return;
        returnToRef.current = returnPath;
        setEditingId(id);
        setEditingStep(null);
        setAddOpen(true);
      })
      .catch((e: any) => {
        if (cancelled) return;
        const msg = e?.response?.status === 404
          ? 'This supplier isn’t available to edit from here — it may belong to another branch or has been removed from the Supplier master.'
          : (e?.response?.data?.message || 'Could not open this supplier for editing.');
        toast.error('Supplier not available', msg);
        if (returnPath) navigate(returnPath);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* Standalone Evidence Vault modal target — clicking the Vault action
   * on a row sets this; the modal pulls a fresh /vault payload from
   * the API and renders KPI cards + per-bucket tables read-only. */
  const [vaultTarget, setVaultTarget] = useState<SupplierVaultTarget | null>(null);
  /* When set, the Contact Persons popup lists all of this supplier's contacts. */
  const [contactsTarget, setContactsTarget] = useState<Vendor | null>(null);
  /* When set, the read-only Mapped Products popup lists this supplier's product
     mappings — opened from the Mapped Products count badge. */
  const [mappedTarget, setMappedTarget] = useState<Vendor | null>(null);
  /* Segment "+N" popover — fixed-positioned card anchored to the clicked badge
     so the table's overflow can't clip it. */
  const [segPop, setSegPop] = useState<{ segments: string[]; x: number; y: number; top: number } | null>(null);
  // Measured placement for the segment popover — anchor to the badge, clamp to
  // the viewport, and flip ABOVE when there isn't room below (never clipped).
  const segPopRef = useRef<HTMLDivElement>(null);
  const [segPopPos, setSegPopPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!segPop) { setSegPopPos(null); return; }
    const el = segPopRef.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 6, pad = 8;
    const left = Math.max(pad, Math.min(segPop.x, window.innerWidth - w - pad));
    let top = segPop.y;
    if (top + h > window.innerHeight - pad) {
      const above = segPop.top - gap - h;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - h - pad);
    }
    setSegPopPos({ left, top });
  }, [segPop]);

  /* Scroll lock — while ANY overlay (Segments / Contact Persons) is open, freeze
     the page behind it. Lock BOTH <html> and <body>; a body-only lock still lets
     the html element scroll on some layouts. */
  useEffect(() => {
    const anyOpen = contactsTarget !== null;
    if (!anyOpen) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [segPop, contactsTarget]);

  /* The Segment "+N" popover is anchored to fixed x/y captured on click, so on a
     window resize OR a page/table scroll it would float at stale coordinates.
     Close it in those cases — but ignore scrolling INSIDE the popover's own list
     (so a 20-segment list can still be scrolled). */
  useEffect(() => {
    if (!segPop) return;
    const close = () => setSegPop(null);
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && typeof el.closest === 'function' && el.closest('.sl-seg-pop')) return;
      setSegPop(null);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true); };
  }, [segPop]);

  const [loading, setLoading] = useState(true);
  /* "What We Are Doing Here" stepper — collapsible, open by default to
     mirror the Figma. Purely presentational. */
  const [brefOpen, setBrefOpen] = useState(true);
  /* Client-side pagination — rows-per-page auto-fits the viewport height
     (same dynamic behaviour as the CLM Segment Master). */
  const [page, setPage] = useState(1);
  /* Row count across ALL pages, from the server. The pager can no longer derive
     it from the rows in hand, because the rows in hand are one page. */
  const [total, setTotal] = useState(0);
  /* Newest-request token. rpp changes on every window resize, so two fetches can
     be in flight at once and the slower must not overwrite the newer. */
  const reqRef = useRef(0);
  /* Search is a network call now, so it waits for a pause in typing instead of
     firing per keystroke. 350ms is the same delay HrEmployees uses. */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rpp, setRpp] = useState(10);
  const autoFitRef = useRef(true); // false once the user picks a rows-per-page manually
  // Stretch the card to the viewport while auto-fitting (default / empty state) so
  // the screen always fills like CLM Segment / T&C Master. A manual rows-per-page
  // pick turns this off so a small count sits compact (no big internal gap).
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* Map a paginated API row to the local list-page shape. Anything the
     backend doesn't populate yet falls back to '—' so the table never
     renders raw `null` cells. */
  const apiToVendor = (row: ApiVendor): Vendor => {
    /* Build the contact list — primary address first, then extras. Each
       address row carries one contact person. */
    const addrs = Array.isArray(row.addresses) ? row.addresses : [];
    const contacts: SupplierContact[] = addrs
      .filter(a => (a.contact_name ?? '').trim())
      .map(a => {
        const isPrimary = a.is_primary === true || a.is_primary === 1;
        return {
          name:  (a.contact_name ?? '').trim(),
          role:  isPrimary ? 'Primary' : ((a.designation ?? '').trim() || 'Contact'),
          phone: (a.contact_no ?? '').trim(),
          email: (a.email ?? '').trim(),
          isPrimary,
        };
      })
      .sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary));
    return {
      id:          row.id,
      code:        row.vendor_code ?? `S-${String(row.id).padStart(3, '0')}`,
      companyName: row.company_name ?? 'Untitled Supplier',
      legalName:   row.legal_name ?? row.company_name ?? '—',
      type:        row.vendor_type?.name ?? 'Pending',
      /* State NAME (e.g. "Maharashtra"); falls back to the code, then a dash.
         The code lives in its own GST State Code column, so it is NOT appended
         in brackets here any more. */
      state:       row.primary_address?.state?.name
                     || row.primary_address?.state_code
                     || '—',
      /* GST state code (e.g. "27"). Kept whenever the address carries one —
         it used to be dropped unless the state NAME also resolved, which blanked
         the code for any supplier whose state_id points at a removed master row. */
      stateCode:   row.primary_address?.state_code || null,
      city:        row.primary_address?.city ?? '—',
      country:     row.primary_address?.country?.name ?? undefined,
      contactName: contacts[0]?.name || row.primary_address?.contact_name || '—',
      designation: '—',
      phone:       row.primary_address?.contact_no ?? '—',
      email:       row.primary_address?.email ?? row.primary_email ?? '—',
      status:      row.status === 'active' ? 'Active' : 'Inactive',
      opportunityCount: Number(row.opportunity_count ?? 0) || 0,
      segment:     row.segment?.name ?? undefined,
      // Prefer the multi-segment pivot; fall back to the legacy scalar `segment`
      // relation so suppliers created before multi-segment still show their
      // segment in the list (the list endpoint returns raw models — no fallback).
      segments:    (() => {
        const arr = (row.segments ?? []).map(s => s.name ?? '').filter(Boolean);
        return arr.length ? arr : (row.segment?.name ? [row.segment.name] : []);
      })(),
      risk:        row.risk_level?.name ?? undefined,
      compliance:  row.compliance_behaviour?.name ?? undefined,
      mappedProducts: Number(row.product_mappings_count ?? 0) || 0,
      contacts,
    };
  };

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    // `silent` = refresh in the background WITHOUT flashing the loading skeleton
    // (used after closing the Edit/Add modal — the list is already on screen, so
    // showing the full skeleton again reads as a slow reload). Initial mount and
    // manual reloads still show the skeleton.
    if (!opts?.silent) setLoading(true);
    /* SERVER-side pagination (was ?per_page=200 + slice-in-the-browser).
       200 was a ceiling, not a page: a tenant with 201 suppliers silently lost
       the rest, and every load shipped the whole table and its eager-loaded
       relations to render ten rows. Page, size, search and both tab filters now
       go to the API, which returns one page plus a total.
       Mirrors HrEmployees.reloadEmployees. */
    const token = ++reqRef.current;
    try {
      const res = await api.get<{ data: ApiVendor[]; total?: number }>('/vendors', {
        params: {
          page,
          per_page: rpp,
          ...(debouncedSearch ? { q: debouncedSearch } : {}),
          scope: scopeTab,
          tab,
        },
      });
      // Stale-response guard: rpp changes on every resize, so two fetches can be
      // in flight and the slower one must not overwrite the newer.
      if (token !== reqRef.current) return;
      const body: any = res.data ?? {};
      const rows: ApiVendor[] = Array.isArray(body) ? body : (body.data ?? []);
      setVendors(rows.map(apiToVendor));
      setTotal(Number(body.total ?? rows.length) || 0);
    } catch {
      if (token !== reqRef.current) return;
      toast.error('Load failed', 'Could not load suppliers');
    } finally {
      if (token === reqRef.current && !opts?.silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rpp, debouncedSearch, scopeTab, tab]);
 const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  useEffect(() => { void refresh(); }, [refresh]);
  /* Reset to page 1 whenever the tab or search changes so the user never
     lands on an out-of-range page after the result set shrinks. */
  /* scopeTab joins tab/search here: with server pagination, switching
     Domestic → International while on page 3 would ask the API for page 3 of a
     one-page result and render an empty table. */
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, scopeTab]);

  /* Dynamic rows-per-page — pick the count that fits between the table's top
     and the bottom of the viewport, so the page fills the screen and the rest
     spills onto further pages (mirrors the CLM Segment Master). The table card
     is also stretched (fillH) so it covers the page when rows are few. */
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;

      /* Fit-to-viewport is a DESKTOP behaviour and has to be switched off on a
         phone, not merely tuned for one.
         The whole measurement assumes the table starts near the top of the
         screen: it takes the space from there down to the bottom edge, fills
         the card with it and scrolls the rows inside. On a phone everything
         above the table — the header strip, the four step cards, the stacked
         toolbar — has already used ~600px of a ~700px screen, so that space
         comes out at or below zero and the card collapses to nothing. Which is
         exactly what it did: tabs, Filter, then the footer, with no table.
         Below 820px the page scrolls the way a page normally does: the card is
         content-height and shows a fixed number of rows. */
      if (window.innerWidth <= 820) {
        setFillH(prev => (prev === undefined ? prev : undefined));
        if (autoFitRef.current) setRpp(prev => (prev === 10 ? prev : 10));
        return;
      }

      const top = el.getBoundingClientRect().top;
      const THEAD = 42, ROW = 54, PAGER = 56;
      // Card is CONTENT-HEIGHT (no forced stretch) — the footer always sits right
      // after the rows, so a short list never leaves an internal gap. The row
      // count auto-fits the space between the table's top and the viewport bottom,
      // so on default load the rows fill the screen; a manual rows-per-page pick
      // simply shows that many (compact, empty page background below — never a gap).
      // Card height = space from the table's top down to the viewport bottom, so
      // the whole thing fits WITHOUT the page itself scrolling. Auto-fit the row
      // count into that space; the card always stretches to fill it (footer pinned
      // to the bottom) — mirrors CLM Segment Master.
      /* Reserve the APP FOOTER, measured live — same rule as DataTable's
         bottomReserve() (see components/ui/DataTable.tsx), which is what the
         HRMS Employees / Onboarding tables use. The flat 16px here assumed no
         footer, so on any page that has one the card was sized ~40px too tall
         and its last row sat behind "2026 © IGC Group". Measured rather than
         hardcoded so it stays right at any zoom level or footer height; 15px
         is the fallback when there is no footer (e.g. inside a modal). */
      const footerEl = document.querySelector('footer.footer') as HTMLElement | null;
      const footerH = footerEl?.offsetHeight ?? 0;
      const bottomReserve = footerH > 0 ? footerH + 8 : 15;

      /* The HORIZONTAL scrollbar occupies height inside the scroll box and was
         never subtracted. This table is 15 columns wide, so that bar is always
         there — ~12-15px, which is exactly enough for the last row to miss the
         cut and the box to grow a VERTICAL scrollbar as well. */
      const scrollbarH = Math.min(20, Math.max(0, el.offsetHeight - el.clientHeight));

      const cardH = Math.max(240, window.innerHeight - top - bottomReserve);
      const avail = cardH - THEAD - PAGER - scrollbarH;
      /* Floor of 10, matching minAutoRows on the HRMS tables. At the old floor
         of 4 a laptop viewport (or any zoom that left the table short) served a
         four-row page, which reads as a broken list rather than a fitted one
         and makes the same tenant look different on every machine. */
      const fit = Math.max(10, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      setFillH(prev => (prev === cardH ? prev : cardH));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    // Mirror CLM Segment Master: measure only on mount, on a SETTLED window
    // resize (debounced), and when the tab/search/data changes — NOT via a
    // ResizeObserver on the root. Observing the root re-measured `top` mid-scroll
    // / on the info-box collapse, so it read a stale (scrolled) top and stretched
    // the card too tall → the page started scrolling and the layout looked broken
    // until a hard refresh. A debounced window-resize keeps it stable.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const recomputeDebounced = () => { if (settleTimer) clearTimeout(settleTimer); settleTimer = setTimeout(recompute, 140); };
    window.addEventListener('resize', recomputeDebounced);
    return () => { if (settleTimer) clearTimeout(settleTimer); window.removeEventListener('resize', recomputeDebounced); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, loading, brefOpen]);
useEffect(() => {
  if (!allowed) return;

  const preloadVendorBundle = async () => {
    if (readVendorMasterBundle()) return;

    try {
      const res = await api.get('/vendors/master-bundle');
      writeVendorMasterBundle(res.data);
    } catch {
      // Silent preload failure — AddVendorModal will fetch normally if needed.
    }
  };

  const w = window as Window & {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  let idleId: number | null = null;
  let timerId: number | null = null;

  if (typeof w.requestIdleCallback === 'function') {
    idleId = w.requestIdleCallback(() => void preloadVendorBundle());
  } else {
    timerId = window.setTimeout(() => void preloadVendorBundle(), 500);
  }

  return () => {
    if (idleId !== null && typeof w.cancelIdleCallback === 'function') {
      w.cancelIdleCallback(idleId);
    }
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
  };
}, [allowed]);
 

  /* SERVER-side pagination math. `vendors` IS the current page — the search,
     the Fresh/Recurring tab and the Domestic/International scope are all applied
     by VendorController::index now, so there is nothing left to filter or slice
     here. `total` is the server's count across every page, which is what the
     pager needs to know how many pages exist. */
  const pages = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pages);
  const start = (curPage - 1) * rpp;   // Sr No offset for the rows on this page
  const pageRows = vendors;

  /* The wizard now persists each step to /api/vendors/* directly, so
     this handler only re-fetches and closes the modal. The payload is
     ignored — its fields are already in the database by the time
     onSubmit fires from the final Save Vendor click. */
  const handleSave = () => {
    setAddOpen(false);
    setEditingId(null);
    setEditingStep(null);
    void refresh({ silent: true });
    // Deep-linked from another page (e.g. Bulk Sourcing) — return there now
    // that the supplier edit is saved.
    const ret = returnToRef.current;
    returnToRef.current = null;
    if (ret) navigate(ret);
  };

  if (!allowed) {
    return (
      <Row>
        <Col xs={12}>
          <Card>
            <CardBody className="text-center py-5">
              <i className="ri-shield-keyhole-line text-danger" style={{ fontSize: 42 }} />
              <h5 className="mt-3 mb-1">Branch / Employee only</h5>
              <p className="text-muted mb-0">The Suppliers module is available only to branch users and employees.</p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    );
  }

  return (
    <>
      <Row>
        <Col xs={12}>
         <div className="sup-fig" ref={rootRef}>
          {/* Whole-page shimmer while the supplier list loads — header strip,
              4-step brief, toolbar tabs and table all resolve into shape at
              once (reuses the shared full-page skeleton). */}
          {loading ? <ShimmerClmMaster cols={7} rows={8} twoTab /> : (<>

          {/* HEADER STRIP — purple gradient hero (Figma "Supplier Management") */}
          <div className="cstrip">
            <span className="cstrip__accent" />
            <span className="cstrip__glow" />
            <span className="cstrip__sheen" />
            <div className="cstrip__left">
              <div className="cstrip__avatar-wrap">
                <div className="cstrip__avatar">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                </div>
                <span className="cstrip__online-dot" />
              </div>
              <div>
                <div className="cstrip__title">Supplier Management</div>
                <div className="cstrip__sub">Manage supplier onboarding, compliance verification, and product mapping for procurement readiness.</div>
              </div>
            </div>
            <div className="cstrip__right">
              <button type="button" className="cstrip__action-btn" onPointerEnter={warmVendorWizard} onFocus={warmVendorWizard} onClick={() => { setEditingId(null); setEditingStep(null); setAddScope(null); setScopeGateOpen(true); }}>
                <span className="cstrip__action-btn-sheen" />
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Supplier
              </button>
            </div>
          </div>

          {/* WHAT WE ARE DOING HERE — collapsible 4-step guide */}
          <div className={`bref-box ${brefOpen ? '' : 'is-collapsed'}`}>
            <div className="bref-box__header" onClick={() => setBrefOpen(o => !o)}>
              <div className="bref-box__header-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
              </div>
              <div className="bref-box__header-mid">
                <div className="bref-box__header-row">
                  <div className="bref-box__header-label">Supplier Management</div>
                  <div className="bref-box__header-sep" />
                  <div className="bref-box__header-title">What We Are Doing Here</div>
                </div>
                <div className="bref-box__header-sub">Creating suppliers, verifying compliance, and mapping products for procurement.</div>
              </div>
              <div className="bref-box__header-right">
                {/* Scope tabs, ported from the Sourcing Tracker strip. stopPropagation
                    on the group: the whole header is the collapse toggle, so a click
                    here would otherwise fold the panel shut under the user. */}
                <div className="sup-scope" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`sup-scope__tab ${scopeTab === 'domestic' ? 'is-active' : ''}`}
                    onClick={() => setScopeTab('domestic')}
                  >
                    <i className="ri-home-4-line" />Domestic<span className="sup-scope__word"> Suppliers</span>
                  </button>
                  <button
                    type="button"
                    className={`sup-scope__tab ${scopeTab === 'international' ? 'is-active' : ''}`}
                    onClick={() => setScopeTab('international')}
                  >
                    <i className="ri-global-line" />International<span className="sup-scope__word"> Suppliers</span>
                  </button>
                </div>
                <div className="bref-box__toggle">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </div>
              </div>
            </div>
            <div className="bref-box__body">
              <div className="bref-item">
                <div className="bref-item__top">
                  <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg></div>
                  <span className="bref-item__num">Step 01</span>
                </div>
                <div className="bref-item__title">Create Supplier</div>
                <div className="bref-item__desc">Create supplier profiles and business details.</div>
              </div>
              <div className="bref-item">
                <div className="bref-item__top">
                  <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg></div>
                  <span className="bref-item__num">Step 02</span>
                </div>
                <div className="bref-item__title">KYC / Due Diligence</div>
                <div className="bref-item__desc">Verify supplier compliance and authenticity.</div>
              </div>
              <div className="bref-item">
                <div className="bref-item__top">
                  <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg></div>
                  <span className="bref-item__num">Step 03</span>
                </div>
                <div className="bref-item__title">Trade &amp; Compliance Documentation</div>
                <div className="bref-item__desc">Manage licenses, certifications, and procurement documents.</div>
              </div>
              <div className="bref-item">
                <div className="bref-item__top">
                  <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></div>
                  <span className="bref-item__num">Step 04</span>
                </div>
                <div className="bref-item__title">Product Mapping</div>
                <div className="bref-item__desc">Link suppliers with products, pricing, and procurement terms.</div>
              </div>
            </div>
          </div>

          <div className="sl-wrap">
            {/* Toolbar — purple Fresh / Recurring tabs + search (Figma sl-toolbar).
                Fresh = supplier with no opportunity yet; Recurring = at least one
                opportunity (lead) created against its mapped products. The split
                is computed server-side (VendorController::index → opportunity_count). */}
            <div className="sl-toolbar">
              <div className="sl-tabs">
                <button
                  type="button"
                  className={`sl-tab ${tab === 'all' ? 'is-active' : ''}`}
                  onClick={() => setTab('all')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                  <span>All Suppliers</span>
                </button>
                <button
                  type="button"
                  className={`sl-tab ${tab === 'fresh' ? 'is-active' : ''}`}
                  onClick={() => setTab('fresh')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                  <span>Fresh Suppliers</span>
                </button>
                <button
                  type="button"
                  className={`sl-tab ${tab === 'recurring' ? 'is-active' : ''}`}
                  onClick={() => setTab('recurring')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                  <span>Recurring Suppliers</span>
                </button>
              </div>
              <div className="sl-search">
                <svg className="sl-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  type="text"
                  placeholder="Search suppliers by name, code or contact…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" className="sl-search-clear" title="Clear search" onClick={() => setSearch('')}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            </div>

            {/* Table — purple Figma table wired to the real /vendors data.
                Pagination is client-side (10 rows/page). */}
            {loading ? (
              <div className="p-3"><ShimmerTable rows={8} cols={15} /></div>
            ) : (
              <>
                <div className="sl-table-scroll" ref={scrollRef} style={fillH ? { minHeight: fillH } : undefined}>
                  <table className="sl-table">
                    <thead>
                      <tr>
                        <th className="sl-th-2line sl-col-c"><span>Sr</span><span>No</span></th>
                        <th className="sl-th-2line sl-col-c"><span>Supplier</span><span>Code</span></th>
                        <th>Supplier Name</th>
                        <th className="sl-col-c">Supplier Type</th>
                        <th>Segment</th>
                        <th className="sl-col-c">Country</th>
                        <th className="sl-col-c">State</th>
                        <th className="sl-th-2line sl-col-c"><span>GST State</span><span>Code</span></th>
                        <th>Contact Person</th>
                        <th className="sl-col-c">Contact No</th>
                        <th className="sl-th-email">Email</th>
                        <th>Supplier Flag</th>
                        <th>Compliant Status</th>
                        <th className="sl-th-2line sl-col-c"><span>Mapped</span><span>Products</span></th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={15} className="sl-empty">No suppliers found.</td></tr>
                      ) : pageRows.map((v, i) => {
                        const kind = typeKind(v.type);
                        const flag = supplierFlag(v.risk);
                        const compliance = complianceTone(v.compliance);
                        return (
                          <tr key={v.id}>
                            <td className="sl-col-c"><span className="sl-sr">{start + i + 1}</span></td>
                            <td className="sl-col-c"><span className="sl-code">{v.code}</span></td>
                            <td><Tooltip label={v.companyName}><span className="sl-name sl-trunc">{v.companyName}</span></Tooltip></td>
                            <td className="sl-col-c"><span className={`sl-pill sl-pill--${kind}`}><span className="sl-pill-dot" />{v.type}</span></td>
                            <td>
                              <span className="sl-seg-wrap">
                                {v.segments && v.segments.length > 0 ? (
                                  <>
                                    <Tooltip label={v.segments[0]}><span className="sl-seg sl-trunc">{v.segments[0]}</span></Tooltip>
                                    {v.segments.length > 1 && (
                                      <Tooltip label={`View all ${v.segments.length} segments`}>
                                      <button
                                        type="button"
                                        className="sl-seg-more"
                                        onClick={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setSegPop({ segments: v.segments ?? [], x: r.left, y: r.bottom + 6, top: r.top });
                                        }}
                                      >
                                        +{v.segments.length - 1}
                                      </button>
                                      </Tooltip>
                                    )}
                                  </>
                                ) : <span className="sl-seg">—</span>}
                              </span>
                            </td>
                            <td className="sl-col-c"><span className="sl-country">{v.country || '—'}</span></td>
                            <td className="sl-col-c"><span className="sl-state">{v.state}</span></td>
                            <td className="sl-col-c">{v.stateCode ? <span className="sl-gstcode">{v.stateCode}</span> : <span className="sl-state">—</span>}</td>
                            <td>
                              <span className="sl-contact-wrap">
                                <Tooltip label={v.contactName}><span className="sl-contact sl-trunc">{v.contactName}</span></Tooltip>
                                {v.contacts.length > 1 && (
                                  <Tooltip label={`View all ${v.contacts.length} contacts`}>
                                  <button
                                    type="button"
                                    className="sl-contact-more"
                                    onClick={() => setContactsTarget(v)}
                                  >
                                    +{v.contacts.length - 1}
                                  </button>
                                  </Tooltip>
                                )}
                              </span>
                            </td>
                            <td className="sl-col-c"><span className="sl-phone">{v.phone}</span></td>
                            <td className="sl-td-email"><Tooltip label={v.email}><a className="sl-email sl-trunc" href={`mailto:${v.email}`}>{v.email}</a></Tooltip></td>
                            <td>
                              {flag
                                ? (
                                  <Tooltip label={`Risk Level: ${v.risk}`}>
                                    <span className={`sl-flag ${flag.cls}`}>
                                      {flag.cls === 'sl-flag--genuine'
                                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>}
                                      {flag.label}
                                    </span>
                                  </Tooltip>
                                )
                                : <Tooltip label="No risk level set on this supplier yet"><span className="sl-state">—</span></Tooltip>}
                            </td>
                            <td>
                              {compliance
                                ? (
                                  <span className={`sl-compliant ${compliance.cls}`}>
                                    {compliance.cls === 'sl-compliant--yes'
                                      ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                      : compliance.cls === 'sl-compliant--pending'
                                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                                        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>}
                                    {compliance.label}
                                  </span>
                                )
                                : <Tooltip label="No compliance behaviour set on this supplier yet"><span className="sl-state">—</span></Tooltip>}
                            </td>
                            <td className="sl-col-c">
                              {/* Count badge → read-only Mapped Products popup.
                                  Zero is rendered as a flat, non-clickable badge:
                                  a button that opens an empty list is a dead end. */}
                              {v.mappedProducts > 0 ? (
                                <Tooltip label="View mapped products">
                                  <button
                                    type="button"
                                    className="sl-prodcount"
                                    onClick={() => setMappedTarget(v)}
                                  >
                                    {v.mappedProducts}
                                  </button>
                                </Tooltip>
                              ) : (
                                <Tooltip label="No products mapped to this supplier yet">
                                  <span className="sl-prodcount sl-prodcount--zero">0</span>
                                </Tooltip>
                              )}
                            </td>
                            <td>
                              <div className="sl-actions">
                                <Tooltip label="Edit Supplier">
                                <button
                                  type="button"
                                  className="sl-act-btn sl-act-btn--edit"
                                  onClick={() => { setEditingId(v.id); setEditingStep(null); setAddOpen(true); }}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                                </button>
                                </Tooltip>
                                {/* Zoho Entry — HIDDEN for now (UI only, not wired up yet).
                                    Un-comment this block to bring the button back.
                                <Tooltip label="Zoho Entry">
                                <button
                                  type="button"
                                  className="sl-act-btn sl-act-btn--book"
                                  onClick={() => toast.info('Coming soon', 'Zoho Entry will be available once it is wired up.')}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h7" /><path d="M9 11h7" /></svg>
                                </button>
                                </Tooltip>
                                */}
                                <button
                                  type="button"
                                  className="sl-evault-btn"
                                  onClick={() => setVaultTarget({
                                    id: v.code,
                                    db_id: v.id,
                                    company: v.companyName,
                                    risk: v.risk,
                                    segment: v.segment,
                                    segments: v.segments,
                                    country: v.country,
                                    type: v.type,
                                    contact: v.contactName,
                                    contactCity: v.city,
                                    email: v.email && v.email !== '—' ? v.email : undefined,
                                  })}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg>
                                  <span>Evidence Vault</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* Shared dynamic pager lives INSIDE the stretched scroll card and
                      is pushed to its bottom (margin-top:auto) so a short list leaves
                      no gap between the table and the footer — mirrors CLM Segment. */}
                  <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[5, 10, 25, 50]} />
                </div>
              </>
            )}
          </div>
          </>)}
         </div>
        </Col>
      </Row>

      {/* Scope first, form second. */}
      {scopeGateOpen && (
        <Suspense fallback={null}>
        <SupplierScopeGate
          onClose={() => setScopeGateOpen(false)}
          onChoose={scope => { setAddScope(scope); setScopeGateOpen(false); setAddOpen(true); }}
        />
        </Suspense>
      )}

      {addOpen && (
        <Suspense fallback={null}>
        <AddVendorModal
          vendorId={editingId}
          /* The row already shows the code, so hand it over rather than making
             the modal's header wait for /vendors/{id}. Read off the loaded list
             instead of held in state — nothing to keep in sync. Resolves to
             null on a deep-link open before the list has landed, which is the
             old behaviour. */
          vendorCodeHint={editingId ? (vendors.find(x => x.id === editingId)?.code ?? null) : null}
          initialStep={editingStep ?? undefined}
          scope={addScope ?? undefined}
          onClose={() => { setAddOpen(false); setEditingId(null); setEditingStep(null); setAddScope(null); returnToRef.current = null; void refresh({ silent: true }); }}
          onSubmit={handleSave}
        />
        </Suspense>
      )}

      {/* Segment "+N" popover — small anchored card at the badge (mirrors the
          Customer list's segment overflow popover), not a full centered modal.
          PORTALLED to <body>: the popover is position:fixed, and any ancestor
          with a transform/will-change (the table hover effects, the auto-fit
          card) turns "fixed" into "relative to that ancestor" — so after the
          page scrolled, it opened at a stale, off-screen spot. A body portal has
          no such ancestor, so it always positions against the real viewport. */}
      {segPop && createPortal(
        <div className="sup-fig">
          <div className="sl-seg-pop-backdrop" onClick={() => setSegPop(null)} />
          <div
            ref={segPopRef}
            className="sl-seg-pop"
            style={segPopPos ? { left: segPopPos.left, top: segPopPos.top, width: 214 } : { left: -9999, top: 0, width: 214, visibility: 'hidden' }}
          >
            <div className="sl-seg-pop-title">Segments ({segPop.segments.length})</div>
            <div className="sl-seg-pop-list" style={{ maxHeight: 148 }}>
              {segPop.segments.map((s, idx) => (
                <div key={`${s}-${idx}`} className={`sl-seg-pop-row ${idx % 2 ? 'alt' : ''}`}>
                  <Tooltip label={s}>
                    <span className="sl-seg">{s.length > 20 ? s.slice(0, 20) + '…' : s}</span>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Contact Persons popup — lists every contact for the chosen supplier
          (primary first), with role badge, phone and email (Figma). */}
      {contactsTarget && (
        <div className="sup-fig">
          <div className="sc-ov" onClick={(e) => { if (e.target === e.currentTarget) setContactsTarget(null); }}>
            <div className="sc-pop" role="dialog" aria-modal="true">
              <div className="sc-head">
                <div className="sc-head-ico">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                </div>
                <div className="min-w-0">
                  <div className="sc-title">Contact Persons</div>
                  <div className="sc-sub">{contactsTarget.companyName} — {contactsTarget.contacts.length} contact{contactsTarget.contacts.length !== 1 ? 's' : ''}</div>
                </div>
                <button type="button" className="sc-close" onClick={() => setContactsTarget(null)} aria-label="Close">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              {/* No pagination — list every contact and let the body scroll
                  after ~5 rows (max-height below). */}
              <div className="sc-body" style={{ maxHeight: 'min(60vh, 392px)' }}>
                {contactsTarget.contacts.map((c, i) => (
                  <div className="sc-row" key={i}>
                    <div className="sc-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</div>
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <div className="sc-name">
                        <Tooltip label={c.name} disabled={!c.name || c.name.length <= 30} position="bottom" zIndex={2999999}>
                          <span>{c.name ? (c.name.length > 30 ? `${c.name.slice(0, 30)}…` : c.name) : '—'}</span>
                        </Tooltip>
                        <Tooltip label={c.role} disabled={!c.role || c.role.length <= 18} position="bottom" zIndex={2999999}>
                          <span className={`sc-role ${c.isPrimary ? 'is-primary' : 'is-other'}`}>{c.role && c.role.length > 18 ? `${c.role.slice(0, 18)}…` : c.role}</span>
                        </Tooltip>
                      </div>
                      <div className="sc-meta">
                        {c.phone && <span><i className="ri-phone-line" />{c.phone}</span>}
                        {c.email && <span><i className="ri-mail-line" />{c.email}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapped Products popup (read-only) — same chrome as the wizard's
          Mapped Products popup, minus the "Map Product" CTA and the per-row
          edit/remove icons. Mappings are edited in the supplier form. */}
      {mappedTarget && (
        <Suspense fallback={null}>
        <MappedProductsViewPopup
          vendorId={mappedTarget.id}
          code={mappedTarget.code}
          name={mappedTarget.companyName}
          onClose={() => setMappedTarget(null)}
        />
        </Suspense>
      )}

      {/* Read-only Supplier Evidence Vault popup — pulls
          /api/segment-uploads/supplier/{id}/vault to render KPI cards +
          per-bucket tables (Company DD, Owner KYC, Trade Licenses,
          Trade Documents, Shipment Agreements). Rows are the union of
          the supplier's segment-rule docs and any files uploaded
          against them in Stage 2. */}
      {/* Mounted only while a vault is open. It already returned null when
          closed (`if (!open || !supplier || !vault) return null`) and every
          effect inside it short-circuits on !open, so gating the mount changes
          nothing on screen — but it is what stops the chunk, jszip and
          file-saver being fetched on page load. */}
      {vaultTarget && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal
            open
            supplier={vaultTarget}
            onClose={() => setVaultTarget(null)}
          />
        </Suspense>
      )}

    </>
  );
}
