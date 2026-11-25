import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDmy } from '../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../../../api';
import { encodeOppId, encodeStage } from '../../../utils/oppCrypto';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import Tooltip from '../../../components/ui/Tooltip';
import AddNewLeadModal, { type LeadFormValues } from './AddNewLeadModal';
import AssignLeadsModal from './AssignLeadsModal';
import LeadDetailsModal from './LeadDetailsModal';
import LeadActivityModal from './LeadActivityModal';
import LeadFilterModal, { type LeadFilters, countFilterValues } from './LeadFilterModal';
import SearchClear from '../../../components/ui/SearchClear';
import { RowsPerPageSelect } from '../../../components/ui/TablePager';
import '../../../components/ui/DataTable.css';


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
  effective_country_iso?: string | null;
  query_product_name:string | null;
  qualified:         boolean;
  disqualified:      boolean;
  whatsapp_status:   string | null;
  lead_stage_id?:    number | null;
  key_opportunity?:  boolean;
  read_only?:        boolean;
  salesperson?:      { id: number; name: string } | null;
  customer?:         { id: number; company_name: string | null; legal_name: string | null; primary_email?: string | null } | null;
};


type LeadStatus = 'qualified' | 'disqualified';
type TabKey     = 'qualified' | 'disqualified' | 'all' | 'key_opportunity';
type DealState  = 'in_progress' | 'won';

type Lead = {
  id:   number;
  type: string;
  date: string;
  source: string;
  assigned: string;
  salespersonId: number | null;
  oppId: string;
  customer: string;
  phone: string;
  email: string;
  product: string;
  company: string;
  country: string;
  status: LeadStatus;
  whatsappStatus: string | null;
  leadStageId: number;
  keyOpportunity: boolean;
  readOnly: boolean;
};

const TAB_LABELS: Record<TabKey, string> = {
  qualified:       'Qualified Leads',
  disqualified:    'Disqualified Leads',
  all:             'All Leads',
  key_opportunity: 'Key Opportunity Leads',
};


const DEAL_STATE_LABELS: Record<DealState, string> = {
  in_progress: 'In Progress',
  won:         'Deal Won',
};

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

const initials = (name: string): string => {
  if (!name || name === 'Unassigned') return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
};

const LEAD_TYPE_LABEL: Record<string, string> = {
  BUY:               'Buy Leads',
  P:                 'PNS Calls',
  W:                 'Direct Enquiries',
  BIZ:               'Catalog-View Leads',
  'Product Inquiry': 'Product Inquiry',
  WA:                'WhatsApp-Enquiries',
  B:                 'Buy-Leads',
};
const prettyLeadType = (t: string | null | undefined): string =>
  LEAD_TYPE_LABEL[t ?? ''] ?? (t || 'Manual');

type FilterChip = { id: string; field: keyof LeadFilters; rawValue?: string; label: string; value: string };
const renderFilterChips = (
  f: LeadFilters,
  o: {
    stages: Array<{ value: string; label: string }>;
    platforms: Array<{ value: string; label: string }>;
    queryTypes: Array<{ value: string; label: string }>;
    countries: Array<{ value: string; label: string }>;
    customers: Array<{ value: string; label: string; code?: string | null }>;
  },
  salespersonNames: Record<number, string> = {},
): FilterChip[] => {
  const lookup = (
    list: Array<{ value: string; label: string }>,
    v: string | undefined,
  ): string => list.find(o => o.value === v)?.label ?? v ?? '';
  const out: FilterChip[] = [];
  const pushArr = (
    field: keyof LeadFilters,
    label: string,
    list: Array<{ value: string; label: string }>,
    vals: string[] | undefined,
  ) => (vals ?? []).forEach(v =>
    out.push({ id: `${field}:${v}`, field, rawValue: v, label, value: lookup(list, v) }));

  pushArr('lead_stage_id',      'Stage',    o.stages,     f.lead_stage_id);
  pushArr('platform',           'Platform', o.platforms,  f.platform);
  pushArr('query_type',         'Type',     o.queryTypes, f.query_type);
  pushArr('sender_country_iso', 'Country',  o.countries,  f.sender_country_iso);
  pushArr('customer_id',        'Customer', o.customers,  f.customer_id);
  if (f.salesperson_id)     out.push({
    id:    'salesperson_id',
    field: 'salesperson_id',
    label: 'Salesperson',
    value: salespersonNames[Number(f.salesperson_id)] ?? `#${f.salesperson_id}`,
  });
  if (f.start_date && f.end_date) out.push({ id: 'date', field: 'start_date', label: 'Date', value: `${f.start_date} → ${f.end_date}` });
  return out;
};

const mapServerToLead = (r: ServerLead): Lead => {
  const dateSrc = r.query_time ?? r.created_at;
  const date = dateSrc
    ? formatDmy(dateSrc)
    : '—';
  return {
    id:       r.id,
    type:     prettyLeadType(r.query_type),
    date,
    source:   r.platform || '—',
    assigned: r.salesperson?.name ?? 'Unassigned',
    salespersonId: r.salesperson?.id ?? null,
    oppId:    r.opp_code,
    customer: r.customer?.company_name || r.sender_name || '—',
    phone:    r.sender_mobile || '—',
    email:    r.customer?.primary_email || r.sender_email || '—',
    product:  r.query_product_name || '—',
    company:  r.customer?.legal_name || r.sender_company || '—',
    country:  r.effective_country_iso || r.sender_country_iso || '—',
    status:   r.disqualified ? 'disqualified' : 'qualified',
    whatsappStatus: r.whatsapp_status ?? null,
    leadStageId: Math.min(6, Math.max(1, Number(r.lead_stage_id) || 1)),
    keyOpportunity: !!r.key_opportunity,
    readOnly: !!r.read_only,
  };
};

const waBadge = (s: string | null): { label: string; mod: string } => {
  if (s === 'connected')      return { label: 'Connected',     mod: 'lwp-wa-yes' };
  if (s === 'not_connected')  return { label: 'Not Connected', mod: 'lwp-wa-no' };
  return { label: 'Pending', mod: 'lwp-wa-pending' };
};

