import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import SegmentBadge, { segmentLabel } from '../../../../components/ui/SegmentBadge';
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
import { lazyPage } from '../../../../utils/lazyPage';

const AddVendorModal = lazyPage(() => import('./AddVendorModal'));
const MappedProductsViewPopup = lazyPage(() =>
  import('./AddVendorModal').then(m => ({ default: m.MappedProductsViewPopup })));
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
};

export type SupplierFacets = {
  grand_total: number;
  category: { star: number; general: number; high_risk: number; blacklisted: number };
  compliance: { compliant: number; non_compliant: number };
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

/* ── Refine Suppliers ─────────────────────────────────────────
 *
 * A popover, not a modal. Every choice in it is one click and is reflected in
 * the table behind immediately, so dimming that table to make the choice would
 * hide the only feedback the panel gives. "Done" just closes it.
 *
 * Filters apply as you tick — there is no Apply/Cancel pair. That means no
 * draft state to keep in sync, and the count in the footer is the live answer
 * rather than a promise about one.
 */
const CAT_TILES: Array<{ key: string; label: string; icon: CatIcon }> = [
  { key: 'star',        label: 'Star',        icon: 'star'  },
  { key: 'general',     label: 'General',     icon: 'medal' },
  { key: 'high_risk',   label: 'High Risk',   icon: 'warn'  },
  { key: 'blacklisted', label: 'Blacklisted', icon: 'ban'   },
];

const COMP_TILES: Array<{ key: string; label: string; tone: string; glyph: ReactNode }> = [
  {
    key: 'compliant', label: 'Compliant', tone: 'ok',
    glyph: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="8 12.5 11 15.5 16 9" /></svg>,
  },
  {
    key: 'non_compliant', label: 'Non Compliant', tone: 'no',
    glyph: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="7.5" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12.01" y2="16.5" /></svg>,
  },
];

function RefineSuppliers(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facets: SupplierFacets | null;
  /** Rows the current filters return — the left half of "N / M". */
  shown: number;
  active: number;
  catSel: string[];
  compSel: string[];
  onToggleCat: (k: string) => void;
  onToggleComp: (k: string) => void;
  onClear: () => void;
}) {
  const { open, onOpenChange, facets } = props;
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Close on an outside click and on Escape. The panel overlays the table it
     filters, so leaving it open while the user reaches for a row would sit in
     front of the result they opened it to see. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  /* Freeze the page behind the panel while it is open, the same way the
     Segments and Contact Persons overlays do. The panel is position:fixed and
     the Filter button is not, so any scroll pulls the two apart — and which
     element does the scrolling varies with the shell, so there is no one scroll
     event to catch. Nothing moves, nothing comes apart.
     BOTH <html> and <body>: a body-only lock still lets the html element
     scroll on some layouts. */
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  /* How tall the facet area may be before the panel runs off the bottom of the
     screen. (#37)
     The body already scrolled, but at a FIXED cap — min(56vh, 420px) — which
     takes no account of where the button sits. On a page scrolled down, or a
     short window, the panel opened below the fold: the top of it was visible
     and Done was not, so it read as "hidden until you scroll the page".
     Measured from the button instead, the panel always ends above the viewport
     edge and the tiles scroll inside it. */
  /* The panel is position:fixed, so it needs real coordinates. Below 720px the
     stylesheet pins it edge-to-edge itself, so leave it alone there.
     maxHeight caps the whole SHEET rather than the body: the head and foot are
     flex:0 0 auto and the body takes the remainder, so the Done bar is on
     screen whatever is left. Capping the body instead meant guessing the head
     and foot heights, and the guess pushed Done past the bottom. */
  const [popPos, setPopPos] = useState<React.CSSProperties | undefined>(undefined);
  const [popUp, setPopUp] = useState(false);
  useEffect(() => {
    if (!open) { setPopPos(undefined); setPopUp(false); return; }
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      if (window.innerWidth <= 720) { setPopPos(undefined); setPopUp(false); return; }
      /* The viewport bottom is NOT the usable bottom: the horizontal shell
         pins .footer there, and the panel ran underneath it. Stop at whichever
         comes first. */
      const footTop = document.querySelector('.footer')?.getBoundingClientRect().top;
      const floorY = Math.min(window.innerHeight, footTop && footTop > r.bottom ? footTop : window.innerHeight);
      const ceilY = (document.querySelector('#page-topbar')?.getBoundingClientRect().bottom ?? 0) + 8;

      const right = Math.max(12, window.innerWidth - r.right);
      const below = floorY - (r.bottom + 11) - 10;
      const above = (r.top - 11) - ceilY - 10;

      /* Flip above the button when there isn't room below. Zoomed in, or on a
         short window, the toolbar sits near the footer and no cap can make a
         downward panel fit — it just loses its bottom. */
      const flip = below < 260 && above > below;
      setPopUp(flip);
      setPopPos(flip
        ? { bottom: window.innerHeight - r.top + 11, right, maxHeight: Math.max(200, above) }
        : { top: r.bottom + 11, right, maxHeight: Math.max(200, below) });
    };
    measure();

    /* Scrolling the page closes it rather than dragging it along: the panel is
       fixed, so it used to hang over a table that had moved on underneath,
       anchored to a Filter button no longer beside it.
       Watched by the button's own position rather than by scroll events. Which
       element scrolls depends on the shell — window, .main-content, or a
       wrapper inside it — and listening for the one that fires meant guessing.
       If the button has moved, the page scrolled, whatever did the scrolling.
       The facet list scrolls inside the panel without moving the button, so it
       is unaffected. */
    let anchor = wrapRef.current?.getBoundingClientRect().top ?? 0;
    let raf = 0;
    const watch = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r && Math.abs(r.top - anchor) > 2) { onOpenChange(false); return; }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);

    // A resize re-anchors instead of closing — the user has not scrolled away.
    const onResize = () => {
      measure();
      anchor = wrapRef.current?.getBoundingClientRect().top ?? anchor;
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [open, onOpenChange]);

  const grand = facets?.grand_total ?? 0;
  const pct = grand > 0 ? Math.round((Math.min(props.shown, grand) / grand) * 100) : 100;

  return (
    <div className="sl-refine" ref={wrapRef}>
      <button
        type="button"
        className={`sl-refine-btn${open ? ' is-open' : ''}${props.active ? ' has-active' : ''}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
        {props.active > 0 && <span className="sl-refine-badge">{props.active}</span>}
      </button>

      {open && (
        <div className={popUp ? 'sl-refine-pop is-up' : 'sl-refine-pop'} role="dialog" aria-label="Refine Suppliers" style={popPos}>
          <div className="sl-refine-sheet">
            <div className="sl-refine-head">
              <span className="sl-refine-head-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </span>
              <span className="sl-refine-title">Refine Suppliers</span>
              {props.active > 0 && <span className="sl-refine-badge">{props.active}</span>}
              <span className="sl-refine-sp" />
              {/* Reset sits with the title, not the footer: it undoes what the
                  panel did, while Done only dismisses it. */}
              {props.active > 0 && (
                <button type="button" className="sl-refine-reset" onClick={props.onClear}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /></svg>
                  Reset
                </button>
              )}
              <button type="button" className="sl-refine-x" onClick={() => onOpenChange(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="sl-refine-body">
              <div className="sl-refine-group">
                <div className="sl-refine-k"><span>Category</span></div>
                <div className="sl-refine-grid sl-refine-grid--4">
                  {CAT_TILES.map(t => {
                    const n = facets ? facets.category[t.key as keyof SupplierFacets['category']] : null;
                    const on = props.catSel.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        /* is-empty, not disabled: a zero facet is still worth
                           showing — it answers "are there any?" — but it must
                           not read as an equal choice beside a live one. */
                        className={`sl-refine-tile sl-refine-tile--${t.icon}${on ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`}
                        onClick={() => props.onToggleCat(t.key)}
                        aria-pressed={on}
                      >
                        <span className="sl-refine-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
                        <span className="sl-refine-tile-ico"><CatIconSvg kind={t.icon} /></span>
                        <span className="sl-refine-tile-lbl">{t.label}</span>
                        <span className="sl-refine-tile-n">{n ?? '–'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sl-refine-group">
                <div className="sl-refine-k"><span>Compliance</span></div>
                <div className="sl-refine-grid sl-refine-grid--2">
                  {COMP_TILES.map(t => {
                    const n = facets ? facets.compliance[t.key as keyof SupplierFacets['compliance']] : null;
                    const on = props.compSel.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className={`sl-refine-tile sl-refine-tile--${t.tone}${on ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`}
                        onClick={() => props.onToggleComp(t.key)}
                        aria-pressed={on}
                      >
                        <span className="sl-refine-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
                        <span className="sl-refine-tile-ico">{t.glyph}</span>
                        <span className="sl-refine-tile-lbl">{t.label}</span>
                        <span className="sl-refine-tile-n">{n ?? '–'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* The two compliance counts need not add up to the total: the
                  master holds ten states, and a supplier still Under Review or
                  Pending is settled neither way, so it is in neither bucket. */}
            </div>

            <div className="sl-refine-foot">
              <div className="sl-refine-res"><b>{props.shown}</b><i>/{grand}</i></div>
              <div className="sl-refine-meter"><span style={{ width: `${pct}%` }} /></div>
              <button type="button" className="sl-refine-done" onClick={() => onOpenChange(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
  const toggleIn = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  /* Scope tabs on the "What We Are Doing Here" strip. Same split the Add
     Supplier gate asks about, applied to the list: a supplier is domestic
     when its country is India and international otherwise — the same rule the
     form derives GST and State Code from.
     Two tabs, no "All": the list is always looking at one side or the other,
     and Domestic is the landing state because it is the larger book. */
  const [scopeTab, setScopeTab] = useState<'domestic' | 'international'>('domestic');
  /* Read once here rather than comparing the string at each of the three places
     the GST State Code column is built (header, cell, empty-row span) — those
     three have to agree or the table's columns stop lining up. */
  const isIntlScope = scopeTab === 'international';
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

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      if (bootedRef.current) setRefetching(true);
      else                   setLoading(true);
    }
    const token = ++reqRef.current;
    try {
      const res = await api.get<{ data: ApiVendor[]; total?: number }>('/vendors', {
        params: {
          page,
          per_page: rpp,
          ...(debouncedSearch ? { q: debouncedSearch } : {}),
          ...(catParam  ? { categories: catParam }  : {}),
          ...(compParam ? { compliance: compParam } : {}),
          scope: scopeTab,
          tab,
        },
      });
      if (token !== reqRef.current) return;
      const body: any = res.data ?? {};
      const rows: ApiVendor[] = Array.isArray(body) ? body : (body.data ?? []);
      setVendors(rows.map(apiToVendor));
      setTotal(Number(body.total ?? rows.length) || 0);
      setFacets(body.facets ?? null);
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
    }
  }, [page, rpp, debouncedSearch, scopeTab, tab, catParam, compParam]);
 const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, scopeTab, catParam, compParam]);

  useEffect(() => {
    if (bootedRef.current) setSwapping(true);
  }, [scopeTab, catParam, compParam, debouncedSearch, page, tab, rpp]);

  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;

      if (window.innerWidth <= 820) { el.style.minHeight = ''; return; }

      const top = el.getBoundingClientRect().top;
      const THEAD = 42, ROW = 54, PAGER = 56;
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

      const h = `${cardH}px`;
      if (el.style.minHeight !== h) el.style.minHeight = h;
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const recomputeDebounced = () => { if (settleTimer) clearTimeout(settleTimer); settleTimer = setTimeout(recompute, 140); };
    window.addEventListener('resize', recomputeDebounced);
    return () => { if (settleTimer) clearTimeout(settleTimer); window.removeEventListener('resize', recomputeDebounced); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, loading, brefOpen, rpp]);
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
  const pageRows = vendors;

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
         <div className="sup-fig" ref={rootRef}>
          {loading ? <ShimmerClmMaster cols={7} rows={8} twoTab /> : (<>

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
            <div className="sl-toolbar">
              <div className="sup-scope sl-scope">
                <button
                  type="button"
                  className={`sup-scope__tab ${scopeTab === 'domestic' ? 'is-active' : ''}`}
                  onClick={() => setScopeTab('domestic')}
                >
                  <i className="ri-home-4-line" />Domestic<span className="sup-scope__word"> Supplier</span>
                </button>
                <button
                  type="button"
                  className={`sup-scope__tab ${scopeTab === 'international' ? 'is-active' : ''}`}
                  onClick={() => setScopeTab('international')}
                >
                  <i className="ri-global-line" />International<span className="sup-scope__word"> Supplier</span>
                </button>
              </div>
              <div className="sl-search">
                <svg className="sl-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  type="text"
                  name="supplier-list-search"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-form-type="other"
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

              <RefineSuppliers
                open={filterOpen}
                onOpenChange={setFilterOpen}
                facets={facets}
                shown={total}
                active={activeFilters}
                catSel={catSel}
                compSel={compSel}
                onToggleCat={k => toggleIn(catSel, setCatSel, k)}
                onToggleComp={k => toggleIn(compSel, setCompSel, k)}
                onClear={() => { setCatSel([]); setCompSel([]); }}
              />
            </div>
            {loading || swapping ? (
              <div className="p-3"><ShimmerTable rows={Math.min(rpp, 12)} cols={isIntlScope ? 14 : 15} /></div>
            ) : (
              <>             
                <div className={`sl-table-scroll${refetching ? ' is-refetching' : ''}`} ref={scrollRef}>
                  <table className="sl-table">
                    <thead>
                      <tr>
                        <th className="sl-th-2line sl-col-c"><span>Sr</span><span>No</span></th>
                        <th className="sl-th-2line sl-col-c"><span>Supplier</span><span>Code</span></th>
                        <th>Supplier Name</th>
                        <th className="sl-col-c">Supplier Type</th>
                        <th className="sl-th-left">Segment</th>
                        <th className="sl-col-c">Country</th>
                        <th className="sl-col-c">State</th>
                        {!isIntlScope && (
                          <th className="sl-th-2line sl-col-c"><span>GST State</span><span>Code</span></th>
                        )}
                        <th className="sl-th-left">Contact Person</th>
                        <th className="sl-col-c">Contact No</th>
                        <th className="sl-th-email">Email</th>
                        <th>Supplier Category</th>
                        <th>Compliant Status</th>
                        <th className="sl-th-2line sl-col-c"><span>Mapped</span><span>Products</span></th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={isIntlScope ? 14 : 15} className="sl-empty">No suppliers found.</td></tr>
                      ) : pageRows.map((v, i) => {
                        const kind = typeKind(v.type);
                        const flag = supplierCategory(v.category);
                        const compliance = complianceTone(v.compliance);
                        return (
                          <tr key={v.id}>
                            <td className="sl-col-c"><span className="sl-sr">{start + i + 1}</span></td>
                            <td className="sl-col-c"><span className="sl-code">{v.code}</span></td>
                            <td><Tooltip label={v.companyName}><span className="sl-name sl-trunc">{v.companyName}</span></Tooltip></td>
                            <td className="sl-col-c"><span className={`sl-pill sl-pill--${kind}`}><span className="sl-pill-dot" />{v.type}</span></td>
                            <td>
                              <span className="sl-seg-wrap">
                                {v.segmentItems && v.segmentItems.length > 0 ? (
                                  <>
                                    <Tooltip label={v.segments?.[0] ?? v.segmentItems[0].name}>
                                      <span className="sl-seg sl-trunc sl-seg--withbadge">
                                        <span className="sl-seg-name">{v.segmentItems[0].name}</span>
                                        <SegmentBadge status={v.segmentItems[0].reg} style={{ flexShrink: 0 }} />
                                      </span>
                                    </Tooltip>
                                    {v.segmentItems.length > 1 && (
                                      <Tooltip label={`View all ${v.segmentItems.length} segments`}>
                                      <button
                                        type="button"
                                        className="sl-seg-more"
                                        onClick={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setSegPop({ segments: v.segmentItems ?? [], x: r.left, y: r.bottom + 6, top: r.top });
                                        }}
                                      >
                                        +{v.segmentItems.length - 1}
                                      </button>
                                      </Tooltip>
                                    )}
                                  </>
                                ) : <span className="sl-seg">—</span>}
                              </span>
                            </td>
                            <td className="sl-col-c"><span className="sl-country">{v.country || '—'}</span></td>
                            <td className="sl-col-c"><span className="sl-state">{v.state}</span></td>
                            {!isIntlScope && (
                              <td className="sl-col-c">{v.stateCode ? <span className="sl-gstcode">{v.stateCode}</span> : <span className="sl-state">—</span>}</td>
                            )}
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
                            <td className="sl-col-cat">
                              {flag
                                ? (
                                  <span className={`sl-cat ${flag.cls}`}>
                                    <CatIconSvg kind={flag.icon} />
                                    {flag.label}
                                  </span>
                                )
                                : <Tooltip label="No category set on this supplier yet"><span className="sl-state">—</span></Tooltip>}
                            </td>
                            <td className="sl-col-c">
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
                  <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[10, 25, 50]} />
                </div>
              </>
            )}
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
        <div className="sup-fig">
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
