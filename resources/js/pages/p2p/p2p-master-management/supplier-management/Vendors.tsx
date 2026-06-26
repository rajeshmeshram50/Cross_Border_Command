import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
import AddVendorModal from './AddVendorModal';
import SupplierEvidenceVaultModal, { type SupplierVaultTarget } from './SupplierEvidenceVaultModal';
import { ShimmerTable, ShimmerClmMaster } from '../../../../components/ui/Shimmer';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import {
  readVendorMasterBundle,
  writeVendorMasterBundle,
} from './vendorBundleCache';
import './supplier-management.css';

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
type SupplierTab = 'fresh' | 'recurring';

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
  segment?: { id: number; title: string | null } | null;
  segments?: { id: number; name: string | null }[] | null;
  risk_level?: { id: number; name: string | null } | null;
  /* Correlated-subquery count from VendorController::index — drives the
     Fresh / Recurring split. May arrive as a number or a numeric string
     depending on the driver, so it's coerced on map. */
  opportunity_count?: number | string | null;
  primary_address?: {
    city: string | null;
    state_id: number | null;
    state_code: string | null;
    /* Resolved state name from the master_states relation (VendorController
       index eager-loads primaryAddress.state:id,name). Falls back to code. */
    state?: { id: number; name: string | null } | null;
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

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<SupplierTab>('fresh');
  const [addOpen, setAddOpen] = useState(false);
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
  /* Standalone Evidence Vault modal target — clicking the Vault action
   * on a row sets this; the modal pulls a fresh /vault payload from
   * the API and renders KPI cards + per-bucket tables read-only. */
  const [vaultTarget, setVaultTarget] = useState<SupplierVaultTarget | null>(null);
  /* When set, the Contact Persons popup lists all of this supplier's contacts. */
  const [contactsTarget, setContactsTarget] = useState<Vendor | null>(null);
  /* Segment "+N" popover — fixed-positioned card anchored to the clicked badge
     so the table's overflow can't clip it. */
  const [segPop, setSegPop] = useState<{ segments: string[]; x: number; y: number } | null>(null);
  /* Contact Persons popup paginates 5 per page. Resets whenever it opens. */
  const CONTACTS_PER_PAGE = 5;
  const [contactsPage, setContactsPage] = useState(1);
  useEffect(() => { setContactsPage(1); }, [contactsTarget]);
  const [loading, setLoading] = useState(true);
  /* "What We Are Doing Here" stepper — collapsible, open by default to
     mirror the Figma. Purely presentational. */
  const [brefOpen, setBrefOpen] = useState(true);
  /* Client-side pagination — rows-per-page auto-fits the viewport height
     (same dynamic behaviour as the CLM Segment Master). */
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
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
      code:        row.vendor_code ?? `SUP-${row.id}`,
      companyName: row.company_name ?? 'Untitled Supplier',
      legalName:   row.legal_name ?? row.company_name ?? '—',
      type:        row.vendor_type?.name ?? 'Pending',
      /* Show the state NAME (e.g. "Maharashtra"), not the raw state_id.
         Fall back to the state code, then a dash. */
      state:       row.primary_address?.state?.name
                     || row.primary_address?.state_code
                     || '—',
      city:        row.primary_address?.city ?? '—',
      contactName: contacts[0]?.name || row.primary_address?.contact_name || '—',
      designation: '—',
      phone:       row.primary_address?.contact_no ?? '—',
      email:       row.primary_address?.email ?? row.primary_email ?? '—',
      status:      row.status === 'active' ? 'Active' : 'Inactive',
      opportunityCount: Number(row.opportunity_count ?? 0) || 0,
      segment:     row.segment?.title ?? undefined,
      segments:    (row.segments ?? []).map(s => s.name ?? '').filter(Boolean),
      risk:        row.risk_level?.name ?? undefined,
      contacts,
    };
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: ApiVendor[] }>('/vendors?per_page=200');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setVendors(rows.map(apiToVendor));
    } catch {
      toast.error('Load failed', 'Could not load suppliers');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
 const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  useEffect(() => { void refresh(); }, [refresh]);
  /* Reset to page 1 whenever the tab or search changes so the user never
     lands on an out-of-range page after the result set shrinks. */
  useEffect(() => { setPage(1); }, [tab, search]);

  /* Dynamic rows-per-page — pick the count that fits between the table's top
     and the bottom of the viewport, so the page fills the screen and the rest
     spills onto further pages (mirrors the CLM Segment Master). The table card
     is also stretched (fillH) so it covers the page when rows are few. */
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const THEAD = 42, ROW = 56;
      // Page size fills the SAME stretched card height as fillH, so the rows
      // actually use the visible card (no big empty gap under a half-full table,
      // and short lists — e.g. 6 — fit on one page instead of spilling to 2).
      const cardH = Math.max(0, window.innerHeight - top - 64);
      const avail = cardH - THEAD;
      const fit = Math.max(4, Math.floor(avail / ROW));
      setRpp(prev => (prev === fit ? prev : fit));
      setFillH(prev => (prev === cardH ? prev : cardH));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
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
 

  const filtered = useMemo(() => {
    const lo = search.trim().toLowerCase();
    const inTab = (v: Vendor) => tab === 'fresh' ? v.opportunityCount === 0 : v.opportunityCount > 0;
    return vendors
      .filter(inTab)
      .filter(v => !lo
        || v.code.toLowerCase().includes(lo)
        || v.companyName.toLowerCase().includes(lo)
        || v.contactName.toLowerCase().includes(lo)
        || v.email.toLowerCase().includes(lo)
        || v.phone.toLowerCase().includes(lo)
        || v.city.toLowerCase().includes(lo)
        || v.state.toLowerCase().includes(lo));
  }, [vendors, search, tab]);

  /* Client-side pagination math — page size is the dynamic `rpp`. */
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pages);
  const start = (curPage - 1) * rpp;
  const pageRows = filtered.slice(start, start + rpp);

  /* The wizard now persists each step to /api/vendors/* directly, so
     this handler only re-fetches and closes the modal. The payload is
     ignored — its fields are already in the database by the time
     onSubmit fires from the final Save Vendor click. */
  const handleSave = () => {
    setAddOpen(false);
    setEditingId(null);
    setEditingStep(null);
    void refresh();
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
              <button type="button" className="cstrip__action-btn" onClick={() => setAddOpen(true)}>
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
                  placeholder="Search suppliers by name, code, type, state, country, contact, phone or email…"
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
              <div className="p-3"><ShimmerTable rows={8} cols={11} /></div>
            ) : (
              <>
                <div className="sl-table-scroll" ref={scrollRef} style={fillH ? { minHeight: fillH } : undefined}>
                  <table className="sl-table">
                    <thead>
                      <tr>
                        <th>Sr No</th>
                        <th>Supplier Code</th>
                        <th>Supplier Name</th>
                        <th>Supplier Type</th>
                        <th>Segment</th>
                        <th>Supplier State</th>
                        <th>Country</th>
                        <th>Contact Person</th>
                        <th>Contact No</th>
                        <th>Email</th>
                        <th>WhatsApp</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={12} className="sl-empty">No suppliers found.</td></tr>
                      ) : pageRows.map((v, i) => {
                        const kind = typeKind(v.type);
                        const hasWa = !!v.phone && v.phone !== '—';
                        return (
                          <tr key={v.id}>
                            <td><span className="sl-sr">{start + i + 1}</span></td>
                            <td><span className="sl-code">{v.code}</span></td>
                            <td><Tooltip label={v.companyName}><span className="sl-name sl-trunc">{v.companyName}</span></Tooltip></td>
                            <td><span className={`sl-pill sl-pill--${kind}`}><span className="sl-pill-dot" />{v.type}</span></td>
                            <td>
                              <span className="sl-seg-wrap">
                                {v.segments && v.segments.length > 0 ? (
                                  <>
                                    <Tooltip label={v.segments[0]}><span className="sl-seg sl-trunc">{v.segments[0]}</span></Tooltip>
                                    {v.segments.length > 1 && (
                                      <button
                                        type="button"
                                        className="sl-seg-more"
                                        onClick={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setSegPop({ segments: v.segments ?? [], x: r.left, y: r.bottom + 6 });
                                        }}
                                      >
                                        +{v.segments.length - 1}
                                      </button>
                                    )}
                                  </>
                                ) : <span className="sl-seg">—</span>}
                              </span>
                            </td>
                            <td><span className="sl-state">{v.state}</span></td>
                            <td><span className="sl-country">{v.country || 'India'}</span></td>
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
                            <td><span className="sl-phone">{v.phone}</span></td>
                            <td><Tooltip label={v.email}><a className="sl-email sl-trunc" href={`mailto:${v.email}`}>{v.email}</a></Tooltip></td>
                            <td>
                              {hasWa
                                ? <span className="sl-wa sl-wa--yes"><span className="sl-wa-dot" />Yes</span>
                                : <span className="sl-wa sl-wa--no"><span className="sl-wa-dot" />No</span>}
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
                </div>
                {/* Shared dynamic pager — same "Showing X–Y of Z · page/pages · ‹ ›"
                    component the CLM Segment Master uses. */}
                <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} />
              </>
            )}
          </div>
          </>)}
         </div>
        </Col>
      </Row>

      {addOpen && (
        <AddVendorModal
          vendorId={editingId}
          initialStep={editingStep ?? undefined}
          onClose={() => { setAddOpen(false); setEditingId(null); setEditingStep(null); }}
          onSubmit={handleSave}
        />
      )}

      {/* Segment "+N" popover — small floating card listing every segment. */}
      {segPop && (
        <div className="sup-fig">
          <div className="sl-seg-pop-ov" onClick={() => setSegPop(null)} />
          <div className="sl-seg-pop" style={{ left: segPop.x, top: segPop.y }} role="dialog">
            <div className="sl-seg-pop-head">Segments ({segPop.segments.length})</div>
            <div className="sl-seg-pop-body">
              {segPop.segments.map((s, idx) => (
                <span key={`${s}-${idx}`} className="sl-seg-chip">{s}</span>
              ))}
            </div>
          </div>
        </div>
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
              {(() => {
                const all = contactsTarget.contacts;
                const totalPages = Math.max(1, Math.ceil(all.length / CONTACTS_PER_PAGE));
                const page = Math.min(contactsPage, totalPages);
                const start = (page - 1) * CONTACTS_PER_PAGE;
                const slice = all.slice(start, start + CONTACTS_PER_PAGE);
                return (
                  <>
                    <div className="sc-body">
                      {slice.map((c, i) => (
                        <div className="sc-row" key={start + i}>
                          <div className="sc-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</div>
                          <div className="min-w-0" style={{ flex: 1 }}>
                            <div className="sc-name">
                              {c.name || '—'}
                              <span className={`sc-role ${c.isPrimary ? 'is-primary' : 'is-other'}`}>{c.role}</span>
                            </div>
                            <div className="sc-meta">
                              {c.phone && <span><i className="ri-phone-line" />{c.phone}</span>}
                              {c.email && <span><i className="ri-mail-line" />{c.email}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {all.length > CONTACTS_PER_PAGE && (
                      <div className="sc-pager">
                        <span className="sc-pg-info">Showing <b>{start + 1}–{Math.min(start + CONTACTS_PER_PAGE, all.length)}</b> of <b>{all.length}</b></span>
                        <div className="sc-pg-ctrls">
                          <button type="button" className="sc-pg-arrow" disabled={page === 1} onClick={() => setContactsPage(page - 1)} aria-label="Previous">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                          </button>
                          <span className="sc-pg-count">{page} / {totalPages}</span>
                          <button type="button" className="sc-pg-arrow" disabled={page === totalPages} onClick={() => setContactsPage(page + 1)} aria-label="Next">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Read-only Supplier Evidence Vault popup — pulls
          /api/segment-uploads/supplier/{id}/vault to render KPI cards +
          per-bucket tables (Company DD, Owner KYC, Trade Licenses,
          Trade Documents, Shipment Agreements). Rows are the union of
          the supplier's segment-rule docs and any files uploaded
          against them in Stage 2. */}
      <SupplierEvidenceVaultModal
        open={!!vaultTarget}
        supplier={vaultTarget}
        onClose={() => setVaultTarget(null)}
      />
    </>
  );
}
