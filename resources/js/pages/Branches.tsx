import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner, Alert } from 'reactstrap';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Branch>>('/branches', {
        params: { search: search || undefined, page, per_page: 10 },
      });
      setBranches(res.data.data);
      setTotalPages(res.data.last_page);
      setTotal(res.data.total);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  const mainBranch = branches.find(b => b.is_main);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Branches</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Branches</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {mainBranch && (
        <Alert color="warning" className="d-flex align-items-center">
          <i className="ri-star-fill me-2"></i>
          <div>
            <strong>Main Branch</strong> — {mainBranch.name} · Main branch users can view all branches data
          </div>
        </Alert>
      )}

      <Row>
        <Col xs={12}>
          <Card>
            <CardHeader className="border-0">
              <Row className="align-items-center gy-3">
                <div className="col-sm">
                  <h5 className="card-title mb-0">All Branches <span className="badge bg-primary-subtle text-primary ms-1">{total}</span></h5>
                </div>
                <div className="col-sm-auto">
                  <div className="d-flex gap-2 flex-wrap">
                    <Button color="light">
                      <i className="ri-download-2-line align-bottom me-1"></i> Export
                    </Button>
                    <Button color="success" onClick={() => onNavigate('branch-form')}>
                      <i className="ri-add-line align-bottom me-1"></i> Add Branch
                    </Button>
                  </div>
                </div>
              </Row>
            </CardHeader>

            <CardBody className="border border-dashed border-end-0 border-start-0 py-3">
              <Row>
                <Col md={4}>
                  <div className="search-box me-2 mb-0 d-inline-block w-100">
                    <Input type="text" className="form-control search" placeholder="Search by name, code, city..."
                      value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                    <i className="ri-search-line search-icon"></i>
                  </div>
                </Col>
                <Col md={8} className="text-md-end text-muted fs-13">
                  {loading ? 'Loading...' : `${branches.length} of ${total} results`}
                </Col>
              </Row>
            </CardBody>

            <CardBody>
              <div className="table-responsive table-card">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>#</th>
                      <th>Branch / Company</th>
                      <th>Code</th>
                      <th>Type & Industry</th>
                      <th>Contact</th>
                      <th>Location</th>
                      <th>Users</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="text-center py-5"><Spinner color="primary" /></td></tr>
                    ) : branches.length === 0 ? (
                      <tr><td colSpan={9} className="text-center text-muted py-5">No branches found. Click "Add Branch" to create one.</td></tr>
                    ) : branches.map((b, i) => {
                      const typeIcon = typeIconMap[b.branch_type || ''] || 'ri-git-branch-line';
                      return (
                        <tr key={b.id}>
                          <td>{(page - 1) * 15 + i + 1}</td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div className="avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], fontSize: 11 }}>
                                {b.name.charAt(0)}{b.name.split(' ')[1]?.charAt(0) || ''}
                              </div>
                              <div>
                                <div className="fw-semibold d-flex align-items-center gap-1">
                                  {b.name}
                                  {b.is_main && (
                                    <span className="badge bg-warning-subtle text-warning text-uppercase fs-10 px-1">
                                      <i className="ri-star-fill me-1"></i>Main
                                    </span>
                                  )}
                                </div>
                                {b.description && <div className="text-muted fs-12 text-truncate" style={{ maxWidth: 200 }}>{b.description}</div>}
                              </div>
                            </div>
                          </td>
                          <td>
                            {b.code ? (
                              <span className="fw-medium text-primary font-monospace">{b.code}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            {b.branch_type ? (
                              <div>
                                <i className={`${typeIcon} me-1 text-muted`}></i>
                                <span className="text-capitalize">{b.branch_type}</span>
                              </div>
                            ) : <span className="text-muted">—</span>}
                            {b.industry && <div className="text-muted fs-12">{b.industry}</div>}
                          </td>
                          <td>
                            {b.contact_person && <div className="fw-medium">{b.contact_person}</div>}
                            {b.email && <div className="text-muted fs-12">{b.email}</div>}
                            {b.phone && <div className="text-muted fs-12">{b.phone}</div>}
                            {!b.contact_person && !b.email && <span className="text-muted">—</span>}
                          </td>
                          <td>
                            {b.city && <span>{b.city}</span>}
                            {b.city && b.state && <span className="text-muted">, </span>}
                            {b.state && <span className="text-muted">{b.state}</span>}
                            {!b.city && !b.state && <span className="text-muted">—</span>}
                          </td>
                          <td>
                            <Badge color="info" pill>{b.users_count ?? 0}</Badge>
                          </td>
                          <td><Badge color={b.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{b.status}</Badge></td>
                          <td>
                            <div className="d-flex gap-1">
                              <button className="btn btn-sm btn-soft-primary" title="Edit" onClick={() => onNavigate('branch-form', { editId: b.id })}>
                                <i className="ri-pencil-fill"></i>
                              </button>
                              <button className="btn btn-sm btn-soft-danger" title="Delete" disabled={deleting === b.id} onClick={() => openDeleteModal(b)}>
                                <i className="ri-delete-bin-5-fill"></i>
                              </button>
                              <button className="btn btn-sm btn-soft-info" title="Users" onClick={() => onNavigate('branch-users', { branchId: b.id, branchName: b.name })}>
                                <i className="ri-team-line"></i>
                              </button>
                              <button className="btn btn-sm btn-soft-warning" title="Permissions" onClick={() => onNavigate('permissions', { branchId: b.id, branchName: b.name })}>
                                <i className="ri-shield-check-line"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <span className="text-muted fs-13">Showing {branches.length} of {total} entries</span>
                  <nav>
                    <ul className="pagination pagination-sm mb-0">
                      <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
                        <button className="page-link" onClick={() => setPage(p => Math.max(1, p - 1))}><i className="ri-arrow-left-s-line"></i></button>
                      </li>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                        <li key={n} className={`page-item ${n === page ? 'active' : ''}`}>
                          <button className="page-link" onClick={() => setPage(n)}>{n}</button>
                        </li>
                      ))}
                      <li className={`page-item ${page === totalPages ? 'disabled' : ''}`}>
                        <button className="page-link" onClick={() => setPage(p => Math.min(totalPages, p + 1))}><i className="ri-arrow-right-s-line"></i></button>
                      </li>
                    </ul>
                  </nav>
                </div>
              )}
            </CardBody>
          </Card>
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
