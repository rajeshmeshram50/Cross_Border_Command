import { useEffect, useMemo, useState } from 'react';
import { Col, Row } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';
import { MasterSelect } from '../../components/ui/MasterSelect';
import DataTable, { ActionCell, type DataTableColumn } from '../../components/ui/DataTable';
import { TemplateRow, EmployeeCategory, RoleType, DocStatus, ROLE_TYPES } from './doc-templates/TemplateForm';
import '../../../css/recruitment.css';

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES: { key: EmployeeCategory; label: string; icon: string }[] = [
  { key: 'IT',     label: 'IT Employee Documents',                  icon: '💻' },
  { key: 'Non-IT', label: 'Non IT Employee Documents (Operations)', icon: '🏭' },
  { key: 'Legal',  label: 'Legal Employee Documents',               icon: '⚖️' },
];

const STATUS_TONES: Record<DocStatus, { bg: string; fg: string; dot: string }> = {
  Draft:      { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  Active:     { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  Deprecated: { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' },
};

interface Stats { total: number; active: number; draft: number; deprecated: number; by_category: Record<string, number>; }
const ZERO_STATS: Stats = { total: 0, active: 0, draft: 0, deprecated: 0, by_category: { 'IT': 0, 'Non-IT': 0, 'Legal': 0 } };

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HrDocumentTemplates() {
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<EmployeeCategory>('IT');
  // Default to the first designation level so the list isn't empty on first
  // visit. Users flip between levels via the chip strip below.
  const [roleType, setRoleType] = useState<RoleType>(ROLE_TYPES[5].value); // 'Intern / Trainee'
  const [search, setSearch] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');

  // Lookups — used to populate the trigger filter dropdown
  const [triggerPoints, setTriggerPoints] = useState<Array<{ id: number; module_name: string }>>([]);

  // Delete confirmation — uses the shared themed DeleteConfirmModal (same as
  // HR Employees / Custom Fields) for a consistent delete UX across modules.
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [listRes, statsRes, tpRes] = await Promise.all([
        api.get('/hr-document-templates'),
        api.get('/hr-document-templates/stats').catch(() => ({ data: ZERO_STATS })),
        api.get('/master/trigger_point').catch(() => ({ data: [] })),
      ]);
      setRows(Array.isArray(listRes.data) ? listRes.data : []);
      setStats({ ...ZERO_STATS, ...(statsRes.data || {}) });
      const tps: any[] = Array.isArray(tpRes.data) ? tpRes.data : [];
      setTriggerPoints(tps.map(r => ({ id: r.id, module_name: r.module_name })));
    } catch (err: any) {
      toast.error('Could not load templates', err?.response?.data?.message || 'Please try again.');
      setRows([]);
      setStats(ZERO_STATS);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Filtered view — category + role + search + filter dropdowns
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(r => r.employee_category === category)
      .filter(r => r.role_type === roleType)
      .filter(r => !triggerFilter || String(r.trigger_point_id) === triggerFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          (r.name || '').toLowerCase().includes(needle) ||
          (r.code || '').toLowerCase().includes(needle) ||
          (r.description || '').toLowerCase().includes(needle)
        );
      });
  }, [rows, category, roleType, triggerFilter, search]);

  /* Per-level counts for the Level tab badges. Everything EXCEPT the level
     itself is applied, so the active tab's badge equals the visible row count
     (what the standalone "N templates" pill used to say) while the other tabs
     preview what you'd get by switching. */
  const levelCounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = rows
      .filter(r => r.employee_category === category)
      .filter(r => !triggerFilter || String(r.trigger_point_id) === triggerFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          (r.name || '').toLowerCase().includes(needle) ||
          (r.code || '').toLowerCase().includes(needle) ||
          (r.description || '').toLowerCase().includes(needle)
        );
      });
    const out: Record<string, number> = {};
    base.forEach(r => { out[r.role_type] = (out[r.role_type] || 0) + 1; });
    return out;
  }, [rows, category, triggerFilter, search]);

  /* Paging lives in <DataTable> (components/ui/DataTable) now. */

  const handleDelete = (row: TemplateRow) => setDeleteTarget(row);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/hr-document-templates/${deleteTarget.id}`);
      toast.success('Deleted', `${deleteTarget.code} removed.`);
      setDeleteTarget(null);
      fetchAll();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleStatus = async (row: TemplateRow) => {
    const next: DocStatus = row.status === 'Active' ? 'Deprecated' : 'Active';
    try {
      const { data } = await api.put(`/hr-document-templates/${row.id}`, { status: next });
      toast.success(next === 'Active' ? 'Activated' : 'Deprecated', `${data.code} is now ${next}.`);
      setRows(prev => prev.map(r => r.id === data.id ? data : r));
      fetchAll();
    } catch (err: any) {
      toast.error('Could not update', err?.response?.data?.message || 'Please try again.');
    }
  };

  const handleGenerate = (row: TemplateRow) => {
    if (row.status !== 'Active') {
      toast.error('Not active', 'Only Active templates can be generated. Publish this template first.');
      return;
    }
    // Launch the 3-step Generate wizard (Select Employees → Fill Variables
    // → Preview & Generate). Replaces the old "download the empty template"
    // shortcut, which never actually produced a usable document.
    navigate(`/hr/doc-templates/${row.id}/generate`);
  };

  /* Columns for the shared <DataTable>. Widths sum to 100 (the table runs in
     table-layout:fixed): 5+9+24+8+14+11+15+14. */
  const columns = useMemo<DataTableColumn<TemplateRow>[]>(() => [
    {
      header: 'Code',
      accessorKey: 'code',
      meta: { width: '9%' },
      cell: info => (
        <span className="dtm-code-pill" style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 6, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700, background: '#fef3c7', color: '#a16207' }}>
          {String(info.getValue() ?? '')}
        </span>
      ),
    },
    {
      header: 'Template Name',
      accessorKey: 'name',
      // wrap: the name can carry an "Approval" sub-pill on a second line.
      meta: { width: '24%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <>
            <div className="dtm-tpl-name" style={{ fontWeight: 700 }}>{r.name}</div>
            {r.requires_manager_approval && (
              <div className="d-flex gap-1 mt-1">
                <span className="dtm-approval-pill" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                  <i className="ri-error-warning-line" /> Approval
                </span>
              </div>
            )}
          </>
        );
      },
    },
    {
      header: 'Version',
      accessorKey: 'version',
      meta: { width: '8%', align: 'center' },
      cell: info => (
        <span className="dtm-version-pill" style={{ padding: '2px 8px', borderRadius: 6, background: '#f3f4f6', color: '#374151', fontSize: 11.5, fontWeight: 700 }}>
          {String(info.getValue() ?? '')}
        </span>
      ),
    },
    {
      header: 'Auto-Trigger',
      id: 'trigger',
      accessorFn: (r: TemplateRow) => r.trigger_point?.module_name ?? '',
      meta: { width: '14%' },
      cell: info => (
        <span className="dtm-trigger-pill" style={{ padding: '3px 8px', borderRadius: 6, background: '#e0e7ff', color: '#4338ca', fontSize: 11.5, fontWeight: 600 }}>
          {info.row.original.trigger_point?.module_name || '—'}
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '11%' },
      cell: info => {
        const r = info.row.original;
        const t = STATUS_TONES[r.status] || STATUS_TONES.Draft;
        return (
          <span className={`dtm-status-pill dtm-status-${r.status}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, background: t.bg, color: t.fg, fontSize: 11.5, fontWeight: 700 }}>
           {r.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Generate</div>,
      id: '__generate',
      enableSorting: false,
      meta: { align: 'center', width: '15%' },
      cell: info => (
        <button type="button" onClick={() => handleGenerate(info.row.original)}
          style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <i className="ri-play-fill" /> Generate Document
        </button>
      ),
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      meta: { align: 'center', width: '14%' },
      cell: info => {
        const r = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center">
            {/* Edit (opens the template editor), Deprecate/Activate, Delete. */}
            <ActionBtn icon="ri-pencil-line" tone="info" onClick={() => navigate(`/hr/doc-templates/${r.id}/edit`)} title="Edit" />
            <ActionBtn
              icon={r.status === 'Active' ? 'ri-forbid-2-line' : 'ri-checkbox-circle-line'}
              tone={r.status === 'Active' ? 'danger' : 'success'}
              onClick={() => handleToggleStatus(r)}
              title={r.status === 'Active' ? 'Deprecate' : 'Activate'}
            />
            <ActionBtn icon="ri-delete-bin-line" tone="danger" onClick={() => handleDelete(r)} title="Delete" />
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [navigate]);

  // KPI strip
  const KPI = [
    { label: 'Total Templates', value: stats.total,       icon: 'ri-file-text-line',         deep: '#4338ca', gradient: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)' },
    { label: 'Active',          value: stats.active,      icon: 'ri-checkbox-circle-fill',   deep: '#089d7a', gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)' },
    { label: 'Draft',           value: stats.draft,       icon: 'ri-draft-line',             deep: '#a4661c', gradient: 'linear-gradient(135deg,#f7b84b 0%,#fbc763 100%)' },
    { label: 'Deprecated',      value: stats.deprecated,  icon: 'ri-forbid-2-line',          deep: '#b1401d', gradient: 'linear-gradient(135deg,#f06548 0%,#f47c5d 100%)' },
  ];

  return (
    <Row>
      <Col xs={12}>
        <div className="rec-page dtm-page">
          <DtmDarkStyles />
          {/* Header strip — same shape as the Clients / Branches headers. */}
          <div className="frm-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-file-text-line" /></div>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="frm-cstrip-title">Document Template Management</span>
                  <span className="dtm-active-badge" style={{ fontSize: 11.5, color: '#15803d', background: '#dcfce7', padding: '3px 10px', borderRadius: 999, fontWeight: 700 }}>
                    <i className="ri-checkbox-circle-fill me-1" style={{ fontSize: 12 }} />Active
                  </span>
                </div>
                <div className="frm-cstrip-sub">Role-based document templates — versions, variables &amp; approval flows</div>
              </div>
            </div>
            {/* Category tabs live in the header strip — the page's top-level
               split, so it belongs beside the title rather than in a strip of
               its own (Add Template moved down to the table toolbar with the
               rest of the list's controls). No emoji: the icons added colour
               noise and the labels stand on their own.
               Renders the shared .dt-tabrail / .dt-tabs / .dt-tab classes from
               components/ui/DataTable.css — the SAME markup and CSS as the
               Level tabs in the table toolbar below, so the two strips are
               identical by construction and can never drift apart. */}
            <div className="dt-tabrail flex-shrink-0" data-accent="violet">
              <div className="dt-tabs" role="tablist">
                {CATEGORIES.map(c => {
                  const on = category === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      className={`dt-tab ${on ? 'on' : 'off'}`}
                      onClick={() => setCategory(c.key)}
                    >
                      {c.label}
                      <span className="dt-tab-count">{stats.by_category?.[c.key] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* KPI strip — surfaces the count totals first so users see scale
              before drilling into a category. */}
          <div className="row g-2 mb-3">
            {KPI.map(k => (
              <div key={k.label} className="col-md-3 col-sm-6">
                <div className="dtm-kpi-tile" style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden' }}>
                  <div style={{ height: 4, background: k.gradient }} />
                  <div className="d-flex align-items-center justify-content-between" style={{ padding: '12px 14px' }}>
                    <div>
                      <div className="dtm-kpi-num" style={{ fontSize: 22, fontWeight: 800, color: k.deep, lineHeight: 1 }}>{k.value}</div>
                      <div className="dtm-kpi-label" style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4 }}>{k.label}</div>
                    </div>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: k.gradient, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Shared list table (components/ui/DataTable) — the designation LEVEL
              tabs now ride in its toolbar next to the search box (they select
              which slice of the chosen category you're looking at, so they
              belong to the table, not to a strip above it), together with the
              Trigger filter and Add Template (Bug #15). Sortable headers and the
              rows-per-page pager come free.
              The level tabs pass no `icon`: the per-level emoji added colour
              noise across six tabs and the label alone is unambiguous. Each
              carries its own count badge instead. */}
          <DataTable<TemplateRow>
            data={filtered}
            columns={columns}
            serial
            accent="violet"
            /* fitToViewport + autoFitRows = the My Workplace behaviour: the card
               stretches to the bottom of the viewport with the pager pinned to
               its lower edge, and the page size is whatever number of rows fits
               that height. Without it a short result set left the card floating
               mid-screen above a band of empty page. */
            fitToViewport
            autoFitRows
            minWidth={1250}
            loading={loading}
            tabs={ROLE_TYPES.map(r => ({ key: r.value, label: r.label, count: levelCounts[r.value] || 0 }))}
            activeTab={roleType}
            onTabChange={k => setRoleType(k as RoleType)}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search templates…"
            emptyMessage={
              <>
                <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                No templates yet for {category} · {roleType}. Click <strong>+ Add Template</strong> to create one.
              </>
            }
            toolbarActions={
              <>
                <div className="d-flex align-items-center gap-2">
                  <span className="dtm-filter-label" style={{ fontSize: 10.5, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.4, textTransform: 'uppercase' }}>Trigger</span>
                  <div style={{ minWidth: 170 }}>
                    <MasterSelect
                      value={triggerFilter}
                      onChange={setTriggerFilter}
                      options={[{ value: '', label: 'All' }, ...triggerPoints.map(t => ({ value: String(t.id), label: t.module_name }))]}
                      placeholder="All"
                    />
                  </div>
                </div>
                {/* Status picker removed — the Status column sorts from its own
                    header now, and the KPI tiles above already break the totals
                    down by Active / Draft / Deprecated.
                    The standalone "N templates" pill is gone too: that number is
                    the active Level tab's badge, so it was saying the same thing
                    twice. */}
                {/* Add Template sits at the right end of the toolbar — the list's
                    primary action next to the list's own controls. */}
                <button type="button" className="dtm-add-tpl-btn flex-shrink-0" onClick={() => navigate('/hr/doc-templates/new')}
                  style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(99,102,241,0.3)', transition: 'transform .15s ease, box-shadow .2s ease, filter .15s ease' }}>
                  <i className="ri-add-line me-1" /> Add Template
                </button>
              </>
            }
          />
        </div>
      </Col>

      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Template"
        itemName={deleteTarget?.code}
        subMessage="This action cannot be undone. The template and its configuration will be permanently removed."
        loading={deleting}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />
    </Row>
  );
}

/* Thin adapter over the shared <ActionCell> (components/ui/DataTable) so the
   Actions column here is the Customer list's button — bordered pale tint that
   inverts to a solid gradient of the same hue on hover. The local flat-pastel
   version had no hover identity. `primary`/`dark` map onto the table's accent
   so callers don't have to change. */
function ActionBtn({ icon, tone, onClick, title }: { icon: string; tone: 'primary' | 'info' | 'success' | 'danger' | 'dark'; onClick: () => void; title: string }) {
  const mapped = tone === 'primary' || tone === 'dark' ? 'accent' : tone;
  return <ActionCell title={title} icon={icon} tone={mapped} onClick={onClick} />;
}

/* Dark-theme overrides for this page. Light styles stay inline; these rules
   only fire under [data-bs-theme="dark"] so the page reads cleanly on dark
   card surfaces (translucent fills instead of pastel light backgrounds). */
function DtmDarkStyles() {
  return (
    <style>{`
      /* Category tab strip lives inline (Expense-module recipe) and the Level
         tabs are the DataTable toolbar's own pill rail, so neither needs page
         CSS here. */

      /* KPI tile hover — gentle lift + shadow so the cards feel clickable
         even though they are currently informational. */
      .dtm-page .dtm-kpi-tile {
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        cursor: default;
      }
      .dtm-page .dtm-kpi-tile:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 22px rgba(15,23,42,0.10);
        border-color: rgba(124,92,252,0.45) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-tile:hover,
      [data-layout-mode="dark"] .dtm-page .dtm-kpi-tile:hover{
        box-shadow: 0 10px 22px rgba(0,0,0,0.45);
        border-color: rgba(167,139,250,0.55) !important;
      }

      [data-bs-theme="dark"] .dtm-page .dtm-header-icon,
      [data-layout-mode="dark"] .dtm-page .dtm-header-icon{
        background: linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25)) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-active-badge,
      [data-layout-mode="dark"] .dtm-page .dtm-active-badge{
        background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-tile,
      [data-layout-mode="dark"] .dtm-page .dtm-kpi-tile{
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-num,
      [data-layout-mode="dark"] .dtm-page .dtm-kpi-num{ color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-label,
      [data-layout-mode="dark"] .dtm-page .dtm-kpi-label{ color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-filter-label,
      [data-layout-mode="dark"] .dtm-page .dtm-filter-label{ color: rgba(255,255,255,0.5) !important; }

      /* Header — an exact copy of the Recruitment list header
         (.rec-list-table thead th): 10.5px / 700 micro-caps at 0.08em, soft
         vertical gradient bar, 13px x 12px padding and a 1px divider. Replaces
         the inline 11px / 800 / letterSpacing 0.4 styling that sat on the tr
         plus the 2px violet underline, which made this table's header read
         differently from every other HRMS list. */
      .dtm-page .dtm-thead th {
        padding: 13px 12px;
        vertical-align: middle;
        background: linear-gradient(180deg, #fafbfc 0%, #f4f5f8 100%);
        color: var(--vz-secondary-color);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border-bottom: 1px solid #ececf2;
        box-shadow: none;
        white-space: nowrap;
      }
      /* Dark header — same recipe as the Recruitment list header. */
      [data-bs-theme="dark"] .dtm-page .dtm-thead th,
      [data-layout-mode="dark"] .dtm-page .dtm-thead th,
      [data-layout-mode="dark"] .dtm-page .dtm-thead th {
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--vz-card-bg, #1a1d29) 88%, #ffffff) 0%,
          var(--vz-card-bg, #1a1d29) 100%) !important;
        color: rgba(255, 255, 255, 0.70) !important;
        border-bottom-color: var(--vz-border-color, #2c3242) !important;
        box-shadow: none;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-table tbody td,
      [data-layout-mode="dark"] .dtm-page .dtm-table tbody td{
        border-bottom-color: var(--vz-border-color) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .dtm-page .dtm-tpl-name,
      [data-layout-mode="dark"] .dtm-page .dtm-tpl-name{ color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-empty,
      [data-layout-mode="dark"] .dtm-page .dtm-empty{ color: rgba(255,255,255,0.5) !important; }

      [data-bs-theme="dark"] .dtm-page .dtm-code-pill,
      [data-layout-mode="dark"] .dtm-page .dtm-code-pill{
        background: rgba(251,191,36,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-approval-pill,
      [data-layout-mode="dark"] .dtm-page .dtm-approval-pill{
        background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-version-pill,
      [data-layout-mode="dark"] .dtm-page .dtm-version-pill{
        background: var(--vz-secondary-bg) !important; color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-trigger-pill,
      [data-layout-mode="dark"] .dtm-page .dtm-trigger-pill{
        background: rgba(124,92,252,0.20) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Draft,
      [data-layout-mode="dark"] .dtm-page .dtm-status-Draft{
        background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Active,
      [data-layout-mode="dark"] .dtm-page .dtm-status-Active{
        background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Deprecated,
      [data-layout-mode="dark"] .dtm-page .dtm-status-Deprecated{
        background: rgba(248,113,113,0.18) !important; color: #fca5a5 !important;
      }

      /* .dtm-act-* dark rules removed — the Actions column renders the shared
         <ActionCell> (.dt-act), which carries its own light + dark styling. */
      /* Add Template button — hover feedback (BUG-039). Applies in both themes. */
      .dtm-page .dtm-add-tpl-btn:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 7px 20px rgba(99,102,241,0.45) !important; }
      .dtm-page .dtm-add-tpl-btn:active { transform: translateY(0); }
    `}</style>
  );
}
