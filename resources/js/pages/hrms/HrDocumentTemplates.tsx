import { useEffect, useMemo, useState } from 'react';
import { Col, Row } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';
import { MasterSelect } from '../../components/ui/MasterSelect';
import DataTable, { ActionCell, TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
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

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HrDocumentTemplates() {
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState<TemplateRow[]>([]);
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
      const [listRes, tpRes] = await Promise.all([
        api.get('/hr-document-templates'),
        api.get('/master/trigger_point').catch(() => ({ data: [] })),
      ]);
      setRows(Array.isArray(listRes.data) ? listRes.data : []);
      const tps: any[] = Array.isArray(tpRes.data) ? tpRes.data : [];
      setTriggerPoints(tps.map(r => ({ id: r.id, module_name: r.module_name })));
    } catch (err: any) {
      toast.error('Could not load templates', err?.response?.data?.message || 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Filtered view — category + role + search + filter dropdowns
  /* KPI + category-tab counts, derived from `rows` rather than fetched.
   *
   * They used to come from /hr-document-templates/stats, called with NO
   * parameters — so the tiles counted EVERY category and EVERY level while the
   * table below showed one category and one level. Sitting on "IT · Intern /
   * Trainee" (2 templates) the strip still read Total 10 / Active 3 /
   * Deprecated 6, which describes nothing on screen.
   *
   * The endpoint does accept employee_category + role_type, so passing them was
   * an option — but /hr-document-templates already returns every row under the
   * same scope, unpaginated, so counting locally is exact, needs no round-trip
   * per tab click, and makes it impossible for the tiles and the table to
   * disagree. If that list ever starts paginating, this has to move back to the
   * server.
   *
   * Scoped to the CATEGORY, not the level: the category tabs sit above the
   * tiles and the level tabs below with their own badges, so KPI Total now
   * always equals the number on the active category tab. */
  const catRows = useMemo(() => rows.filter(r => r.employee_category === category), [rows, category]);
  const stats = useMemo<Stats>(() => {
    const count = (st: DocStatus) => catRows.filter(r => r.status === st).length;
    const byCat: Record<string, number> = { 'IT': 0, 'Non-IT': 0, 'Legal': 0 };
    for (const r of rows) {
      if (r.employee_category in byCat) byCat[r.employee_category] += 1;
    }
    return {
      total: catRows.length,
      active: count('Active'),
      draft: count('Draft'),
      deprecated: count('Deprecated'),
      by_category: byCat,
    };
  }, [rows, catRows]);

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

  /* Bulk deprecate.
     Rows are keyed by id rather than by index so the selection survives paging,
     sorting and a refetch — an index-keyed set would silently point at
     different templates the moment the list reordered. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selCounts = useMemo(() => {
    let active = 0, deprecated = 0;
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      if (r.status === 'Active') active++;
      else if (r.status === 'Deprecated') deprecated++;
    }
    return { active, deprecated };
  }, [rows, selected]);

  /* One action for both directions.
     Only "Deprecate selected" existed, so picking rows that were already
     deprecated led nowhere: the single-row button is a toggle, but in bulk the
     only reply was "nothing to deprecate". Reactivating still meant clicking
     row by row. */
  const bulkSetStatus = async (next: DocStatus) => {
    const from: DocStatus = next === 'Deprecated' ? 'Active' : 'Deprecated';
    const targets = rows.filter(r => selected.has(r.id) && r.status === from);
    if (!targets.length) return;
    setBulkBusy(true);
    let done = 0; const failed: string[] = [];
    for (const r of targets) {
      try {
        await api.put(`/hr-document-templates/${r.id}`, { status: next });
        done++;
      } catch { failed.push(r.code); }
    }
    setBulkBusy(false);
    setSelected(new Set());
    await fetchAll();
    const verb = next === 'Deprecated' ? 'deprecated' : 'activated';
    if (failed.length) {
      toast.error(`${done} ${verb}, ${failed.length} failed`, `Could not update: ${failed.join(', ')}`);
    } else {
      toast.success(`${done} template${done === 1 ? '' : 's'} ${verb}`,
        next === 'Deprecated' ? 'They can be reactivated any time.' : 'They are live again.');
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

  /* Pinned left of Sr No — DataTable prepends Sr No itself, so a checkbox
     supplied through `columns` would always land to the RIGHT of it. */
  const leading = useMemo<DataTableColumn<TemplateRow>[]>(() => [
    {
      id: 'select',
      meta: { width: '4%', align: 'center' as const },
      /* Header box picks / clears everything on the CURRENT page only, which is
         what the user can see — a "select all" that silently reached rows on
         other pages would deprecate templates nobody looked at. */
      header: ({ table }) => {
        const page = table.getRowModel().rows.map(r => r.original.id);
        const on = page.length > 0 && page.every(id => selected.has(id));
        return (
          <input
            type="checkbox" checked={on} aria-label="Select all on this page"
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#7c5cfc' }}
            onChange={e => setSelected(prev => {
              const next = new Set(prev);
              page.forEach(id => e.target.checked ? next.add(id) : next.delete(id));
              return next;
            })}
          />
        );
      },
      cell: ({ row }) => {
        const id = row.original.id;
        return (
          <input
            type="checkbox" checked={selected.has(id)} aria-label={`Select ${row.original.code}`}
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#7c5cfc' }}
            onClick={e => e.stopPropagation()}
            onChange={e => setSelected(prev => {
              const next = new Set(prev);
              e.target.checked ? next.add(id) : next.delete(id);
              return next;
            })}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selected]);

  /* Columns for the shared <DataTable>. Widths sum to 100 (the table runs in
     table-layout:fixed): 4+5+8+22+8+13+11+15+14. */
  const columns = useMemo<DataTableColumn<TemplateRow>[]>(() => [
    {
      header: 'Code',
      accessorKey: 'code',
      meta: { width: '8%' },
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
      meta: { width: '22%', wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <>
            {/* One line, ellipsised, full name on hover. The cell is `wrap`
                (the Approval pill needs a second line), so an over-long name
                used to run straight across Version / Auto-Trigger — and a
                pasted no-space name has nowhere to wrap even when it could. */}
            <TruncCell value={r.name} className="dtm-tpl-name fw-bold" caseSensitive />
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
        <button type="button" className="dtm-gen-btn" onClick={() => handleGenerate(info.row.original)}
          style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <i className="ri-play-fill" /> Generate<span className="dtm-gen-word"> Document</span>
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
            leading={leading}
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
            tabs={ROLE_TYPES.map(r => ({ key: r.value, label: r.short, count: levelCounts[r.value] || 0 }))}
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
                {/* Compact: with six role tabs the rail needs every pixel, and
                    a 170px-wide "All" dropdown plus a roomy button pushed the
                    last tab onto a second line inside the rail. */}
                <div className="d-flex align-items-center gap-1">
                  <span className="dtm-filter-label" style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.3, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Trigger</span>
                  <div style={{ minWidth: 118, maxWidth: 150 }}>
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
                  style={{ padding: '7px 12px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(99,102,241,0.3)', transition: 'transform .15s ease, box-shadow .2s ease, filter .15s ease' }}>
                  <i className="ri-add-line me-1" /> Add Template
                </button>
              </>
            }
              /* The bar belongs to the ROWS, so it renders inside the table card
                 between the last row and the pager. Above the table it pushed the
                 list down as soon as a row was ticked; after <DataTable> it sat
                 under the pager, detached from the card entirely. */
              belowRows={selected.size > 0 ? (
                <div className="dt-below-rows">
                <div className="hdt-bulk-bar">
                  <div className="hdt-bulk-info">
                    <strong>{selected.size}</strong> selected
                    {/* Round X, not a "Clear" word — same as the Trade Documents
                        bar. Clearing is a dismissal, and a labelled button next to
                        two real actions competes with them for attention. */}
                    <button
                      type="button" className="hdt-bulk-clear" title="Clear selection"
                      aria-label="Clear selection" disabled={bulkBusy}
                      onClick={() => setSelected(new Set())}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  {/* Counts come from the selection itself, so a button is only
                      offered when it has something to do — no more pressing
                      Deprecate to be told there was nothing to deprecate. */}
                  {selCounts.active > 0 && (
                    <button
                      type="button" className="hdt-bulk-btn is-danger"
                      onClick={() => bulkSetStatus('Deprecated')} disabled={bulkBusy}>
                      <i className="ri-forbid-2-line" />
                      {bulkBusy ? 'Working…' : `Deprecate ${selCounts.active}`}
                    </button>
                  )}
                  {selCounts.deprecated > 0 && (
                    <button
                      type="button" className="hdt-bulk-btn is-primary"
                      onClick={() => bulkSetStatus('Active')} disabled={bulkBusy}>
                      <i className="ri-checkbox-circle-line" />
                      {bulkBusy ? 'Working…' : `Activate ${selCounts.deprecated}`}
                    </button>
                  )}
                </div>
                </div>
              ) : null}
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
      /* Bulk-action bar — same floating pill the Trade Documents / Agreements
         popup uses (.lasm-bulk-bar). It used to be a pale lavender strip with
         outline buttons stretched across the full width, which read as part of
         the toolbar rather than as a thing that appeared because you selected
         rows. Deliberately in flow (not sticky) and centred, so it pushes the
         table down instead of covering the rows it acts on. */
      /* Slot between the last row and the pager. Padded so the pill never
         touches either, and it does not stretch — the pill sizes to itself. */
      /* Page gutters, copied from Supplier Management (.sup-fig in
         p2p/.../supplier-management.css), which is the reference:

             .sup-fig { margin: -6px 0 0; }

         Note what it does NOT do: no horizontal negative margin. It keeps the
         container's own side padding, so the card stays inset with page
         background either side. My earlier guesses pulled the sides out to
         -1.5rem, which ran the card edge to edge — a different layout, not a
         tighter one. Vertically it only trims 6px; the rest of the gap is the
         shell's, and every page lives with it. */
      .dtm-page { margin: -6px 0 0; padding: 0; }
      @media (max-width: 640px) { .dtm-page { margin: -2px 0 0; } }

      .dtm-page .dt-below-rows { flex-shrink: 0; padding: 10px 12px 2px; }

      .hdt-bulk-bar {
        position: relative; z-index: 5; flex-shrink: 0;
        margin: 0 auto; width: fit-content; max-width: calc(100% - 24px);
        display: flex; align-items: center; gap: 12px; white-space: nowrap;
        padding: 11px 18px; border-radius: 16px;
        background: linear-gradient(135deg, #4c1d95, #7c3aed);
        box-shadow: 0 12px 40px rgba(124,58,237,.45), 0 4px 14px rgba(0,0,0,.18);
        animation: hdtBulkIn .22s cubic-bezier(.22,1,.36,1);
      }
      @keyframes hdtBulkIn { from { opacity: 0; transform: translateY(10px); } }
      .hdt-bulk-info { font-size: 12.5px; font-weight: 700; color: #fff; display: inline-flex; align-items: center; gap: 10px; }
      .hdt-bulk-info strong { font-size: 13px; }
      .hdt-bulk-clear {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; padding: 0;
        background: rgba(255,255,255,.14); border: 1.5px solid rgba(255,255,255,.25); color: #fff;
        border-radius: 8px; cursor: pointer; transition: background .15s;
      }
      .hdt-bulk-clear:hover:not(:disabled) { background: rgba(255,255,255,.22); }
      .hdt-bulk-clear:disabled { opacity: .5; cursor: not-allowed; }
      .hdt-bulk-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 10px;
        border: 1.5px solid rgba(255,255,255,.25); background: rgba(255,255,255,.14); color: #fff;
        font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
        transition: background .15s, transform .15s ease, box-shadow .15s ease;
      }
      .hdt-bulk-btn:hover:not(:disabled) { background: rgba(255,255,255,.24); transform: translateY(-1px); }
      /* Activate is the constructive action, so it gets the solid white
         treatment the reference bar reserves for its primary. Deprecate stays
         translucent — destructive, and it should not be the easiest thing to
         hit on a bar you opened by ticking boxes. */
      .hdt-bulk-btn.is-primary {
        background: #fff; border-color: #fff; color: #7c3aed; box-shadow: 0 2px 8px rgba(0,0,0,.12);
      }
      .hdt-bulk-btn.is-primary:hover:not(:disabled) { background: #f5f3ff; box-shadow: 0 6px 14px rgba(124,58,237,.30); }
      .hdt-bulk-btn.is-danger { color: #fecdd3; border-color: rgba(254,205,211,.45); }
      .hdt-bulk-btn.is-danger:hover:not(:disabled) { background: rgba(254,205,211,.22); }
      .hdt-bulk-btn:disabled { opacity: .55; cursor: wait; transform: none; }
      /* Category tab strip lives inline (Expense-module recipe) and the Level
         tabs are the DataTable toolbar's own pill rail, so neither needs page
         CSS here. */

      /* KPI tile hover — gentle lift + shadow so the cards feel clickable
         even though they are currently informational. */
      /* Toolbar sizing, scoped to this page so no other list shifts.
         The search field is the control people actually use here, and the
         Trigger picker sat taller than everything beside it — so the strip read
         as mismatched heights with a small search box wedged in. */
      .dtm-page .dt-search { flex: 0 4 320px; max-width: 320px; }
      .dtm-page .master-select-toggle { min-height: 34px; height: 34px; padding-top: 0; padding-bottom: 0; }
      /* The Trigger picker is capped inline at 150px, which read as a cramped
         afterthought beside a 400px search. Overridden rather than edited in
         place so the sizing lives with the rest of this page's toolbar rules.
         Selected by the label it always follows — no markup change needed. */
      .dtm-page .dtm-filter-label + div { min-width: 180px !important; max-width: 210px !important; }
      /* Pull the group off the right edge so it is not pinned against the
         Add Template button. */
      .dtm-page .dtm-filter-label { margin-left: 6px; }

      /* ── Small screens ────────────────────────────────────────────────
         Nine columns do not belong on a phone. The first attempt gave the
         table a min-width so it scrolled sideways — which is not responsive,
         it just moves the problem: the user drags a wide table around and the
         Generate button lives permanently off-screen.
         So columns drop out by priority instead, and what stays always fits.
         Order is select · Sr No · Code · Name · Version · Trigger · Status ·
         Generate · Actions, hence the nth-child numbers. */
      @media (max-width: 1199.98px) {
        /* Sr No is decoration — the rows are already ordered. */
        .dtm-page .dt-table th:nth-child(2), .dtm-page .dt-table td:nth-child(2),
        /* Version is v1 on essentially everything. */
        .dtm-page .dt-table th:nth-child(5), .dtm-page .dt-table td:nth-child(5) { display: none; }
      }
      @media (max-width: 991.98px) {
        /* Trigger matters, but it is visible on the row's edit screen and the
           Trigger filter above already narrows by it. */
        .dtm-page .dt-table th:nth-child(6), .dtm-page .dt-table td:nth-child(6) { display: none; }
      }
      /* Six role tabs never fit beside the search + Trigger + Add Template on
         anything short of a wide desktop, and wrapping turned the toolbar into
         two ragged rows with one lone tab underneath. It scrolls sideways
         instead — at every width, not just phones, because the wrap started
         well above the phone breakpoint. */
      .dtm-page .dt-tabrail { overflow-x: auto; scrollbar-width: none; }
      .dtm-page .dt-tabrail::-webkit-scrollbar { display: none; }
      .dtm-page .dt-tabs { flex-wrap: nowrap; }
      /* The pill hugs its tabs; only the RAIL takes the full line.
         DataTable's own @media (max-width: 1100px) sets .dt-tabs to
         flex:1 1 100% so the tabs claim their own row when the toolbar gets
         cramped — but that stretches the PILL, not just the row, leaving a wide
         empty white slab to the right of the last tab. The rail above already
         takes the line (flex: 1 0 100% at <=1500px), so the pill only needs to
         be as wide as its tabs.
         Above 760px only: on a phone the shared rule makes it full-width and
         centred, which is the right call there. */
      @media (min-width: 761px) {
        .dtm-page .dt-toolbar .dt-tabs { flex: 0 0 auto; width: fit-content; max-width: 100%; }
      }
      /* ...but NOT the category rail in the header strip. Sideways scrolling
         suits the six Level tabs, where any one of them is a short word. These
         three are sentences ("Non IT Employee Documents (Operations)"), so the
         rail was always wider than the card: it clipped the active tab mid-word
         and hid the third one off the right edge, with no scrollbar to say so.
         Three tabs wrap onto a second line perfectly well. */
      .dtm-page .frm-cstrip .dt-tabrail { overflow-x: visible; max-width: 100%; }
      .dtm-page .frm-cstrip .dt-tabs { flex-wrap: wrap; }
      .dtm-page .frm-cstrip .dt-tab { white-space: normal; text-align: left; }
      /* DataTable keeps the toolbar on ONE line above 1200px, on the assumption
         that the tab rail will wrap its tabs INSIDE itself to give up width.
         Six role tabs scrolling on a single line cannot do that, so everything
         to their right got crushed instead — the search shrank to a stub and
         TRIGGER ended up touching it.
         Below 1500px the rail takes a line of its own and the controls take the
         next. Two clean rows beat one crammed one; above that they all fit. */
      @media (max-width: 1499.98px) {
        .dtm-page .dt-toolbar { flex-wrap: wrap; }
        .dtm-page .dt-tabrail { flex: 1 0 100%; max-width: 100%; }
      }
      @media (max-width: 767.98px) {
        /* Code is carried in the template name in practice. */
        .dtm-page .dt-table th:nth-child(3), .dtm-page .dt-table td:nth-child(3) { display: none; }
        .dtm-page .frm-cstrip { flex-wrap: wrap; row-gap: 10px; }
        /* Load-bearing: a flex child's min-width defaults to its CONTENT width,
           so the category rail refused to shrink and pushed itself out past the
           card's rounded edge instead of scrolling inside it. */
        .dtm-page .frm-cstrip > * { min-width: 0; }
        .dtm-page .dt-tabrail { width: 100%; max-width: 100%; }
        /* Same inline-style override as the height rules below. */
        .dtm-page .dtm-kpi-num { font-size: 19px !important; }
        /* The table body is flex:1 + min-height:0 inside a shell that gets its
           height from the viewport-fit calc. On a phone that calc leaves nothing
           over, so the rows collapsed to zero height — the pager still read
           "Showing 1-2 of 2" above an empty gap. A floor keeps them on screen. */
        .dtm-page .dt-table-wrap { min-height: 260px; }
        .dtm-page .dt-scroll { min-height: 200px; }
      }
      /* Two KPI tiles per row rather than four crushed ones. Also below 576px:
         Bootstrap's col-sm-6 stops applying there, so all four went full width
         and ate ~320px of a phone screen before the table even started. Four
         one-line counters read perfectly well two-up. */
      @media (max-width: 767.98px) {
        .dtm-page .row > [class*='col-md-3'] { flex: 0 0 50%; max-width: 50%; }
      }

      /* ── Bulk bar ──
         width:fit-content + white-space:nowrap keeps the pill tight on a
         desktop, but on a narrow screen "2 selected · Deprecate 2 · Activate 2"
         is wider than the card and simply overflowed it. Let it wrap and take
         the full width instead — it is a bar, not a badge. */
      @media (max-width: 575.98px) {
        .dtm-page .hdt-bulk-bar {
          width: 100%; max-width: 100%;
          flex-wrap: wrap; white-space: normal;
          justify-content: center; row-gap: 8px; padding: 10px 12px;
        }
        .dtm-page .hdt-bulk-btn { flex: 1 1 auto; justify-content: center; }
      }

      /* ── Generate button ──
         "Generate Document" is the widest cell in the row. Below 992px the word
         "Document" is dropped: the green play button in the Generate column
         cannot mean anything else, and the 90px it frees is what keeps Status
         and Actions on screen instead of pushing them into a scroll. */
      @media (max-width: 991.98px) {
        .dtm-page .dtm-gen-word { display: none; }
        .dtm-page .dtm-gen-btn { padding: 6px 10px !important; }
      }

      /* ── Toolbar on phones ──
         Search, the Trigger picker and Add Template shared one row and each was
         squeezed to a stub. Search takes its own line; the other two split the
         next one. */
      @media (max-width: 575.98px) {
        .dtm-page .dt-search { flex: 1 1 100%; max-width: 100%; }
        .dtm-page .dt-toolbar { row-gap: 8px; }
        .dtm-page .dtm-add-tpl-btn { flex: 1 1 auto; justify-content: center; }
      }

      /* ── Toolbar: shrink to fit rather than wrap ──
         Six level tabs + search + the Trigger picker + Add Template is a lot
         for one row. Past the point where they stop fitting, the toolbar was
         wrapping and dropping Trigger + Add Template onto a second line, pinned
         right, which reads as two unrelated strips.
         Between 1200px and 1700px everything shrinks instead: smaller tab text,
         tighter padding, a narrower search and Trigger. Nothing is hidden or
         moved — it just gets smaller, and one row survives.
         Below 1200px shrinking is no longer enough, so the existing rule takes
         over and gives the rail a line of its own. */
      @media (min-width: 1200px) and (max-width: 1699.98px) {
        .dtm-page .dt-toolbar { flex-wrap: nowrap; }
        .dtm-page .dt-tabrail { flex: 0 1 auto; min-width: 0; }
        .dtm-page .dt-tab { padding-left: 10px; padding-right: 10px; font-size: 11.5px; }
        .dtm-page .dt-tab-count { min-width: 17px; height: 17px; font-size: 9.5px; padding: 0 4px; }
        .dtm-page .dt-search { flex: 0 3 240px; max-width: 240px; }
        .dtm-page .dtm-filter-label { font-size: 10px; }
        .dtm-page .dtm-filter-label + div { min-width: 130px !important; max-width: 150px !important; }
        .dtm-page .dtm-add-tpl-btn { padding: 7px 10px !important; font-size: 11.5px !important; }
      }

      /* ── Density by viewport HEIGHT ──
         Everything above was about width. What actually breaks this page is
         height: zoom in, or use a laptop panel, and the viewport shrinks while
         the KPI tiles, the two tab rails, the toolbar and the row height all
         stay the same — so the table is left a sliver and the row count drops
         to its floor with the last row still clipped.
         Below 900px tall the chrome gives up a few pixels everywhere; below
         740px it gives up more. Nothing is hidden — the same page, tighter, so
         more rows fit instead of fewer. */
      @media (max-height: 900px) {
        .dtm-page .frm-cstrip { min-height: 56px; padding: 9px 16px; }
        .dtm-page .frm-cstrip-icon { width: 38px; height: 38px; font-size: 18px; }
        .dtm-page .frm-cstrip-title { font-size: 16px; }
        .dtm-page .frm-cstrip-sub { font-size: 11.5px; margin-top: 2px; }
        .dtm-page .dtm-kpi-tile .d-flex { padding: 8px 12px !important; }
        /* !important throughout this block: the tiles and the Generate button
           carry INLINE styles (fontSize / padding on the JSX), and an inline
           declaration beats any stylesheet rule short of !important. Without
           it these rules parse fine, ship fine and do nothing. */
        .dtm-page .dtm-kpi-num { font-size: 18px !important; }
        .dtm-page .dtm-kpi-label { font-size: 9.5px !important; }
        .dtm-page .dt-table tbody td { padding: 5px 9px; }
        .dtm-page .dt-table thead th { padding: 7px 9px; }
        .dtm-page .dt-toolbar { padding-top: 8px; padding-bottom: 8px; gap: 8px; }
      }
      @media (max-height: 740px) {
        /* The KPI row is the biggest single block that is not the table. It
           keeps its numbers, on one line, at half the height. */
        .dtm-page .dtm-kpi-tile .d-flex { padding: 6px 10px !important; }
        .dtm-page .dtm-kpi-num { font-size: 16px !important; }
        .dtm-page .dtm-kpi-tile > div:first-child { height: 3px !important; }
        .dtm-page .frm-cstrip-sub { display: none; }
        .dtm-page .dt-table tbody td { padding: 4px 8px; font-size: 11px; }
        .dtm-page .dt-tab { padding-top: 5px; padding-bottom: 5px; }
        .dtm-page .dt-table tbody .dt-serial { width: 20px; height: 20px; font-size: 9.5px; }
        .dtm-page .dtm-gen-btn { padding: 4px 9px !important; font-size: 11px !important; }
      }

      /* ── Header strip on phones ──
         The title block and the category rail sit side by side and both refuse
         to shrink, so the rail was pushed past the card's rounded edge. Stacked,
         each gets the full width and the rail scrolls inside it. */
      @media (max-width: 575.98px) {
        .dtm-page .frm-cstrip { flex-direction: column; align-items: stretch; }
        .dtm-page .frm-cstrip-title { font-size: 16px; }
        .dtm-page .frm-cstrip-icon { width: 38px; height: 38px; font-size: 18px; }
      }

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
