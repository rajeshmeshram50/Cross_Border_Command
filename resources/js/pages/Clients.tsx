import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Input } from 'reactstrap';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import TableContainer from '../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Client, PaginatedResponse } from '../types';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

interface ClientStats {
  total: number;
  active: number;
  inactive: number;
  plans_count: number;
  plan_breakdown: { plan_name: string; count: number }[];
}

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

export default function Clients({ onNavigate }: Props) {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [, setTotalPages] = useState(1);
  const [, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<ClientStats>({
    total: 0, active: 0, inactive: 0, plans_count: 0, plan_breakdown: [],
  });

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Client>>('/clients', {
        params: { search: search || undefined, page, per_page: 15 },
      });
      setClients(res.data.data);
      setTotalPages(res.data.last_page);
      setTotal(res.data.total);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<ClientStats>('/clients/stats');
      setStats(res.data);
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchStats(); }, [fetchStats, clients.length]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get<PaginatedResponse<Client>>('/clients', { params: { per_page: 9999 } });
      const allClients = res.data.data;
      const rows = allClients.map((c, i) => ({
        '#': i + 1, 'Organization Name': c.org_name, 'Unique ID': c.unique_number,
        'Email': c.email, 'Phone': c.phone || '', 'Type': c.org_type,
        'City': c.city || '', 'State': c.state || '',
        'Plan': c.plan?.name || 'Free', 'Status': c.status,
        'Branches': c.branches_count ?? 0, 'Users': c.users_count ?? 0,
        'Created At': new Date(c.created_at).toLocaleDateString('en-IN'),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clients');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `Clients_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${allClients.length} clients exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export clients');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteClick = (c: Client) => { setSelectedClient(c); setDeleteOpen(true); };

  const confirmDelete = async () => {
    if (!selectedClient) return;
    setDeleting(selectedClient.id);
    try {
      await api.delete(`/clients/${selectedClient.id}`);
      toast.success('Deleted', `${selectedClient.org_name} deleted successfully`);
      fetchClients();
      setDeleteOpen(false);
      setSelectedClient(null);
    } catch {
      toast.error('Error', 'Failed to delete client');
    } finally {
      setDeleting(null);
    }
  };

  // Reusable action button — outline icon pill with hover color
  const ActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        transition: 'all .15s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = `var(--vz-${color}-bg-subtle, ${color === 'primary' ? '#40518918' : color === 'danger' ? '#f0654818' : color === 'success' ? '#0ab39c18' : color === 'info' ? '#299cdb18' : color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)'})`;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--vz-secondary-bg)';
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );

  // Table columns for TableContainer
  const columns = [
    {
      header: '#',
      accessorKey: 'index',
      cell: (info: any) => <span className="text-muted fs-13">{(page - 1) * 15 + info.row.index + 1}</span>,
    },
    {
      header: 'Organization',
      accessorKey: 'org_name',
      cell: (info: any) => (
        <div className="d-flex align-items-center gap-2">
          <div
            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
            style={{
              width: 34, height: 34, fontSize: 12,
              background: `linear-gradient(135deg, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}cc)`,
              boxShadow: `0 2px 6px ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}40`,
            }}
          >
            {info.row.original.org_name.charAt(0)}{info.row.original.org_name.split(' ')[1]?.charAt(0) || ''}
          </div>
          <span className="fw-semibold fs-13">{info.row.original.org_name}</span>
        </div>
      ),
    },
    {
      header: 'Unique ID',
      accessorKey: 'unique_number',
      cell: (info: any) => (
        <span className="fw-medium text-primary font-monospace fs-13">
          {info.row.original.unique_number}
        </span>
      ),
    },
    {
      header: 'Email',
      accessorKey: 'email',
      cell: (info: any) => (
        <a href={`mailto:${info.row.original.email}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
          <i className="ri-mail-line text-muted fs-13"></i>
          <span className="fs-13">{info.row.original.email}</span>
        </a>
      ),
    },
    {
      header: 'Phone',
      accessorKey: 'phone',
      cell: (info: any) => info.row.original.phone ? (
        <a href={`tel:${info.row.original.phone}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
          <i className="ri-phone-line text-muted fs-13"></i>
          <span className="fs-13 font-monospace">{info.row.original.phone}</span>
        </a>
      ) : <span className="text-muted">—</span>,
    },
    {
      header: 'Type',
      accessorKey: 'org_type',
      cell: (info: any) => (
        <span className="text-uppercase fw-medium text-muted fs-12">
          {info.row.original.org_type}
        </span>
      ),
    },
    {
      header: 'Branches',
      accessorKey: 'branches_count',
      cell: (info: any) => (
        <span className="d-inline-flex align-items-center gap-1 fs-13">
          <i className="ri-git-branch-line text-muted"></i>
          <span className="fw-semibold">{info.row.original.branches_count ?? 0}</span>
        </span>
      ),
    },
    {
      header: 'Plan',
      accessorKey: 'plan_name',
      cell: (info: any) => (
        <span className="fw-semibold fs-13">{info.row.original.plan?.name || 'Free'}</span>
      ),
    },
    {
      header: 'Price',
      accessorKey: 'plan_price',
      cell: (info: any) => {
        const plan = info.row.original.plan;
        if (!plan || plan.price <= 0) return <span className="text-muted">—</span>;
        const suffix = plan.period === 'month' ? '/mo' : plan.period === 'quarter' ? '/qtr' : '/yr';
        return (
          <span className="text-success fw-semibold fs-13">
            ₹{plan.price.toLocaleString()}
            <small className="text-muted fw-normal fs-11 ms-1">{suffix}</small>
          </span>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info: any) => {
        const isActive = info.row.original.status === 'active';
        const color = isActive ? 'success' : 'danger';
        return (
          <span className={`badge rounded-pill border border-${color} text-${color} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}>
            <span className={`bg-${color} rounded-circle`} style={{ width: 6, height: 6 }} />
            {info.row.original.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: 'actions',
      cell: (info: any) => (
        <div className="d-flex gap-1 justify-content-center">
          <ActionBtn title="View"        icon="ri-eye-line"         color="primary" onClick={() => onNavigate('client-view',        { clientId: info.row.original.id })} />
          <ActionBtn title="Edit"        icon="ri-pencil-line"      color="info"    onClick={() => onNavigate('client-form',        { editId:   info.row.original.id })} />
          <ActionBtn title="Delete"      icon="ri-delete-bin-line"  color="danger"  disabled={deleting === info.row.original.id} onClick={() => handleDeleteClick(info.row.original)} />
          <ActionBtn title="Branches"    icon="ri-git-branch-line"  color="primary" onClick={() => onNavigate('client-branches',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Permissions" icon="ri-shield-check-line" color="success" onClick={() => onNavigate('client-permissions', { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Payments"    icon="ri-bank-card-line"   color="warning" onClick={() => onNavigate('client-payments',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Settings"    icon="ri-settings-3-line"  color="secondary" onClick={() => toast.info('Coming Soon', 'Client settings will be available in a future update.')} />
        </div>
      ),
    },
  ];

  const KPI_CARDS = [
    { label: 'Total Clients',    value: stats.total,        icon: 'ri-building-fill',         gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active Clients',   value: stats.active,       icon: 'ri-checkbox-circle-fill',  gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Inactive Clients', value: stats.inactive,     icon: 'ri-close-circle-fill',     gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  ];

  const PLAN_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#7c5cfc', '#299cdb', '#f06548', '#9b72cf'];
  const [hoveredPlan, setHoveredPlan] = useState<{ name: string; count: number; color: string } | null>(null);

  return (
    <>
      <style>{`
        .clients-surface { background: #ffffff; }
        [data-bs-theme="dark"] .clients-surface { background: #1c2531; }
      `}</style>

      <Row>
        <Col xs={12}>
          <div className=" page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Clients</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Admin</a></li>
                <li className="breadcrumb-item active">Clients</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <div
            className="clients-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── KPI cards (single row, equal height) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="clients-surface"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          {k.value.toLocaleString()}
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}

              {/* Plan Distribution — donut + total count, same height as other KPIs */}
              <Col md={3} sm={6} xs={12}>
                <div
                  className="clients-surface"
                  style={{
                    borderRadius: 14,
                    border: '1px solid var(--vz-border-color)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                    padding: '16px 18px',
                    position: 'relative',
                    height: '100%',
                  }}
                >
                  {/* Inner clip wrapper — holds the strip + decorative wave so they
                      respect borderRadius without clipping the donut tooltip. */}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden', pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(135deg,#7c5cfc,#a993fd)' }} />
                    <svg
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.4 }}
                      viewBox="0 0 400 180" preserveAspectRatio="none"
                    >
                      <path d="M0,130 C80,90 180,170 280,110 C340,75 380,120 400,100 L400,180 L0,180 Z" fill="var(--vz-secondary-bg)" />
                    </svg>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                        Plan Distribution
                      </p>
                      <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                        {stats.plans_count.toLocaleString()}
                      </h3>
                      <small style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        {stats.plans_count === 1 ? 'plan in use' : 'plans in use'}
                      </small>
                    </div>

                    {/* Donut with custom controlled tooltip */}
                    <div style={{ width: 76, height: 76, flexShrink: 0, position: 'relative' }}>
                      {stats.plan_breakdown.length === 0 ? (
                        <div style={{
                          width: 76, height: 76, borderRadius: '50%',
                          border: '7px solid var(--vz-secondary-bg)',
                        }} />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={stats.plan_breakdown}
                              dataKey="count"
                              nameKey="plan_name"
                              cx="50%"
                              cy="50%"
                              innerRadius={22}
                              outerRadius={36}
                              paddingAngle={2}
                              stroke="none"
                              isAnimationActive
                              onMouseLeave={() => setHoveredPlan(null)}
                            >
                              {stats.plan_breakdown.map((p, i) => (
                                <Cell
                                  key={i}
                                  fill={PLAN_COLORS[i % PLAN_COLORS.length]}
                                  onMouseEnter={() => setHoveredPlan({
                                    name: p.plan_name,
                                    count: p.count,
                                    color: PLAN_COLORS[i % PLAN_COLORS.length],
                                  })}
                                  style={{ cursor: 'pointer', outline: 'none' }}
                                />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      )}

                      {/* Custom tooltip — anchored above the donut, never clipped */}
                      {hoveredPlan && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 'calc(100% + 6px)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#1e2a3a',
                            color: '#fff',
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '5px 10px',
                            borderRadius: 8,
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                            pointerEvents: 'none',
                            zIndex: 1050,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: hoveredPlan.color }} />
                          {hoveredPlan.name}
                          <strong style={{ fontWeight: 800 }}>{hoveredPlan.count}</strong>
                          {/* Pointer arrow */}
                          <span style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 0, height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderTop: '5px solid #1e2a3a',
                          }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Col>
            </Row>

            {/* ── Search + Export + Add Client (single row) ── */}
            <Row className="g-2 align-items-center mb-6">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by name or ID..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
              <Col md={6} sm={12} className="d-flex justify-content-md-end gap-2 flex-wrap">
                <Button
                  onClick={handleExport}
                  disabled={exporting}
                  className="rounded-pill px-3"
                  style={{
                    background: '#fff',
                    color: 'var(--vz-secondary)',
                    border: '1px solid var(--vz-secondary)',
                    fontWeight: 600,
                    transition: 'background .18s ease, color .18s ease, box-shadow .18s ease, transform .18s ease',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    if (el.disabled) return;
                    el.style.background = 'var(--vz-secondary)';
                    el.style.color = '#fff';
                    el.style.boxShadow = '0 4px 12px rgba(135,138,153,0.35)';
                    el.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.background = '#fff';
                    el.style.color = 'var(--vz-secondary)';
                    el.style.boxShadow = 'none';
                    el.style.transform = 'translateY(0)';
                  }}
                >
                  {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                  {exporting ? 'Exporting...' : 'Export'}
                </Button>
                <Button
                  color="secondary"
                  className="btn-label waves-effect waves-light rounded-pill"
                  onClick={() => onNavigate('client-form')}
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Client
                </Button>
              </Col>
            </Row>

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <TableContainer
                  columns={columns}
                  data={clients}
                  isGlobalFilter={false}
                  customPageSize={15}
                  tableClass="align-middle table-nowrap mb-0"
                  theadClass="table-light"
                  divClass="table-responsive table-card border rounded"
                  SearchPlaceholder="Search by name or ID..."
                />
                {loading && <div className="text-center py-5"><Spinner color="secondary" /></div>}
                {!loading && clients.length === 0 && <div className="text-center text-muted py-5">No clients found</div>}
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <DeleteConfirmModal
        open={deleteOpen}
        clientName={selectedClient?.org_name}
        onClose={() => { setDeleteOpen(false); setSelectedClient(null); }}
        onConfirm={confirmDelete}
        loading={deleting !== null}
      />
    </>
  );
}
