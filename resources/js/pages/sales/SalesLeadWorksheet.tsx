import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';
import AddNewLeadModal, { type LeadFormValues } from './AddNewLeadModal';

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
  type: string;
  date: string;
  source: string;
  assigned: string;       // 'Unassigned' or a person's name
  oppId: string;          // OPP-001
  customer: string;
  phone: string;
  email: string;
  product: string;        // '—' for empty
  company: string;        // '—' for empty
  country: string;        // ISO-2 code
  status: LeadStatus;
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

/* Convert a server lead row to the table's display shape. The columns
 * use placeholder dashes for absent values to match the existing styling
 * (the in-page '—' tests check string equality). */
const mapServerToLead = (r: ServerLead): Lead => {
  const dateSrc = r.query_time ?? r.created_at;
  const date = dateSrc
    ? new Date(dateSrc).toLocaleDateString('en-GB') // DD/MM/YYYY
    : '—';
  return {
    type:     r.query_type || 'Manual',
    date,
    source:   r.platform || '—',
    assigned: r.salesperson?.name ?? 'Unassigned',
    oppId:    r.opp_code,
    customer: r.sender_name || '—',
    phone:    r.sender_mobile || '—',
    email:    r.sender_email || '—',
    product:  r.query_product_name || '—',
    company:  r.sender_company || '—',
    country:  r.sender_country_iso || '—',
    status:   r.disqualified ? 'disqualified' : 'qualified',
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

  // Fetch leads from the API whenever tab / search / pagination changes.
  const fetchLeads = useCallback(async () => {
    const countSig = `${tab}|${debouncedQ}|${rpp}`;
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
  }, [tab, debouncedQ, page, rpp, toast]);

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

  /* ── Stub action handlers (toast-only until real flows ship) ── */
  const stubToast = (msg: string) => toast.info('Coming next', msg);

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
      fetchLeads();
    } catch (e: any) {
      toast.error('Sync failed', e?.response?.data?.message ?? 'IndiaMart sync request failed');
    } finally {
      setSyncing(false);
    }
  };
  const onAssignLeads   = () => stubToast('Assign Leads — opens the Assign Leads modal');
  const onLeadDistr     = () => stubToast('Lead Distribution page — coming next');
  const onFilter        = () => stubToast('Filter modal — coming next');
  // Opens the Sales Matrix detail page (Stage 1) for this opportunity.
  // The clicked row travels in router state so the detail page can render
  // the customer header without a second fetch.
  const openMatrixDetail = (l: Lead) => {
    navigate(`/sales/matrix/${l.oppId}/stage/1`, {
      state: {
        row: {
          oppId:        l.oppId,
          customer:     l.customer,
          customerCode: `C-${l.oppId.replace(/^OPP-/, '')}`,
          date:         l.date,
          country:      l.country,
        },
      },
    });
  };

  const onViewLead      = (l: Lead) => openMatrixDetail(l);
  const onAssignOne     = (l: Lead) => stubToast(`Assign lead ${l.oppId} to a salesperson`);
  const onOpenLead      = (l: Lead) => openMatrixDetail(l);
  const onOpenOpp       = (oppId: string) => {
    // Find the lead in the current page; the table is server-paginated so
    // anything outside the current page won't be in `leads`. The matrix
    // detail page falls back to a server fetch when state is missing.
    const lead = leads.find(l => l.oppId === oppId);
    if (lead) openMatrixDetail(lead);
    else navigate(`/sales/matrix/${oppId}/stage/1`);
  };
  const onBulkAssign    = () => stubToast(`Bulk-assign ${selected.size} leads`);
  const onBulkCTQ       = () => stubToast(`Bulk-convert ${selected.size} leads to Qualified`);

  // CTQ for disqualified — opens confirmation, then "converts" (toast).
  const onAskCTQ      = (l: Lead) => setCtqLead(l);
  const onConfirmCTQ  = () => {
    if (!ctqLead) return;
    toast.success('Converted', `${ctqLead.oppId} would be moved to Qualified`);
    setCtqLead(null);
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
          <button className="lwp-bact lwp-bact-assigned" onClick={onLeadDistr}>
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
          <button className="lwp-bact lwp-bact-filter" title="Filter Leads" onClick={onFilter}>
            <IconFilter />
            Filter
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
            placeholder="Search ID / Product / Assignee…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
      </div>

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
            <div className="lwp-ctq-header">
              <span className="lwp-ctq-header-glow" />
              <div className="lwp-ctq-header-left">
                <div className="lwp-ctq-header-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div className="lwp-ctq-header-title">Convert to Qualified</div>
                  <div className="lwp-ctq-header-sub">Lead qualification confirmation</div>
                </div>
              </div>
              <button className="lwp-ctq-close" onClick={() => setCtqLead(null)}>
                <IconX />
              </button>
            </div>
            <div className="lwp-ctq-body">
              <div className="lwp-ctq-row">
                <div className="lwp-ctq-row-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <div className="lwp-ctq-row-title">Convert this lead to Qualified?</div>
                  <div className="lwp-ctq-row-sub">
                    Lead <span className="lwp-ctq-opp">{ctqLead.oppId}</span> will be moved from{' '}
                    <span style={{ color: '#e11d48', fontWeight: 600 }}>Disqualified</span> to{' '}
                    <span style={{ color: '#059669', fontWeight: 600 }}>Qualified</span>. This action can be reversed.
                  </div>
                </div>
              </div>
              <div className="lwp-ctq-lead-info">
                <strong>{ctqLead.customer}</strong> · {ctqLead.product === '—' ? 'No product specified' : ctqLead.product} · {ctqLead.country}
              </div>
              <div className="lwp-ctq-actions">
                <button className="lwp-ctq-btn-cancel" onClick={() => setCtqLead(null)}>Cancel</button>
                <button className="lwp-ctq-btn-confirm" onClick={onConfirmCTQ}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 5, verticalAlign: 'middle' }}>
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
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 20px; border-radius: 12px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; white-space: nowrap; transition: all .22s;
  letter-spacing: .02em; min-height: 42px; border: none;
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

