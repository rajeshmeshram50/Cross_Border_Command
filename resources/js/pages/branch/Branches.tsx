import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Spinner } from 'reactstrap';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';
import { ShimmerTable } from '../../components/ui/Shimmer';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Branch, PaginatedResponse } from '../../types';

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
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
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
    </Tooltip>
  );

  // ── Table columns ──
  const columns = useMemo(() => [
    {
      header: 'Sr No',
      accessorKey: '__idx',
      cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
    },
    {
      header: 'Branch',
      accessorKey: 'name',
      cell: (info: any) => {
        const b: any = info.row.original;
        const photo = b.profile_photo_url || b.profile_photo;
        return (
          <div className="d-flex align-items-center gap-2">
            {photo ? (
              <img
                src={photo}
                alt={b.name}
                className="rounded-circle flex-shrink-0"
                style={{ width: 34, height: 34, objectFit: 'cover', border: '1px solid rgba(128,128,128,0.2)' }}
              />
            ) : (
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
            )}
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
        : <span className="text-muted fs-13">—</span>,
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
          : <span className="text-muted fs-13">—</span>;
      },
    },
    {
      header: 'Email',
      accessorKey: 'email',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        if (!b.email) return <span className="text-muted fs-13">—</span>;
        return (
          <Tooltip label={b.email}>
            <a
              href={`mailto:${b.email}`}
              className="d-inline-flex align-items-center gap-1 text-decoration-none fs-13"
              style={{ color: 'var(--vz-body-color)', maxWidth: '100%' }}
            >
              <i className="ri-mail-line flex-shrink-0 fs-13" style={{ color: '#7c5cfc' }} />
              <span className="text-truncate" style={{ minWidth: 0 }}>{b.email}</span>
            </a>
          </Tooltip>
        );
      },
    },
    {
      header: 'Phone',
      accessorKey: 'phone',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        if (!b.phone) return <span className="text-muted fs-13">—</span>;
        return (
          <Tooltip label={b.phone}>
            <a
              href={`tel:${b.phone}`}
              className="d-inline-flex align-items-center gap-1 text-decoration-none fs-13"
              style={{ color: 'var(--vz-body-color)' }}
            >
              <i className="ri-phone-line flex-shrink-0 fs-13" style={{ color: '#0ab39c' }} />
              <span className="font-monospace">{b.phone}</span>
            </a>
          </Tooltip>
        );
      },
    },
    {
      header: 'Location',
      accessorKey: 'city',
      cell: (info: any) => {
        const b: Branch = info.row.original;
        const loc = [b.city, b.state].filter(Boolean).join(', ');
        return loc ? <span className="fs-13">{loc}</span> : <span className="text-muted fs-13">—</span>;
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
      header: 'Org. Status',
      accessorKey: 'status',
      cell: (info: any) => {
        const isActive = info.row.original.status === 'active';
        const color = isActive ? 'success' : 'danger';
        const label = isActive ? 'Active' : 'Inactive';
        return (
          <span className={`badge rounded-pill bg-${color}-subtle text-${color} fw-semibold px-3 py-2`}>
            {label}
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
            <ActionBtn title="Employees" icon="ri-team-line" color="primary" onClick={() => onNavigate('branch-users', { branchId: b.id, branchName: b.name })} />
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

        /* Unify table typography — every cell + header reads at the same
           13px size so the table looks like a single grid (matches the
           Clients list). */
        .branches-surface .table thead th,
        .branches-surface .table tbody td {
          font-size: 13px;
          vertical-align: middle;
        }
        .branches-surface .table thead th {
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        /* KPI cards — haptic hover lift, identical feel to the Clients /
           Payments / Branch-dashboard KPIs so every list page feels alive
           on hover instead of sitting flat. Transform + layered shadow
           only — no layout change so the row never reflows. */
        .branches-kpi {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease,
            border-color 220ms ease;
          will-change: transform;
          cursor: default;
        }
        .branches-kpi:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 36px -8px rgba(64, 81, 137, 0.28),
            0 8px 16px -4px rgba(64, 81, 137, 0.18),
            0 2px 4px rgba(0, 0, 0, 0.06);
          border-color: rgba(64, 81, 137, 0.35);
        }
        .branches-kpi:hover .branches-kpi-icon {
          transform: scale(1.08) rotate(-3deg);
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
        }
        .branches-kpi-icon {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease;
        }
        [data-bs-theme="dark"] .branches-kpi:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 8px 16px -4px rgba(0, 0, 0, 0.45),
            0 2px 4px rgba(0, 0, 0, 0.30);
          border-color: rgba(124, 92, 252, 0.50);
        }

        /* Export button — outlined emerald style. Distinct from the
           solid-purple Add button so the two never read as duplicates.
           Uses transparent + theme-aware tints so dark mode doesn't
           glow bright like a hard-coded #fff would. */
        .export-btn,
        .export-btn:focus,
        .export-btn:active {
          background: transparent !important;
          color: #0ab39c !important;
          border: 1px solid #0ab39c !important;
          box-shadow: none !important;
          transition:
            background 200ms ease,
            color 200ms ease,
            border-color 200ms ease,
            transform 200ms ease;
        }
        .export-btn:hover:not(:disabled) {
          background: rgba(10, 179, 156, 0.10) !important;
          color: #099481 !important;
          border-color: #099481 !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(10, 179, 156, 0.18) !important;
        }
        .export-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        [data-bs-theme="dark"] .export-btn,
        [data-bs-theme="dark"] .export-btn:focus,
        [data-bs-theme="dark"] .export-btn:active {
          color: #2ec7b0 !important;
          border-color: #2ec7b0 !important;
        }
        [data-bs-theme="dark"] .export-btn:hover:not(:disabled) {
          background: rgba(46, 199, 176, 0.14) !important;
          color: #5be0cb !important;
          border-color: #5be0cb !important;
          box-shadow: 0 4px 14px rgba(46, 199, 176, 0.28) !important;
        }
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
                    className="branches-surface branches-kpi"
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
                      <div className="branches-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
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
                  className="rounded-pill px-3 export-btn"
                  style={{ fontWeight: 600 }}
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
                {loading ? (
                  <ShimmerTable rows={6} cols={9} />
                ) : (
                  <>
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
                    {filtered.length === 0 && (
                      <div className="text-center text-muted py-5">
                        No branches found. Click "Add Branch" to create one.
                      </div>
                    )}
                  </>
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
