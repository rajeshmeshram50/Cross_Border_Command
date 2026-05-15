import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Input } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { ShimmerTableRows } from '../../components/ui/Shimmer';
import { MasterSelect } from '../../components/ui/MasterSelect';
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
  const [statusFilter, setStatusFilter]   = useState('');

  // Lookups — used to populate the trigger filter dropdown
  const [triggerPoints, setTriggerPoints] = useState<Array<{ id: number; module_name: string }>>([]);

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
      .filter(r => !statusFilter || r.status === statusFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          (r.name || '').toLowerCase().includes(needle) ||
          (r.code || '').toLowerCase().includes(needle) ||
          (r.description || '').toLowerCase().includes(needle)
        );
      });
  }, [rows, category, roleType, triggerFilter, statusFilter, search]);

  const handleDelete = async (row: TemplateRow) => {
    if (!confirm(`Delete template ${row.code}? This cannot be undone.`)) return;
    try {
      await api.delete(`/hr-document-templates/${row.id}`);
      toast.success('Deleted', `${row.code} removed.`);
      fetchAll();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
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
          {/* Header */}
          <Card className="mb-3" style={{ borderRadius: 14 }}>
            <CardBody className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
              <div className="d-flex align-items-center gap-3">
                <span className="dtm-header-icon" style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ri-file-text-line" style={{ fontSize: 22, color: '#4338ca' }} />
                </span>
                <div>
                  <h4 className="mb-0 fw-bold d-flex align-items-center gap-2">
                    Document Template Management
                    <span className="dtm-active-badge" style={{ fontSize: 11.5, color: '#15803d', background: '#dcfce7', padding: '3px 10px', borderRadius: 999, fontWeight: 700 }}>
                      <i className="ri-checkbox-circle-fill me-1" style={{ fontSize: 12 }} />Active
                    </span>
                  </h4>
                  <div className="text-muted" style={{ fontSize: 12.5 }}>Role-based document templates — versions, variables &amp; approval flows</div>
                </div>
              </div>
              <button type="button" onClick={() => navigate('/hr/doc-templates/new')}
                style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}>
                <i className="ri-add-line me-1" /> Add Template
              </button>
            </CardBody>
          </Card>

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

          {/* Category top tabs — matches the Active/Disabled tab-strip pattern
              used on HrEmployees: a single container with transparent inactive
              tabs and a purple-gradient active tab. */}
          <div
            className="d-flex mb-3 dtm-cat-tabbar"
            style={{
              background: 'var(--vz-secondary-bg)',
              border: '1px solid var(--vz-border-color)',
              borderRadius: 10,
              padding: 4,
              gap: 4,
            }}
          >
            {CATEGORIES.map(c => {
              const on = category === c.key;
              const cnt = stats.by_category?.[c.key] || 0;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold dtm-cat-tab-btn"
                  style={{
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 13,
                    background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                    color: on ? '#fff' : 'var(--vz-secondary-color)',
                    border: 'none',
                    boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{c.icon}</span>
                  {c.label}
                  <span
                    className="badge rounded-pill"
                    style={{
                      fontSize: 11,
                      background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                      color: on ? '#fff' : 'var(--vz-secondary-color)',
                    }}
                  >
                    {cnt}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Designation level chips — same tab-strip housing as the category
              row above, just denser. Inactive chips keep their role color as
              an icon tint; active chip gets the purple-gradient fill. */}
          <div
            className="d-flex flex-wrap mb-3 dtm-role-tabbar"
            style={{
              background: 'var(--vz-secondary-bg)',
              border: '1px solid var(--vz-border-color)',
              borderRadius: 10,
              padding: 4,
              gap: 4,
            }}
          >
            {ROLE_TYPES.map(r => {
              const on = roleType === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRoleType(r.value)}
                  className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold dtm-role-chip"
                  style={{
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 12.5,
                    minWidth: 120,
                    background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                    color: on ? '#fff' : 'var(--vz-secondary-color)',
                    border: 'none',
                    boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1 }}>{r.icon}</span>
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* Filters + count badge */}
          <Card className="mb-3" style={{ borderRadius: 12 }}>
            <CardBody className="d-flex flex-wrap gap-3 align-items-center" style={{ padding: 12 }}>
              <div style={{ position: 'relative', minWidth: 260 }}>
                <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <Input type="text" placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 30, height: 36 }} />
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="dtm-filter-label" style={{ fontSize: 10.5, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.4, textTransform: 'uppercase' }}>Trigger</span>
                <div style={{ minWidth: 180 }}>
                  <MasterSelect
                    value={triggerFilter}
                    onChange={setTriggerFilter}
                    options={[{ value: '', label: 'All' }, ...triggerPoints.map(t => ({ value: String(t.id), label: t.module_name }))]}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="dtm-filter-label" style={{ fontSize: 10.5, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.4, textTransform: 'uppercase' }}>Status</span>
                <div style={{ minWidth: 160 }}>
                  <MasterSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      { value: '', label: 'All' },
                      { value: 'Active', label: 'Active' },
                      { value: 'Draft', label: 'Draft' },
                      { value: 'Deprecated', label: 'Deprecated' },
                    ]}
                    placeholder="All"
                  />
                </div>
              </div>
              <div className="ms-auto">
                <span style={{ fontSize: 11.5, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', padding: '5px 12px', borderRadius: 999 }}>
                  {filtered.length} {filtered.length === 1 ? 'template' : 'templates'}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Table */}
          <Card style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="table-responsive">
                <table className="table align-middle mb-0 dtm-table" style={{ fontSize: 13 }}>
                  <thead className="dtm-thead" style={{ background: '#f5f3ff' }}>
                    <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px', width: 40 }}>#</th>
                      <th>Code</th>
                      <th>Template Name</th>
                      <th>Version</th>
                      <th>Auto-Trigger</th>
                      <th>Status</th>
                      <th>Generate</th>
                      <th style={{ width: 200 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={5} cols={8} />
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={8} className="dtm-empty" style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                        <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                        No templates yet for {category} · {roleType}. Click <strong>+ Add Template</strong> to create one.
                      </td></tr>
                    ) : (
                      filtered.map((r, i) => {
                        const tone = STATUS_TONES[r.status] || STATUS_TONES.Draft;
                        return (
                          <tr key={r.id}>
                            <td style={{ padding: '10px 12px' }}>{i + 1}</td>
                            <td>
                              <span className="dtm-code-pill" style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 6, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700, background: '#fef3c7', color: '#a16207' }}>{r.code}</span>
                            </td>
                            <td>
                              <div className="dtm-tpl-name" style={{ fontWeight: 700, color: '#1f2937' }}>{r.name}</div>
                              {r.requires_manager_approval && (
                                <div className="d-flex gap-1 mt-1">
                                  <span className="dtm-approval-pill" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}><i className="ri-error-warning-line" /> Approval</span>
                                </div>
                              )}
                            </td>
                            <td><span className="dtm-version-pill" style={{ padding: '2px 8px', borderRadius: 6, background: '#f3f4f6', color: '#374151', fontSize: 11.5, fontWeight: 700 }}>{r.version}</span></td>
                            <td><span className="dtm-trigger-pill" style={{ padding: '3px 8px', borderRadius: 6, background: '#e0e7ff', color: '#4338ca', fontSize: 11.5, fontWeight: 600 }}>{r.trigger_point?.module_name || '—'}</span></td>
                            <td>
                              <span className={`dtm-status-pill dtm-status-${r.status}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 700 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot, display: 'inline-block' }} />{r.status}
                              </span>
                            </td>
                            <td>
                              <button type="button" onClick={() => handleGenerate(r)}
                                style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <i className="ri-play-fill" /> Generate Document
                              </button>
                            </td>
                            <td>
                              <div className="d-flex gap-1">
                                <ActionBtn icon="ri-pencil-line"  tone="info"    onClick={() => navigate(`/hr/doc-templates/${r.id}/edit`)} title="Edit" />
                                <ActionBtn icon="ri-more-2-fill"  tone="dark"    onClick={() => toast.info('Coming soon', 'More actions menu.')} title="More" />
                                <ActionBtn icon={r.status === 'Active' ? 'ri-forbid-2-line' : 'ri-checkbox-circle-line'} tone={r.status === 'Active' ? 'danger' : 'success'} onClick={() => handleToggleStatus(r)} title={r.status === 'Active' ? 'Deprecate' : 'Activate'} />
                                <ActionBtn icon="ri-delete-bin-line" tone="danger" onClick={() => handleDelete(r)} title="Delete" />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      </Col>
    </Row>
  );
}

function ActionBtn({ icon, tone, onClick, title }: { icon: string; tone: 'primary' | 'info' | 'success' | 'danger' | 'dark'; onClick: () => void; title: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    primary: { bg: '#ede9fe', fg: '#6d28d9' },
    info:    { bg: '#dbeafe', fg: '#1d4ed8' },
    success: { bg: '#dcfce7', fg: '#15803d' },
    danger:  { bg: '#fee2e2', fg: '#b91c1c' },
    dark:    { bg: '#e5e7eb', fg: '#374151' },
  };
  const c = palette[tone];
  return (
    <button type="button" onClick={onClick} title={title}
      className={`dtm-act-btn dtm-act-${tone}`}
      style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: c.bg, color: c.fg, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={icon} />
    </button>
  );
}

/* Dark-theme overrides for this page. Light styles stay inline; these rules
   only fire under [data-bs-theme="dark"] so the page reads cleanly on dark
   card surfaces (translucent fills instead of pastel light backgrounds). */
function DtmDarkStyles() {
  return (
    <style>{`
      /* Tab-strip rows (category + role) — hover state on inactive tabs only;
         active tab already carries its own gradient + shadow so leave it. */
      .dtm-page .dtm-cat-tab-btn:not([style*="linear-gradient"]):hover,
      .dtm-page .dtm-role-chip:not([style*="linear-gradient"]):hover {
        background: var(--vz-card-bg) !important;
        color: var(--vz-heading-color, var(--vz-body-color)) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-cat-tab-btn:not([style*="linear-gradient"]):hover,
      [data-bs-theme="dark"] .dtm-page .dtm-role-chip:not([style*="linear-gradient"]):hover {
        background: rgba(255,255,255,0.06) !important;
        color: #fff !important;
      }

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
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-tile:hover {
        box-shadow: 0 10px 22px rgba(0,0,0,0.45);
        border-color: rgba(167,139,250,0.55) !important;
      }

      [data-bs-theme="dark"] .dtm-page .dtm-header-icon {
        background: linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25)) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-active-badge {
        background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-tile {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-num { color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-kpi-label { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-filter-label { color: rgba(255,255,255,0.5) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-thead {
        background: rgba(124,92,252,0.14) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-thead tr,
      [data-bs-theme="dark"] .dtm-page .dtm-thead th {
        color: rgba(255,255,255,0.65) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-table tbody td {
        border-bottom-color: var(--vz-border-color) !important;
        color: var(--vz-body-color);
      }
      [data-bs-theme="dark"] .dtm-page .dtm-tpl-name { color: rgba(255,255,255,0.95) !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-empty { color: rgba(255,255,255,0.5) !important; }

      [data-bs-theme="dark"] .dtm-page .dtm-code-pill {
        background: rgba(251,191,36,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-approval-pill {
        background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-version-pill {
        background: var(--vz-secondary-bg) !important; color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-trigger-pill {
        background: rgba(124,92,252,0.20) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Draft {
        background: rgba(245,158,11,0.18) !important; color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Active {
        background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .dtm-page .dtm-status-Deprecated {
        background: rgba(248,113,113,0.18) !important; color: #fca5a5 !important;
      }

      [data-bs-theme="dark"] .dtm-page .dtm-act-primary { background: rgba(167,139,250,0.18) !important; color: #c4b5fd !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-act-info    { background: rgba(96,165,250,0.18) !important; color: #93c5fd !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-act-success { background: rgba(34,197,94,0.18) !important; color: #6ee7b7 !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-act-danger  { background: rgba(248,113,113,0.18) !important; color: #fca5a5 !important; }
      [data-bs-theme="dark"] .dtm-page .dtm-act-dark    { background: var(--vz-secondary-bg) !important; color: var(--vz-body-color) !important; }
    `}</style>
  );
}
