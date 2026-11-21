import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import SegmentBadge, { segmentLabel } from '../../../../components/ui/SegmentBadge';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { useIsClipped } from '../../../../components/ui/DataTable';
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
import '../../../../components/ui/DataTable.css';   // .dt-root / .dt-search / .dt-table — the shared list table and search
import './supplier-management.css';
import './supplier-scope-gate-teal.css';
import '../../../sales/core-masters/customer/SalesCustomers.css';   // .smc-* - the Customer list's classes
import { lazyPage } from '../../../../utils/lazyPage';
import { SERVICE_MAPPING_ENABLED, serviceBucketOf } from './serviceMapping';

const AddVendorModal = lazyPage(() => import('./AddVendorModal'));
const MappedProductsViewPopup = lazyPage(() =>
  import('./AddVendorModal').then(m => ({ default: m.MappedProductsViewPopup })));
/* Mapped Services (a service-provider supplier's Map Product / Service), loaded with the modal's
   chunk; the bucket is resolved from the type name there (serviceBucketOf). */
const MappedServicesViewPopup = lazyPage(() =>
  import('./AddVendorModal').then(m => ({
    default: (p: { vendorId: number; typeName: string; international: boolean; code?: string; name?: string; onClose: () => void; onChanged?: () => void }) => {
      const bucket = m.serviceBucketOf(p.typeName);
      // From the list: "Map New Service" in the header, like the list's Mapped Products popup.
      return bucket ? <m.MappedServicesPopup {...p} bucket={bucket} addInHeader /> : null;
    },
  })));
/** Supplier Types mapped to SERVICES, not products (./serviceMapping, shared with the form). */
const isServiceType = (t: string) => serviceBucketOf(t) !== null;
const SupplierScopeGate = lazyPage(() => import('./SupplierScopeGate'));
const SupplierEvidenceVaultModal = lazyPage(() => import('./SupplierEvidenceVaultModal'));

const warmVendorWizard = () => { void import('./AddVendorModal'); };

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
  opportunityCount: number;
  segment?: string;
  segments?: string[];
  segmentItems?: { id?: number; name: string; reg?: string | null }[];
  risk?: string;
  compliance?: string;
  category?: string;
  mappedProducts: number;
  website?: string;
  address?: string;
  country?: string;
  pincode?: string;
  contacts: SupplierContact[];
  /** dd/mm/yyyy the supplier was created, under its code in the list. */
  createdOn?: string;
};

export type SupplierFacets = {
  grand_total: number;
  /** Rows each Domestic / International tab would list (before the scope). */
  scope?: { domestic: number; international: number };
  category: { star: number; general: number; high_risk: number; blacklisted: number };
  compliance: { compliant: number; non_compliant: number };
  /** Rows per supplier-type tab (backend pending: the tabs show 0 until counts arrive). */
  kind?: { all: number; material: number; logistics: number; services: number };
};

export type SupplierContact = {
  name: string;
  role: string;   // "Primary" for the primary address, else the designation
  phone: string;
  email: string;
  isPrimary: boolean;
};

const PER_PAGE_KEY = 'cbc.p2p.suppliers.perPage.v2';

type SupplierTab = 'all' | 'fresh' | 'recurring';