export default function SalesLeadWorksheet() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.workplace'];
  const canView   = isSuperAdmin || !!perm?.can_view;
  const canAssign = isSuperAdmin || !!perm?.can_edit;

  const [leads, setLeads]       = useState<Lead[]>([]);
  const [loading, setLoading]   = useState(false);
  const skeletonSinceRef = useRef<number | null>(null);
  const SKELETON_MIN_MS = 450;
  const [total, setTotal]       = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [counts, setCounts]     = useState<Record<string, number>>({
    qualified: 0, disqualified: 0, all: 0, key_opportunity: 0, key_in_progress: 0, key_won: 0,
  });

  const [countsLoaded, setCountsLoaded] = useState(false);
  const [canDistribute, setCanDistribute] = useState(true);
  const [tab, setTab]   = useState<TabKey>('qualified');
  const [dealState, setDealState] = useState<DealState>('in_progress');
  const [q, setQ]       = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rpp, setRpp]   = useState(10);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const wrapRef    = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  useEffect(() => {
    const recompute = () => {
      if (!autoFitRef.current) return;
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const THEAD = 40, ROW = 44, FOOTER = 56;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      if (avail <= 0) return;
      const fit = Math.max(5, Math.floor(avail / ROW));
      setRpp(prev => (prev === fit ? prev : fit));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(recompute, 140); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const [ctqLead, setCtqLead] = useState<Lead | null>(null);
  const [ctqBusy, setCtqBusy] = useState(false);

  const [addLeadOpen, setAddLeadOpen] = useState(false);

  const [assignModal, setAssignModal] = useState<{
    open: boolean;
    mode: 'single' | 'selection' | 'filters';
    leadId?: number | null;
    leadIds?: number[];
    customerName?: string | null;
    oppCode?: string | null;
    initialSalespersonId?: number | null;
    initialSalespersonName?: string | null;
  }>({ open: false, mode: 'filters' });
  const [filterOpen, setFilterOpen] = useState(false);

  const [exportOpen, setExportOpen]   = useState(false);
  const [exporting,  setExporting]    = useState<TabKey | null>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportPos, setExportPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [exportOpen]);

  const [salespersonNames, setSalespersonNames] = useState<Record<number, string>>({});

  const [viewLeadId, setViewLeadId] = useState<number | null>(null);
  const [activityLead, setActivityLead] = useState<{ id: number; opp: string } | null>(null);

  const [filterOptions, setFilterOptions] = useState<{
    stages: Array<{ value: string; label: string }>;
    platforms: Array<{ value: string; label: string }>;
    queryTypes: Array<{ value: string; label: string }>;
    countries: Array<{ value: string; label: string }>;
    customers: Array<{ value: string; label: string; code?: string | null }>;
  }>({ stages: [], platforms: [], queryTypes: [], countries: [], customers: [] });
  const [activeFilters, setActiveFilters] = useState<LeadFilters>({});

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

  const [syncCfg, setSyncCfg] = useState<{ enabled: boolean; labels: string[] }>({
    enabled: false,
    labels: [],
  });

  useEffect(() => {
    api.get<{ enabled: boolean; labels: string[] }>('/sales/leads/sync/config')
      .then(r => setSyncCfg(r.data))
      .catch(() => {  });
  }, []);

  useEffect(() => {
    api.get<{
      stages:      Array<{ value: string; label: string }>;
      platforms:   string[];
      query_types: string[];
      countries:   Array<{ value: string; label: string }>;
      customers:   Array<{ value: string; label: string; code?: string | null }>;
    }>('/sales/leads/filter-options')
      .then(r => setFilterOptions({
        stages: r.data.stages,
        platforms:  (r.data.platforms  ?? []).map(p => ({ value: p, label: p })),
        queryTypes: (r.data.query_types ?? []).map(t => ({ value: t, label: prettyLeadType(t) })),
        countries:  r.data.countries ?? [],
        customers:  r.data.customers ?? [],
      }))
      .catch(() => {  });
  }, []);

  useEffect(() => {
    const id = 'sm-lwp-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const lastQRef = useRef('');

  useEffect(() => {
    const t = setTimeout(() => {
      if (lastQRef.current === q) return;
      lastQRef.current = q;
      setLeads([]);
      setLoading(true);
      setPage(1);
      skeletonSinceRef.current = Date.now();
      setDebouncedQ(q);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const countSigRef = useRef<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  const fetchLeads = useCallback(async () => {
    const filtersSig = JSON.stringify(activeFilters);
    const countSig = `${tab}|${dealState}|${debouncedQ}|${rpp}|${filtersSig}`;
    const withCounts = countSigRef.current !== countSig ? 1 : 0;
    countSigRef.current = countSig;

    setLoading(true);
    let commit: (() => void) | null = null;
    try {
      const { data } = await api.get<{
        status: boolean;
        data: ServerLead[];
        pagination: { current_page: number; last_page: number; per_page: number; total: number };
        counts?: Record<string, number>;
      }>('/sales/leads', {
        params: {
          status: tab,
          deal_state: tab === 'key_opportunity' ? dealState : undefined,
          search: debouncedQ || undefined,
          page,
          per_page: rpp,
          with_counts: withCounts,
          ...activeFilters,
        },
      });
      const mapped = (data.data ?? []).map(mapServerToLead);
      commit = () => {
        setLeads(mapped);
        setTotal(data.pagination?.total ?? 0);
        setLastPage(data.pagination?.last_page ?? 1);
        if (data.counts) { setCounts(data.counts); setCountsLoaded(true); }
        setCanDistribute((data as any).can_distribute !== false);
      };
    } catch (e: any) {
      toast.error('Load failed', e?.response?.data?.message ?? 'Could not load leads');
      commit = () => { setLeads([]); setTotal(0); setLastPage(1); };
    } finally {
      const since = skeletonSinceRef.current;
      const left  = since === null ? 0 : SKELETON_MIN_MS - (Date.now() - since);
      skeletonSinceRef.current = null;
      const paint = () => { commit?.(); setLoading(false); };
      if (left > 0) setTimeout(paint, left);
      else paint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dealState, debouncedQ, page, rpp, toast, activeFilters, reloadKey]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const rows = leads;
  const pages = Math.max(1, lastPage);
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;

  const pageIds = rows.filter(r => !r.readOnly).map(r => r.oppId);
  const allChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked = pageIds.some(id => selected.has(id));

  const startNewQuery = () => {
    setLeads([]);
    setLoading(true);
    setPage(1);
    setSelected(new Set());
    skeletonSinceRef.current = Date.now();
  };

  const changeRowsPerPage = (n: number) => {
    autoFitRef.current = false;
    setRpp(n);
    setPage(1);
    setLeads([]);
    setLoading(true);
    skeletonSinceRef.current = Date.now();
  };

  const goToPage = (next: number) => {
    const target = Math.min(Math.max(1, next), pages);
    if (target === safePage) return;
    setPage(target);
    setLeads([]);
    setLoading(true);
    skeletonSinceRef.current = Date.now();
  };

  const switchTab = (next: TabKey) => {
    setTab(next);
    if (next === 'key_opportunity') setDealState('in_progress');
    setActiveFilters({});
    startNewQuery();
  };

  const switchDealState = (next: DealState) => {
    setDealState(next);
    setActiveFilters({});
    startNewQuery();
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

  const toggleExportMenu = () => {
    setExportOpen(o => {
      if (o) return false;
      const r = exportBtnRef.current?.getBoundingClientRect();
      if (r) setExportPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
      return true;
    });
  };

  const fetchAllLeads = async (bucket: TabKey): Promise<Lead[]> => {
    const all: Lead[] = [];
    let pg = 1;
    let last = 1;
    do {
      const { data } = await api.get<{
        data: ServerLead[];
        pagination: { last_page: number };
      }>('/sales/leads', {
        params: { status: bucket, page: pg, per_page: 200, with_counts: 0 },
      });
      all.push(...(data.data ?? []).map(mapServerToLead));
      last = data.pagination?.last_page ?? 1;
      pg += 1;
    } while (pg <= last);
    return all;
  };

  const exportLeads = async (bucket: TabKey) => {
    if (exporting) return;
    setExportOpen(false);
    setExporting(bucket);
    try {
      const data = await fetchAllLeads(bucket);
      if (data.length === 0) {
        toast.warning('Nothing to export', `No ${TAB_LABELS[bucket]} to export.`);
        return;
      }
      const sheet = data.map(l => ({
        'Lead Type':       l.type,
        'Lead Date':       l.date,
        'Lead Source':     l.source,
        'Assigned To':     l.assigned,
        'WhatsApp Status': waBadge(l.whatsappStatus).label,
        'Opportunity ID':  l.oppId,
        'Customer Name':   l.customer,
        'Customer Number': l.phone,
        'Customer Email':  l.email,
        'Product Name':    l.product,
        'Company':         l.company,
        'Country':         l.country,
      }));
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, TAB_LABELS[bucket].slice(0, 31));
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Leads_${bucket}_${stamp}.xlsx`);
      toast.success('Exported', `${data.length} ${TAB_LABELS[bucket]} exported.`);
    } catch (e: any) {
      toast.error('Export failed', e?.response?.data?.message ?? 'Could not export leads.');
    } finally {
      setExporting(null);
    }
  };

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
      setTab('qualified');
      countSigRef.current = '';
      startNewQuery();
      setReloadKey(k => k + 1);
    } catch (e: any) {
      const errs = (e?.response?.data?.errors as Record<string, string[]> | undefined) ?? {};
      const firstFieldMsg = Object.values(errs)[0]?.[0];
      const msg = e?.response?.data?.message ?? firstFieldMsg ?? 'Could not save lead';
      toast.error('Save failed', msg);
    }
  };
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
  const openMatrixDetail = (l: Lead) => {
    navigate(`/sales/matrix/${encodeOppId(l.oppId)}/stage/${encodeStage(l.leadStageId)}`, {
      state: {
        row: {
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

  const onViewLead      = (l: Lead) => setViewLeadId(l.id);
  const onViewActivity  = (l: Lead) => setActivityLead({ id: l.id, opp: l.oppId });

  const onAssignOne     = (l: Lead) => setAssignModal({
    open: true,
    mode: 'single',
    leadId: l.id,
    customerName: l.customer,
    oppCode: l.oppId,
    initialSalespersonId: l.salespersonId,
    initialSalespersonName: l.salespersonId ? l.assigned : null,
  });
  const onOpenLead      = (l: Lead) => openMatrixDetail(l);
  const onOpenOpp       = (oppId: string) => {
    const lead = leads.find(l => l.oppId === oppId);
    if (lead) openMatrixDetail(lead);
    else navigate(`/sales/matrix/${encodeOppId(oppId)}/stage/${encodeStage(1)}`);
  };
  const onBulkAssign    = () => {
    const picked = leads.filter(l => selected.has(l.oppId));
    const ids = picked.map(l => l.id);
    if (ids.length === 0) {
      toast.warning('Nothing selected', 'Tick at least one row to bulk-assign');
      return;
    }
    const owners = new Set(picked.map(l => l.salespersonId));
    const shared = owners.size === 1 ? picked[0].salespersonId : null;
    setAssignModal({
      open: true,
      mode: 'selection',
      leadIds: ids,
      initialSalespersonId: shared,
      initialSalespersonName: shared ? picked[0].assigned : null,
    });
  };
  const onBulkCTQ       = async () => {
    if (ctqBusy) return;
    const ids = leads.filter(l => selected.has(l.oppId) && l.status === 'disqualified').map(l => l.id);
    if (ids.length === 0) {
      toast.warning('Nothing to convert', 'Select disqualified rows first');
      return;
    }
    setCtqBusy(true);
    try {
      const { data } = await api.post<{ status: boolean; converted: number }>(
        '/sales/leads/convert-to-qualified',
        { lead_ids: ids },
      );
      toast.success('Converted', `${data.converted} lead(s) moved to Qualified`);
      clearSelection();
      countSigRef.current = '';
      fetchLeads();
    } catch (e: any) {
      toast.error('Convert failed', e?.response?.data?.message ?? 'Could not convert leads');
    } finally {
      setCtqBusy(false);
    }
  };

  const onAskCTQ      = (l: Lead) => setCtqLead(l);
  const onConfirmCTQ  = async () => {
    if (!ctqLead || ctqBusy) return;
    setCtqBusy(true);
    try {
      await api.post('/sales/leads/convert-to-qualified', { lead_ids: [ctqLead.id] });
      toast.success('Converted', `${ctqLead.oppId} moved to Qualified`);
      setCtqLead(null);
      countSigRef.current = '';
      fetchLeads();
    } catch (e: any) {
      toast.error('Convert failed', e?.response?.data?.message ?? 'Could not convert lead');
    } finally {
      setCtqBusy(false);
    }
  };

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
          <button className="lwp-bact lwp-bact-primary" onClick={onAddLead}>
            <IconPlus />
            Add New Lead
          </button>
          {canDistribute && (
            <>
              <button className="lwp-bact lwp-bact-assign" onClick={onAssignLeads}>
                <IconUsers />
                Assign Leads
              </button>
              <button className="lwp-bact lwp-bact-assigned" onClick={onAssignedLeads}>
                <IconUserCheck />
                Lead Distribution
              </button>
            </>
          )}
          {syncCfg.enabled && canDistribute && (
            <button
              className={`lwp-bact lwp-bact-sync lwp-bact-icon-only ${syncing ? 'is-syncing' : ''}`}
              onClick={onSyncLeads}
              disabled={syncing}
              title={syncing ? 'Syncing…' : `Pull new leads from IndiaMart (${syncCfg.labels.join(', ') || 'configured keys'})`}
              aria-label={syncing ? 'Syncing leads' : 'Sync leads from IndiaMart'}
            >
              <IconSync />
            </button>
          )}
          <span className="lwp-banner-divider" />
          <button
            className={`lwp-bact lwp-bact-filter ${countFilterValues(activeFilters) > 0 ? 'lwp-bact-filter-active' : ''}`}
            title="Filter Leads"
            onClick={onFilter}
          >
            <IconFilter />
            Filter
            {countFilterValues(activeFilters) > 0 && (
              <span className="lwp-bact-badge">
                {countFilterValues(activeFilters)}
              </span>
            )}
          </button>

          <div className="lwp-export-wrap">
            <button
              ref={exportBtnRef}
              className={`lwp-bact lwp-bact-export ${exportOpen ? 'is-open' : ''}${exporting ? ' is-exporting' : ''}`}
              title="Export Leads"
              onClick={toggleExportMenu}
              disabled={!!exporting}
            >
              {exporting ? <IconSpinner /> : <IconDownload />}
              {exporting ? 'Exporting…' : 'Export Leads'}
              <IconChevron />
            </button>
            {exportOpen && exportPos && createPortal(
              <>
                <div className="lwp-export-backdrop" onClick={() => setExportOpen(false)} />
                <div className="lwp-export-menu" role="menu" style={{ top: exportPos.top, right: exportPos.right }}>
                  {(Object.keys(TAB_LABELS) as TabKey[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      role="menuitem"
                      className="lwp-export-item"
                      onClick={() => exportLeads(t)}
                      disabled={!!exporting}
                    >
                      <span>Export {TAB_LABELS[t]}</span>
                      <span className="lwp-export-count">{counts[t] ?? 0}</span>
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      </div>

      <div className="lwp-pre-table">
        <div className="dt-tabrail hr-dt flex-shrink-0" data-accent="teal">
          <div className="dt-tabs" role="tablist">
            {(Object.keys(TAB_LABELS) as TabKey[]).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`dt-tab ${tab === t ? 'on' : 'off'}`}
                onClick={() => switchTab(t)}
              >
                {TAB_LABELS[t]}
                {countsLoaded && <span className="dt-tab-count">{counts[t] ?? 0}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="lwp-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            name="worklist-search"
            data-lpignore="true"
            data-form-type="other"
            autoComplete="new-password"
            placeholder="Search anything — ID, name, phone, email, product, country…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <SearchClear show={q} onClear={() => setQ('')} />
        </div>
      </div>

      {tab === 'key_opportunity' && (
        <div className="dt-tabrail hr-dt lwp-subrail" data-accent="teal">
          <div className="dt-tabs" role="tablist">
            {(Object.keys(DEAL_STATE_LABELS) as DealState[]).map(st => (
              <button
                key={st}
                type="button"
                role="tab"
                aria-selected={dealState === st}
                className={`dt-tab ${dealState === st ? 'on' : 'off'}`}
                onClick={() => switchDealState(st)}
              >
                {DEAL_STATE_LABELS[st]}
                {countsLoaded && <span className="dt-tab-count">{counts[st === 'in_progress' ? 'key_in_progress' : 'key_won'] ?? 0}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {countFilterValues(activeFilters) > 0 && (
        <div className="lwp-chip-strip">
          <span className="lwp-chip-strip-label">Filters:</span>
          {renderFilterChips(activeFilters, filterOptions, salespersonNames).map(c => (
            <span key={c.id} className="lwp-chip">
              <span className="lwp-chip-key">{c.label}:</span>
              <span className="lwp-chip-val">{c.value}</span>
              <button
                className="lwp-chip-x"
                aria-label={`Clear ${c.label}`}
                onClick={() => {
                  setActiveFilters(prev => {
                    const next = { ...prev };
                    if (c.field === 'start_date') {
                      delete next.start_date; delete next.end_date;
                    } else if (c.rawValue !== undefined) {
                      const arr = ((next[c.field] as string[] | undefined) ?? [])
                        .filter(v => v !== c.rawValue);
                      if (arr.length) (next[c.field] as string[]) = arr;
                      else delete next[c.field];
                    } else {
                      delete next[c.field];
                    }
                    return next;
                  });
                  startNewQuery();
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="lwp-chip-clear-all"
            onClick={() => { setActiveFilters({}); startNewQuery(); }}
          >
            Clear all
          </button>
        </div>
      )}

      <div className="lwp-table-card">
        <div className="lwp-table-wrap" ref={wrapRef}>
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
                <th style={{ textAlign: 'left' }}>Opportunity ID</th>
                <th>Customer Name</th><th>Customer Number</th><th>Customer Email</th>
                <th>Product Name</th><th>Company</th><th>Country</th><th>Action</th>
              </tr>
            </thead>
            <tbody className={loading && rows.length > 0 ? 'lwp-tbody-refetching' : undefined}>
              {loading && rows.length === 0 && (
                Array.from({ length: Math.max(1, Math.min(rpp, 25)) }).map((_, i) => (
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
                    style={isChecked ? { background: 'rgba(8,145,178,.06)' } : undefined}
                  >
                    <td style={{ textAlign: 'center', paddingLeft: 14 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="lwp-chk"
                        checked={isChecked}
                        disabled={l.readOnly}
                        title={l.readOnly ? 'Transferred to another user — view only' : undefined}
                        onChange={() => { if (!l.readOnly) toggleRow(l.oppId); }}
                      />
                    </td>
                    <td style={{ color: '#64748b' }}>{l.type}</td>
                    <td style={{ color: '#64748b' }}>{l.date}</td>
                    <td style={{ color: '#64748b' }}>{l.source}</td>
                    <td>
                      <Tooltip label={l.assigned} disabled={ua || !l.assigned}>
                        <div className="lwp-asgn">
                          <div className={`lwp-av-xs ${ua ? 'u' : ''}`}>{initials(l.assigned)}</div>
                          <span className={ua ? 'u' : ''}>
                            {ua ? 'Unassigned' : l.assigned}
                          </span>
                        </div>
                      </Tooltip>
                    </td>
                    <td>
                      {(() => { const wa = waBadge(l.whatsappStatus); return (
                        <span className={`lwp-wa-badge ${wa.mod}`}><span className="lwp-wa-dot" />{wa.label}</span>
                      ); })()}
                    </td>
                    <td>
                      <span className="lwp-opp-cell">
                        <span
                          className="lwp-opp-link"
                          onClick={e => { e.stopPropagation(); onOpenOpp(l.oppId); }}
                        >{l.oppId}</span>
                        {l.keyOpportunity && (
                          <Tooltip label="Key Opportunity">
                            <svg className="lwp-key-star" viewBox="0 0 24 24" width="14" height="14"
                                 fill="currentColor" aria-label="Key Opportunity" role="img">
                              <path d="M12 2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.98 6.1 20.17l1.13-6.57L2.45 8.94l6.6-.96L12 2z" />
                            </svg>
                          </Tooltip>
                        )}
                        {l.readOnly && (
                          <Tooltip label="Transferred to another user — view only. You can still track its history & progress.">
                            <span className="lwp-viewonly" style={{ fontSize: 9, fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: '1px 6px', marginLeft: 4, whiteSpace: 'nowrap' }}>View only</span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td>
                      <Tooltip label={l.customer} disabled={!l.customer}>
                        <span className="lwp-cust-name">{l.customer}</span>
                      </Tooltip>
                    </td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>
                      <Tooltip label={l.phone} disabled={!l.phone || l.phone === '—'}>
                        <span>{l.phone}</span>
                      </Tooltip>
                    </td>
                    <td style={{ color: '#64748b', fontSize: 11.5 }}>
                      <Tooltip label={l.email} disabled={!l.email || l.email === '—'}>
                        <span>{l.email}</span>
                      </Tooltip>
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {l.product === '—' ? (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      ) : (
                        <Tooltip label={l.product}>
                          <span>{l.product}</span>
                        </Tooltip>
                      )}
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {l.company === '—' ? (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      ) : (
                        <Tooltip label={l.company}>
                          <span>{l.company}</span>
                        </Tooltip>
                      )}
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
                        <Tooltip label="Activity Tracker">
                          <button
                            className="lwp-ab lwp-ab-activity"
                            aria-label="Activity Tracker"
                            onClick={e => { e.stopPropagation(); onViewActivity(l); }}
                          >
                            <IconActivity />
                          </button>
                        </Tooltip>
                        {canAssign && canDistribute && !l.readOnly && (
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
                        {l.status === 'disqualified' && !l.readOnly && (
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

        <div className="lwp-pagination">
          <span className="lwp-pag-info">
            {loading
              ? <span className="lwp-skel lwp-skel-lg" aria-label="Loading" />
              : total === 0
                ? 'No leads found'
                : <>Showing <span className="lwp-hl">{startIdx + 1}–{Math.min(startIdx + rpp, total)}</span> of <span className="lwp-hl">{total}</span></>}
          </span>
          <div className="lwp-pag-right">
            <div className="lwp-rows-sel">
              Rows per page:
              <RowsPerPageSelect pageSize={rpp} options={ROWS_PER_PAGE_OPTIONS} onChange={changeRowsPerPage} />
            </div>
            <span className="lwp-pag-range">{safePage} / {pages}</span>
            <div className="lwp-page-nav">
              <button className="lwp-pg-btn" disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button className="lwp-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => goToPage(safePage + 1)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

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
            <button className="lwp-bulk-btn-ctq" onClick={onBulkCTQ} disabled={ctqBusy}>
              {ctqBusy ? <span className="lwp-ctq-spin" aria-hidden="true" /> : <IconCheck />}
              {ctqBusy ? 'Converting…' : 'Convert to Qualified'}
            </button>
          )}
          <button className="lwp-bulk-btn-clear" onClick={clearSelection}>
            <IconX />
            Clear
          </button>
        </div>
      )}

      {ctqLead && (
        <div className="lwp-ctq-overlay">
          <div className="lwp-ctq-modal">
            <div className="lwp-ctq-head">
              <div className="lwp-ctq-head-ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="lwp-ctq-head-text">
                <div className="lwp-ctq-head-title">Convert to Qualified</div>
                <div className="lwp-ctq-head-sub">Lead qualification confirmation</div>
              </div>
              <button className="lwp-ctq-close" onClick={() => setCtqLead(null)} disabled={ctqBusy} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="lwp-ctq-body">
              <div className="lwp-ctq-question">
                <div className="lwp-ctq-q-ico">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div className="lwp-ctq-q-text">
                  <div className="lwp-ctq-title">Convert this lead to Qualified?</div>
                  <div className="lwp-ctq-sub">
                    Lead <span className="lwp-ctq-opp">{ctqLead.oppId}</span> will be moved from
                    {' '}<span className="lwp-ctq-from">Disqualified</span> to
                    {' '}<span className="lwp-ctq-to">Qualified</span>. This action can be reversed.
                  </div>
                </div>
              </div>

              <div className="lwp-ctq-info">
                <div className="lwp-ctq-info-cell">
                  <div className="lwp-ctq-info-label">CUSTOMER</div>
                  <div className="lwp-ctq-info-val">{ctqLead.customer || '—'}</div>
                </div>
                <div className="lwp-ctq-info-cell">
                  <div className="lwp-ctq-info-label">LEAD SOURCE</div>
                  <div className="lwp-ctq-info-val lwp-ctq-info-val-accent">{ctqLead.source || '—'}</div>
                </div>
                <div className="lwp-ctq-info-cell">
                  <div className="lwp-ctq-info-label">PRODUCT</div>
                  <div className="lwp-ctq-info-val">{ctqLead.product === '—' ? '—' : ctqLead.product}</div>
                </div>
                <div className="lwp-ctq-info-cell">
                  <div className="lwp-ctq-info-label">LEAD DATE</div>
                  <div className="lwp-ctq-info-val">{ctqLead.date || '—'}</div>
                </div>
              </div>

              <div className="lwp-ctq-actions">
                <button className="lwp-ctq-btn-cancel" onClick={() => setCtqLead(null)} disabled={ctqBusy}>Cancel</button>
                <button className="lwp-ctq-btn-confirm" onClick={onConfirmCTQ} disabled={ctqBusy}>
                  {ctqBusy ? (
                    <span className="lwp-ctq-spin" aria-hidden="true" />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {ctqBusy ? 'Converting…' : 'Convert to Qualified'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        customerName={assignModal.customerName ?? null}
        oppCode={assignModal.oppCode ?? null}
        initialSalespersonId={assignModal.initialSalespersonId ?? null}
        initialSalespersonName={assignModal.initialSalespersonName ?? null}
        accountLabels={syncCfg.labels}
        onClose={() => setAssignModal(s => ({ ...s, open: false }))}
        onAssigned={() => { clearSelection(); fetchLeads(); }}
      />


      <LeadFilterModal
        open={filterOpen}
        initial={activeFilters}
        options={filterOptions}
        onClose={() => setFilterOpen(false)}
        onApply={(f) => { setActiveFilters(f); startNewQuery(); }}
      />

      <LeadDetailsModal
        open={viewLeadId !== null}
        leadId={viewLeadId}
        onClose={() => setViewLeadId(null)}
      />

      <LeadActivityModal
        open={activityLead !== null}
        leadId={activityLead?.id ?? null}
        oppCode={activityLead?.opp ?? null}
        onClose={() => setActivityLead(null)}
      />
    </div>
  );
}

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
const IconSync = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconDownload = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconSpinner = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
const IconChevron = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
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
const IconActivity = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
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

const SCOPED_CSS = `
.lwp-root {
  font-family: var(--font-sans);
  background: linear-gradient(160deg, #f0fdfe 0%, #e8fafb 30%, #f5feff 60%, #ffffff 100%);
  padding: 8px;
  margin: -8px;
  height: calc(100vh - 130px);
  overflow: hidden;
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

.lwp-root .lwp-banner {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  min-height: 58px; padding: 0 20px 0 13px; margin-bottom: 10px;
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
  z-index: 1; padding-left: 0;
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
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  box-sizing: border-box; height: 40px;
  padding: 0 18px; border-radius: 12px;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; white-space: nowrap; transition: all .22s;
  letter-spacing: .02em; min-height: 40px; border: none;
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
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(6,182,212,.40), 0 2px 6px rgba(14,116,144,.22), 0 1px 0 rgba(255,255,255,.18) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-sync:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.50), 0 3px 8px rgba(14,116,144,.28), 0 1px 0 rgba(255,255,255,.18) inset;
}

.lwp-root .lwp-bact-icon-only {
  padding: 0;
  width: 40px;
  flex: 0 0 40px;
  justify-content: center;
}
.lwp-root .lwp-bact-sync.is-syncing { cursor: progress; }
.lwp-root .lwp-bact-sync.is-syncing svg { animation: lwp-spin 1s linear infinite; }
.lwp-root .lwp-bact-export.is-exporting { cursor: progress; }
.lwp-root .lwp-bact-export.is-exporting svg:first-of-type { animation: lwp-spin 1s linear infinite; }
@keyframes lwp-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
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
  box-shadow: 0 0 0 2px #67e8f9, 0 6px 20px rgba(8,145,178,.4);
}
.lwp-root .lwp-bact-badge {
  background: rgba(255,255,255,.95); color: #0e7490;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 4px;
}

.lwp-root .lwp-export-wrap { position: relative; display: inline-flex; }
.lwp-root .lwp-bact-export {
  background: linear-gradient(135deg, #155e75 0%, #0e7490 55%, #0891b2 100%);
  color: #fff;
  box-shadow: 0 4px 16px rgba(21,94,117,.4), 0 2px 6px rgba(14,116,144,.22), 0 1px 0 rgba(255,255,255,.15) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
}
.lwp-root .lwp-bact-export:hover:not(:disabled) {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(21,94,117,.5), 0 3px 8px rgba(14,116,144,.28), 0 1px 0 rgba(255,255,255,.15) inset;
}
.lwp-root .lwp-bact-export:disabled { cursor: progress; opacity: .8; transform: none; }
.lwp-root .lwp-bact-export.is-open { transform: translateY(-1px); }
.lwp-export-backdrop { position: fixed; inset: 0; z-index: 4000; }
.lwp-export-menu {
  position: fixed; z-index: 4001;
  min-width: 230px; padding: 6px;
  background: #fff; border: 1px solid #cffafe; border-radius: 12px;
  box-shadow: 0 16px 40px rgba(8,47,73,.22), 0 4px 12px rgba(14,116,144,.14);
  animation: lwpExportIn .16s ease both;
  font-family: var(--font-sans);
}
@keyframes lwpExportIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.lwp-export-item {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border: none; background: transparent; border-radius: 8px;
  font-family: inherit; font-size: 12px; font-weight: 500; color: #334155;
  cursor: pointer; text-align: left; transition: background .15s, color .15s;
}
.lwp-export-item:hover:not(:disabled) { background: #ecfeff; color: #0e7490; }
.lwp-export-item:disabled { cursor: progress; opacity: .6; }
.lwp-export-count {
  min-width: 22px; height: 18px; padding: 0 6px;
  background: #f1f5f9; color: #475569;
  border-radius: 999px; font-size: 10px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.lwp-export-item:hover:not(:disabled) .lwp-export-count { background: #cffafe; color: #0e7490; }
[data-bs-theme="dark"] .lwp-export-menu { background: #0f2233; border-color: rgba(8,145,178,.35); }
[data-bs-theme="dark"] .lwp-export-item { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-export-item:hover:not(:disabled) { background: rgba(8,145,178,.18); color: #67e8f9; }
[data-bs-theme="dark"] .lwp-export-count { background: rgba(148,163,184,.2); color: #cbd5e1; }

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

.lwp-root,
.lwp-root .dt-tabrail.dt-tabrail {
  --dt-a-50:#f0fdfa; --dt-a-100:#ccfbf1; --dt-a-150:#cffafe; --dt-a-200:#a5e8f5;
  --dt-a-300:#67e8f9; --dt-a-400:#22d3ee; --dt-a-500:#06b6d4; --dt-a-600:#0891b2;
  --dt-a-700:#0e7490; --dt-a-800:#155e75; --dt-a-rgb: 8, 145, 178;
}
.lwp-root .lwp-pre-table {
  display: flex; align-items: stretch; gap: 14px;
  margin-bottom: 8px; flex-shrink: 0;
}
.lwp-root .lwp-pre-table .dt-tabrail .dt-tab { height: 40px; font-size: 12.5px; }
.lwp-root .lwp-pre-table .dt-tabrail .dt-tab svg { flex-shrink: 0; }
.lwp-root .lwp-subrail { align-self: flex-start; margin-bottom: 8px; flex-shrink: 0; max-width: 100%; overflow-x: auto; }
.lwp-root .lwp-subrail .dt-tab { height: 40px; font-size: 12.5px; }
.lwp-root .lwp-subrail .dt-tab svg { flex-shrink: 0; }
.lwp-root .lwp-search {
  --ui-search-clear: #0891b2;
  --ui-search-clear-dark: #67e8f9;
  display: flex; align-items: center;
  background: #ffffff;
  border: 1.5px solid #a5f3fc;
  box-sizing: border-box;
  border-radius: 12px; padding: 0 18px; gap: 10px;
  flex: 1 1 auto; min-width: 240px; max-width: none; height: auto; min-height: 48px;
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
.lwp-root .lwp-search.lwp-search {
  position: relative;
  padding: 0 16px;
  border: 0;
  background: transparent;
  border-radius: 12px;
  box-shadow: none;
}
.lwp-root .lwp-search.lwp-search::before {
  content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #d6f9fd;
  transition: border-color .16s, box-shadow .16s;
}
.lwp-root .lwp-search.lwp-search > * { position: relative; z-index: 1; }
.lwp-root .lwp-search.lwp-search:focus-within { border: 0; box-shadow: none; }
.lwp-root .lwp-search.lwp-search:focus-within::before { border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
[data-bs-theme="dark"] .lwp-root .lwp-search.lwp-search { background: transparent; border: 0; box-shadow: none; }
[data-bs-theme="dark"] .lwp-root .lwp-search.lwp-search::before { background: rgba(255,255,255,.03); border-color: rgba(8,145,178,.25); }
[data-bs-theme="dark"] .lwp-root .lwp-search.lwp-search:focus-within::before { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.28); }

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
  scrollbar-color: #a5f3fc transparent;
}
.lwp-root .lwp-table-wrap::-webkit-scrollbar { width: 9px; height: 9px; }
.lwp-root .lwp-table-wrap::-webkit-scrollbar-track { background: transparent; }
.lwp-root .lwp-table-wrap::-webkit-scrollbar-thumb {
  background: #a5f3fc; border-radius: 8px;
  border: 2px solid transparent; background-clip: content-box;
}
.lwp-root .lwp-table-wrap::-webkit-scrollbar-thumb:hover { background: #67e8f9; background-clip: content-box; }
[data-bs-theme="dark"] .lwp-root .lwp-table-wrap { scrollbar-color: rgba(34,211,238,.4) transparent; }
[data-bs-theme="dark"] .lwp-root .lwp-table-wrap::-webkit-scrollbar-thumb { background: rgba(34,211,238,.4); background-clip: content-box; }
.lwp-root .lwp-table { width: 100%; min-width: 1564px; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
.lwp-root .lwp-table col.c-chk    { width: 42px; }
.lwp-root .lwp-table col.c-type   { width: 110px; }
.lwp-root .lwp-table col.c-date   { width: 88px; }
.lwp-root .lwp-table col.c-source { width: 86px; }
.lwp-root .lwp-table col.c-assign { width: 130px; }
.lwp-root .lwp-table col.c-wa     { width: 124px; }
.lwp-root .lwp-table col.c-opp    { width: 160px; }
.lwp-root .lwp-table col.c-cust   { width: 140px; }
.lwp-root .lwp-table col.c-phone  { width: 118px; }
.lwp-root .lwp-table col.c-email  { width: 160px; }
.lwp-root .lwp-table col.c-prod   { width: 120px; }
.lwp-root .lwp-table col.c-company{ width: 100px; }
.lwp-root .lwp-table col.c-country{ width: 56px; }
.lwp-root .lwp-table col.c-action { width: 130px; }

.lwp-root .lwp-table thead {
  position: sticky; top: 0; z-index: 5;
}
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
  vertical-align: middle;
}
.lwp-root .lwp-table:has(.lwp-empty) { height: 100%; }
.lwp-root .lwp-table:has(.lwp-empty) tbody tr:has(.lwp-empty) { height: 100%; background: transparent; border-bottom: 0; }

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
  accent-color: #0891b2; cursor: pointer; border-radius: 4px;
}

.lwp-root .lwp-opp-cell { display: flex; align-items: center; justify-content: flex-start; gap: 5px; width: 100%; }
.lwp-root .lwp-opp-link {
  color: #0891b2; font-weight: 600; cursor: pointer; white-space: nowrap;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.lwp-root .lwp-viewonly { flex: 0 0 auto; }
.lwp-root .lwp-opp-link:hover { text-decoration: underline; color: #0e7490; }
.lwp-root .lwp-key-star { color: #f59e0b; flex: 0 0 auto; }
.lwp-root .lwp-cust-name { font-weight: 600; color: #0f172a; }
.lwp-root .lwp-wa-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: 20px; font-size: 10px; font-weight: 600;
  background: #fef3c7; color: #92400e;
}
.lwp-root .lwp-wa-yes     { background: #dcfce7; color: #15803d; }
.lwp-root .lwp-wa-no      { background: #fee2e2; color: #b91c1c; }
.lwp-root .lwp-wa-pending { background: #fef3c7; color: #92400e; }
.lwp-root .lwp-wa-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity:.8; flex-shrink:0; }
.lwp-root .lwp-asgn { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.lwp-root .lwp-asgn span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px;
  color: #1e293b; font-weight: 500;
}
.lwp-root .lwp-asgn span.u { color: #94a3b8; font-weight: 400; }
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
.lwp-root .lwp-ab-activity {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  color: #fff; box-shadow: 0 2px 6px rgba(2,132,199,.35);
}
.lwp-root .lwp-ab-activity:hover {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(2,132,199,.5);
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
.lwp-root .lwp-rows-sel { --tcwl-accent: #0891b2; --tcwl-text: #0e7490; --tcwl-border: #a5f3fc; --tcwl-band: #ecfeff; }
.lwp-root .lwp-rows-sel .tc-wl-rows-btn { color: #0891b2; }
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel .tc-wl-rows-btn { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel .tc-wl-rows-menu { background: #0c1f2e; border-color: rgba(34, 211, 238, .35); }
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel .tc-wl-rows-menu button { color: #a5f3fc; }
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel .tc-wl-rows-menu button:hover { background: rgba(34, 211, 238, .16); color: #fff; }
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel .tc-wl-rows-menu button.is-on { background: #0891b2; color: #fff; }
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

.lwp-root .lwp-bulk-bar {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  z-index: 8900;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(8,145,178,.45), 0 4px 14px rgba(0,0,0,.18);
  padding: 12px 20px;
  display: flex; align-items: center; gap: 14px; white-space: nowrap;
  font-family: var(--font-sans);
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
  padding: 8px 18px; background: #fff; color: #0e7490;
  border: none; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
}
.lwp-root .lwp-bulk-btn-primary:hover { background: #ecfeff; }
.lwp-root .lwp-bulk-btn-ctq {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: #fef3c7; color: #b45309;
  border: 1.5px solid #fde68a; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 2px 8px rgba(0,0,0,.10);
}
.lwp-root .lwp-bulk-btn-ctq:hover:not(:disabled) { background: #fde68a; }
.lwp-root .lwp-bulk-btn-clear {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px; background: rgba(255,255,255,.14); color: #fff;
  border: 1.5px solid rgba(255,255,255,.25); border-radius: 10px;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.lwp-root .lwp-bulk-btn-clear:hover { background: rgba(255,255,255,.22); }

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
  border-radius: 16px; width: min(94vw, 520px);
  box-shadow: 0 24px 60px rgba(8,145,178,.28), 0 8px 24px rgba(0,0,0,.18);
  overflow: hidden;
  font-family: var(--font-sans);
  animation: lwpCtqIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpCtqIn {
  from { opacity: 0; transform: scale(.95) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.lwp-ctq-head {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 18px 22px;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
}
.lwp-ctq-head-ico {
  width: 44px; height: 44px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.lwp-ctq-head-text { flex: 1; min-width: 0; }
.lwp-ctq-head-title {
  font-size: 17px; font-weight: 700; letter-spacing: -.2px;
  color: #fff; line-height: 1.2;
}
.lwp-ctq-head-sub {
  font-size: 12px; color: rgba(255,255,255,.82);
  margin-top: 2px; letter-spacing: .1px;
}
.lwp-ctq-close {
  width: 32px; height: 32px; border-radius: 9px; border: none;
  background: rgba(255,255,255,.16); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.lwp-ctq-close:hover:not(:disabled) { background: rgba(255,255,255,.28); }

.lwp-ctq-body { padding: 22px 24px 20px; }

.lwp-ctq-question {
  display: flex; align-items: flex-start; gap: 14px;
  margin-bottom: 18px;
}
.lwp-ctq-q-ico {
  width: 42px; height: 42px; border-radius: 11px; flex-shrink: 0;
  background: #ecfeff; border: 1px solid #a5f3fc; color: #0891b2;
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-q-text { flex: 1; min-width: 0; }
.lwp-ctq-title {
  font-size: 16px; font-weight: 700; color: #0f172a;
  letter-spacing: -.2px; margin-bottom: 6px;
}
.lwp-ctq-sub {
  font-size: 12.5px; color: #475569; line-height: 1.55;
}
.lwp-ctq-opp {
  font-weight: 700; color: #0891b2;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
.lwp-ctq-from { color: #dc2626; font-weight: 600; }
.lwp-ctq-to   { color: #15803d; font-weight: 600; }

.lwp-ctq-info {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 14px 22px;
  background: linear-gradient(135deg, #f0fdfe, #ecfeff);
  border: 1px solid #a5f3fc; border-radius: 12px;
  padding: 16px 18px; margin-bottom: 20px;
}
.lwp-ctq-info-cell { min-width: 0; }
.lwp-ctq-info-label {
  font-size: 10px; font-weight: 700;
  color: #64748b; letter-spacing: .14em; text-transform: uppercase;
  margin-bottom: 4px;
}
.lwp-ctq-info-val {
  font-size: 13px; font-weight: 600; color: #0f172a;
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lwp-ctq-info-val-accent { color: #0891b2; }

.lwp-ctq-actions {
  display: flex; gap: 10px; justify-content: flex-end;
}
.lwp-ctq-btn-cancel {
  padding: 10px 22px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.lwp-ctq-btn-cancel:hover:not(:disabled) { border-color: #94a3b8; background: #f8fafc; }
.lwp-ctq-btn-confirm {
  padding: 10px 22px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(8,145,178,.35);
  transition: all .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.lwp-ctq-btn-confirm:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
.lwp-ctq-btn-confirm:active:not(:disabled) { transform: translateY(0); }

.lwp-root .lwp-ctq-spin,
.lwp-ctq-spin {
  width: 13px; height: 13px; flex-shrink: 0;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: lwp-spin .7s linear infinite;
}
.lwp-root .lwp-bulk-btn-ctq .lwp-ctq-spin {
  border-color: rgba(180,83,9,.30); border-top-color: #b45309;
}
.lwp-ctq-btn-confirm:disabled,
.lwp-ctq-btn-cancel:disabled,
.lwp-root .lwp-bulk-btn-ctq:disabled {
  opacity: .70; cursor: not-allowed; transform: none;
}
.lwp-ctq-close:disabled { opacity: .45; cursor: not-allowed; }

[data-bs-theme="dark"] .lwp-root .lwp-ctq-modal { background: #0f172a; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-title { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-sub { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-q-ico {
  background: rgba(8,145,178,.18); border-color: rgba(6,182,212,.35); color: #67e8f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-opp { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-info {
  background: rgba(8,145,178,.10);
  border-color: rgba(6,182,212,.25);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-info-label { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-info-val { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-info-val-accent { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel {
  background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.14); color: #cbd5e1;
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel:hover {
  background: rgba(255,255,255,.08); border-color: rgba(103,232,249,.4); color: #ecfeff;
}

[data-bs-theme="dark"] .lwp-root,
[data-layout-mode="dark"] .lwp-root {
  background:
    radial-gradient(ellipse at top, rgba(8,145,178,.12), transparent 55%),
    linear-gradient(160deg, #0b1220 0%, #0f172a 40%, #0b1220 100%);
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
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity {
  background: rgba(34, 211, 238, 0.14);
  border-color: rgba(103, 232, 249, 0.45);
}
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity::before { background: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity > span { color: #cffafe; }
[data-bs-theme="dark"] .lwp-root .lwp-banner-divider { background: rgba(148,163,184,0.25); }
[data-bs-theme="dark"] .lwp-root .lwp-banner-sheen {
  background: linear-gradient(180deg, rgba(255,255,255,.05), transparent);
}
[data-bs-theme="dark"] .lwp-root .lwp-banner-glow {
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(34,211,238,.10) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(14,165,233,.08) 0%, transparent 55%);
}

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

[data-bs-theme="dark"] .lwp-root .lwp-pagination {
  background: linear-gradient(90deg, #0f172a 0%, #111c33 50%, #0f172a 100%);
  border: 1px solid rgba(34, 211, 238, 0.18);
  border-top: 2px solid rgba(34, 211, 238, 0.28);
  box-shadow: 0 4px 18px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-pag-info,
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(34, 211, 238, 0.20);
  color: #cffafe;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
[data-bs-theme="dark"] .lwp-root .lwp-pag-info .lwp-hl,
[data-bs-theme="dark"] .lwp-root .lwp-pg-btn {
  background: rgba(15, 23, 42, 0.55);
  border-color: rgba(34, 211, 238, 0.22);
  color: #67e8f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-pg-btn:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.16);
  border-color: rgba(103, 232, 249, 0.55);
}

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

.lwp-root .lwp-bact-assign,
.lwp-root .lwp-bact-assigned,
.lwp-root .lwp-bact-sync,
.lwp-root .lwp-bact-filter,
.lwp-root .lwp-bact-export,
[data-bs-theme="dark"] .lwp-root .lwp-bact-assign,
[data-bs-theme="dark"] .lwp-root .lwp-bact-assigned,
[data-bs-theme="dark"] .lwp-root .lwp-bact-sync,
[data-bs-theme="dark"] .lwp-root .lwp-bact-filter,
[data-bs-theme="dark"] .lwp-root .lwp-bact-export {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
  animation: none;
}
.lwp-root .lwp-bact-assign:hover,
.lwp-root .lwp-bact-assigned:hover,
.lwp-root .lwp-bact-sync:hover,
.lwp-root .lwp-bact-filter:hover,
.lwp-root .lwp-bact-export:hover,
[data-bs-theme="dark"] .lwp-root .lwp-bact-assign:hover,
[data-bs-theme="dark"] .lwp-root .lwp-bact-assigned:hover,
[data-bs-theme="dark"] .lwp-root .lwp-bact-sync:hover,
[data-bs-theme="dark"] .lwp-root .lwp-bact-filter:hover,
[data-bs-theme="dark"] .lwp-root .lwp-bact-export:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.55), 0 3px 8px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.22) inset;
}
.lwp-root .lwp-bact-filter-active,
[data-bs-theme="dark"] .lwp-root .lwp-bact-filter-active {
  box-shadow: 0 0 0 2px #67e8f9, 0 6px 20px rgba(6,182,212,.45);
}
[data-bs-theme="dark"] .lwp-root .lwp-tab { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-tab.on {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff;
}

[data-bs-theme="dark"] .lwp-root .lwp-search {
  background: #1e293b; border-color: #334155;
  box-shadow: 0 2px 10px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.05) inset;
}
[data-bs-theme="dark"] .lwp-root .lwp-search:focus-within {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8,145,178,.28), 0 4px 16px rgba(0,0,0,.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-banner {
  box-shadow: 0 2px 0 rgba(255,255,255,.04) inset, 0 4px 16px rgba(0,0,0,.35), 0 1px 4px rgba(0,0,0,.25);
}
[data-bs-theme="dark"] .lwp-root .lwp-pag-info,
[data-bs-theme="dark"] .lwp-root .lwp-rows-sel {
  box-shadow: 0 1px 4px rgba(0,0,0,.3), 0 1px 0 rgba(255,255,255,.05) inset;
}
[data-bs-theme="dark"] .lwp-root .lwp-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-search input::placeholder { color: #64748b; }

[data-bs-theme="dark"] .lwp-root .lwp-table-card {
  background: #0f172a;
  border-color: rgba(6,182,212,0.18);
  box-shadow: 0 4px 20px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-table-wrap {
  background: #0f172a;
  border-color: rgba(6,182,212,0.18);
  box-shadow: 0 4px 18px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .lwp-root .lwp-table thead th {
  background: rgba(8,145,178,.18) !important;
  color: #cffafe !important;
  border-bottom-color: rgba(6,182,212,0.30) !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody td {
  background: transparent !important;
  color: #cbd5e1 !important;
  border-top-color: rgba(6,182,212, 0.10) !important;
  border-bottom: none !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr {
  border-bottom: 1px solid rgba(6,182,212,0.10) !important;
  background: transparent !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:last-child {
  border-bottom: none !important;
}
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:nth-child(even) td { background: rgba(8,145,178,.06) !important; }
[data-bs-theme="dark"] .lwp-root .lwp-table tbody tr:hover td { background: rgba(8,145,178,.16) !important; }
[data-bs-theme="dark"] .lwp-root .lwp-table a { color: #67e8f9; }

[data-bs-theme="dark"] .lwp-root .lwp-cust-name { color: #f1f5f9; font-weight: 600; }
[data-bs-theme="dark"] .lwp-root .lwp-asgn span { color: #e2e8f0; }
[data-bs-theme="dark"] .lwp-root .lwp-asgn span.u { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-av-xs.u   { background: #1e293b; color: #64748b; }
[data-bs-theme="dark"] .lwp-root .lwp-opp-link  { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-opp-link:hover { color: #a5f3fc; }

[data-bs-theme="dark"] .lwp-root .lwp-ctag {
  background: rgba(14, 165, 233, 0.16) !important;
  color: #7dd3fc !important;
  border: 1px solid rgba(34, 211, 238, 0.35) !important;
  box-shadow: none !important;
  font-weight: 600 !important;
  letter-spacing: 0.04em !important;
}

[data-bs-theme="dark"] .lwp-root .lwp-wa-badge {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}
[data-bs-theme="dark"] .lwp-root .lwp-wa-yes { background: rgba(34, 197, 94, 0.18); color: #86efac; }
[data-bs-theme="dark"] .lwp-root .lwp-wa-no  { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
[data-bs-theme="dark"] .lwp-root .lwp-wa-pending { background: rgba(245, 158, 11, 0.16); color: #fbbf24; }
[data-bs-theme="dark"] .lwp-root .lwp-ab {
  background: rgba(15, 23, 42, 0.65);
  border-color: rgba(148, 163, 184, 0.30);
  color: #cbd5e1;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab:hover { background: rgba(8, 145, 178, 0.25); color: #f0f9ff; }
[data-bs-theme="dark"] .lwp-root .lwp-ab-view {
  background: linear-gradient(135deg, rgba(6,182,212,.22), rgba(8,145,178,.22));
  color: #67e8f9; border: 1px solid rgba(34,211,238,.40); box-shadow: none;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-view:hover {
  background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff;
  box-shadow: 0 3px 10px rgba(6,182,212,.4);
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-activity {
  background: linear-gradient(135deg, rgba(2,132,199,.24), rgba(3,105,161,.24));
  color: #7dd3fc; border: 1px solid rgba(56,189,248,.40); box-shadow: none;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-activity:hover {
  background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff;
  box-shadow: 0 3px 10px rgba(2,132,199,.4);
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-assign {
  background: linear-gradient(135deg, rgba(14,116,144,.30), rgba(21,94,117,.30));
  color: #67e8f9; border: 1px solid rgba(34,211,238,.40); box-shadow: none;
}
[data-bs-theme="dark"] .lwp-root .lwp-ab-assign:hover {
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
  box-shadow: 0 3px 10px rgba(14,116,144,.4);
}

[data-bs-theme="dark"] .lwp-root .lwp-no-access {
  background: #0f172a; border-color: rgba(34,211,238,0.25); color: #e2e8f0;
}
[data-bs-theme="dark"] .lwp-root .lwp-no-access-title { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-no-access-sub   { color: #94a3b8; }
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
[data-bs-theme="dark"] .lwp-root .lwp-ctq-opp {
  background: rgba(34, 211, 238, 0.16);
  color: #67e8f9;
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel {
  background: transparent; color: #cbd5e1; border-color: rgba(34, 211, 238, 0.22);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel:hover {
  background: rgba(15, 23, 42, 0.55); border-color: rgba(34, 211, 238, 0.45);
}
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-confirm {
  box-shadow: 0 4px 16px rgba(34, 197, 94, 0.45);
}


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
  .lwp-root .lwp-search { flex: 0 0 auto; width: 100%; max-width: none; height: 48px; }
  .lwp-root .lwp-pre-table .dt-tabrail { max-width: 100%; overflow-x: auto; }
}

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
  .lwp-root .lwp-chip-strip { gap: 4px; }
  .lwp-root .lwp-chip { font-size: 10.5px; padding: 2px 4px 2px 8px; }
  .lwp-root .lwp-pagination { padding: 8px 12px; gap: 6px; }
  .lwp-root .lwp-pag-info, .lwp-root .lwp-rows-sel { font-size: 11px; padding: 4px 10px; }
  .lwp-root .lwp-bulk-bar {
    left: 8px; right: 8px; bottom: 10px;
    transform: none; width: auto;
    padding: 10px 12px; gap: 8px; flex-wrap: wrap;
    border-radius: 14px;
  }
  .lwp-root .lwp-bulk-bar > * { flex: 1 1 auto; }
  .lwp-root .lwp-bulk-divider  { display: none; }
}

@media (max-width: 480px) {
  .lwp-root .lwp-banner { border-radius: 12px; padding: 12px 14px; }
  .lwp-root .lwp-actions { grid-template-columns: 1fr; }
  .lwp-root .lwp-table-card { border-radius: 10px; }
  .lwp-root .lwp-table { font-size: 11px; }
  .lwp-root .lwp-table thead th, .lwp-root .lwp-table tbody td { padding: 0 6px; }
  .lwp-root .lwp-pag-range { font-size: 11px; }
  .lwp-root .lwp-ctq-modal { border-radius: 16px; }
  .lwp-root .lwp-ctq-body { padding: 0 18px 20px; }
  .lwp-root .lwp-ctq-title { font-size: 15.5px; }
  .lwp-root .lwp-ctq-actions { flex-direction: column-reverse; }
  .lwp-root .lwp-ctq-btn-cancel,
  .lwp-root .lwp-ctq-btn-confirm { max-width: none; width: 100%; flex: none; }
}
`;
