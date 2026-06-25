import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import AddVendorModal from './AddVendorModal';
import SupplierEvidenceVaultModal, { type SupplierVaultTarget } from './SupplierEvidenceVaultModal';
import { ShimmerTable, ShimmerClmMaster } from '../../components/ui/Shimmer';
import Tooltip from '../../components/ui/Tooltip';
import WorklistPager from '../../components/ui/WorklistPager';
import {
  readVendorMasterBundle,
  writeVendorMasterBundle,
} from './vendorBundleCache';

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
      {/* ── Figma "Supplier Management" purple theme — scoped under .sup-fig ──
         Ported verbatim from the P2P_Sourcing prototype: header strip
         (cstrip), the collapsible 4-step "What We Are Doing Here" box
         (bref), and (next step) the purple supplier table (sl-*). */}
      <style>{`
        .sup-fig{font-family: var(--font-sans);display:flex;flex-direction:column;gap:6px;margin:-6px 0 0;}
        @media(max-width:640px){.sup-fig{margin:-2px 0 0;}}

        /* HEADER STRIP */
        .sup-fig .cstrip{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;min-height:58px;padding:0 20px;border:1px solid #c4b5fd;border-radius:16px;background:linear-gradient(110deg,#faf5ff 0%,#f3e8ff 25%,#ede9fe 55%,#ddd6fe 85%,#c4b5fd 100%);box-shadow:0 2px 0 rgba(255,255,255,.85) inset,0 8px 28px rgba(139,92,246,.2),0 2px 8px rgba(0,0,0,.06);}
        .sup-fig .cstrip__accent{position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#a78bfa,#7c3aed,#5b21b6);border-radius:16px 0 0 16px;}
        .sup-fig .cstrip__glow{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(196,181,253,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(167,139,250,.25) 0%,transparent 55%);}
        .sup-fig .cstrip__sheen{position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);border-radius:16px 16px 0 0;}
        .sup-fig .cstrip__left{display:flex;align-items:center;gap:13px;z-index:1;padding-left:10px;}
        .sup-fig .cstrip__avatar-wrap{position:relative;flex-shrink:0;}
        .sup-fig .cstrip__avatar{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 55%,#5b21b6 100%);box-shadow:0 0 0 3px rgba(139,92,246,.25),0 4px 14px rgba(124,58,237,.45);}
        .sup-fig .cstrip__online-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#4ade80,#22c55e);border:2px solid #f3e8ff;box-shadow:0 2px 4px rgba(34,197,94,.4);}
        .sup-fig .cstrip__title{font-size:14.5px;font-weight:700;color:#3b0764;letter-spacing:-.3px;line-height:1.2;}
        .sup-fig .cstrip__sub{font-size:10px;font-weight:500;color:#6d28d9;opacity:.85;margin-top:2px;line-height:1.3;}
        .sup-fig .cstrip__right{display:flex;align-items:center;gap:7px;z-index:1;}
        .sup-fig .cstrip__action-btn{position:relative;overflow:hidden;display:flex;align-items:center;gap:7px;padding:9px 18px;border:none;border-radius:12px;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;letter-spacing:.02em;white-space:nowrap;cursor:pointer;flex-shrink:0;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 50%,#5b21b6 100%);box-shadow:0 4px 16px rgba(124,58,237,.5),0 1px 3px rgba(91,33,182,.3),0 1px 0 rgba(255,255,255,.2) inset;text-shadow:0 1px 2px rgba(0,0,0,.2);transition:background .2s,transform .2s,box-shadow .2s;}
        .sup-fig .cstrip__action-btn:hover{background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 50%,#4c1d95 100%);transform:translateY(-1.5px);box-shadow:0 8px 24px rgba(124,58,237,.6),0 2px 6px rgba(91,33,182,.35),0 1px 0 rgba(255,255,255,.2) inset;}
        .sup-fig .cstrip__action-btn-sheen{position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.18),transparent);border-radius:12px 12px 0 0;}

        /* WHAT WE ARE DOING HERE — collapsible stepper */
        .sup-fig .bref-box{background:#fff;border:1px solid #c4b5fd;border-radius:16px;overflow:hidden;position:relative;box-shadow:0 2px 0 rgba(255,255,255,.9) inset,0 8px 28px rgba(139,92,246,.2),0 2px 8px rgba(0,0,0,.06);}
        .sup-fig .bref-box::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#a78bfa,#7c3aed,#5b21b6);border-radius:16px 0 0 16px;z-index:10;}
        .sup-fig .bref-box__header{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;padding:7px 12px;background:linear-gradient(110deg,#faf5ff 0%,#f3e8ff 25%,#ede9fe 55%,#ddd6fe 85%,#c4b5fd 100%);border-bottom:1px solid #c4b5fd;cursor:pointer;user-select:none;min-height:48px;}
        .sup-fig .bref-box.is-collapsed .bref-box__header{border-bottom-color:transparent;}
        .sup-fig .bref-box__header::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(196,181,253,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(167,139,250,.25) 0%,transparent 55%);}
        .sup-fig .bref-box__header::after{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
        .sup-fig .bref-box__header-ico{width:36px;height:36px;border-radius:11px;flex-shrink:0;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 55%,#5b21b6 100%);display:flex;align-items:center;justify-content:center;color:#fff;position:relative;z-index:1;box-shadow:0 0 0 3px rgba(139,92,246,.25),0 4px 14px rgba(124,58,237,.45);}
        .sup-fig .bref-box__header-mid{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;position:relative;z-index:1;}
        .sup-fig .bref-box__header-row{display:flex;align-items:center;gap:9px;}
        .sup-fig .bref-box__header-label{font-size:9.5px;font-weight:600;letter-spacing:-.2px;color:#7c3aed;line-height:1;white-space:nowrap;flex-shrink:0;}
        .sup-fig .bref-box__header-sep{width:1px;height:13px;background:#C4B5FD;flex-shrink:0;}
        .sup-fig .bref-box__header-title{font-size:11px;font-weight:600;color:#3b0764;letter-spacing:-.2px;line-height:1;white-space:nowrap;}
        .sup-fig .bref-box__header-sub{font-size:9.5px;font-weight:500;color:#6d28d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .sup-fig .bref-box__header-right{flex-shrink:0;display:flex;align-items:center;gap:6px;position:relative;z-index:1;}
        .sup-fig .bref-box__toggle{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);border:1.5px solid rgba(124,58,237,.22);color:#7c3aed;transition:transform .24s cubic-bezier(.22,1,.36,1);box-shadow:0 1px 4px rgba(124,58,237,.10),inset 0 1px 0 rgba(255,255,255,.9);}
        .sup-fig .bref-box.is-collapsed .bref-box__toggle{transform:rotate(-90deg);}
        .sup-fig .bref-box__body{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));background:linear-gradient(180deg,#F7F4FF 0%,#F8FAFC 100%);gap:0;overflow:hidden;max-height:320px;transition:max-height .3s cubic-bezier(.22,1,.36,1),opacity .22s;opacity:1;}
        .sup-fig .bref-box.is-collapsed .bref-box__body{max-height:0;opacity:0;}
        .sup-fig .bref-item{position:relative;padding:10px 11px 11px;background:#fff;margin:7px 5px;border-radius:11px;border:1.5px solid #ECE7F8;transition:box-shadow .18s,border-color .18s,transform .18s;cursor:default;display:flex;flex-direction:column;gap:0;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.04);}
        .sup-fig .bref-item:first-child{margin-left:7px;}
        .sup-fig .bref-item:last-child{margin-right:7px;}
        .sup-fig .bref-item:hover{border-color:#C4B5FD;box-shadow:0 6px 18px rgba(124,58,237,.14),0 1px 4px rgba(15,23,42,.04);transform:translateY(-2px);}
        .sup-fig .bref-item::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:11px 11px 0 0;background:linear-gradient(90deg,#8b5cf6,#7c3aed);}
        .sup-fig .bref-item__top{display:flex;align-items:center;gap:6px;margin-bottom:0;}
        .sup-fig .bref-item__ico{width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#7c3aed;}
        .sup-fig .bref-item__num{font-size:8.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;line-height:1;}
        .sup-fig .bref-item__title{font-size:11px;font-weight:600;color:#1e293b;letter-spacing:-.2px;line-height:1.25;margin-bottom:3px;margin-top:5px;}
        .sup-fig .bref-item__desc{font-size:9.5px;font-weight:500;color:#94A3B8;line-height:1.4;}
        @media(max-width:1100px){.sup-fig .bref-box__body{grid-template-columns:repeat(4,1fr)}}
        @media(max-width:700px){.sup-fig .bref-box__body{grid-template-columns:repeat(2,1fr)}}

        /* TABLE WRAP — purple-bordered card holding toolbar + table + footer */
        .sup-fig .sl-wrap{display:flex;flex-direction:column;margin-top:4px;border:1px solid #c4b5fd;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 0 rgba(255,255,255,.85) inset,0 8px 28px rgba(139,92,246,.16),0 2px 8px rgba(0,0,0,.05);}

        /* TOOLBAR — purple tabs + search (Figma sl-toolbar) */
        .sup-fig .sl-toolbar{display:flex;align-items:center;gap:14px;padding:12px 14px;border-bottom:1px solid #e2d4fa;background:linear-gradient(110deg,#faf5ff 0%,#f3e8ff 35%,#ede9fe 70%,#ddd6fe 100%);}
        .sup-fig .sl-tabs{display:flex;gap:8px;flex-shrink:0;background:rgba(255,255,255,.55);border:1px solid rgba(139,92,246,.22);border-radius:11px;padding:4px;}
        .sup-fig .sl-tab{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:700;color:#6d28d9;background:linear-gradient(135deg,#f5f1fe,#ede9fe);border:1px solid rgba(139,92,246,.2);border-radius:8px;padding:8px 14px;cursor:pointer;white-space:nowrap;transition:background .16s,color .16s,box-shadow .16s,border-color .16s;}
        .sup-fig .sl-tab:hover{color:#5b21b6;background:linear-gradient(135deg,#ede9fe,#ddd6fe);border-color:rgba(139,92,246,.35);}
        .sup-fig .sl-tab.is-active{position:relative;overflow:hidden;color:#fff;background:linear-gradient(135deg,#a78bfa 0%,#8b5cf6 35%,#7c3aed 68%,#5b21b6 100%);border:none;box-shadow:0 5px 14px rgba(124,58,237,.5),0 1px 0 rgba(255,255,255,.4) inset,0 -2px 6px rgba(91,33,182,.3) inset;text-shadow:0 1px 2px rgba(76,29,149,.4);}
        .sup-fig .sl-tab.is-active::before{content:'';position:absolute;top:0;left:0;right:0;height:50%;background:linear-gradient(180deg,rgba(255,255,255,.26),transparent);pointer-events:none;}
        .sup-fig .sl-tab svg,.sup-fig .sl-tab span{position:relative;z-index:1;}
        .sup-fig .sl-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 7px;border-radius:99px;font-size:10px;font-weight:800;color:#7c3aed;background:#fff;border:1px solid #ddd0f7;}
        .sup-fig .sl-tab.is-active .sl-tab-count{color:#7c3aed;background:#fff;border-color:transparent;}
        .sup-fig .sl-search{flex:1;display:flex;align-items:center;gap:9px;min-width:0;background:rgba(255,255,255,.8);border:1.5px solid rgba(139,92,246,.28);border-radius:11px;padding:9px 12px 9px 14px;box-shadow:0 1px 0 rgba(255,255,255,.95) inset;transition:border-color .16s,box-shadow .16s;}
        .sup-fig .sl-search:focus-within{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.18);}
        .sup-fig .sl-search-ico{flex-shrink:0;}
        .sup-fig .sl-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:13px;font-weight:500;color:#3b0764;}
        .sup-fig .sl-search input::placeholder{color:#a78bfa;font-weight:500;}
        .sup-fig .sl-search-clear{flex-shrink:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:rgba(139,92,246,.12);color:#7c3aed;cursor:pointer;transition:background .14s,color .14s;}
        .sup-fig .sl-search-clear:hover{background:#7c3aed;color:#fff;}

        /* TABLE — purple gradient header + purple chrome (Figma sl-table) */
        /* Soft purple glow at the top + faint gradient so the table area
           never reads as flat white, even with only a couple of rows. */
        .sup-fig .sl-table-scroll{overflow-x:auto;background:radial-gradient(130% 360px at 50% -50px,rgba(167,139,250,.12),transparent 70%),linear-gradient(180deg,#ffffff 0%,#fdfbff 100%);}
        .sup-fig .sl-table{width:100%;border-collapse:collapse;font-size:11.5px;white-space:nowrap;}
        .sup-fig .sl-table thead tr{background:linear-gradient(110deg,#8b5cf6 0%,#7c3aed 45%,#6d28d9 75%,#5b21b6 100%);}
        .sup-fig .sl-table thead th{color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;text-align:left;padding:9px 13px;}
        .sup-fig .sl-table thead th:last-child{text-align:center;}
        .sup-fig .sl-table tbody td{padding:7px 13px;border-bottom:1px solid #F1ECFB;color:#334155;vertical-align:middle;}
        .sup-fig .sl-table tbody tr{transition:background .18s ease,box-shadow .18s ease;}
        /* Gentle zebra so rows are easier to scan. */
        .sup-fig .sl-table tbody tr:nth-child(even){background:rgba(139,92,246,.035);}
        /* Hover = soft purple sweep + a sliding left accent + lifted SR chip. */
        .sup-fig .sl-table tbody tr:hover{background:linear-gradient(90deg,rgba(124,58,237,.11),rgba(167,139,250,.05) 55%,transparent);box-shadow:inset 3px 0 0 #7c3aed,0 1px 0 rgba(124,58,237,.06);}
        .sup-fig .sl-table tbody tr:hover .sl-sr{transform:scale(1.08) rotate(-3deg);box-shadow:0 5px 12px rgba(124,58,237,.5);}
        .sup-fig .sl-table tbody tr:hover .sl-code{border-color:#c4b5fd;background:#efe7fe;}
        .sup-fig .sl-table tbody tr:hover .sl-name{color:#5b21b6;}
        .sup-fig .sl-sr{transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s ease;}
        .sup-fig .sl-code{transition:background .18s ease,border-color .18s ease;}
        .sup-fig .sl-name{transition:color .18s ease;}
        .sup-fig .sl-table tbody tr:last-child td{border-bottom:none;}
        .sup-fig .sl-sr{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;font-size:10.5px;font-weight:800;color:#fff;background:linear-gradient(135deg,#8b5cf6,#7c3aed);box-shadow:0 2px 5px rgba(124,58,237,.3);}
        .sup-fig .sl-code{display:inline-flex;align-items:center;font-family:inherit;font-feature-settings:"tnum";font-size:10.5px;font-weight:700;letter-spacing:.01em;color:#5b21b6;background:#F5F1FE;border:1px solid #E2D4FA;border-radius:6px;padding:2px 8px;}
        .sup-fig .sl-name{font-weight:700;font-size:12px;color:#1E293B;letter-spacing:-.1px;}
        /* Truncate long values so they never stretch the column / break the row.
           Explicit per-field caps because table cells auto-size to content. */
        .sup-fig .sl-trunc{display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;}
        .sup-fig .sl-name.sl-trunc{max-width:200px;}
        .sup-fig .sl-contact.sl-trunc{max-width:140px;}
        .sup-fig .sl-email.sl-trunc{max-width:210px;}
        .sup-fig .sl-state,.sup-fig .sl-country,.sup-fig .sl-contact{font-weight:600;color:#475569;}
        .sup-fig .sl-contact-wrap{display:inline-flex;align-items:center;gap:6px;}
        .sup-fig .sl-contact-more{font-family:inherit;font-size:10px;font-weight:800;color:#7c3aed;background:#f1eafe;border:1px solid #ddd0f7;border-radius:999px;padding:2px 7px;cursor:pointer;line-height:1;transition:all .15s;}
        .sup-fig .sl-contact-more:hover{background:#e6d9fb;transform:translateY(-1px);}

        /* Contact Persons popup */
        .sc-ov{position:fixed;inset:0;z-index:1200;background:rgba(49,22,99,.42);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;font-family: var(--font-sans);}
        .sc-pop{width:100%;max-width:480px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.45);border:1.5px solid rgba(255,255,255,.65);}
        .sc-head{display:flex;align-items:center;gap:12px;padding:16px 18px;background:linear-gradient(115deg,#4c1d95 0%,#5b21b6 28%,#6d28d9 55%,#7c3aed 80%,#8b5cf6 100%);color:#fff;}
        .sc-head-ico{width:38px;height:38px;border-radius:11px;flex-shrink:0;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;}
        .sc-title{font-size:15.5px;font-weight:700;}
        .sc-sub{font-size:11px;color:rgba(255,255,255,.85);margin-top:1px;}
        .sc-close{margin-left:auto;width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.12);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}
        .sc-close:hover{background:rgba(255,255,255,.22);}
        .sc-body{padding:8px 14px 14px;max-height:60vh;overflow-y:auto;}
        /* Contact Persons pager — 5 per page */
        .sc-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 16px;border-top:1px solid #f1ecfb;background:#FBF9FF;}
        .sc-pg-info{font-size:11.5px;font-weight:600;color:#6d28d9;}
        .sc-pg-info b{color:#5b21b6;}
        .sc-pg-ctrls{display:inline-flex;align-items:center;gap:7px;}
        .sc-pg-count{font-size:11.5px;font-weight:700;color:#fff;background:linear-gradient(135deg,#8b5cf6,#7c3aed,#5b21b6);border-radius:8px;padding:4px 11px;box-shadow:0 3px 9px rgba(124,58,237,.4);}
        .sc-pg-arrow{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #E2D4FA;border-radius:8px;background:#fff;color:#6d28d9;cursor:pointer;transition:background .14s,color .14s,border-color .14s;}
        .sc-pg-arrow:hover:not(:disabled){background:#7c3aed;color:#fff;border-color:transparent;}
        .sc-pg-arrow:disabled{opacity:.4;cursor:not-allowed;}
        .sc-row{display:flex;align-items:flex-start;gap:12px;padding:12px 6px;border-bottom:1px solid #f1ecfb;}
        .sc-row:last-child{border-bottom:none;}
        .sc-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);}
        .sc-name{font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:8px;}
        .sc-role{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:99px;}
        .sc-role.is-primary{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;}
        .sc-role.is-other{background:#f1eafe;color:#7c3aed;border:1px solid #ddd0f7;}
        .sc-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:5px;}
        .sc-meta span{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#64748b;}
        .sc-meta i{color:#a78bfa;}
        .sup-fig .sl-phone{font-family:inherit;font-feature-settings:"tnum";font-size:11.5px;font-weight:500;color:#64748B;}
        .sup-fig .sl-email{font-weight:600;color:#7c3aed;text-decoration:none;}
        .sup-fig .sl-email:hover{text-decoration:underline;}
        .sup-fig .sl-pill{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid;}
        .sup-fig .sl-pill-dot{width:4px;height:4px;border-radius:50%;background:currentColor;}
        .sup-fig .sl-pill--material{color:#7c3aed;background:#F5F1FE;border-color:#DDD6FE;}
        .sup-fig .sl-pill--logistics{color:#0891b2;background:#ECFEFF;border-color:#A5F3FC;}
        .sup-fig .sl-pill--services{color:#D97706;background:#FFFBEB;border-color:#FDE68A;}
        .sup-fig .sl-wa{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid;}
        .sup-fig .sl-wa-dot{width:4px;height:4px;border-radius:50%;background:currentColor;}
        .sup-fig .sl-wa--yes{color:#16a34a;background:#F0FDF4;border-color:#BBF7D0;}
        .sup-fig .sl-wa--no{color:#dc2626;background:#FEF2F2;border-color:#FECACA;}
        .sup-fig .sl-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding-right:18px;}
        .sup-fig .sl-act-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid;cursor:pointer;transition:transform .14s,box-shadow .14s,background .14s;}
        .sup-fig .sl-act-btn svg{width:13px;height:13px;}
        .sup-fig .sl-act-btn:hover{transform:translateY(-1px);}
        .sup-fig .sl-act-btn--edit{color:#7c3aed;background:linear-gradient(135deg,#faf8ff,#f1ebfe);border-color:#DDD6FE;box-shadow:0 1px 3px rgba(124,58,237,.12),0 1px 0 rgba(255,255,255,.7) inset;}
        .sup-fig .sl-act-btn--edit:hover{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border-color:transparent;box-shadow:0 5px 13px rgba(124,58,237,.45),0 1px 0 rgba(255,255,255,.3) inset;}
        .sup-fig .sl-evault-btn{position:relative;overflow:hidden;width:auto;height:34px;gap:8px;padding:0 17px;font-family:inherit;font-size:12px;font-weight:700;letter-spacing:.012em;color:#fff;border:none;border-radius:9px;background:linear-gradient(135deg,#a78bfa 0%,#8b5cf6 38%,#7c3aed 70%,#6d28d9 100%);box-shadow:0 4px 12px rgba(124,58,237,.4),0 1px 0 rgba(255,255,255,.4) inset,0 -2px 6px rgba(91,33,182,.3) inset;text-shadow:0 1px 2px rgba(76,29,149,.4);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
        .sup-fig .sl-evault-btn::before{content:'';position:absolute;top:0;left:0;right:0;height:50%;background:linear-gradient(180deg,rgba(255,255,255,.28),transparent);pointer-events:none;}
        .sup-fig .sl-evault-btn svg{width:14px;height:14px;position:relative;z-index:1;}
        .sup-fig .sl-evault-btn span{position:relative;z-index:1;}
        .sup-fig .sl-evault-btn:hover{background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 45%,#6d28d9 100%);box-shadow:0 7px 18px rgba(124,58,237,.52),0 1px 0 rgba(255,255,255,.45) inset,0 -2px 6px rgba(76,29,149,.35) inset;transform:translateY(-1px);}
        /* Book Entry — teal icon button (name shown via tooltip), same size as the edit icon button. */
        .sup-fig .sl-act-btn--book{color:#0d9488;background:linear-gradient(135deg,#f0fdfa,#ccfbf1);border-color:#99f6e4;box-shadow:0 1px 3px rgba(13,148,136,.12),0 1px 0 rgba(255,255,255,.7) inset;}
        .sup-fig .sl-act-btn--book:hover{background:linear-gradient(135deg,#2dd4bf,#0d9488);color:#fff;border-color:transparent;box-shadow:0 5px 13px rgba(13,148,136,.45),0 1px 0 rgba(255,255,255,.3) inset;}
        .sup-fig .sl-empty{text-align:center;color:#94A3B8;font-weight:600;padding:24px 16px;}
        .sup-fig .sl-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-top:1px solid #F1ECFB;background:#FBF9FF;}
        .sup-fig .sl-count{font-size:11.5px;font-weight:700;color:#6d28d9;background:#F5F1FE;border:1px solid #E2D4FA;border-radius:8px;padding:5px 12px;}
        .sup-fig .sl-pager{display:flex;align-items:center;gap:5px;}
        .sup-fig .sl-page-num,.sup-fig .sl-page-arrow{min-width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0 8px;font-family:inherit;font-size:11.5px;font-weight:700;color:#6d28d9;background:#fff;border:1px solid #E2D4FA;border-radius:8px;cursor:pointer;transition:background .14s,color .14s,border-color .14s,box-shadow .14s;}
        .sup-fig .sl-page-num:hover,.sup-fig .sl-page-arrow:hover:not(:disabled){background:#F5F1FE;border-color:#C4B5FD;}
        .sup-fig .sl-page-num.is-active{color:#fff;background:linear-gradient(135deg,#8b5cf6,#7c3aed,#5b21b6);border-color:transparent;box-shadow:0 3px 9px rgba(124,58,237,.4);}
        .sup-fig .sl-page-arrow:disabled{opacity:.4;cursor:not-allowed;}
        .sup-fig .sl-page-dots{min-width:22px;height:28px;display:inline-flex;align-items:flex-end;justify-content:center;padding-bottom:4px;color:#a78bfa;font-weight:800;font-size:13px;}

        .vendors-surface { background: #fff; }
        [data-bs-theme="dark"] .vendors-surface { background: #1c2531; }

        /* Match the Clients master table — plain Velzon table-light thead
           with 13px cells. No coloured gradient on the header. The explicit
           background is here because some parent rules in this page neutralise
           Bootstrap's --bs-table-bg variable on the thead. */
        .vendors-surface .table thead th,
        .vendors-surface .table tbody td {
          font-size: 13px;
          vertical-align: middle;
        }
        .vendors-surface .table > thead.table-light > tr > th,
        .vendors-surface .table thead.table-light th {
          background-color: var(--vz-light, #eff2f7) !important;
          color: var(--vz-heading-color, #495057);
          font-weight: 600;
          letter-spacing: 0.01em;
          white-space: nowrap;
          border-bottom: 1px solid var(--vz-border-color, #e9ebec);
        }
        [data-bs-theme="dark"] .vendors-surface .table > thead.table-light > tr > th,
        [data-bs-theme="dark"] .vendors-surface .table thead.table-light th {
          background-color: rgba(255,255,255,0.04) !important;
          color: #ced4da;
        }

        /* Status tab pill strip — same look as the Products page */
        .v-status-tabs {
          display: inline-flex; gap: 4px; padding: 4px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
        }
        .v-status-tab {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 16px;
          background: transparent; border: none;
          border-radius: 9px;
          font-family: inherit; font-size: 12.5px; font-weight: 800;
          color: #6b7280; cursor: pointer;
          transition: background .15s, color .15s;
        }
        .v-status-tab:hover { background: #eef2ff; color: #405189; }
        .v-status-tab.on {
          background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
          color: #fff;
          box-shadow: 0 4px 12px rgba(64,81,137,.35);
        }
        .v-status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .v-status-dot.is-active   { background: #22c55e; }
        .v-status-dot.is-inactive { background: #f59e0b; }
        .v-status-tab.on .v-status-dot { background: #fff; }
        .v-status-count {
          min-width: 22px; height: 20px; padding: 0 8px; border-radius: 99px;
          background: #e2e8f0; color: #475569;
          font-size: 10.5px; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .v-status-tab.on .v-status-count { background: rgba(255,255,255,.25); color: #fff; }
        [data-bs-theme="dark"] .v-status-tabs { background: #1c2531; border-color: rgba(255,255,255,0.1); }
        [data-bs-theme="dark"] .v-status-tab { color: #adb5bd; }
        [data-bs-theme="dark"] .v-status-tab:hover { background: rgba(64,81,137,.22); color: #ede9fe; }
        [data-bs-theme="dark"] .v-status-count { background: rgba(255,255,255,0.08); color: #ced4da; }

        /* Type chip — coloured by vendor classification */
        .v-type-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 10px; border-radius: 99px;
          font-size: 11px; font-weight: 700;
        }
        .v-type-chip .ri-checkbox-circle-fill { font-size: 13px; }

        /* Action button row in the last column */
        .v-actions { display: inline-flex; gap: 4px; }
        .v-actions .btn { padding: .25rem .5rem; line-height: 1; }

        /* Add Supplier — primary CTA. Hover lift + brighter gradient +
         * shadow glow so the button actively responds to the cursor
         * instead of feeling like a static decal. Dark mode keeps the
         * same elevation curve with a deeper shadow that reads against
         * the near-black surface. */
        .v-add-btn {
          background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
          border: none;
          color: #fff;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(64,81,137,.28);
          transition: transform .15s ease, box-shadow .2s ease, filter .15s ease;
        }
        .v-add-btn:hover, .v-add-btn:focus-visible {
          transform: translateY(-1px);
          filter: brightness(1.08);
          box-shadow: 0 8px 20px rgba(102,145,231,.45);
          background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
          color: #fff;
        }
        .v-add-btn:active {
          transform: translateY(0);
          box-shadow: 0 3px 10px rgba(64,81,137,.32);
        }
        [data-bs-theme="dark"] .v-add-btn {
          box-shadow: 0 4px 14px rgba(102,145,231,.32);
        }
        [data-bs-theme="dark"] .v-add-btn:hover,
        [data-bs-theme="dark"] .v-add-btn:focus-visible {
          box-shadow: 0 10px 26px rgba(102,145,231,.55);
          filter: brightness(1.12);
        }

        /* Search bar — Velzon's default .search-box leaves the input
         * borderless until focus, which looked flat in default state
         * and then suddenly snapped into a heavy outline on focus.
         * Scope a consistent visible border at rest, a soft hover
         * lift, and a smooth focus ring transition. */
        .vendors-surface .search-box .form-control {
          border: 1.5px solid #e2e8f0;
          background: #f8fafc;
          transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
        }
        .vendors-surface .search-box .form-control:hover {
          background: #fff;
          border-color: #cbd5e1;
        }
        .vendors-surface .search-box .form-control:focus {
          background: #fff;
          border-color: #6691e7;
          box-shadow: 0 0 0 3px rgba(102,145,231,.18);
          outline: none;
        }
        .vendors-surface .search-box .search-icon {
          transition: color .18s ease;
        }
        .vendors-surface .search-box .form-control:focus + .search-icon,
        .vendors-surface .search-box:hover .search-icon {
          color: #405189;
        }
        [data-bs-theme="dark"] .vendors-surface .search-box .form-control {
          background: #1a1430;
          border-color: rgba(255,255,255,.10);
          color: #ede9fe;
        }
        [data-bs-theme="dark"] .vendors-surface .search-box .form-control:hover {
          background: #221940;
          border-color: rgba(167,139,250,.30);
        }
        [data-bs-theme="dark"] .vendors-surface .search-box .form-control:focus {
          background: #221940;
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124,58,237,.25);
        }

        /* Responsive — stack the toolbar (tabs + search) on narrow screens;
           the table itself already scrolls horizontally via .sl-table-scroll. */
        @media (max-width: 640px) {
          .sup-fig .sl-toolbar { flex-direction: column; align-items: stretch; }
          .sup-fig .sl-tabs { justify-content: center; }
          .sup-fig .cstrip { flex-direction: column; align-items: flex-start; gap: 10px; }
        }

        /* ───── Dark mode for the purple Figma supplier list ─────
           Translucent purple accents on a deep surface (matches the app's
           dark-mode recipe). Light-mode values above are untouched. */
        /* Flat solid panels in dark — no gradient sweeps; clean + clear. */
        [data-bs-theme="dark"] .sup-fig .cstrip{background:#34216b;border-color:rgba(167,139,250,.28);box-shadow:0 8px 28px rgba(0,0,0,.4);}
        [data-bs-theme="dark"] .sup-fig .cstrip__glow,
        [data-bs-theme="dark"] .sup-fig .cstrip__sheen{display:none;}
        [data-bs-theme="dark"] .sup-fig .cstrip__title{color:#f3e8ff;}
        [data-bs-theme="dark"] .sup-fig .cstrip__sub{color:#c4b5fd;}

        [data-bs-theme="dark"] .sup-fig .bref-box{background:#1c1633;border-color:rgba(167,139,250,.22);box-shadow:0 8px 28px rgba(0,0,0,.35);}
        [data-bs-theme="dark"] .sup-fig .bref-box__header{background:#241a47;border-bottom-color:rgba(167,139,250,.2);}
        [data-bs-theme="dark"] .sup-fig .bref-box__header::before,
        [data-bs-theme="dark"] .sup-fig .bref-box__header::after{display:none;}
        [data-bs-theme="dark"] .sup-fig .bref-box__header-title{color:#f3e8ff;}
        [data-bs-theme="dark"] .sup-fig .bref-box__header-sub,
        [data-bs-theme="dark"] .sup-fig .bref-box__header-label{color:#c4b5fd;}
        [data-bs-theme="dark"] .sup-fig .bref-box__body{background:#171029;}
        [data-bs-theme="dark"] .sup-fig .bref-item{background:#221a40;border-color:rgba(167,139,250,.16);box-shadow:none;}
        [data-bs-theme="dark"] .sup-fig .bref-item__title{color:#ede9fe;}
        [data-bs-theme="dark"] .sup-fig .bref-item__desc,
        [data-bs-theme="dark"] .sup-fig .bref-item__num{color:#a89fc7;}
        [data-bs-theme="dark"] .sup-fig .bref-box__toggle{background:rgba(255,255,255,.08);border-color:rgba(167,139,250,.25);color:#c4b5fd;}

        [data-bs-theme="dark"] .sup-fig .sl-wrap{background:#141a2b;border-color:rgba(167,139,250,.2);box-shadow:0 8px 28px rgba(0,0,0,.45);}
        [data-bs-theme="dark"] .sup-fig .sl-toolbar{background:#1f1838;border-bottom-color:rgba(167,139,250,.22);}
        [data-bs-theme="dark"] .sup-fig .sl-tabs{background:rgba(124,58,237,.14);border-color:rgba(167,139,250,.3);}
        [data-bs-theme="dark"] .sup-fig .sl-tab{color:#e2d6fb;background:rgba(255,255,255,.06);border-color:rgba(167,139,250,.24);}
        [data-bs-theme="dark"] .sup-fig .sl-tab:hover{color:#fff;background:rgba(124,58,237,.32);border-color:rgba(167,139,250,.5);}
        [data-bs-theme="dark"] .sup-fig .sl-tab svg{opacity:.95;}
        [data-bs-theme="dark"] .sup-fig .sl-search{background:rgba(255,255,255,.07);border-color:rgba(167,139,250,.32);}
        [data-bs-theme="dark"] .sup-fig .sl-search input{color:#f3effe;}
        [data-bs-theme="dark"] .sup-fig .sl-search input::placeholder{color:#a89ad8;}
        [data-bs-theme="dark"] .sup-fig .sl-search-clear{background:rgba(167,139,250,.22);color:#d6c9f5;}
        [data-bs-theme="dark"] .sup-fig .sl-tab-count{background:rgba(255,255,255,.14);color:#e2d6fb;border-color:transparent;}

        [data-bs-theme="dark"] .sup-fig .sl-table tbody td{color:#cbd5e1;border-bottom-color:rgba(167,139,250,.10);}
        /* Clean flat surface in dark — no glow/gradient; the premium feel comes
           from the crisp zebra + interactive hover, not a hazy background. */
        [data-bs-theme="dark"] .sup-fig .sl-table-scroll{background:#141a2b;}
        [data-bs-theme="dark"] .sup-fig .sl-table thead tr{background:#4c1d95;}
        [data-bs-theme="dark"] .sup-fig .sl-table tbody tr:nth-child(even){background:rgba(124,58,237,.055);}
        /* Clean flat hover — CLM gold-standard recipe. No gradient sweep, no
           accent bar, no chip bounce; just a calm translucent purple fill. */
        [data-bs-theme="dark"] .sup-fig .sl-table tbody tr:hover{background:rgba(124,58,237,.16);box-shadow:none;}
        [data-bs-theme="dark"] .sup-fig .sl-table tbody tr:hover .sl-sr{transform:none;box-shadow:0 2px 5px rgba(124,58,237,.35);}
        [data-bs-theme="dark"] .sup-fig .sl-table tbody tr:hover .sl-code{background:rgba(124,58,237,.24);border-color:rgba(167,139,250,.4);}
        [data-bs-theme="dark"] .sup-fig .sl-table tbody tr:hover .sl-name{color:#f3e8ff;}
        [data-bs-theme="dark"] .sup-fig .sl-name{color:#f3e8ff;}
        [data-bs-theme="dark"] .sup-fig .sl-state,
        [data-bs-theme="dark"] .sup-fig .sl-country,
        [data-bs-theme="dark"] .sup-fig .sl-contact{color:#adb5bd;}
        [data-bs-theme="dark"] .sup-fig .sl-phone{color:#9a93b3;}
        [data-bs-theme="dark"] .sup-fig .sl-code{background:rgba(124,58,237,.18);color:#c4b5fd;border-color:rgba(167,139,250,.3);}
        [data-bs-theme="dark"] .sup-fig .sl-contact-more{background:rgba(124,58,237,.2);color:#c4b5fd;border-color:rgba(167,139,250,.3);}
        /* Type + WhatsApp pills — translucent dark-tinted variants so they read
           crisp on the dark surface instead of washing out in their light bg. */
        [data-bs-theme="dark"] .sup-fig .sl-pill--material{color:#c4b5fd;background:rgba(124,58,237,.20);border-color:rgba(167,139,250,.38);}
        [data-bs-theme="dark"] .sup-fig .sl-pill--logistics{color:#67e8f9;background:rgba(8,145,178,.20);border-color:rgba(34,211,238,.38);}
        [data-bs-theme="dark"] .sup-fig .sl-pill--services{color:#fcd34d;background:rgba(217,119,6,.22);border-color:rgba(251,191,36,.38);}
        [data-bs-theme="dark"] .sup-fig .sl-wa--yes{color:#86efac;background:rgba(22,163,74,.20);border-color:rgba(74,222,128,.38);}
        [data-bs-theme="dark"] .sup-fig .sl-wa--no{color:#fca5a5;background:rgba(220,38,38,.20);border-color:rgba(248,113,113,.38);}
        [data-bs-theme="dark"] .sup-fig .sl-email{color:#c4b5fd;}
        /* Edit action button — was a bright white square in dark; make it a
           translucent purple chip that fills on hover (like the Evidence btn). */
        [data-bs-theme="dark"] .sup-fig .sl-act-btn--edit{color:#c4b5fd;background:rgba(124,58,237,.18);border-color:rgba(167,139,250,.38);box-shadow:none;}
        [data-bs-theme="dark"] .sup-fig .sl-act-btn--edit:hover{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border-color:transparent;box-shadow:0 5px 13px rgba(124,58,237,.5);}
        [data-bs-theme="dark"] .sup-fig .sl-act-btn--book{color:#5eead4;background:rgba(13,148,136,.20);border-color:rgba(45,212,191,.4);box-shadow:none;}
        [data-bs-theme="dark"] .sup-fig .sl-act-btn--book:hover{background:linear-gradient(135deg,#2dd4bf,#0d9488);color:#fff;border-color:transparent;box-shadow:0 5px 13px rgba(13,148,136,.5);}
        [data-bs-theme="dark"] .sup-fig .sl-footer{background:rgba(255,255,255,.03);border-top-color:rgba(255,255,255,.07);}

        /* Contact Persons popup — dark surface */
        [data-bs-theme="dark"] .sup-fig .sc-pop{background:#1c2531;border-color:rgba(167,139,250,.25);}
        [data-bs-theme="dark"] .sup-fig .sc-row{border-bottom-color:rgba(255,255,255,.06);}
        [data-bs-theme="dark"] .sup-fig .sc-pager{background:rgba(255,255,255,.03);border-top-color:rgba(255,255,255,.07);}
        [data-bs-theme="dark"] .sup-fig .sc-pg-info{color:#c4b5fd;}
        [data-bs-theme="dark"] .sup-fig .sc-pg-info b{color:#ede9fe;}
        [data-bs-theme="dark"] .sup-fig .sc-pg-arrow{background:rgba(255,255,255,.05);border-color:rgba(167,139,250,.25);color:#c4b5fd;}
        [data-bs-theme="dark"] .sup-fig .sc-pg-arrow:hover:not(:disabled){background:#7c3aed;color:#fff;border-color:transparent;}
        [data-bs-theme="dark"] .sup-fig .sc-name{color:#f3e8ff;}
        [data-bs-theme="dark"] .sup-fig .sc-meta span{color:#adb5bd;}
      `}</style>

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
                        <tr><td colSpan={11} className="sl-empty">No suppliers found.</td></tr>
                      ) : pageRows.map((v, i) => {
                        const kind = typeKind(v.type);
                        const hasWa = !!v.phone && v.phone !== '—';
                        return (
                          <tr key={v.id}>
                            <td><span className="sl-sr">{start + i + 1}</span></td>
                            <td><span className="sl-code">{v.code}</span></td>
                            <td><Tooltip label={v.companyName}><span className="sl-name sl-trunc">{v.companyName}</span></Tooltip></td>
                            <td><span className={`sl-pill sl-pill--${kind}`}><span className="sl-pill-dot" />{v.type}</span></td>
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
