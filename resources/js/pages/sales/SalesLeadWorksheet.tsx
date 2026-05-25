import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddNewLeadModal, { type LeadFormValues } from './AddNewLeadModal';
import AssignLeadsModal from './AssignLeadsModal';
import LeadDetailsModal from './LeadDetailsModal';
import LeadFilterModal, { type LeadFilters } from './LeadFilterModal';

/* Shape returned by GET /sales/leads — Laravel paginator items. Mapped to
 * the table's Lead type below via mapServerToLead(). */
type ServerLead = {
  id:                number;
  opp_code:          string;
  unique_query_id?:  string | null;
  platform:          string;
  query_type:        string;
  query_time:        string | null;
  created_at:        string;
  sender_name:       string | null;
  sender_mobile:     string | null;
  sender_email:      string | null;
  sender_company:    string | null;
  sender_country_iso:string | null;
  query_product_name:string | null;
  qualified:         boolean;
  disqualified:      boolean;
  whatsapp_status:   string | null;
  /* Saved progress — drives the resume-at-stage behaviour. Null/0 means the
   * lead is fresh and lands on Stage 1; otherwise the worksheet opens the
   * matrix detail at this stage so users pick up where they left off. */
  lead_stage_id?:    number | null;
  salesperson?:      { id: number; name: string } | null;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Worksheet (My Workplace)
 *
 * Faithful port of the prototype's `#lwPage` (SalesMatrix_v4_9, line 9239) —
 * the cyan/teal "My Workplace" landing page that lists all leads with bulk
 * selection, per-row actions, and a CTQ ("Convert to Qualified") flow for
 * disqualified leads.
 *
 * Data: mock for now — 27 sample leads matching prototype `window.LW_LEADS`
 * (line 21402). Wire to `api.get('/sales/leads')` once the table migration
 * lands.
 *
 * Perm-gated on `sales.lead_worksheet` — super_admin bypasses. The permission
 * key needs to exist in the seeder for non-admin users to view this page.
 * ──────────────────────────────────────────────────────────────────────── */

type LeadStatus = 'qualified' | 'disqualified';
type TabKey     = 'qualified' | 'disqualified' | 'all';

type Lead = {
  id:   number;           // DB primary key — needed for /sales/leads/assign payloads
  type: string;
  date: string;
  source: string;
  assigned: string;       // 'Unassigned' or a person's name
  salespersonId: number | null;  // current owner — drives the assign-modal pre-select
  oppId: string;          // OPP-001
  customer: string;
  phone: string;
  email: string;
  product: string;        // '—' for empty
  company: string;        // '—' for empty
  country: string;        // ISO-2 code
  status: LeadStatus;
  /* Saved pipeline stage — clamped to 1..6 when the user clicks into the
   * matrix detail page so they resume where they left off. */
  leadStageId: number;
};

const TAB_LABELS: Record<TabKey, string> = {
  qualified:    'Qualified Leads',
  disqualified: 'Disqualified Leads',
  all:          'All Leads',
};

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

const initials = (name: string): string => {
  if (!name || name === 'Unassigned') return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
};

/* Build human-readable chips for whatever filter fields are active. Looks
 * each value up against the parent's cached options list so the chip shows
 * the label ('Inquiry Required') rather than the wire value ('1'). */
type FilterChip = { key: string; label: string; value: string };
const renderFilterChips = (
  f: LeadFilters,
  o: {
    stages: Array<{ value: string; label: string }>;
    platforms: Array<{ value: string; label: string }>;
    queryTypes: Array<{ value: string; label: string }>;
    countries: Array<{ value: string; label: string }>;
    customers: Array<{ value: string; label: string }>;
  },
  salespersonNames: Record<number, string> = {},
): FilterChip[] => {
  const lookup = (
    list: Array<{ value: string; label: string }>,
    v: string | undefined,
  ): string => list.find(o => o.value === v)?.label ?? v ?? '';
  const out: FilterChip[] = [];
  if (f.lead_stage_id)      out.push({ key: 'lead_stage_id',      label: 'Stage',    value: lookup(o.stages,     f.lead_stage_id) });
  if (f.platform)           out.push({ key: 'platform',           label: 'Platform', value: lookup(o.platforms,  f.platform) });
  if (f.query_type)         out.push({ key: 'query_type',         label: 'Type',     value: lookup(o.queryTypes, f.query_type) });
  if (f.sender_country_iso) out.push({ key: 'sender_country_iso', label: 'Country',  value: lookup(o.countries,  f.sender_country_iso) });
  if (f.customer_id)        out.push({ key: 'customer_id',        label: 'Customer', value: lookup(o.customers,  f.customer_id) });
  if (f.salesperson_id)     out.push({
    key:   'salesperson_id',
    label: 'Salesperson',
    // Resolve from the modal-supplied name cache; fall back to the raw
    // id so the chip is still removable if the cache was cleared (e.g.
    // page refresh restoring filters from a future URL-state plumb).
    value: salespersonNames[Number(f.salesperson_id)] ?? `#${f.salesperson_id}`,
  });
  if (f.start_date && f.end_date) out.push({ key: 'start_date', label: 'Date', value: `${f.start_date} → ${f.end_date}` });
  return out;
};

/* Convert a server lead row to the table's display shape. The columns
 * use placeholder dashes for absent values to match the existing styling
 * (the in-page '—' tests check string equality). */
const mapServerToLead = (r: ServerLead): Lead => {
  const dateSrc = r.query_time ?? r.created_at;
  const date = dateSrc
    ? new Date(dateSrc).toLocaleDateString('en-GB') // DD/MM/YYYY
    : '—';
  return {
    id:       r.id,
    type:     r.query_type || 'Manual',
    date,
    source:   r.platform || '—',
    assigned: r.salesperson?.name ?? 'Unassigned',
    salespersonId: r.salesperson?.id ?? null,
    oppId:    r.opp_code,
    customer: r.sender_name || '—',
    phone:    r.sender_mobile || '—',
    email:    r.sender_email || '—',
    product:  r.query_product_name || '—',
    company:  r.sender_company || '—',
    country:  r.sender_country_iso || '—',
    status:   r.disqualified ? 'disqualified' : 'qualified',
    leadStageId: Math.min(6, Math.max(1, Number(r.lead_stage_id) || 1)),
  };
};

export default function SalesLeadWorksheet() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  // Permission slug matches what ModuleSeeder.php seeds ('sales.workplace').
  // Older preview code looked for 'sales.lead_worksheet' which was never
  // seeded — that fallback is no longer needed now that the backend is live.
  const perm = user?.permissions?.['sales.workplace'];
  const canView   = isSuperAdmin || !!perm?.can_view;
  // Add-action permission no longer gates the header buttons — the
  // modal opens for any user, and the server enforces who can save.
  const canAssign = isSuperAdmin || !!perm?.can_edit;

  const [leads, setLeads]       = useState<Lead[]>([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [counts, setCounts]     = useState<Record<TabKey, number>>({ qualified: 0, disqualified: 0, all: 0 });
  const [tab, setTab]   = useState<TabKey>('qualified');
  const [q, setQ]       = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rpp, setRpp]   = useState(10);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // CTQ confirmation modal
  const [ctqLead, setCtqLead] = useState<Lead | null>(null);

  // Add New Lead modal — toggled by the My Workplace banner button.
  // Frontend-only for now; the modal owns the form state. On save
  // we just toast and could append the new lead to a local list.
  const [addLeadOpen, setAddLeadOpen] = useState(false);

  // Assign / Distribute / Filter modals — the lead worksheet's three
  // banner-action modals. Assign supports three modes (single/selection/
  // filters); the others are mode-free.
  const [assignModal, setAssignModal] = useState<{
    open: boolean;
    mode: 'single' | 'selection' | 'filters';
    leadId?: number | null;
    leadIds?: number[];
    /* When the picked row(s) already have an owner, we pre-select that
     * person in the modal's salesperson dropdown so the user sees "this
     * lead is currently with X" instead of an empty box. For 'selection'
     * mode this only kicks in when every selected row shares the same
     * owner — mixed selections leave the field blank. */
    initialSalespersonId?: number | null;
  }>({ open: false, mode: 'filters' });
  // Lead Distribution lives at /sales/lead-distribution now. The salesperson
  // pick comes back as ?sp=<id> on the URL and is applied below in useEffect.
  const [filterOpen, setFilterOpen] = useState(false);

  // Salesperson chip-label resolver — when "View Leads" applies a
  // salesperson_id filter we want the chip strip to read "Salesperson:
  // John Doe", not "Salesperson: 42". Stash the picked person's name
  // here keyed by id; renderFilterChips reads from this. Persisted only
  // for the session (in-memory) since the lead list itself will surface
  // the name on every row anyway.
  const [salespersonNames, setSalespersonNames] = useState<Record<number, string>>({});

  // Quick-view (eye icon) — fetches GET /sales/leads/{id} for the picked
  // row and renders all the row's details in a read-only card layout.
  const [viewLeadId, setViewLeadId] = useState<number | null>(null);

  // Filter modal options + active filters. Options are fetched once when
  // the page mounts so opening the modal is instant.
  const [filterOptions, setFilterOptions] = useState<{
    stages: Array<{ value: string; label: string }>;
    platforms: Array<{ value: string; label: string }>;
    queryTypes: Array<{ value: string; label: string }>;
    countries: Array<{ value: string; label: string }>;
    customers: Array<{ value: string; label: string }>;
  }>({ stages: [], platforms: [], queryTypes: [], countries: [], customers: [] });
  const [activeFilters, setActiveFilters] = useState<LeadFilters>({});

  /* When the user picks "View Leads" on the Lead Distribution page they
   * land back here with `?sp=<id>&sp_name=<name>` in the URL. Apply the
   * salesperson filter once on mount and strip the params so a reload
   * doesn't lock the filter in. */
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sp = params.get('sp');
    const spName = params.get('sp_name');
    if (sp) {
      if (spName) setSalespersonNames(prev => ({ ...prev, [Number(sp)]: spName }));
      setTab('all');
      setActiveFilters(prev => ({ ...prev, salesperson_id: sp }));
      setPage(1);
      navigate('/sales/lead-worksheet', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync-config state. The Sync button only renders when:
  //   - LEAD_SYNC_BRANCH_ID matches the user's branch (or =all), AND
  //   - at least one INDIAMART_*_KEY is configured.
  // super_admin always sees it; the server lets them fire sync anyway.
  const [syncCfg, setSyncCfg] = useState<{ enabled: boolean; labels: string[] }>({
    enabled: false,
    labels: [],
  });

  useEffect(() => {
    api.get<{ enabled: boolean; labels: string[] }>('/sales/leads/sync/config')
      .then(r => setSyncCfg(r.data))
      .catch(() => { /* silent — button just stays hidden */ });
  }, []);

  // Filter modal options — fetch once. The modal can open instantly,
  // and the Assign/Distribute modals reuse `platforms` from this too.
  useEffect(() => {
    api.get<{
      stages:      Array<{ value: string; label: string }>;
      platforms:   string[];
      query_types: string[];
      countries:   Array<{ value: string; label: string }>;
      customers:   Array<{ value: string; label: string }>;
    }>('/sales/leads/filter-options')
      .then(r => setFilterOptions({
        stages: r.data.stages,
        platforms:  (r.data.platforms  ?? []).map(p => ({ value: p, label: p })),
        queryTypes: (r.data.query_types ?? []).map(t => ({ value: t, label: t })),
        countries:  r.data.countries ?? [],
        customers:  r.data.customers ?? [],
      }))
      .catch(() => { /* silent — filter modal degrades gracefully */ });
  }, []);

  // Inject Google Fonts (DM Sans + Inter) once on mount — matches the
  // pattern used by the other ported Sales pages.
  useEffect(() => {
    const id = 'sm-lwp-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  // Debounce the search box so we only refetch ~250ms after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Skip the counts query on pure pagination changes — on a million-row
  // table the conditional-aggregation count is the slowest part of the
  // response, so we only re-run it when the bucket boundary could have
  // moved (tab / search / per-page).
  const countSigRef = useRef<string>('');

  // Fetch leads from the API whenever tab / search / pagination / filters change.
  const fetchLeads = useCallback(async () => {
    const filtersSig = JSON.stringify(activeFilters);
    const countSig = `${tab}|${debouncedQ}|${rpp}|${filtersSig}`;
    const withCounts = countSigRef.current !== countSig ? 1 : 0;
    countSigRef.current = countSig;

    setLoading(true);
    try {
      const { data } = await api.get<{
        status: boolean;
        data: ServerLead[];
        pagination: { current_page: number; last_page: number; per_page: number; total: number };
        counts?: Record<TabKey, number>;
      }>('/sales/leads', {
        params: {
          status: tab,
          search: debouncedQ || undefined,
          page,
          per_page: rpp,
          with_counts: withCounts,
          // Spread active filters — undefined values are dropped by axios's
          // paramsSerializer so empty fields don't bloat the query string.
          ...activeFilters,
        },
      });
      setLeads((data.data ?? []).map(mapServerToLead));
      setTotal(data.pagination?.total ?? 0);
      setLastPage(data.pagination?.last_page ?? 1);
      if (data.counts) setCounts(data.counts);
    } catch (e: any) {
      toast.error('Load failed', e?.response?.data?.message ?? 'Could not load leads');
      setLeads([]); setTotal(0); setLastPage(1);
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedQ, page, rpp, toast, activeFilters]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // The server already paginated for us — rows we got back are the visible page.
  const rows = leads;
  const pages = Math.max(1, lastPage);
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;

  // Page-level select-all checkbox state
  const pageIds = rows.map(r => r.oppId);
  const allChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked = pageIds.some(id => selected.has(id));

  const switchTab = (next: TabKey) => {
    setTab(next);
    setPage(1);
    setSelected(new Set());
  };

  const toggleRow = (oppId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(oppId)) next.delete(oppId);
      else next.add(oppId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) pageIds.forEach(id => next.add(id));
      else pageIds.forEach(id => next.delete(id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const onAddLead       = () => setAddLeadOpen(true);
  const onSaveNewLead   = async (lead: LeadFormValues, pickedCustomerDbId?: number | null) => {
    try {
      await api.post('/sales/leads', {
        sender_name:         lead.customerName,
        sender_mobile:       lead.mobileNumber || null,
        sender_email:        lead.customerEmail || null,
        sender_company:      lead.companyName || null,
        sender_address:      lead.customerAddress || null,
        sender_city:         lead.customerCity || null,
        sender_state:        lead.state || null,
        sender_country_name: lead.country || null,
        sender_pincode:      lead.pincode || null,
        customer_id:         pickedCustomerDbId ?? null,
      });
      toast.success('Saved', 'Lead created');
      setAddLeadOpen(false);
      // Jump to the Qualified tab on page 1 so the newly created lead is visible.
      setTab('qualified'); setPage(1);
      fetchLeads();
    } catch (e: any) {
      // Laravel validation errors arrive as { errors: { field: ["msg"] } }.
      // Pull the first message we can find, otherwise fall back to the
      // generic top-level message.
      const errs = (e?.response?.data?.errors as Record<string, string[]> | undefined) ?? {};
      const firstFieldMsg = Object.values(errs)[0]?.[0];
      const msg = e?.response?.data?.message ?? firstFieldMsg ?? 'Could not save lead';
      toast.error('Save failed', msg);
    }
  };
  // Manual sync — pull leads from each IndiaMart CRM key configured for
  // this tenant. Triggered by the "Sync from IndiaMart" banner button.
  const [syncing, setSyncing] = useState(false);
  const onSyncLeads = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { data } = await api.post<{
        status: boolean;
        fetched: number; created: number; updated: number; disqualified: number;
        errors: string[];
      }>('/sales/leads/sync');
      const summary = `${data.created} new · ${data.updated} updated · ${data.disqualified} disqualified`;
      if (data.errors?.length) {
        toast.warning?.('Sync finished with warnings', `${summary} · ${data.errors.length} error(s)`);
        // eslint-disable-next-line no-console
        console.warn('IndiaMart sync errors:', data.errors);
      } else {
        toast.success('Synced', summary);
      }
      /* Invalidate the count signature BEFORE refetching so the next
       * /sales/leads request runs with with_counts=1. Without this,
       * fetchLeads only re-requests counts when tab / search / filters
       * change; a sync that pulls 30 new rows on the same tab landed
       * the new rows in the table but left the tab badges stale until
       * the user navigated or refreshed the page. */
      countSigRef.current = '';
      fetchLeads();
    } catch (e: any) {
      toast.error('Sync failed', e?.response?.data?.message ?? 'IndiaMart sync request failed');
    } finally {
      setSyncing(false);
    }
  };
  const onAssignLeads   = () => setAssignModal({ open: true, mode: 'filters' });
  const onAssignedLeads = () => navigate('/sales/lead-distribution');
  const onFilter        = () => setFilterOpen(true);
  // Opens the Sales Matrix detail page for this opportunity at the lead's
  // SAVED stage (resume-where-you-left-off). A brand-new lead at stage 1
  // lands on Stage 1; a lead that advanced to 3 reopens at Stage 3, etc.
  // The clicked row travels in router state so the detail page can render
  // the customer header without a second fetch.
  const openMatrixDetail = (l: Lead) => {
    navigate(`/sales/matrix/${l.oppId}/stage/${l.leadStageId}`, {
      state: {
        row: {
          // Pass the DB id so Stage 1 / Task Manager can hit the API
          // directly without re-resolving the opp code first.
          id:           l.id,
          oppId:        l.oppId,
          customer:     l.customer,
          customerCode: `C-${l.oppId.replace(/^OPP-/, '')}`,
          date:         l.date,
          country:      l.country,
        },
      },
    });
  };

  // Eye-icon → quick-view modal. The row-click anywhere else still opens
  // the full matrix detail page; the eye icon is the lightweight peek.
  const onViewLead      = (l: Lead) => setViewLeadId(l.id);

  const onAssignOne     = (l: Lead) => setAssignModal({
    open: true,
    mode: 'single',
    leadId: l.id,
    initialSalespersonId: l.salespersonId,
  });
  const onOpenLead      = (l: Lead) => openMatrixDetail(l);
  const onOpenOpp       = (oppId: string) => {
    // Find the lead in the current page; the table is server-paginated so
    // anything outside the current page won't be in `leads`. The matrix
    // detail page falls back to a server fetch when state is missing.
    const lead = leads.find(l => l.oppId === oppId);
    if (lead) openMatrixDetail(lead);
    // Outside the current page — fall back to stage 1; the matrix detail
    // page's own fetch will redirect to the saved stage on load.
    else navigate(`/sales/matrix/${oppId}/stage/1`);
  };
  const onBulkAssign    = () => {
    // Translate the selection (Set of OPP-#### display codes) into the
    // numeric DB ids the assign endpoint expects.
    const picked = leads.filter(l => selected.has(l.oppId));
    const ids = picked.map(l => l.id);
    if (ids.length === 0) {
      toast.warning('Nothing selected', 'Tick at least one row to bulk-assign');
      return;
    }
    // Pre-select the common owner only when every selected lead shares
    // it — a mixed selection leaves the dropdown blank so the user makes
    // a deliberate choice rather than silently inheriting one owner.
    const owners = new Set(picked.map(l => l.salespersonId));
    const shared = owners.size === 1 ? picked[0].salespersonId : null;
    setAssignModal({
      open: true,
      mode: 'selection',
      leadIds: ids,
      initialSalespersonId: shared,
    });
  };
  const onBulkCTQ       = async () => {
    const ids = leads.filter(l => selected.has(l.oppId) && l.status === 'disqualified').map(l => l.id);
    if (ids.length === 0) {
      toast.warning('Nothing to convert', 'Select disqualified rows first');
      return;
    }
    try {
      const { data } = await api.post<{ status: boolean; converted: number }>(
        '/sales/leads/convert-to-qualified',
        { lead_ids: ids },
      );
      toast.success('Converted', `${data.converted} lead(s) moved to Qualified`);
      clearSelection();
      fetchLeads();
    } catch (e: any) {
      toast.error('Convert failed', e?.response?.data?.message ?? 'Could not convert leads');
    }
  };

  // CTQ for a single disqualified row — confirmation dialog → backend.
  const onAskCTQ      = (l: Lead) => setCtqLead(l);
  const onConfirmCTQ  = async () => {
    if (!ctqLead) return;
    try {
      await api.post('/sales/leads/convert-to-qualified', { lead_ids: [ctqLead.id] });
      toast.success('Converted', `${ctqLead.oppId} moved to Qualified`);
      setCtqLead(null);
      fetchLeads();
    } catch (e: any) {
      toast.error('Convert failed', e?.response?.data?.message ?? 'Could not convert lead');
    }
  };

  /* ── No-access early return ── */
  if (!canView) {
    return (
      <div className="lwp-root">
        <style>{SCOPED_CSS}</style>
        <div className="lwp-no-access">
          <div className="lwp-no-access-title">No access</div>
          <div className="lwp-no-access-sub">
            You don't have permission to view the Lead Worksheet. Ask your branch admin to
            grant <strong>can_view</strong> on Sales Matrix → Lead Worksheet.
          </div>
        </div>
      </div>
    );
  }

  const showBulkCTQ = tab === 'disqualified' && selected.size > 0;

  return (
    <div className="lwp-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Page header banner ── */}
      <div className="lwp-banner">
        <span className="lwp-banner-accent" />
        <span className="lwp-banner-glow" />
        <span className="lwp-banner-sheen" />

        <div className="lwp-banner-left">
          <div className="lwp-banner-icon-wrap">
            <div className="lwp-banner-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <span className="lwp-banner-dot" />
          </div>
          <div>
            <div className="lwp-banner-title">My Workplace</div>
            <div className="lwp-banner-entity"><span>Sales Matrix</span></div>
          </div>
        </div>

        <div className="lwp-actions">
          {/* Add New Lead + Assign Leads are always rendered now. The
              previous `canAdd` / `canAssign` gates hid the buttons on
              Branch User accounts that didn't have those flags seeded,
              which made the toolbar look incomplete. The server still
              authorises the actual POST when the modal saves. */}
          <button className="lwp-bact lwp-bact-primary" onClick={onAddLead}>
            <IconPlus />
            Add New Lead
          </button>
          <button className="lwp-bact lwp-bact-assign" onClick={onAssignLeads}>
            <IconUsers />
            Assign Leads
          </button>
          <button className="lwp-bact lwp-bact-assigned" onClick={onAssignedLeads}>
            <IconUserCheck />
            Lead Distribution
          </button>
          {/* Pulls leads from every IndiaMart CRM key configured in .env.
              LEAD_SYNC_BRANCH_ID in .env decides which branch sees this
              button. Same flow as IDIMS_6.0's POST /lead_store. */}
          {syncCfg.enabled && (
            <button
              className="lwp-bact lwp-bact-sync"
              onClick={onSyncLeads}
              disabled={syncing}
              title={`Pull new leads from IndiaMart (${syncCfg.labels.join(', ') || 'configured keys'})`}
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <span className="lwp-banner-divider" />
          <button
            className={`lwp-bact lwp-bact-filter ${Object.values(activeFilters).some(v => v) ? 'lwp-bact-filter-active' : ''}`}
            title="Filter Leads"
            onClick={onFilter}
          >
            <IconFilter />
            Filter
            {Object.values(activeFilters).filter(v => v).length > 0 && (
              <span className="lwp-bact-badge">
                {Object.values(activeFilters).filter(v => v).length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Tabs + Search ── */}
      <div className="lwp-pre-table">
        <div className="lwp-pills">
          {(Object.keys(TAB_LABELS) as TabKey[]).map(t => (
            <div
              key={t}
              className={`lwp-pill ${tab === t ? 'active' : ''}`}
              onClick={() => switchTab(t)}
            >
              {TAB_LABELS[t]} ({counts[t] ?? 0})
            </div>
          ))}
        </div>
        <div className="lwp-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            /* Placeholder lists the most common targets, but the
             * backend now searches every column on the My Workplace
             * table (opp id, type, source, customer name / number /
             * email / company, product, country, remark, assigned
             * salesperson, etc.) so "anything you can see, you can
             * search". */
            placeholder="Search anything — ID, name, phone, email, product, country…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Active-filter chips — one per applied field, with an inline × to
          drop just that filter. Rendered above the table so the user can
          see at a glance why the row count shrank. */}
      {Object.values(activeFilters).some(v => v) && (
        <div className="lwp-chip-strip">
          <span className="lwp-chip-strip-label">Filters:</span>
          {renderFilterChips(activeFilters, filterOptions, salespersonNames).map(c => (
            <span key={c.key} className="lwp-chip">
              <span className="lwp-chip-key">{c.label}:</span>
              <span className="lwp-chip-val">{c.value}</span>
              <button
                className="lwp-chip-x"
                aria-label={`Clear ${c.label}`}
                onClick={() => {
                  setActiveFilters(prev => {
                    const next = { ...prev };
                    delete next[c.key as keyof LeadFilters];
                    return next;
                  });
                  setPage(1);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="lwp-chip-clear-all"
            onClick={() => { setActiveFilters({}); setPage(1); }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="lwp-table-card">
        <div className="lwp-table-wrap">
          <table className="lwp-table">
            <colgroup>
              <col className="c-chk" /><col className="c-type" /><col className="c-date" /><col className="c-source" />
              <col className="c-assign" /><col className="c-wa" /><col className="c-opp" />
              <col className="c-cust" /><col className="c-phone" /><col className="c-email" />
              <col className="c-prod" /><col className="c-company" /><col className="c-country" />
              <col className="c-action" />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center', paddingLeft: 14 }}>
                  <input
                    type="checkbox"
                    title="Select all leads on this page"
                    className="lwp-chk"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={e => togglePage(e.target.checked)}
                  />
                </th>
                <th>Lead Type</th><th>Lead Date</th><th>Lead Source</th>
                <th>Assigned To</th><th>WhatsApp Status</th>
                <th style={{ textAlign: 'center' }}>Opportunity ID</th>
                <th>Customer Name</th><th>Customer Number</th><th>Customer Email</th>
                <th>Product Name</th><th>Company</th><th>Country</th><th>Action</th>
              </tr>
            </thead>
            <tbody className={loading && rows.length > 0 ? 'lwp-tbody-refetching' : undefined}>
              {loading && rows.length === 0 && (
                Array.from({ length: Math.min(rpp, 10) }).map((_, i) => (
                  <tr key={`sk-${i}`} className="lwp-skel-row">
                    <td><span className="lwp-skel lwp-skel-chk" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-sm" /></td>
                    <td><span className="lwp-skel lwp-skel-sm" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-sm" /></td>
                    <td><span className="lwp-skel lwp-skel-lg" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-lg" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                    <td><span className="lwp-skel lwp-skel-xs" /></td>
                    <td><span className="lwp-skel lwp-skel-md" /></td>
                  </tr>
                ))
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="lwp-empty">
                    No leads found
                  </td>
                </tr>
              )}
              {rows.map(l => {
                const ua = l.assigned === 'Unassigned';
                const isChecked = selected.has(l.oppId);
                return (
                  <tr
                    key={l.oppId}
                    onClick={() => onOpenLead(l)}
                    style={isChecked ? { background: 'rgba(124,58,237,.05)' } : undefined}
                  >
                    <td style={{ textAlign: 'center', paddingLeft: 14 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="lwp-chk"
                        checked={isChecked}
                        onChange={() => toggleRow(l.oppId)}
                      />
                    </td>
                    <td style={{ color: '#64748b' }}>{l.type}</td>
                    <td style={{ color: '#64748b' }}>{l.date}</td>
                    <td style={{ color: '#64748b' }}>{l.source}</td>
                    <td>
                      <div className="lwp-asgn">
                        <div className={`lwp-av-xs ${ua ? 'u' : ''}`}>{initials(l.assigned)}</div>
                        <span style={{ color: ua ? '#94a3b8' : '#1e293b', fontWeight: ua ? 400 : 500 }}>
                          {ua ? 'Unassigned' : l.assigned}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="lwp-wa-badge"><span className="lwp-wa-dot" />Pending</span>
                    </td>
                    <td>
                      <span
                        className="lwp-opp-link"
                        onClick={e => { e.stopPropagation(); onOpenOpp(l.oppId); }}
                      >{l.oppId}</span>
                    </td>
                    <td><span className="lwp-cust-name">{l.customer}</span></td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>{l.phone}</td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>{l.email}</td>
                    <td style={{ color: '#64748b' }}>
                      {l.product === '—' ? <span style={{ color: '#cbd5e1' }}>—</span> : l.product}
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {l.company === '—' ? <span style={{ color: '#cbd5e1' }}>—</span> : l.company}
                    </td>
                    <td><span className="lwp-ctag">{l.country}</span></td>
                    <td>
                      <div className="lwp-action-btns">
                        <Tooltip label="View Lead Details">
                          <button
                            className="lwp-ab lwp-ab-view"
                            aria-label="View Lead Details"
                            onClick={e => { e.stopPropagation(); onViewLead(l); }}
                          >
                            <IconEye />
                          </button>
                        </Tooltip>
                        {canAssign && (
                          <Tooltip label="Assign Lead">
                            <button
                              className="lwp-ab lwp-ab-assign"
                              aria-label="Assign Lead"
                              onClick={e => { e.stopPropagation(); onAssignOne(l); }}
                            >
                              <IconAssign />
                            </button>
                          </Tooltip>
                        )}
                        {l.status === 'disqualified' && (
                          <Tooltip label="Convert to Qualified">
                            <button
                              className="lwp-ab-ctq"
                              aria-label="Convert to Qualified"
                              onClick={e => { e.stopPropagation(); onAskCTQ(l); }}
                            >
                              CTQ
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="lwp-pagination">
          <span className="lwp-pag-info">
            {total === 0
              ? 'No leads found'
              : <>Showing <span className="lwp-hl">{startIdx + 1}–{Math.min(startIdx + rpp, total)}</span> of <span className="lwp-hl">{total}</span></>}
          </span>
          <div className="lwp-pag-right">
            <div className="lwp-rows-sel">
              Rows per page:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="lwp-pag-range">{safePage} / {pages}</span>
            <div className="lwp-page-nav">
              <button className="lwp-pg-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button className="lwp-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating bulk action bar ── */}
      {selected.size > 0 && (
        <div className="lwp-bulk-bar">
          <div className="lwp-bulk-count-wrap">
            <div className="lwp-bulk-count-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <span className="lwp-bulk-count-text">{selected.size} lead{selected.size === 1 ? '' : 's'} selected</span>
          </div>
          <span className="lwp-bulk-divider" />
          <button className="lwp-bulk-btn-primary" onClick={onBulkAssign}>
            <IconUsers />
            Assign Selected Leads
          </button>
          {showBulkCTQ && (
            <button className="lwp-bulk-btn-ctq" onClick={onBulkCTQ}>
              <IconCheck />
              Convert to Qualified
            </button>
          )}
          <button className="lwp-bulk-btn-clear" onClick={clearSelection}>
            <IconX />
            Clear
          </button>
        </div>
      )}

      {/* ── CTQ Confirmation Modal ── */}
      {ctqLead && (
        <div className="lwp-ctq-overlay" onMouseDown={() => setCtqLead(null)}>
          <div className="lwp-ctq-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="lwp-ctq-close" onClick={() => setCtqLead(null)} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Big illustrated icon — sits half over the body to draw the eye
                to "this is a state-change confirmation, not a generic dialog". */}
            <div className="lwp-ctq-hero">
              <div className="lwp-ctq-hero-ring">
                <div className="lwp-ctq-hero-icon">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="lwp-ctq-body">
              <div className="lwp-ctq-title">Convert this lead to Qualified?</div>
              <div className="lwp-ctq-sub">
                Lead <span className="lwp-ctq-opp">{ctqLead.oppId}</span> will move to the Qualified bucket and reappear in the sales pipeline.
              </div>

              {/* Disqualified → Qualified — visual transition arrow */}
              <div className="lwp-ctq-transition">
                <span className="lwp-ctq-pill lwp-ctq-pill-from">
                  <span className="lwp-ctq-pill-dot" />
                  Disqualified
                </span>
                <span className="lwp-ctq-arrow">
                  <svg width="18" height="14" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="9" x2="20" y2="9" />
                    <polyline points="14 3 20 9 14 15" />
                  </svg>
                </span>
                <span className="lwp-ctq-pill lwp-ctq-pill-to">
                  <span className="lwp-ctq-pill-dot" />
                  Qualified
                </span>
              </div>

              {/* Lead summary card */}
              <div className="lwp-ctq-lead-card">
                <div className="lwp-ctq-lead-avatar">{initials(ctqLead.customer)}</div>
                <div className="lwp-ctq-lead-meta">
                  <div className="lwp-ctq-lead-name">{ctqLead.customer}</div>
                  <div className="lwp-ctq-lead-row">
                    <span>{ctqLead.product === '—' ? 'No product specified' : ctqLead.product}</span>
                    <span className="lwp-ctq-lead-dot" />
                    <span>{ctqLead.country}</span>
                  </div>
                </div>
              </div>

              <div className="lwp-ctq-hint">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
                You can reverse this any time from the Qualified tab.
              </div>

              <div className="lwp-ctq-actions">
                <button className="lwp-ctq-btn-cancel" onClick={() => setCtqLead(null)}>Cancel</button>
                <button className="lwp-ctq-btn-confirm" onClick={onConfirmCTQ}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Convert to Qualified
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add New Lead — quick-capture modal triggered by the banner button.
          Renders via portal so the page's CSS containment doesn't crop it. */}
      <AddNewLeadModal
        open={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        onSave={onSaveNewLead}
      />

      <AssignLeadsModal
        open={assignModal.open}
        mode={assignModal.mode}
        leadId={assignModal.leadId ?? null}
        leadIds={assignModal.leadIds ?? []}
        initialSalespersonId={assignModal.initialSalespersonId ?? null}
        /* Account list comes from the .env-configured IndiaMart key labels
         * for this branch (via /sales/leads/sync/config). If nothing is
         * configured for the branch, the Account field hides itself. */
        accountLabels={syncCfg.labels}
        onClose={() => setAssignModal(s => ({ ...s, open: false }))}
        onAssigned={() => { clearSelection(); fetchLeads(); }}
      />

      {/* Lead Distribution moved to a standalone page at /sales/lead-distribution. */}

      <LeadFilterModal
        open={filterOpen}
        initial={activeFilters}
        options={filterOptions}
        onClose={() => setFilterOpen(false)}
        onApply={(f) => { setActiveFilters(f); setPage(1); }}
      />

      <LeadDetailsModal
        open={viewLeadId !== null}
        leadId={viewLeadId}
        onClose={() => setViewLeadId(null)}
      />
    </div>
  );
}

/* ─── Icons ─── */
const IconPlus = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconUsers = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconUserCheck = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <line x1="17" y1="11" x2="22" y2="11" />
  </svg>
);
const IconFilter = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="5" x2="21" y2="5" /><circle cx="8" cy="5" r="2" fill="currentColor" stroke="none" />
    <line x1="3" y1="12" x2="21" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <line x1="3" y1="19" x2="21" y2="19" /><circle cx="10" cy="19" r="2" fill="currentColor" stroke="none" />
  </svg>
);
const IconEye = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconAssign = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ─── Scoped CSS — faithful port of prototype #lwPage block, rescoped to .lwp-root ─── */
const SCOPED_CSS = `
.lwp-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #f0fdfe 0%, #e8fafb 30%, #f5feff 60%, #ffffff 100%);
  padding: 12px 20px 12px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 0;
  color: #111827;
  font-size: 13.5px;
  position: relative;
}
.lwp-root *, .lwp-root *::before, .lwp-root *::after { box-sizing: border-box; }

.lwp-no-access {
  background: #fff; border: 1.5px solid #a5f3fc; border-radius: 14px;
  padding: 28px 24px; text-align: center;
  box-shadow: 0 2px 10px rgba(8,145,178,.08);
}
.lwp-no-access-title { font-size: 16px; font-weight: 800; color: #0e7490; }
.lwp-no-access-sub   { font-size: 12px; color: #64748b; margin-top: 8px; line-height: 1.55; max-width: 540px; margin-left: auto; margin-right: auto; }

/* ─── Banner ─── */
.lwp-root .lwp-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  min-height: 58px; padding: 0 20px; margin-bottom: 10px;
  border: 1px solid #cef3f9; border-radius: 16px;
  background: linear-gradient(110deg, #f0fdff 0%, #e6fafe 25%, #d0f5fb 55%, #bef0f8 85%, #a8eaf5 100%);
  box-shadow: 0 2px 0 rgba(255,255,255,.9) inset, 0 4px 16px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  flex-shrink: 0;
}
.lwp-root .lwp-banner-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #06b6d4, #0891b2, #0e7490);
  border-radius: 16px 0 0 16px;
}
.lwp-root .lwp-banner-glow {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(190,240,248,.35) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(168,234,245,.2) 0%, transparent 55%);
}
.lwp-root .lwp-banner-sheen {
  position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
  border-radius: 16px 16px 0 0;
}
.lwp-root .lwp-banner-left {
  display: flex; align-items: center; gap: 13px;
  z-index: 1; padding-left: 10px;
}
.lwp-root .lwp-banner-icon-wrap { position: relative; flex-shrink: 0; }
.lwp-root .lwp-banner-icon {
  width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  box-shadow: 0 0 0 3px rgba(8,145,178,.25), 0 4px 14px rgba(14,116,144,.45);
  border: none;
}
.lwp-root .lwp-banner-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #cffafe;
  box-shadow: 0 2px 4px rgba(34,197,94,.4);
}
.lwp-root .lwp-banner-title {
  font-size: 14.5px; font-weight: 800;
  color: #0c4a6e; letter-spacing: -.4px; line-height: 1.2;
}
.lwp-root .lwp-banner-entity {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px; padding: 1px 9px;
  background: rgba(255,255,255,.6);
  border: 1px solid rgba(8,145,178,.35);
  border-radius: 20px;
}
.lwp-root .lwp-banner-entity::before {
  content: ""; width: 4px; height: 4px; border-radius: 50%; background: #0891b2;
}
.lwp-root .lwp-banner-entity > span {
  font-size: 8.5px; color: #155e75;
  font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
}
.lwp-root .lwp-banner-divider {
  width: 1px; height: 30px; margin: 0 3px;
  background: linear-gradient(to bottom, transparent, rgba(8,145,178,.3) 40%, rgba(8,145,178,.3) 60%, transparent);
}
.lwp-root .lwp-actions {
  display: flex; align-items: center; gap: 7px;
  flex-shrink: 0; z-index: 1;
}
.lwp-root .lwp-bact {
  /* Trimmed by ~25% on every axis — the original 11/20px padding +
   * 42px min-height pushed all four CTAs into a chunky row that
   * dwarfed the tab pills below. Compact sizing now matches a
   * standard toolbar button height while keeping the same gradient
   * + shadow language. */
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 10px;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; white-space: nowrap; transition: all .22s;
  letter-spacing: .02em; min-height: 34px; border: none;
}
.lwp-root .lwp-bact-primary {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-primary:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.55), 0 3px 8px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.22) inset;
}
.lwp-root .lwp-bact-assign {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(8,145,178,.4), 0 2px 6px rgba(14,116,144,.22), 0 1px 0 rgba(255,255,255,.18) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-assign:hover {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(8,145,178,.5), 0 3px 8px rgba(14,116,144,.28), 0 1px 0 rgba(255,255,255,.18) inset;
}
.lwp-root .lwp-bact-assigned {
  background: linear-gradient(135deg, #0e7490 0%, #155e75 55%, #164e63 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(14,116,144,.4), 0 2px 6px rgba(21,94,117,.22), 0 1px 0 rgba(255,255,255,.15) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-assigned:hover {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(14,116,144,.5), 0 3px 8px rgba(21,94,117,.28), 0 1px 0 rgba(255,255,255,.15) inset;
}
.lwp-root .lwp-bact-sync {
  background: linear-gradient(135deg, #16a34a 0%, #15803d 55%, #166534 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(22,163,74,.40), 0 2px 6px rgba(21,128,61,.22), 0 1px 0 rgba(255,255,255,.18) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-sync:hover {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 55%, #15803d 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(22,163,74,.50), 0 3px 8px rgba(21,128,61,.28), 0 1px 0 rgba(255,255,255,.18) inset;
}
.lwp-root .lwp-bact-sync:disabled {
  background: linear-gradient(135deg, #86efac 0%, #6ee7b7 100%);
  color: #f0fdf4; cursor: not-allowed; transform: none;
  box-shadow: 0 2px 6px rgba(34,197,94,.18);
}
.lwp-root .lwp-bact-filter {
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 40%, #06b6d4 100%);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(6,182,212,.4), 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.2) inset;
  position: relative; overflow: hidden;
  animation: lwpFilterPulse 2.5s ease-in-out infinite;
}
.lwp-root .lwp-bact-filter::before {
  content: '';
  position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);
  animation: lwpFilterShimmer 2.2s ease-in-out infinite;
}
@keyframes lwpFilterShimmer { 0%{left:-60%} 55%{left:120%} 100%{left:120%} }
@keyframes lwpFilterPulse {
  0%,100% { box-shadow: 0 0 0 2px rgba(6,182,212,.4), 0 4px 16px rgba(6,182,212,.45), 0 1px 0 rgba(255,255,255,.2) inset; }
  50%     { box-shadow: 0 0 0 4px rgba(6,182,212,.2), 0 6px 24px rgba(6,182,212,.6), 0 1px 0 rgba(255,255,255,.2) inset; }
}
.lwp-root .lwp-bact-filter:hover {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%);
  transform: translateY(-2px);
  box-shadow: 0 0 0 3px rgba(6,182,212,.5), 0 8px 28px rgba(6,182,212,.6), 0 1px 0 rgba(255,255,255,.2) inset;
}
.lwp-root .lwp-bact-filter-active {
  box-shadow: 0 0 0 2px #facc15, 0 6px 20px rgba(8,145,178,.4);
}
.lwp-root .lwp-bact-badge {
  background: #facc15; color: #422006;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 4px;
}

/* ─── Active filter chips ─── */
.lwp-root .lwp-chip-strip {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin: -2px 0 8px;
}
.lwp-root .lwp-chip-strip-label {
  font-size: 11px; font-weight: 600; color: #64748b; margin-right: 2px;
}
.lwp-root .lwp-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: #ecfeff; border: 1px solid #a5f3fc; color: #0e7490;
  padding: 3px 4px 3px 10px; border-radius: 999px;
  font-size: 11px;
}
.lwp-root .lwp-chip-key { font-weight: 600; opacity: .8; }
.lwp-root .lwp-chip-val { font-weight: 500; }
.lwp-root .lwp-chip-x {
  width: 16px; height: 16px; border: none; background: rgba(8,145,178,.15);
  color: #0e7490; border-radius: 50%; cursor: pointer; font-size: 13px;
  line-height: 1; display: inline-flex; align-items: center; justify-content: center;
  transition: background .12s;
}
.lwp-root .lwp-chip-x:hover { background: rgba(8,145,178,.32); }
.lwp-root .lwp-chip-clear-all {
  background: transparent; border: none; color: #ef4444; font-size: 11px;
  font-weight: 600; cursor: pointer; padding: 3px 8px; border-radius: 6px;
}
.lwp-root .lwp-chip-clear-all:hover { background: rgba(239,68,68,.08); }
[data-bs-theme="dark"] .lwp-root .lwp-chip {
  background: rgba(8,145,178,.20); border-color: rgba(34,211,238,.35); color: #67e8f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-chip-x { background: rgba(34,211,238,.18); color: #67e8f9; }

/* ─── Pre-table: pills + search ───
 * justify-content was space-between so the search bar was pinned
 * to the far right with a big empty band between it and the tab
 * pills. Changed to flex-start with a small gap so the search bar
 * sits immediately after the pills, and the bar gets flex 1 to
 * take the remaining width up to a sensible max so the layout
 * still feels balanced on wider viewports. */
.lwp-root .lwp-pre-table {
  display: flex; align-items: center; justify-content: flex-start;
  gap: 12px; margin-bottom: 8px; flex-shrink: 0;
}
.lwp-root .lwp-pills {
  display: flex; align-items: center; gap: 4px;
  background: linear-gradient(110deg, #ecfeff 0%, #cffafe 50%, #a5f3fc 100%);
  padding: 4px; border-radius: 12px;
  border: 1.5px solid #a5f3fc;
  box-shadow: 0 2px 10px rgba(8,145,178,.12), 0 1px 0 rgba(255,255,255,.9) inset;
  min-height: 42px;
  flex-shrink: 0;
}
.lwp-root .lwp-pill {
  padding: 7px 16px; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  background: transparent; color: #0e7490;
  border: none; transition: all .18s; white-space: nowrap;
  min-height: 32px; display: inline-flex; align-items: center; gap: 6px;
}
.lwp-root .lwp-pill:hover { color: #0891b2; background: rgba(255,255,255,.6); }
.lwp-root .lwp-pill.active {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  border-radius: 8px;
}
.lwp-root .lwp-search {
  display: flex; align-items: center;
  background: #ffffff;
  border: 1.5px solid #a5f3fc;
  border-radius: 12px; padding: 0 14px; gap: 8px;
  /* Sits adjacent to the pills now and stretches to use whatever
   * width is left; capped at 480px so it doesn't dominate on wide
   * desktops. height matches the trimmed pill height for a clean
   * single-row toolbar. */
  flex: 1 1 auto; min-width: 220px; height: 42px;
  box-shadow: 0 2px 10px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
  transition: all .2s;
}
.lwp-root .lwp-search:focus-within {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8,145,178,.15), 0 4px 16px rgba(8,145,178,.15);
}
.lwp-root .lwp-search input {
  border: none; background: transparent; font-family: inherit;
  font-size: 12.5px; color: #0c4a6e; outline: none; width: 100%; font-weight: 500;
}
.lwp-root .lwp-search input::placeholder { color: #94a3b8; font-weight: 400; }

/* ─── Table card ─── */
.lwp-root .lwp-table-card {
  background: #fff;
  border: 1.5px solid #a5f3fc;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
}
.lwp-root .lwp-table-wrap {
  overflow-x: auto; overflow-y: auto; width: 100%;
  flex: 1; min-height: 0;
  scrollbar-width: thin;
}
.lwp-root .lwp-table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
.lwp-root .lwp-table col.c-chk    { width: 42px; }
.lwp-root .lwp-table col.c-type   { width: 110px; }
.lwp-root .lwp-table col.c-date   { width: 88px; }
.lwp-root .lwp-table col.c-source { width: 86px; }
.lwp-root .lwp-table col.c-assign { width: 130px; }
.lwp-root .lwp-table col.c-wa     { width: 100px; }
.lwp-root .lwp-table col.c-opp    { width: 96px; }
.lwp-root .lwp-table col.c-cust   { width: 140px; }
.lwp-root .lwp-table col.c-phone  { width: 118px; }
.lwp-root .lwp-table col.c-email  { width: 160px; }
.lwp-root .lwp-table col.c-prod   { width: 120px; }
.lwp-root .lwp-table col.c-company{ width: 100px; }
.lwp-root .lwp-table col.c-country{ width: 56px; }
.lwp-root .lwp-table col.c-action { width: 130px; }

.lwp-root .lwp-table thead tr {
  background: linear-gradient(90deg, #155e75 0%, #0e7490 25%, #0891b2 55%, #06b6d4 80%, #22d3ee 100%);
  box-shadow: 0 2px 10px rgba(8,145,178,.3);
}
.lwp-root .lwp-table thead th {
  color: #fff; font-size: 8px; font-weight: 700;
  text-align: left; padding: 10px 8px;
  white-space: nowrap; letter-spacing: .07em; text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,.2);
  overflow: hidden; text-overflow: ellipsis;
}
.lwp-root .lwp-table thead th:first-child { padding-left: 0; text-align: center; width: 42px; }
.lwp-root .lwp-table thead th:last-child  { text-align: center; }
.lwp-root .lwp-table tbody tr {
  border-bottom: 1px solid #ecfeff;
  transition: background .12s; cursor: pointer;
}
.lwp-root .lwp-table tbody tr:nth-child(even) { background: #f7fffe; }
.lwp-root .lwp-table tbody tr:last-child { border-bottom: none; }
.lwp-root .lwp-table tbody tr:hover { background: #ecfeff; }
.lwp-root .lwp-table tbody td {
  padding: 0 8px; color: #475569;
  height: 44px; vertical-align: middle; font-size: 10.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;
}
.lwp-root .lwp-table tbody td:first-child { padding: 0; text-align: center; }
.lwp-root .lwp-table tbody td:last-child  { overflow: visible; text-align: center; padding: 0 6px; }
.lwp-root .lwp-table tbody td:nth-child(13) { text-align: center; padding: 0 4px; }
.lwp-root .lwp-empty {
  text-align: center !important; padding: 40px 12px !important;
  color: #94a3b8 !important; font-style: italic;
}

/* ─── Skeleton / shimmer loader ─── */
.lwp-root .lwp-skel-row { cursor: default !important; background: transparent !important; }
.lwp-root .lwp-skel-row:hover td { background: transparent !important; }
.lwp-root .lwp-skel {
  display: inline-block; height: 10px; border-radius: 4px; vertical-align: middle;
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 200% 100%;
  animation: lwp-shimmer 1.1s ease-in-out infinite;
}
.lwp-root .lwp-skel-xs  { width: 28px; }
.lwp-root .lwp-skel-sm  { width: 55px; }
.lwp-root .lwp-skel-md  { width: 80px; }
.lwp-root .lwp-skel-lg  { width: 120px; }
.lwp-root .lwp-skel-chk { width: 14px; height: 14px; border-radius: 3px; }
@keyframes lwp-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
/* Dim existing rows during a background refetch (page change, etc.)
   so the user sees "fresh data is on the way" without a jarring blank. */
.lwp-root .lwp-tbody-refetching {
  opacity: 0.55;
  pointer-events: none;
  transition: opacity .15s ease;
}
[data-bs-theme="dark"] .lwp-root .lwp-skel {
  background: linear-gradient(90deg, #1e293b 0%, #334155 50%, #1e293b 100%);
  background-size: 200% 100%;
}

.lwp-root .lwp-chk {
  width: 15px; height: 15px;
  accent-color: #7c3aed; cursor: pointer; border-radius: 4px;
}

/* ─── Row sub-elements ─── */
.lwp-root .lwp-opp-link { color: #0891b2; font-weight: 600; cursor: pointer; display: block; text-align: center; }
.lwp-root .lwp-opp-link:hover { text-decoration: underline; color: #0e7490; }
.lwp-root .lwp-cust-name { font-weight: 600; color: #0f172a; }
.lwp-root .lwp-wa-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: 20px; font-size: 10px; font-weight: 600;
  background: #fef3c7; color: #92400e;
}
.lwp-root .lwp-wa-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity:.8; flex-shrink:0; }
.lwp-root .lwp-asgn { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.lwp-root .lwp-asgn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.lwp-root .lwp-av-xs {
  width: 20px; height: 20px; border-radius: 50%;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-size: 7.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-root .lwp-av-xs.u { background: #e2e8f0; color: #94a3b8; }

.lwp-root .lwp-ctag {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 10px; border-radius: 8px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .04em;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff; border: none;
  box-shadow: 0 2px 8px rgba(8,145,178,.35), 0 1px 0 rgba(255,255,255,.2) inset;
  min-width: 32px;
}

.lwp-root .lwp-action-btns {
  display: flex; gap: 5px; flex-wrap: nowrap;
  align-items: center; justify-content: center;
}
.lwp-root .lwp-ab {
  width: 26px; height: 26px; border-radius: 7px; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .18s; flex-shrink: 0; padding: 0;
}
.lwp-root .lwp-ab-view {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff; box-shadow: 0 2px 6px rgba(6,182,212,.35);
}
.lwp-root .lwp-ab-view:hover {
  background: linear-gradient(135deg, #22d3ee, #06b6d4);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(6,182,212,.5);
}
.lwp-root .lwp-ab-assign {
  background: linear-gradient(135deg, #0e7490, #155e75);
  color: #fff; box-shadow: 0 2px 6px rgba(14,116,144,.35);
}
.lwp-root .lwp-ab-assign:hover {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(14,116,144,.5);
}
.lwp-root .lwp-ab-ctq {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff; border: none; border-radius: 7px;
  padding: 0 8px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .18s; flex-shrink: 0;
  font-size: 8.5px; font-weight: 800; white-space: nowrap; letter-spacing: .05em;
  box-shadow: 0 2px 6px rgba(245,158,11,.35);
}
.lwp-root .lwp-ab-ctq:hover {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(245,158,11,.5);
}

/* ─── Pagination ─── */
.lwp-root .lwp-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 2px solid #a5f3fc;
  flex-wrap: wrap; gap: 8px; flex-shrink: 0;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 40%, #ecfeff 100%);
  border-radius: 0 0 13px 13px;
}
.lwp-root .lwp-pag-info {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 500; color: #0e7490;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 5px 14px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lwp-root .lwp-pag-info .lwp-hl { color: #0891b2; font-weight: 800; font-size: 12px; }
.lwp-root .lwp-pag-right { display: flex; align-items: center; gap: 8px; }
.lwp-root .lwp-rows-sel {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #0e7490; font-weight: 500;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lwp-root .lwp-rows-sel select {
  border: none; background: transparent; font-family: inherit;
  font-size: 11.5px; color: #0891b2; font-weight: 700; cursor: pointer; outline: none;
}
.lwp-root .lwp-pag-range {
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border: none; padding: 5px 18px; border-radius: 20px;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  white-space: nowrap;
}
.lwp-root .lwp-page-nav { display: flex; gap: 5px; }
.lwp-root .lwp-pg-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1.5px solid #a5f3fc;
  background: rgba(255,255,255,.8);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #0891b2;
  transition: all .18s;
}
.lwp-root .lwp-pg-btn:hover:not(:disabled) {
  background: #fff; border-color: #0891b2;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8,145,178,.25);
}
.lwp-root .lwp-pg-btn:disabled { opacity: .4; cursor: not-allowed; }

/* ─── Floating bulk action bar ─── */
.lwp-root .lwp-bulk-bar {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  z-index: 8900;
  background: linear-gradient(135deg, #4c1d95, #7c3aed);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(124,58,237,.45), 0 4px 14px rgba(0,0,0,.18);
  padding: 12px 20px;
  display: flex; align-items: center; gap: 14px; white-space: nowrap;
  font-family: 'DM Sans', sans-serif;
  animation: lwpBulkBarIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpBulkBarIn {
  from { opacity: 0; transform: translateX(-50%) translateY(14px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.lwp-root .lwp-bulk-count-wrap { display: flex; align-items: center; gap: 8px; }
.lwp-root .lwp-bulk-count-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: rgba(255,255,255,.18);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-root .lwp-bulk-count-text {
  font-size: 13px; font-weight: 700; color: #fff; letter-spacing: -.1px;
}
.lwp-root .lwp-bulk-divider { width: 1px; height: 20px; background: rgba(255,255,255,.25); }
.lwp-root .lwp-bulk-btn-primary {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: #fff; color: #7c3aed;
  border: none; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
}
.lwp-root .lwp-bulk-btn-primary:hover { background: #f5f3ff; }
.lwp-root .lwp-bulk-btn-ctq {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: #fef3c7; color: #b45309;
  border: 1.5px solid #fde68a; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.10);
}
.lwp-root .lwp-bulk-btn-ctq:hover { background: #fde68a; }
.lwp-root .lwp-bulk-btn-clear {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px; background: rgba(255,255,255,.14); color: #fff;
  border: 1.5px solid rgba(255,255,255,.25); border-radius: 10px;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.lwp-root .lwp-bulk-btn-clear:hover { background: rgba(255,255,255,.22); }

/* ─── CTQ confirmation modal ─── */
.lwp-ctq-overlay {
  position: fixed; inset: 0; z-index: 9500;
  background: rgba(15,23,42,.55);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.lwp-ctq-modal {
  position: relative;
  background: #fff;
  border-radius: 20px; width: min(94vw, 460px);
  box-shadow: 0 24px 60px rgba(8,145,178,.22), 0 8px 24px rgba(0,0,0,.12);
  overflow: visible;
  font-family: 'DM Sans', 'Inter', sans-serif;
  animation: lwpCtqIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpCtqIn {
  from { opacity: 0; transform: scale(.93) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
.lwp-ctq-close {
  position: absolute; top: 14px; right: 14px;
  width: 30px; height: 30px; border-radius: 9px; border: none;
  background: #f1f5f9; color: #475569; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, color .15s; z-index: 2;
}
.lwp-ctq-close:hover { background: #e2e8f0; color: #0f172a; }

/* Hero icon — emerald gradient circle floating above the body so the
   confirmation feels celebratory rather than a generic dialog. */
.lwp-ctq-hero {
  display: flex; justify-content: center;
  padding: 28px 0 8px;
}
.lwp-ctq-hero-ring {
  width: 84px; height: 84px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(34,197,94,.15), rgba(34,197,94,0) 70%);
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-hero-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
  box-shadow: 0 10px 28px rgba(34,197,94,.35), 0 0 0 5px rgba(34,197,94,.10);
  display: flex; align-items: center; justify-content: center;
  animation: lwpCtqPop .35s cubic-bezier(.34,1.56,.64,1) .05s both;
}
@keyframes lwpCtqPop {
  from { transform: scale(0); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.lwp-ctq-body { padding: 4px 26px 24px; text-align: center; }
.lwp-ctq-title {
  font-size: 17px; font-weight: 700; color: #0f172a;
  letter-spacing: -.3px; margin-bottom: 8px;
}
.lwp-ctq-sub {
  font-size: 12.5px; color: #64748b; line-height: 1.55;
  margin-bottom: 18px;
}
.lwp-ctq-opp {
  font-weight: 700; color: #0891b2;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #ecfeff; padding: 1px 7px; border-radius: 5px;
}

/* From / To pill row */
.lwp-ctq-transition {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-bottom: 18px;
}
.lwp-ctq-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600;
  border: 1.5px solid;
}
.lwp-ctq-pill-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor; opacity: .9;
}
.lwp-ctq-pill-from {
  background: #fef2f2; color: #b91c1c; border-color: #fecaca;
}
.lwp-ctq-pill-to {
  background: #f0fdf4; color: #15803d; border-color: #bbf7d0;
}
.lwp-ctq-arrow {
  display: inline-flex; align-items: center; color: #0891b2;
  animation: lwpCtqArrow 1.6s ease-in-out infinite;
}
@keyframes lwpCtqArrow {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(3px); }
}

/* Lead summary card */
.lwp-ctq-lead-card {
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, #f0fdfe, #ecfeff);
  border: 1px solid #a5f3fc; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 14px; text-align: left;
}
.lwp-ctq-lead-avatar {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-size: 12.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(8,145,178,.25);
}
.lwp-ctq-lead-meta { flex: 1; min-width: 0; }
.lwp-ctq-lead-name {
  font-size: 13px; font-weight: 700; color: #0f172a;
  line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lwp-ctq-lead-row {
  display: flex; align-items: center; gap: 8px; margin-top: 4px;
  font-size: 11px; color: #475569;
}
.lwp-ctq-lead-dot {
  width: 3px; height: 3px; border-radius: 50%; background: #94a3b8;
  flex-shrink: 0;
}

.lwp-ctq-hint {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #94a3b8; margin-bottom: 18px;
}

.lwp-ctq-actions {
  display: flex; gap: 10px; justify-content: center;
}
.lwp-ctq-btn-cancel {
  flex: 1; max-width: 140px;
  padding: 11px 22px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.lwp-ctq-btn-cancel:hover { border-color: #94a3b8; background: #f8fafc; }
.lwp-ctq-btn-confirm {
  flex: 1.4; padding: 11px 24px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(34,197,94,.35);
  transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.lwp-ctq-btn-confirm:hover { transform: translateY(-1px); filter: brightness(1.05); }
.lwp-ctq-btn-confirm:active { transform: translateY(0); }

/* ════════════════════════════════════════════════════════════════════
   Dark-mode adaptation — every panel re-tints against the deep slate
   surface so the page reads as part of the dark theme instead of
   floating on a bright cyan haze.
   ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .lwp-root,
[data-layout-mode="dark"] .lwp-root {
  background: linear-gradient(160deg, #0b1220 0%, #0f172a 35%, #0b1220 100%);
  color: #e2e8f0;
}
[data-bs-theme="dark"] .lwp-root .lwp-banner,
[data-layout-mode="dark"] .lwp-root .lwp-banner {
  background:
    radial-gradient(ellipse at top right, rgba(34,211,238,0.10), transparent 60%),
    radial-gradient(ellipse at bottom left, rgba(14,165,233,0.08), transparent 60%),
    linear-gradient(135deg, #0e2940 0%, #102a3a 50%, #0c1f2e 100%);
  border-color: rgba(34,211,238,0.18);
  box-shadow: 0 6px 24px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-banner-title { color: #f0f9ff; }
/* The "SALES MATRIX" entity badge was illegible in dark mode — its
 * wrapper bg stayed at rgba(255,255,255,.6) (milky white) while the
 * dark-mode rule only flipped the text colour to light cyan. Light
 * cyan on milky white = near-zero contrast. Flip the whole pill to
 * a translucent cyan tint with a stronger border so the badge reads
 * cleanly on the dark banner. */
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity {
  background: rgba(34, 211, 238, 0.14);
  border-color: rgba(103, 232, 249, 0.45);
}
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity::before { background: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity > span { color: #cffafe; }
[data-bs-theme="dark"] .lwp-root .lwp-banner-divider { background: rgba(148,163,184,0.25); }

/* CTQ action button — was a saturated amber gradient on every theme
 * which screamed at the user against the dark table row. In dark
 * mode we drop it to a muted amber chip with a thin border so the
 * affordance is still tagged-amber but doesn't dominate the row. */
[data-bs-theme="dark"] .lwp-root .lwp-ab-ctq {
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fbbf24;
  box-shadow: none;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-ctq:hover {
  background: rgba(245, 158, 11, 0.28);
  border-color: rgba(251, 191, 36, 0.7);
  color: #fde68a;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.28);
}

/* Pagination footer — light cyan gradient + cyan-on-white pills
 * stayed visible on the light theme but produced a glaring teal
 * stripe in dark mode that didn't match the rest of the dark table.
 * Flip to a slate canvas with translucent cyan accents. */
[data-bs-theme="dark"] .lwp-root .lwp-pagination {
  background: linear-gradient(90deg, rgba(15, 23, 42, 0.55) 0%, rgba(15, 23, 42, 0.35) 50%, rgba(15, 23, 42, 0.55) 100%);
  border-top-color: rgba(34, 211, 238, 0.18);
}
[data-bs-theme="dark"] .lwp-root .lwp-pag-info,
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(34, 211, 238, 0.20);
  color: #cffafe;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
[data-bs-theme="dark"] .lwp-root .lwp-pag-info .lwp-hl,
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel select { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-pg-btn {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(34, 211, 238, 0.22);
  color: #67e8f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-pg-btn:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.16);
  border-color: rgba(103, 232, 249, 0.55);
}

/* Banner action buttons — translucent glass against the dark banner. */
[data-bs-theme="dark"] .lwp-root .lwp-bact {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
}
[data-bs-theme="dark"] .lwp-root .lwp-bact:hover { background: rgba(15, 23, 42, 0.75); }
[data-bs-theme="dark"] .lwp-root .lwp-bact-primary,
[data-bs-theme="dark"] .lwp-root .lwp-bact-primary:hover {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #fff; border-color: transparent;
}
[data-bs-theme="dark"] .lwp-root .lwp-bact-assign {
  background: linear-gradient(135deg, #0e7490, #155e75);
  color: #f0f9ff; border-color: rgba(34,211,238,0.30);
}
[data-bs-theme="dark"] .lwp-root .lwp-bact-assigned {
  background: linear-gradient(135deg, #1e3a5f, #1e293b);
  color: #cbd5e1; border-color: rgba(148,163,184,0.25);
}
[data-bs-theme="dark"] .lwp-root .lwp-bact-filter {
  background: linear-gradient(135deg, #155e75, #0e7490);
  color: #f0fdfa; border-color: rgba(34,211,238,0.28);
}

/* Tab pills */
[data-bs-theme="dark"] .lwp-root .lwp-tabs { background: rgba(8, 145, 178, 0.10); border-color: rgba(34,211,238,0.18); }
[data-bs-theme="dark"] .lwp-root .lwp-tab { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-tab.on {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
}

/* Search bar */
[data-bs-theme="dark"] .lwp-root .lwp-search {
  background: #1e293b; border-color: #334155;
}
[data-bs-theme="dark"] .lwp-root .lwp-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-search input::placeholder { color: #64748b; }

/* Lead table */
[data-bs-theme="dark"] .lwp-root .lwp-table-wrap {
  background: #0f172a;
  border-color: rgba(34,211,238,0.18);
  box-shadow: 0 4px 18px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-table thead th {
  background: linear-gradient(135deg, #0e7490, #155e75) !important;
  color: #f0f9ff !important;
  border-bottom-color: rgba(34,211,238,0.30) !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody td {
  background: #0f172a !important;
  color: #cbd5e1 !important;
  /* Repaints the row separator in a near-invisible navy so the
     previous off-white border doesn't leave a bright line streaking
     across every row. */
  border-top-color: rgba(30, 41, 59, 0.65) !important;
  border-bottom: none !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr {
  border-bottom: 1px solid rgba(30, 41, 59, 0.65) !important;
  background: transparent !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:last-child {
  border-bottom: none !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:nth-child(even) td { background: #111c33 !important; }
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:hover td { background: #16223d !important; }
[data-bs-theme="dark"] .lwp-root .lwp-table a { color: #67e8f9; }

/* Cell-level text — customer name was hard-coded to slate-900 (near
   black) which becomes invisible on the dark slate row surface. */
[data-bs-theme="dark"] .lwp-root .lwp-cust-name { color: #f1f5f9; font-weight: 600; }
[data-bs-theme="dark"] .lwp-root .lwp-asgn span { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-av-xs.u   { background: #1e293b; color: #64748b; }
[data-bs-theme="dark"] .lwp-root .lwp-opp-link  { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-opp-link:hover { color: #a5f3fc; }

/* Country tag — the light version uses a bright cyan gradient with
   white text. On the dark theme that screams against the surface;
   recolor as a subtler translucent chip so it reads as data, not a
   call-to-action. */
[data-bs-theme="dark"] .lwp-root .lwp-ctag {
  background: rgba(14, 165, 233, 0.16) !important;
  color: #7dd3fc !important;
  border: 1px solid rgba(34, 211, 238, 0.35) !important;
  box-shadow: none !important;
  font-weight: 600 !important;
  letter-spacing: 0.04em !important;
}

/* WhatsApp + status pills — keep the meaning, dim the brightness. */
[data-bs-theme="dark"] .lwp-root .lwp-wa-badge {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}
[data-bs-theme="dark"] .lwp-root .lwp-pill-pending {
  background: rgba(245, 158, 11, 0.18); color: #fbbf24; border-color: rgba(245, 158, 11, 0.40);
}
[data-bs-theme="dark"] .lwp-root .lwp-country-pill {
  background: rgba(14, 165, 233, 0.18); color: #7dd3fc; border-color: rgba(14, 165, 233, 0.40);
}
[data-bs-theme="dark"] .lwp-root .lwp-ab {
  background: rgba(15, 23, 42, 0.65);
  border-color: rgba(148, 163, 184, 0.30);
  color: #cbd5e1;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab:hover { background: rgba(8, 145, 178, 0.25); color: #f0f9ff; }
[data-bs-theme="dark"] .lwp-root .lwp-ab-assign { color: #67e8f9; border-color: rgba(34,211,238,0.40); }

/* No-access card */
[data-bs-theme="dark"] .lwp-root .lwp-no-access {
  background: #0f172a; border-color: rgba(34,211,238,0.25); color: #e2e8f0;
}
[data-bs-theme="dark"] .lwp-root .lwp-no-access-title { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-no-access-sub   { color: #94a3b8; }

/* CTQ confirmation overlay */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-card {
  background: #14102a; color: #ede9fe;
  border: 1px solid rgba(34,211,238,0.22);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}
/* CTQ ("Convert to Qualified") confirmation modal — dark-mode coverage.
 * Previously only the title / sub / cancel button had dark overrides,
 * so the modal card itself stayed white, the close button stayed light
 * grey, the lead-summary card stayed pale cyan, and the OPP pill stayed
 * a near-white tint. The whole dialog now follows the dark canvas. */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-modal {
  background:
    radial-gradient(ellipse at top, rgba(34,197,94,0.08), transparent 60%),
    linear-gradient(135deg, #0e2940 0%, #102a3a 50%, #0c1f2e 100%);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 8px 24px rgba(0, 0, 0, 0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-close {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-close:hover {
  background: rgba(255, 255, 255, 0.16); color: #f1f5f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-title { color: #f0f9ff; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-sub   { color: #94a3b8; }
/* OPP code chip — light cyan in light theme; tinted cyan-on-dark here
 * so it stays readable but doesn't punch through the dark canvas. */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-opp {
  background: rgba(34, 211, 238, 0.16);
  color: #67e8f9;
}
/* From / To status pills — the light-mode pastel fills (#fef2f2 /
 * #f0fdf4) look like white blocks on a dark canvas. Drop them onto
 * tinted backgrounds with brighter text so the colour coding still
 * reads (red→green). */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-pill-from {
  background: rgba(239, 68, 68, 0.16);
  color: #fca5a5; border-color: rgba(239, 68, 68, 0.42);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-pill-to {
  background: rgba(34, 197, 94, 0.16);
  color: #86efac; border-color: rgba(34, 197, 94, 0.45);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-arrow { color: #67e8f9; }
/* Lead summary card — was the milky cyan gradient that read as
 * white on dark canvas. Switch to a translucent cyan-on-dark with a
 * lifted border + readable text. */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-lead-card {
  background: linear-gradient(135deg, rgba(34,211,238,0.10), rgba(34,211,238,0.05));
  border-color: rgba(34, 211, 238, 0.28);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-lead-name { color: #f0f9ff; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-lead-row  { color: #cbd5e1; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-lead-dot  { background: #64748b; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-hint      { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel {
  background: transparent; color: #cbd5e1; border-color: rgba(34, 211, 238, 0.22);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel:hover {
  background: rgba(15, 23, 42, 0.55); border-color: rgba(34, 211, 238, 0.45);
}
/* Confirm button stays green — only soften the shadow against dark bg. */
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-confirm {
  box-shadow: 0 4px 16px rgba(34, 197, 94, 0.45);
}

/* ════════════════════════════════════════════════════════════════════
 * Responsive layout — single consolidated block covering every surface
 * on this page. Breakpoints follow the rough phone (≤480) / large-
 * phone (≤640) / tablet (≤900) bands; the table itself always lives
 * inside .lwp-table-wrap { overflow:auto } so it horizontally scrolls
 * unchanged on phones while everything around it reflows.
 * ════════════════════════════════════════════════════════════════════ */

/* Tablet — banner + actions wrap; pre-table stacks; tighter table cells */
@media (max-width: 900px) {
  .lwp-root .lwp-banner {
    flex-direction: column; align-items: stretch;
    padding: 14px 16px; gap: 10px;
  }
  .lwp-root .lwp-banner-left { width: 100%; }
  .lwp-root .lwp-actions { flex-wrap: wrap; gap: 6px; justify-content: flex-start; }
  .lwp-root .lwp-actions .lwp-bact { flex: 1 0 auto; justify-content: center; }
  .lwp-root .lwp-actions .lwp-banner-divider { display: none; }
  .lwp-root .lwp-pre-table { flex-direction: column; align-items: stretch; gap: 8px; }
  .lwp-root .lwp-search { width: 100%; }
  .lwp-root .lwp-pills { width: 100%; justify-content: space-between; overflow-x: auto; }
  .lwp-root .lwp-pill  { padding: 8px 14px; font-size: 12px; }
}

/* Large phone — actions become 2-column grid, pills shrink */
@media (max-width: 640px) {
  .lwp-root .lwp-banner-title  { font-size: 15px; }
  .lwp-root .lwp-banner-entity { font-size: 11px; }
  .lwp-root .lwp-actions {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
  }
  .lwp-root .lwp-actions .lwp-bact {
    padding: 9px 12px; font-size: 11.5px;
    min-height: 38px; min-width: 0;
  }
  .lwp-root .lwp-pill { padding: 7px 10px; font-size: 11px; }
  .lwp-root .lwp-chip-strip { gap: 4px; }
  .lwp-root .lwp-chip { font-size: 10.5px; padding: 2px 4px 2px 8px; }
  .lwp-root .lwp-pagination { padding: 8px 12px; gap: 6px; }
  .lwp-root .lwp-pag-info, .lwp-root .lwp-rows-sel { font-size: 11px; padding: 4px 10px; }
  /* Bulk bar — full-width sheet at the bottom on phones rather than
     centred floating pill, so all buttons remain reachable. */
  .lwp-root .lwp-bulk-bar {
    left: 8px; right: 8px; bottom: 10px;
    transform: none; width: auto;
    padding: 10px 12px; gap: 8px; flex-wrap: wrap;
    border-radius: 14px;
  }
  .lwp-root .lwp-bulk-bar > * { flex: 1 1 auto; }
  .lwp-root .lwp-bulk-divider  { display: none; }
}

/* Phone — single-column actions, even more compact */
@media (max-width: 480px) {
  .lwp-root .lwp-banner { border-radius: 12px; padding: 12px 14px; }
  .lwp-root .lwp-actions { grid-template-columns: 1fr; }
  .lwp-root .lwp-table-card { border-radius: 10px; }
  .lwp-root .lwp-table { font-size: 11px; }
  .lwp-root .lwp-table thead th, .lwp-root .lwp-table tbody td { padding: 0 6px; }
  .lwp-root .lwp-pag-range { font-size: 11px; }
  /* CTQ — tighter padding so the hero icon doesn't crowd the title */
  .lwp-root .lwp-ctq-modal { border-radius: 16px; }
  .lwp-root .lwp-ctq-body { padding: 0 18px 20px; }
  .lwp-root .lwp-ctq-title { font-size: 15.5px; }
  .lwp-root .lwp-ctq-hero { padding: 22px 0 4px; }
  .lwp-root .lwp-ctq-hero-icon { width: 56px; height: 56px; }
  .lwp-root .lwp-ctq-actions { flex-direction: column-reverse; }
  .lwp-root .lwp-ctq-btn-cancel,
  .lwp-root .lwp-ctq-btn-confirm { max-width: none; width: 100%; flex: none; }
}
`;