/* ─── Pre-table: pills + search ─── */
.lwp-root .lwp-pre-table {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px; flex-shrink: 0;
}
.lwp-root .lwp-pills {
  display: flex; align-items: center; gap: 4px;
  background: linear-gradient(110deg, #ecfeff 0%, #cffafe 50%, #a5f3fc 100%);
  padding: 5px; border-radius: 14px;
  border: 1.5px solid #a5f3fc;
  box-shadow: 0 2px 10px rgba(8,145,178,.12), 0 1px 0 rgba(255,255,255,.9) inset;
  min-height: 50px;
}
.lwp-root .lwp-pill {
  padding: 9px 20px; border-radius: 10px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  background: transparent; color: #0e7490;
  border: none; transition: all .18s; white-space: nowrap;
  min-height: 40px; display: inline-flex; align-items: center; gap: 6px;
}
.lwp-root .lwp-pill:hover { color: #0891b2; background: rgba(255,255,255,.6); }
.lwp-root .lwp-pill.active {
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  border-radius: 10px;
}
.lwp-root .lwp-search {
  display: flex; align-items: center;
  background: #ffffff;
  border: 1.5px solid #a5f3fc;
  border-radius: 14px; padding: 0 18px; gap: 10px;
  width: 380px; max-width: 100%; height: 50px;
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
  background: rgba(15,23,42,.45);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-modal {
  background: #fff; border-radius: 18px; width: min(92vw, 440px);
  box-shadow: 0 24px 60px rgba(8,145,178,.2), 0 8px 24px rgba(0,0,0,.1);
  overflow: hidden;
  font-family: 'DM Sans', 'Inter', sans-serif;
  animation: lwpCtqIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lwpCtqIn {
  from { opacity: 0; transform: scale(.93) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
.lwp-ctq-header {
  background: linear-gradient(135deg, #0891b2, #0e7490, #155e75);
  padding: 18px 22px;
  display: flex; align-items: center; justify-content: space-between;
  position: relative; overflow: hidden;
}
.lwp-ctq-header-glow {
  position: absolute; right: -20px; top: -20px;
  width: 90px; height: 90px; border-radius: 50%;
  background: rgba(255,255,255,.07); pointer-events: none;
}
.lwp-ctq-header-left {
  display: flex; align-items: center; gap: 12px; z-index: 1;
}
.lwp-ctq-header-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,.2);
  border: 1px solid rgba(255,255,255,.3);
  display: flex; align-items: center; justify-content: center;
}
.lwp-ctq-header-title {
  font-size: 14px; font-weight: 800; color: #fff; letter-spacing: -.2px;
}
.lwp-ctq-header-sub {
  font-size: 10.5px; color: rgba(255,255,255,.7); margin-top: 2px;
}
.lwp-ctq-close {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.18); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center; z-index: 1;
}
.lwp-ctq-body { padding: 24px 22px; }
.lwp-ctq-row {
  display: flex; align-items: flex-start; gap: 14px; margin-bottom: 20px;
}
.lwp-ctq-row-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #ecfeff, #cffafe);
  border: 1.5px solid #a5f3fc;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lwp-ctq-row-title {
  font-size: 13.5px; font-weight: 700; color: #0f172a; margin-bottom: 6px;
}
.lwp-ctq-row-sub {
  font-size: 12px; color: #64748b; line-height: 1.6;
}
.lwp-ctq-opp {
  font-weight: 700; color: #0891b2; font-family: 'JetBrains Mono', monospace;
}
.lwp-ctq-lead-info {
  background: linear-gradient(110deg, #f0fdfe, #ecfeff);
  border: 1px solid #a5f3fc; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 20px;
  font-size: 12px; color: #0e7490;
}
.lwp-ctq-actions {
  display: flex; gap: 10px; justify-content: flex-end;
}
.lwp-ctq-btn-cancel {
  padding: 10px 22px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #64748b; font-family: inherit;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.lwp-ctq-btn-cancel:hover { border-color: #94a3b8; }
.lwp-ctq-btn-confirm {
  padding: 10px 24px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; font-family: inherit;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 3px 12px rgba(8,145,178,.4);
  transition: all .15s;
}
.lwp-ctq-btn-confirm:hover { transform: translateY(-1px); }

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
[data-bs-theme="dark"] .lwp-root .lwp-banner-entity > span { color: #67e8f9; }
[data-bs-theme="dark"] .lwp-root .lwp-banner-divider { background: rgba(148,163,184,0.25); }

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
[data-bs-theme="dark"] .lwp-root .lwp-ctq-title { color: #f0f9ff; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .lwp-root .lwp-ctq-btn-cancel {
  background: transparent; color: #cbd5e1; border-color: #334155;
}
`;
