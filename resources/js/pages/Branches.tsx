import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Spinner } from 'reactstrap';
import TableContainer from '../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Branch, PaginatedResponse } from '../types';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

const typeIconMap: Record<string, string> = {
  company: 'ri-building-line',
  division: 'ri-git-branch-line',
  factory: 'ri-home-gear-line',
  warehouse: 'ri-archive-2-line',
};

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

export default function Branches({ onNavigate }: Props) {
  const toast = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const [exporting, setExporting] = useState(false);

  // ── Fetch all branches once; TableContainer paginates client-side (matches Clients page) ──
  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Branch>>('/branches', {
        params: { per_page: 9999 },
      });
      setBranches(res.data.data);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  // ── Client-side search filter ──
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(b =>
      [b.name, b.code, b.branch_type, b.industry, b.city, b.state, b.contact_person, b.email, b.phone]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [branches, searchInput]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = branches.length;
    const active = branches.filter(b => b.status === 'active').length;
    const inactive = branches.filter(b => b.status !== 'active').length;
    const users = branches.reduce((s, b) => s + (b.users_count ?? 0), 0);
    return { total, active, inactive, users };
  }, [branches]);

  const mainBranchName = branches.find(b => b.is_main)?.name;

  const openDeleteModal = (branch: Branch) => {
    if (branch.is_main) {
      toast.warning('Cannot Delete', 'Main branch cannot be deleted. Set another branch as main first.');
      return;
    }
    setDeleteModal({ open: true, branch });
  };

  const confirmDelete = async () => {
    if (!deleteModal.branch) return;
    const branch = deleteModal.branch;
    setDeleting(branch.id);
    try {
      await api.delete(`/branches/${branch.id}`);
      toast.success('Branch Deleted', `"${branch.name}" has been deleted successfully`);
      setDeleteModal({ open: false, branch: null });
      fetchBranches();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Failed to delete branch');
    } finally {
      setDeleting(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = branches.map((b, i) => ({
        '#': i + 1,
        'Branch': b.name,
        'Code': b.code || '',
        'Main Branch': b.is_main ? 'Yes' : 'No',
        'Type': b.branch_type || '',
        'Industry': b.industry || '',
        'Contact Person': b.contact_person || '',
        'Email': b.email || '',
        'Phone': b.phone || '',
        'City': b.city || '',
        'State': b.state || '',
        'Users': b.users_count ?? 0,
        'Status': b.status,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Branches');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `Branches_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${branches.length} branches exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export branches');
    } finally {
      setExporting(false);
    }
  };

  // ── Clients-page style compact action button ──
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
        const tint =
          color === 'primary' ? '#40518918' :
            color === 'danger' ? '#f0654818' :
              color === 'success' ? '#0ab39c18' :
                color === 'info' ? '#299cdb18' :
                  color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)';
        el.style.background = tint;
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

  // ── Table columns ──
  const columns = useMemo(() => [
    {
      header: '#',
      accessorKey: '__idx',
      cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
    },
    {
      header: 'Branch',
      accessorKey: 'name',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{
                width: 34, height: 34, fontSize: 12,
                background: `linear-gradient(135deg, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}cc)`,
                boxShadow: `0 2px 6px ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}40`,
              }}
            >
              {b.name.charAt(0)}{b.name.split(' ')[1]?.charAt(0) || ''}
            </div>
            <div className="min-w-0">
              <div className="fw-semibold fs-13 d-flex align-items-center gap-1 text-truncate">
                {b.name}
                {b.is_main && (
                  <span className="badge bg-warning-subtle text-warning text-uppercase fs-10 px-1 ms-1">
                    <i className="ri-star-fill me-1" />MAIN
                  </span>
                )}
              </div>
              {b.description && <div className="text-muted fs-11 text-truncate" style={{ maxWidth: 240 }}>{b.description}</div>}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: (info: any) => info.row.original.code
        ? <span className="fw-medium text-primary font-monospace fs-13">{info.row.original.code}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Type',
      accessorKey: 'branch_type',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        const ti = typeIconMap[b.branch_type || ''] || 'ri-git-branch-line';
        return b.branch_type ? (
          <div>
            <span className="d-inline-flex align-items-center gap-1 fs-13">
              <i className={`${ti} text-muted`} />
              <span className="text-capitalize">{b.branch_type}</span>
            </span>
            {b.industry && <div className="text-muted fs-11">{b.industry}</div>}
          </div>
        ) : <span className="text-muted">—</span>;
      },
    },
    {
      header: 'Contact',
      accessorKey: 'contact_person',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        return b.contact_person
          ? <span className="fw-semibold fs-13" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{b.contact_person}</span>
          : <span className="text-muted">—</span>;
      },
    },
    {
      header: 'Email',
      accessorKey: 'email',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        if (!b.email) return <span className="text-muted">—</span>;
        return (
          <a
            href={`mailto:${b.email}`}
            className="d-inline-flex align-items-center gap-1 text-decoration-none"
            style={{ fontSize: 12.5, color: 'var(--vz-body-color)', maxWidth: '100%' }}
            title={b.email}
          >
            <i className="ri-mail-line flex-shrink-0" style={{ fontSize: 14, color: '#7c5cfc' }} />
            <span className="text-truncate" style={{ minWidth: 0 }}>{b.email}</span>
          </a>
        );
      },
    },
    {
      header: 'Phone',
      accessorKey: 'phone',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        if (!b.phone) return <span className="text-muted">—</span>;
        return (
          <a
            href={`tel:${b.phone}`}
            className="d-inline-flex align-items-center gap-1 text-decoration-none"
            style={{ fontSize: 12.5, color: 'var(--vz-body-color)' }}
            title={b.phone}
          >
            <i className="ri-phone-line flex-shrink-0" style={{ fontSize: 14, color: '#0ab39c' }} />
            <span className="font-monospace">{b.phone}</span>
          </a>
        );
      },
    },
    {
      header: 'Location',
      accessorKey: 'city',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        const loc = [b.city, b.state].filter(Boolean).join(', ');
        return loc ? <span className="fs-13">{loc}</span> : <span className="text-muted">—</span>;
      },
    },
    {
      header: 'Users',
      accessorKey: 'users_count',
      cell: (info: any) => (
        <span className="d-inline-flex align-items-center gap-1 fs-13">
          <i className="ri-team-line text-muted" />
          <span className="fw-semibold">{info.row.original.users_count ?? 0}</span>
        </span>
      ),
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
      cell: (info: any) => {
        const b: Branch = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center">
            <ActionBtn title="View" icon="ri-eye-line" color="primary" onClick={() => onNavigate('branch-view', { branchId: b.id })} />
            <ActionBtn title="Edit" icon="ri-pencil-line" color="info" onClick={() => onNavigate('branch-form', { editId: b.id })} />
            <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger" disabled={deleting === b.id} onClick={() => openDeleteModal(b)} />
            <ActionBtn title="Users" icon="ri-team-line" color="primary" onClick={() => onNavigate('branch-users', { branchId: b.id, branchName: b.name })} />
            <ActionBtn title="Permissions" icon="ri-shield-check-line" color="success" onClick={() => onNavigate('permissions', { branchId: b.id, branchName: b.name })} />
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleting]);

  // ── KPI cards definition ──
  const KPI_CARDS = [
    { label: 'Total Branches', value: stats.total, icon: 'ri-git-branch-line', gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active Branches', value: stats.active, icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Inactive Branches', value: stats.inactive, icon: 'ri-close-circle-fill', gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
    { label: 'Total Users', value: stats.users, icon: 'ri-team-fill', gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)' },
  ];

  return (
    <>
      <style>{`
        .branches-surface { background: #ffffff; }
        [data-bs-theme="dark"] .branches-surface { background: #1c2531; }
      `}</style>

      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Branches</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Admin</a></li>
                <li className="breadcrumb-item active">Branches</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <div
            className="branches-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── KPI cards ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="branches-surface"
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
                        {k.label === 'Total Branches' && mainBranchName && (
                          <p className="text-muted mt-2 mb-0" style={{ fontSize: 11 }}>
                            <i className="ri-star-fill text-warning me-1" />
                            Main: {mainBranchName}
                          </p>
                        )}
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Search + Export + Add Branch ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by name, code, city..."
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
                  onClick={() => onNavigate('branch-form')}
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Branch
                </Button>
              </Col>
            </Row>

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <TableContainer
                  columns={columns}
                  data={filtered}
                  isGlobalFilter={false}
                  customPageSize={10}
                  tableClass="align-middle table-nowrap mb-0"
                  theadClass="table-light"
                  divClass="table-responsive table-card border rounded"
                  SearchPlaceholder="Search by name, code, city..."
                />
                {loading && <div className="text-center py-5"><Spinner color="primary" /></div>}
                {!loading && filtered.length === 0 && (
                  <div className="text-center text-muted py-5">
                    No branches found. Click "Add Branch" to create one.
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <DeleteConfirmModal
        open={deleteModal.open}
        clientName={deleteModal.branch?.name}
        onClose={() => setDeleteModal({ open: false, branch: null })}
        onConfirm={confirmDelete}
        loading={deleting !== null}
      />
    </>
  );
}