type ApiVendor = {
  id: number;
  vendor_code: string | null;
  company_name: string;
  legal_name: string | null;
  status: string;
  created_at?: string | null;
  primary_email: string | null;
  vendor_type?: { id: number; name: string | null } | null;
  segment?: { id: number; name: string | null; regulatory_status?: string | null } | null;
  segments?: { id: number; name: string | null; regulatory_status?: string | null }[] | null;
  risk_level?: { id: number; name: string | null } | null;
  compliance_behaviour?: { id: number; name: string | null } | null;
  compliance_status?: string | null;
  supplier_category?: string | null;
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
/* A text cell that shows its full value on hover only when it is really cut -
   the Customer list's TruncatedCell, measured from the DOM. */
function ClipCell({ value, className }: { value?: string | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const v = (value ?? '').trim();
  const clipped = useIsClipped(ref, v);
  if (!v || v === '—') return <span className="text-muted">—</span>;
  const inner = <span ref={ref} className={className} style={{ maxWidth: '100%', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{v}</span>;
  return clipped ? <Tooltip label={v}>{inner}</Tooltip> : inner;
}

/* A segment chip's name, with its full text on hover only when the chip cuts
   it — the Customer list's SegChip, measured from the DOM. */
function SegNameCell({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const clipped = useIsClipped(ref, name);
  const inner = <span ref={ref} className="smc-seg-name">{name}</span>;
  return clipped ? <Tooltip label={name}>{inner}</Tooltip> : inner;
}

/* Supplier Type pill colours: classes (.sup-type--material / --logistics / --services in
   supplier-management.css), so light and dark mode both follow the design. */

function typeKind(type: string): 'material' | 'logistics' | 'services' {
  const t = (type || '').toLowerCase();
  /* Movement-of-goods types all take the teal pill Figma gives Logistics.
     Matching 'logist' alone meant "FFD / Transporter" — a type tenants create
     themselves — matched nothing and fell through to the material default, so
     it rendered violet and was indistinguishable from Material / Goods.
     'ffd' = Freight Forwarding Division. */
  if (t.includes('logist') || t.includes('transport') || t.includes('ffd') || t.includes('freight')) return 'logistics';
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
/* Supplier Category — the supplier's COMMERCIAL STANDING, read from the
   stored vendors.supplier_category.
   This column used to be "Supplier Flag", derived by sniffing the RISK LEVEL
   string for "high"/"medium" — so it never showed anything the Risk Level
   column did not already say, and it could not show Star or Blacklisted at
   all because risk has no such value. It is a real field now. */
type CatIcon = 'star' | 'medal' | 'warn' | 'ban';
function supplierCategory(cat?: string): { label: string; cls: string; icon: CatIcon } | null {
  switch ((cat || '').trim().toLowerCase()) {
    case 'star':        return { label: 'Star Supplier',        cls: 'sl-cat--star',  icon: 'star'  };
    case 'general':     return { label: 'General Supplier',     cls: 'sl-cat--general', icon: 'medal' };
    case 'high_risk':   return { label: 'High Risk Supplier',   cls: 'sl-cat--risk',  icon: 'warn'  };
    case 'blacklisted': return { label: 'Blacklisted Supplier', cls: 'sl-cat--black', icon: 'ban'   };
    default:            return null;
  }
}

/* One glyph per category. Drawn inline rather than pulled from an icon font so
   the badge renders identically wherever this table is embedded. */
function CatIconSvg({ kind }: { kind: CatIcon }) {
  const common = { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'star')  return <svg {...common}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
  if (kind === 'medal') return <svg {...common}><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></svg>;
  if (kind === 'warn')  return <svg {...common}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>;
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
  /* Two values now, and they arrive already decided: the server derives
     Compliant / Non Compliant from the supplier's mandatory document set (see
     App\Support\SupplierCompliance) instead of the ten-state Compliance
     Behaviour master this used to bucket by keyword. Nothing is guessed from
     the wording here any more — the label IS the answer. */
  const no = s.toLowerCase().startsWith('non');
  return { label: s, cls: no ? 'sl-compliant--no' : 'sl-compliant--yes' };
}

/* ── Filter Suppliers (the design's centred modal) ──────────────────────────
 * Ticks are a DRAFT inside the modal: the list changes only on Apply Filters.
 * Cancel, ×, Esc and the backdrop drop the draft. "N of M suppliers match" is
 * still the real answer from the server — a count-only request for the draft. */
const CAT_OPTS: Array<{ key: string; label: string; hint: string; icon: CatIcon }> = [
  { key: 'star',        label: 'Star Supplier',        hint: 'Top-rated, high-volume',      icon: 'star'  },
  { key: 'general',     label: 'General Supplier',     hint: 'Standard approved suppliers', icon: 'medal' },
  { key: 'high_risk',   label: 'High Risk Supplier',   hint: 'Flagged for closer review',   icon: 'warn'  },
  { key: 'blacklisted', label: 'Blacklisted Supplier', hint: 'Blocked from new orders',     icon: 'ban'   },
];

const COMP_OPTS: Array<{ key: string; label: string; hint: string; glyph: ReactNode }> = [
  {
    key: 'compliant', label: 'Compliant', hint: 'All KYC & documents verified',
    glyph: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>,
  },
  {
    key: 'non_compliant', label: 'Non Compliant', hint: 'Pending or failed compliance',
    glyph: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12.01" y2="16.5" /></svg>,
  },
];

const IcoFunnel = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>;
const IcoTick = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;

function RefineSuppliers(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facets: SupplierFacets | null;
  /** Rows the current filters return: the N of "N of M suppliers match". */
  shown: number;
  active: number;
  scopeLabel: string;
  /** The filters the LIST uses now (applied). */
  applied: { cat: string[]; comp: string[] };
  /** Apply Filters: hand the draft to the list. Resolves once the filtered list has loaded. */
  onApply: (cat: string[], comp: string[]) => Promise<void> | void;
  /** How many suppliers a draft would return (count only; the list is not touched). */
  countFor: (cat: string[], comp: string[]) => Promise<number>;
}) {
  const { open, onOpenChange, facets, applied, onApply, countFor } = props;
  const dialogRef = useRef<HTMLDivElement>(null);

  // The draft starts from what is applied each time the modal opens.
  const [catSel, setCatSel] = useState<string[]>(applied.cat);
  const [compSel, setCompSel] = useState<string[]>(applied.comp);
  useEffect(() => {
    if (open) { setCatSel(applied.cat); setCompSel(applied.comp); dialogRef.current?.focus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (list: string[], set: (v: string[]) => void, k: string) =>
    set(list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  const draftCount = catSel.length + compSel.length;

  // "N of M suppliers match" for the draft: the list's own total while the draft equals what is
  // applied, otherwise a count-only request (debounced; a newer one wins).
  const same = catSel.join() === applied.cat.join() && compSel.join() === applied.comp.join();
  const [matchN, setMatchN] = useState<number | null>(null);
  useEffect(() => {
    if (!open || same) { setMatchN(null); return; }
    let live = true;
    setMatchN(null);
    const t = window.setTimeout(() => {
      countFor(catSel, compSel).then(n => { if (live) setMatchN(n); }).catch(() => {});
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, same, catSel.join(), compSel.join()]);
  const shownN = same ? props.shown : matchN;

  // Cancel / × / Esc / backdrop: close and drop the draft (the list never changed).
  /* Apply Filters shows a loader until the filtered list has loaded, then closes (it used to close
     at once while the list reloaded unseen behind it). Cancel / × / Esc wait while it applies. */
  const [applying, setApplying] = useState(false);
  const cancel = useCallback(() => { if (!applying) onOpenChange(false); }, [onOpenChange, applying]);
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try { await onApply(catSel, compSel); }
    finally { setApplying(false); onOpenChange(false); }
  };

  // Esc cancels; the page behind stays still (html too: a body-only lock still lets it scroll).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey);
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = b;
      document.documentElement.style.overflow = h;
    };
  }, [open, cancel]);

  const grand = facets?.grand_total ?? 0;

  const option = (key: string, label: string, hint: string, ico: ReactNode, n: number | null, on: boolean, toggle: () => void) => (
    /* No supplier with this value (n = 0): disabled, not just faded (QA #29). One already ticked
       stays clickable so it can be unticked. */
    <button key={key} type="button" role="checkbox" aria-checked={on} className={`supfm-opt${on ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`}
      onClick={toggle} disabled={n === 0 && !on} title={n === 0 && !on ? 'No supplier has this yet' : undefined}>
      <span className="supfm-chk"><IcoTick /></span>
      <span className="supfm-ico">{ico}</span>
      <span className="supfm-txt"><b>{label}</b><small>{hint}</small></span>
      <span className="supfm-n">{n ?? '–'}</span>
    </button>
  );

  return (
    <div className="sl-refine">
      <button
        type="button"
        className={`sl-refine-btn${open ? ' is-open' : ''}${props.active ? ' has-active' : ''}`}
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
        {props.active > 0 && <span className="sl-refine-badge">{props.active}</span>}
      </button>

      {open && createPortal(
        <div className="supfm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
          <div className="supfm" role="dialog" aria-modal="true" aria-label="Filter Suppliers" ref={dialogRef} tabIndex={-1}>
            <div className="supfm-hd">
              <span className="supfm-hd__ico"><IcoFunnel /></span>
              <div className="supfm-hd__t">
                <b>Filter Suppliers</b>
                <small>Narrow the list by category and compliance · <span>{props.scopeLabel}</span></small>
              </div>
              <button type="button" className="supfm-x" onClick={cancel} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="supfm-body">
              <section className="supfm-sec">
                <div className="supfm-sec__hd">
                  <span className="supfm-sec__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></span>
                  <div className="supfm-sec__t"><b>Supplier Category</b><small>Filter by supplier rating</small></div>
                  {catSel.length > 0 && <span className="supfm-sel">{catSel.length} selected</span>}
                </div>
                <div className="supfm-grid">
                  {CAT_OPTS.map(t => option(
                    t.key, t.label, t.hint, <CatIconSvg kind={t.icon} />,
                    facets ? facets.category[t.key as keyof SupplierFacets['category']] : null,
                    catSel.includes(t.key), () => toggle(catSel, setCatSel, t.key),
                  ))}
                </div>
              </section>

              <section className="supfm-sec">
                <div className="supfm-sec__hd">
                  <span className="supfm-sec__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></span>
                  <div className="supfm-sec__t"><b>Compliant Status</b><small>Filter by KYC / compliance result</small></div>
                  {compSel.length > 0 && <span className="supfm-sel">{compSel.length} selected</span>}
                </div>
                <div className="supfm-grid">
                  {COMP_OPTS.map(t => option(
                    t.key, t.label, t.hint, t.glyph,
                    facets ? facets.compliance[t.key as keyof SupplierFacets['compliance']] : null,
                    compSel.includes(t.key), () => toggle(compSel, setCompSel, t.key),
                  ))}
                </div>
              </section>
            </div>

            <div className="supfm-ft">
              {/* Clears the draft; the list follows only on Apply. */}
              <button type="button" className="supfm-clear" onClick={() => { setCatSel([]); setCompSel([]); }} disabled={!draftCount}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /></svg>
                Clear All
              </button>
              <span className="supfm-res"><b>{shownN ?? '…'}</b> of {grand} suppliers match</span>
              <span className="supfm-sp" />
              <button type="button" className="supfm-cancel" onClick={cancel} disabled={applying}>Cancel</button>
              {/* Nothing to apply until the ticks differ from what the list already uses (CS-2324):
                  disabled with no selection, and after a change that was put back. */}
              <button type="button" className="supfm-apply" onClick={() => { void apply(); }} disabled={applying || same} aria-busy={applying || undefined}
                title={same && !applying ? 'Select a category or compliance status to filter by' : undefined}>
                {applying
                  ? <><span className="supfm-spin" aria-hidden />Applying…</>
                  : <><IcoTick />Apply Filters{draftCount > 0 ? ` (${draftCount})` : ''}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** The design's supplier-type tabs. They send `kind` to /vendors and read `facets.kind` counts
    (backend pending: filter + counts by the same rule as typeKind). */
type SupplierKind = 'all' | 'material' | 'logistics' | 'services';
/* Tab glyphs as the Figma draws them: 12px line icons, stroke 2.2 (users / box / truck / wrench). */
const KIND_ICON: Record<SupplierKind, ReactNode> = {
  all: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  material: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  logistics: <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  services: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
};
const SUPPLIER_KINDS: { key: SupplierKind; label: string }[] = [
  { key: 'all', label: 'All Suppliers' },
  { key: 'material', label: 'Material/ Goods Suppliers' },
  { key: 'logistics', label: 'FFD/ Transporter Suppliers' },
  { key: 'services', label: 'Service Suppliers' },
] as const;

/** Rows a type tab may load at once while the API cannot filter by type. */
const KIND_FETCH_CAP = 1000;
const matchesKind = (v: Vendor, k: SupplierKind) =>
  k === 'all' || (!!v.type && v.type !== 'Pending' && typeKind(v.type) === k);
const countKinds = (rows: Vendor[]): Record<SupplierKind, number> => ({
  all: rows.length,
  material: rows.filter(v => matchesKind(v, 'material')).length,
  logistics: rows.filter(v => matchesKind(v, 'logistics')).length,
  services: rows.filter(v => matchesKind(v, 'services')).length,
});

/** "State, Country" for the supplier cell (either may be missing). */
const place = (v: Vendor) => [v.state !== '—' ? v.state : '', v.country ?? ''].filter(Boolean).join(', ');

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  /* The facet Filter (the two-pane PartyFilterModal the Customer list uses)
     was removed from this page. Search plus the Fresh/Recurring and
     Domestic/International tabs are the whole narrowing story here now. */
  // The list has no status tab any more: always the whole list.
  const tab: SupplierTab = 'all';

  /* Refine Suppliers — two facet groups, both server-applied. The counts come
     back with the list (VendorController::index) rather than being tallied from
     the rows on screen: the list is ONE PAGE, so counting it would report "3
     General" when the branch has thirty. */
  const [filterOpen, setFilterOpen] = useState(false);
  const [catSel,  setCatSel]  = useState<string[]>([]);
  const [compSel, setCompSel] = useState<string[]>([]);
  const [facets,  setFacets]  = useState<SupplierFacets | null>(null);
  const catParam  = catSel.join(',');
  const compParam = compSel.join(',');
  const activeFilters = catSel.length + compSel.length;
  /* Scope tabs on the "What We Are Doing Here" strip. Same split the Add
     Supplier gate asks about, applied to the list: a supplier is domestic
     when its country is India and international otherwise — the same rule the
     form derives GST and State Code from.
     Two tabs, no "All": the list is always looking at one side or the other,
     and Domestic is the landing state because it is the larger book. */
  const [scopeTab, setScopeTab] = useState<'domestic' | 'international'>('domestic');
  /* International rows have no GST State Code: the Location cell leaves its
     "GST nn" line out. */
  const isIntlScope = scopeTab === 'international';
  const [kindTab, setKindTab] = useState<SupplierKind>('all');
  const [kindCounts, setKindCounts] = useState<Record<SupplierKind, number> | null>(null);
  const kindCacheRef = useRef('');    // filters + type of the list a type tab holds
  const countsKeyRef = useRef('');    // filters the tab counts were taken for
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
  const [vaultTarget, setVaultTarget] = useState<SupplierVaultTarget | null>(null);
  const [contactsTarget, setContactsTarget] = useState<Vendor | null>(null);
  /* When set, the read-only Mapped Products popup lists this supplier's product
     mappings — opened from the Mapped Products count badge. */
  const [mappedTarget, setMappedTarget] = useState<Vendor | null>(null);
  /* A service-provider supplier's Mapped Services popup, and how many services each supplier
     is mapped to. The vendor list has no service count, so it comes from ONE call: every
     service with its active suppliers' names, counted per supplier name. */
  const [servicesTarget, setServicesTarget] = useState<Vendor | null>(null);
  const [serviceCounts, setServiceCounts] = useState<Map<string, number>>(new Map());
  const loadServiceCounts = useCallback(() => {
    api.get<{ data?: { supplier_names?: string[] }[] }>('/p2p/services', { params: { per_page: 200 } })
      .then(r => {
        const m = new Map<string, number>();
        for (const s of r.data?.data ?? []) {
          for (const n of s.supplier_names ?? []) { const k = n.trim().toLowerCase(); m.set(k, (m.get(k) ?? 0) + 1); }
        }
        setServiceCounts(m);
      })
      .catch(() => {});
  }, []);
  // Only while service mapping is switched on: off, the list makes no extra call.
  useEffect(() => { if (SERVICE_MAPPING_ENABLED) loadServiceCounts(); }, [loadServiceCounts]);
  const [segPop, setSegPop] = useState<{ segments: { name: string; reg?: string | null }[]; x: number; y: number; top: number } | null>(null);
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

  useEffect(() => {
    const anyOpen = contactsTarget !== null;
    if (!anyOpen) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [segPop, contactsTarget]);

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
  const [refetching, setRefetching] = useState(false);
  /** Apply Filters waits on this: resolved when the list request for the new filters finishes. */
  const applyWaitRef = useRef<{ resolve: () => void; token: number | null } | null>(null);
  const [swapping, setSwapping] = useState(false);
  const bootedRef = useRef(false);
  const [brefOpen, setBrefOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const reqRef = useRef(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rpp, setRpp] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(PER_PAGE_KEY));
      return Number.isFinite(n) && n >= 10 && n <= 200 ? n : 10;
    } catch {
      return 10;
    }
  });
  /* True until the user picks a size this visit. */
  const autoFitRef = useRef(true);
  const rppRef = useRef(rpp);
  rppRef.current = rpp;
  const pageRef = useRef(page);
  pageRef.current = page;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const apiToVendor = (row: ApiVendor): Vendor => {
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
      state:       row.primary_address?.state?.name
                     || row.primary_address?.state_code
                     || '—',
      stateCode:   row.primary_address?.state_code || null,
      city:        row.primary_address?.city ?? '—',
      country:     row.primary_address?.country?.name ?? undefined,
      contactName: contacts[0]?.name || row.primary_address?.contact_name || '—',
      designation: '—',
      phone:       row.primary_address?.contact_no ?? '—',
      email:       row.primary_address?.email ?? row.primary_email ?? '—',
      status:      row.status === 'active' ? 'Active' : 'Inactive',
      createdOn:   row.created_at ? row.created_at.slice(0, 10).split('-').reverse().join('/') : undefined,
      opportunityCount: Number(row.opportunity_count ?? 0) || 0,
      segment:     row.segment?.name ? segmentLabel(row.segment.name, row.segment.regulatory_status) : undefined,
      segmentItems: (() => {
        const arr = (row.segments ?? []).filter(s => s.name).map(s => ({ id: s.id, name: String(s.name), reg: s.regulatory_status }));
        return arr.length ? arr : (row.segment?.name ? [{ id: row.segment.id, name: row.segment.name, reg: row.segment.regulatory_status }] : []);
      })(),
      segments:    (() => {
        const arr = (row.segments ?? []).filter(s => s.name).map(s => segmentLabel(s.name, s.regulatory_status));
        return arr.length ? arr : (row.segment?.name ? [segmentLabel(row.segment.name, row.segment.regulatory_status)] : []);
      })(),
      risk:        row.risk_level?.name ?? undefined,
      compliance:  row.compliance_status ?? undefined,
      category:    row.supplier_category ?? undefined,
      mappedProducts: Number(row.product_mappings_count ?? 0) || 0,
      contacts,
    };
  };


  useEffect(() => {
    const next = search.trim();
    if (!next) { setDebouncedSearch(''); return; }
    const t = window.setTimeout(() => setDebouncedSearch(next), 500);
    return () => window.clearTimeout(t);
  }, [search]);

  /* Filter Suppliers works on a draft: these are the filters the list uses (applied), and the
     count a draft would return — same search / scope / tab as the list, one row, total only. */
  const appliedFilters = useMemo(() => ({ cat: catSel, comp: compSel }), [catSel, compSel]);
  const countSuppliersFor = useCallback(async (cat: string[], comp: string[]) => {
    const r = await api.get<any>('/vendors', { params: {
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(cat.length ? { categories: cat.join(',') } : {}),
      ...(comp.length ? { compliance: comp.join(',') } : {}),
      scope: scopeTab, tab, page: 1, per_page: 1,
    } });
    const b: any = r.data ?? {};
    return Number(b.total ?? b.meta?.total ?? (Array.isArray(b) ? b.length : 0)) || 0;
  }, [debouncedSearch, scopeTab, tab]);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const filterKey = JSON.stringify([debouncedSearch, catParam, compParam, scopeTab, tab]);
    const kindMode = kindTab !== 'all';
    // A type tab holds the whole filtered list and pages it here, so a page change needs no fetch.
    if (kindMode && !opts?.silent && kindCacheRef.current === `${filterKey}|${kindTab}`) {
      // After this render's effects (the swap effect below sets the shimmer on a page change).
      void Promise.resolve().then(() => setSwapping(false));
      return;
    }
    if (!opts?.silent) {
      if (bootedRef.current) setRefetching(true);
      else                   setLoading(true);
    }
    const token = ++reqRef.current;
    // An Apply Filters waiting for its list follows the newest request (a page reset can start a second).
    if (applyWaitRef.current) applyWaitRef.current.token = token;
    const base = {
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(catParam  ? { categories: catParam }  : {}),
      ...(compParam ? { compliance: compParam } : {}),
      scope: scopeTab,
      tab,
    };
    const fetchAll = () => api.get<any>('/vendors', { params: { ...base, page: 1, per_page: KIND_FETCH_CAP } });
    try {
      /* Until /vendors filters and counts by `kind` (backend pending), a type tab loads the whole
         filtered list once, keeps its type, and pages it on screen. */
      const res = kindMode
        ? await fetchAll()
        : await api.get<any>('/vendors', { params: { ...base, page, per_page: rpp } });
      if (token !== reqRef.current) return;
      const body: any = res.data ?? {};
      const rows: Vendor[] = (Array.isArray(body) ? body : (body.data ?? [])).map(apiToVendor);
      if (kindMode) {
        const ofKind = rows.filter(v => matchesKind(v, kindTab));
        setVendors(ofKind);
        setTotal(ofKind.length);
        kindCacheRef.current = `${filterKey}|${kindTab}`;
      } else {
        setVendors(rows);
        setTotal(Number(body.total ?? rows.length) || 0);
        kindCacheRef.current = '';
      }
      setFacets(body.facets ?? null);

      // Tab counts: the API's own when it sends them; otherwise counted here, once per filter set.
      if (body.facets?.kind) {
        setKindCounts(body.facets.kind);
      } else if (kindMode) {
        setKindCounts(countKinds(rows));
        countsKeyRef.current = filterKey;
      } else if (opts?.silent || countsKeyRef.current !== filterKey) {
        countsKeyRef.current = filterKey;
        fetchAll()
          .then(r => {
            if (countsKeyRef.current !== filterKey) return;
            const b: any = r.data ?? {};
            setKindCounts(countKinds((Array.isArray(b) ? b : (b.data ?? [])).map(apiToVendor)));
          })
          .catch(() => { /* counts stay as they were; the list itself loaded */ });
      }
    } catch {
      if (token !== reqRef.current) return;
      toast.error('Load failed', 'Could not load suppliers');
    } finally {
      if (token === reqRef.current) {
        bootedRef.current = true;
        setLoading(false);
        setRefetching(false);
        setSwapping(false);
      }
      if (applyWaitRef.current?.token === token) { const done = applyWaitRef.current.resolve; applyWaitRef.current = null; done(); }
    }
  }, [page, rpp, debouncedSearch, scopeTab, kindTab, tab, catParam, compParam]);
 const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  /* Domestic <-> International (CS-2321): the type-tab counts belong to the scope they were
     taken in, so they read 0 until the new scope's counts arrive, never the old scope's numbers.
     Set before the refresh below runs, so the new counts land on top of the 0s. */
  const prevScopeRef = useRef(scopeTab);
  if (prevScopeRef.current !== scopeTab) {
    prevScopeRef.current = scopeTab;
    setKindCounts(null);
    setTotal(0);
  }
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, scopeTab, kindTab, catParam, compParam]);

  useEffect(() => {
    if (bootedRef.current) setSwapping(true);
  }, [scopeTab, kindTab, catParam, compParam, debouncedSearch, page, tab, rpp]);

  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;

      if (window.innerWidth <= 820) { el.style.minHeight = ''; return; }

      const top = el.getBoundingClientRect().top;
      /* Measured, not assumed: the rows are the Customer list's (.smc-table-wrap)
         now, shorter than the old 54px. Fallbacks cover the shimmer pass. */
      const THEAD = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight || 40;
      const ROW = (el.querySelector('tbody tr') as HTMLElement | null)?.offsetHeight || 41;
      const PAGER = 56;
      const footerEl = document.querySelector('footer.footer') as HTMLElement | null;
      const footerH = footerEl?.offsetHeight ?? 0;
      const bottomReserve = footerH > 0 ? footerH + 8 : 15;

      const scrollbarH = Math.min(20, Math.max(0, el.offsetHeight - el.clientHeight));

      const cardH = Math.max(240, window.innerHeight - top - bottomReserve);
      const avail = cardH - THEAD - PAGER - scrollbarH;
      const fit = Math.max(10, Math.floor(avail / ROW));
      if (autoFitRef.current && fit !== rppRef.current) {
        const firstRow = (pageRef.current - 1) * rppRef.current;
        setRpp(fit);
        setPage(Math.floor(firstRow / fit) + 1);
        try { localStorage.setItem(PER_PAGE_KEY, String(fit)); } catch { /* private mode */ }
      }

      // cardH covers the whole card; the pager is now its sibling, so the
      // scroller gets what is left after that band.
      const h = `${cardH - PAGER}px`;
      if (el.style.minHeight !== h) el.style.minHeight = h;
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const recomputeDebounced = () => { if (settleTimer) clearTimeout(settleTimer); settleTimer = setTimeout(recompute, 140); };
    window.addEventListener('resize', recomputeDebounced);
    return () => { if (settleTimer) clearTimeout(settleTimer); window.removeEventListener('resize', recomputeDebounced); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, loading, swapping, brefOpen, rpp, vendors.length > 0]);
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
 

  const pages = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pages);
  const start = (curPage - 1) * rpp;   // Sr No offset for the rows on this page
  /* Until /vendors filters by `kind`, the type tab narrows the loaded page on screen; once the
     API filters, every row already matches and this is a no-op. */
  const pageRows = kindTab === 'all' ? vendors : vendors.slice(start, start + rpp);

  const handleSave = () => {
    setAddOpen(false);
    setEditingId(null);
    setEditingStep(null);
    void refresh({ silent: true });
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
         {/* The Customer list's layout (.smc-root): header block in .sup-fig,
             then the .smc-table-card list - same classes, same overrides. */}
         <div className="smc-root sup-list" ref={rootRef}>
          {loading ? <div className="sup-fig"><ShimmerClmMaster cols={11} rows={8} twoTab /></div> : (<>

          <div className="sup-fig">
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

          <div className={`bref-box smc-bref ${brefOpen ? '' : 'is-collapsed'}`}>
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

          </div>

          {/* .sup-fig stays the ancestor: the category / compliance pills and
              the Refine panel are styled under it. */}
          <div className="sup-fig">
          <div className="smc-table-card dt-root hr-dt" data-accent="teal">
            <div className="smc-toolbar">
              {/* Domestic / International: the design's main tabs (icon tile, label, count). */}
              <div className="sup-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={scopeTab === 'domestic'} className={`sup-tab${scopeTab === 'domestic' ? ' is-on' : ''}`} onClick={() => setScopeTab('domestic')}>
                  <span className="sup-tab__ico"><i className="ri-home-4-line" /></span>Domestic Supplier
                  <span className="sup-tab__c">{facets?.scope?.domestic ?? 0}</span>
                </button>
                <button type="button" role="tab" aria-selected={scopeTab === 'international'} className={`sup-tab${scopeTab === 'international' ? ' is-on' : ''}`} onClick={() => setScopeTab('international')}>
                  <span className="sup-tab__ico"><i className="ri-global-line" /></span>International Supplier
                  <span className="sup-tab__c">{facets?.scope?.international ?? 0}</span>
                </button>
              </div>
              {/* Filter, then search, on the right — the design's order. */}
              <div className="sup-tools">
              <RefineSuppliers
                open={filterOpen}
                onOpenChange={setFilterOpen}
                facets={facets}
                shown={total}
                active={activeFilters}
                applied={appliedFilters}
                onApply={(cat, comp) => new Promise<void>(resolve => {
                  // Nothing changed: nothing to load.
                  if (cat.join() === catSel.join() && comp.join() === compSel.join()) { resolve(); return; }
                  applyWaitRef.current = { resolve, token: null };
                  setCatSel(cat); setCompSel(comp);
                  // Never leave the modal stuck if the request does not come back.
                  window.setTimeout(() => { if (applyWaitRef.current?.resolve === resolve) { applyWaitRef.current = null; resolve(); } }, 15000);
                })}
                countFor={countSuppliersFor}
                scopeLabel={isIntlScope ? 'International Suppliers' : 'Domestic Suppliers'}
              />
              <div className="dt-search">
                <i className="ri-search-line dt-search-icon" />
                <input
                  type="search"
                  name="supplier-list-search"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-form-type="other"
                  placeholder="Search by supplier code, name, type, state, country, contact, phone or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" className="dt-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                    <i className="ri-close-line" />
                  </button>
                )}
              </div>
              </div>
            </div>
            <div className="sup-kinds" role="tablist" aria-label="Supplier type">
              {SUPPLIER_KINDS.map(k => {
                const on = kindTab === k.key;
                const count = kindCounts?.[k.key] ?? (k.key === 'all' && kindTab === 'all' ? total : null);
                return (
                  <button key={k.key} type="button" role="tab" aria-selected={on} className={`sup-kind${on ? ' is-on' : ''}`} onClick={() => setKindTab(k.key)}>
                    <span className="sup-kind__ico" aria-hidden><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{KIND_ICON[k.key]}</svg></span>{k.label}
                    {/* 0 until the counts arrive (never a dash), like the Domestic / International tabs. */}
                    <span className="sup-kind__c">{count ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className="smc-table-wrap sup-table-wrap">
            {loading || swapping ? (
              <ShimmerTable rows={Math.min(rpp, 12)} cols={11} />
            ) : (
              <>
                <div className={`table-responsive${refetching ? ' is-refetching' : ''}`} ref={scrollRef}>
                  <table className="table align-middle table-nowrap mb-0 dt-table">
                    <thead className="table-light">
                      <tr>
                        <th style={{ textAlign: 'center' }}>Sr. No</th>
                        <th style={{ textAlign: 'center' }}>Supplier Code</th>
                        <th>Supplier</th>
                        <th style={{ textAlign: 'center' }}>Supplier Type</th>
                        <th>Segment</th>
                        <th>Location</th>
                        <th>Contact Person</th>
                        <th style={{ textAlign: 'center' }}>Supplier Category</th>
                        <th style={{ textAlign: 'center' }}>Compliant Status</th>
                        <th style={{ textAlign: 'center' }}>Mapped Products / Services</th>
                        <th style={{ textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((v, i) => {
                        const kind = typeKind(v.type);
                        const flag = supplierCategory(v.category);
                        const compliance = complianceTone(v.compliance);
                        return (
                          <tr key={v.id}>
                            <td style={{ textAlign: 'center' }}><span className="dt-serial">{start + i + 1}</span></td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="sup-code">
                                <span className="dt-id-chip">{v.code}</span>
                                {v.createdOn && <span className="sup-sub">{v.createdOn}</span>}
                              </span>
                            </td>
                            <td>
                              {/* Icon tile, name, location. Type and contact count have their own columns. */}
                              <span className="sup-cell">
                                <span className="sup-cell__ico" aria-hidden><i className="ri-building-2-line" /></span>
                                <span className="sup-cell__txt">
                                  <ClipCell value={v.companyName} className="smc-company sup-name" />
                                  {place(v) && <span className="sup-sub sup-sub--loc"><i className="ri-map-pin-line" aria-hidden />{place(v)}</span>}
                                </span>
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {v.type && v.type !== 'Pending'
                                ? <span className={`smc-type-pill sup-type sup-type--${kind}`}>{v.type}</span>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              {v.segmentItems && v.segmentItems.length > 0 ? (
                                <span className="d-inline-flex align-items-center" style={{ gap: 4, maxWidth: '100%', minWidth: 0 }}>
                                  {/* The name tooltip hangs on the NAME only, never the
                                      whole chip: the Reg badge inside carries its own
                                      tooltip, and moving onto it never left the chip, so
                                      both stayed up at once (QA #50). */}
                                  <span className="smc-seg smc-seg--withbadge">
                                    <SegNameCell name={v.segmentItems[0].name} />
                                    <SegmentBadge status={v.segmentItems[0].reg} style={{ marginLeft: 0, flexShrink: 0 }} />
                                  </span>
                                  {v.segmentItems.length > 1 && (
                                    <Tooltip label={`View ${v.segmentItems.length - 1} more`}>
                                      <button
                                        type="button"
                                        className="smc-seg-more"
                                        onClick={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setSegPop({ segments: v.segmentItems ?? [], x: r.left, y: r.bottom + 6, top: r.top });
                                        }}
                                      >+{v.segmentItems.length - 1}</button>
                                    </Tooltip>
                                  )}
                                </span>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              <span className="sup-loc">
                                <span><b className="sup-strong">{v.state !== '—' ? v.state : (v.country ?? '—')}</b>{v.state !== '—' && v.country && <span className="sup-sub">, {v.country}</span>}</span>
                                {!isIntlScope && v.stateCode && <span className="sup-sub">GST <b className="smc-mono sup-strong">{v.stateCode}</b></span>}
                              </span>
                            </td>
                            <td>
                              <span className="sup-ct">
                                <span className="d-inline-flex align-items-center" style={{ gap: 4, maxWidth: '100%', minWidth: 0 }}>
                                  <ClipCell value={v.contactName} className="smc-contact sup-strong" />
                                  {v.contacts.length > 1 && (
                                    <Tooltip label={`View all ${v.contacts.length} contacts`}>
                                      <button type="button" className="smc-seg-more" onClick={() => setContactsTarget(v)}>
                                        +{v.contacts.length - 1}
                                      </button>
                                    </Tooltip>
                                  )}
                                </span>
                                {v.phone && v.phone !== '—' && <span className="sup-sub"><i className="ri-phone-line" aria-hidden /><span className="smc-mono">{v.phone}</span></span>}
                                {v.email && v.email !== '—' && <span className="sup-sub"><i className="ri-mail-line" aria-hidden /><ClipCell value={v.email} className="smc-email" /></span>}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {flag
                                ? (
                                  <span className={`sl-cat ${flag.cls}`}>
                                    <CatIconSvg kind={flag.icon} />
                                    {flag.label}
                                  </span>
                                )
                                : <Tooltip label="No category set on this supplier yet"><span className="text-muted">—</span></Tooltip>}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {compliance
                                ? (
                                  <span className={`sl-compliant ${compliance.cls}`}>
                                    <span className="sl-compliant__dot" aria-hidden />
                                    {compliance.label}
                                  </span>
                                )
                                : <Tooltip label="No compliance behaviour set on this supplier yet"><span className="text-muted">—</span></Tooltip>}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {/* A service-provider supplier counts and opens its SERVICES; every
                                  other type keeps its products. */}
                              {isServiceType(v.type) ? (() => {
                                // Switched off (./serviceMapping): a plain dash, like the form's disabled button.
                                if (!SERVICE_MAPPING_ENABLED) {
                                  return (
                                    <Tooltip label="Service mapping is not available yet">
                                      <span className="sl-prodcount sl-prodcount--zero">—</span>
                                    </Tooltip>
                                  );
                                }
                                const n = serviceCounts.get(v.companyName.trim().toLowerCase()) ?? 0;
                                return n > 0 ? (
                                  <Tooltip label="View mapped services">
                                    <button type="button" className="sl-prodcount" onClick={() => setServicesTarget(v)}>{n}</button>
                                  </Tooltip>
                                ) : (
                                  <Tooltip label="No services mapped to this supplier yet">
                                    <span className="sl-prodcount sl-prodcount--zero">0</span>
                                  </Tooltip>
                                );
                              })() : v.mappedProducts > 0 ? (
                                <Tooltip label="View mapped products">
                                  <button type="button" className="sl-prodcount" onClick={() => setMappedTarget(v)}>
                                    {v.mappedProducts}
                                  </button>
                                </Tooltip>
                              ) : (
                                <Tooltip label="No products mapped to this supplier yet">
                                  <span className="sl-prodcount sl-prodcount--zero">0</span>
                                </Tooltip>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {/* The Supplier list's own action pair (kept as it was):
                                  the edit square and the "Evidence Vault" button. */}
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
                                    segmentItems: v.segmentItems,
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
                  {pageRows.length === 0 && <div className="smc-empty py-4">No suppliers found</div>}
                </div>
                <WorklistPager className={`tc-wl-pag${refetching ? ' is-refetching' : ''}`} total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[10, 25, 50]} />
              </>
            )}
            </div>
          </div>
          </div>
          </>)}
         </div>
        </Col>
      </Row>

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
          vendorCodeHint={editingId ? (vendors.find(x => x.id === editingId)?.code ?? null) : null}
          initialStep={editingStep ?? undefined}
          scope={addScope ?? undefined}
          onClose={() => { setAddOpen(false); setEditingId(null); setEditingStep(null); setAddScope(null); returnToRef.current = null; void refresh({ silent: true }); }}
          onSubmit={handleSave}
        />
        </Suspense>
      )}

      {segPop && createPortal(
        <div className="sup-fig sup-list">
          <div className="sl-seg-pop-backdrop" onClick={() => setSegPop(null)} />
          <div
            ref={segPopRef}
            className="sl-seg-pop"
            style={segPopPos ? { left: segPopPos.left, top: segPopPos.top, width: 260 } : { left: -9999, top: 0, width: 260, visibility: 'hidden' }}
          >
            <div className="sl-seg-pop-title">Segments ({segPop.segments.length})</div>
            <div className="sl-seg-pop-list" style={{ maxHeight: 148 }}>
              {segPop.segments.map((s, idx) => (
                <div key={`${s.name}-${idx}`} className={`sl-seg-pop-row ${idx % 2 ? 'alt' : ''}`}>
                  <Tooltip label={s.name}>
                    <span className="sl-seg sl-seg-pop-name">{s.name}</span>
                  </Tooltip>
                  <SegmentBadge status={s.reg} style={{ marginLeft: 'auto', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {contactsTarget && (
        <div className="sup-fig sup-list">
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

      {mappedTarget && (
        <Suspense fallback={null}>
        <MappedProductsViewPopup
          vendorId={mappedTarget.id}
          code={mappedTarget.code}
          name={mappedTarget.companyName}
          segments={mappedTarget.segments}
          segmentIds={(mappedTarget.segmentItems ?? []).map(s => s.id).filter((id): id is number => typeof id === 'number')}
          onClose={() => setMappedTarget(null)}
          onChanged={() => void refresh({ silent: true })}
        />
        </Suspense>
      )}
      {servicesTarget && (
        <Suspense fallback={null}>
          <MappedServicesViewPopup
            vendorId={servicesTarget.id}
            code={servicesTarget.code}
            name={servicesTarget.companyName}
            typeName={servicesTarget.type}
            international={!!servicesTarget.country && servicesTarget.country.trim().toLowerCase() !== 'india'}
            onClose={() => setServicesTarget(null)}
            onChanged={loadServiceCounts}
          />
        </Suspense>
      )}
      {vaultTarget && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal
            open
            supplier={vaultTarget}
            /* Re-read the list on close: uploads in the vault change the supplier's Compliant
               status, which otherwise showed only after a page refresh (CS-2326). */
            onClose={() => { setVaultTarget(null); void refresh({ silent: true }); }}
          />
        </Suspense>
      )}

    </>
  );
}
