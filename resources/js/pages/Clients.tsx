import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner } from 'reactstrap';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Client, PaginatedResponse } from '../types';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

export default function Clients({ onNavigate }: Props) {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [exporting, setExporting] = useState(false);

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

  useEffect(() => { fetchClients(); }, [fetchClients]);

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

  return (
    <>
      {/* Page title */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Clients</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Clients</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card>
            <CardHeader className="border-0">
              <Row className="align-items-center gy-3">
                <div className="col-sm">
                  <h5 className="card-title mb-0">All Clients <span className="badge bg-primary-subtle text-primary ms-1">{total}</span></h5>
                </div>
                <div className="col-sm-auto">
                  <div className="d-flex gap-2 flex-wrap">
                    <Button color="light" onClick={handleExport} disabled={exporting}>
                      {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                      {exporting ? 'Exporting...' : 'Export'}
                    </Button>
                    <Button color="success" onClick={() => onNavigate('client-form')}>
                      <i className="ri-add-line align-bottom me-1"></i> Add Client
                    </Button>
                  </div>
                </div>
              </Row>
            </CardHeader>

            <CardBody className="border border-dashed border-end-0 border-start-0 py-3">
              <Row>
                <Col md={4}>
                  <div className="search-box me-2 mb-0 d-inline-block w-100">
                    <Input type="text" className="form-control search" placeholder="Search by name or ID..."
                      value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                    <i className="ri-search-line search-icon"></i>
                  </div>
                </Col>
                <Col md={8} className="text-md-end text-muted fs-13">
                  {loading ? 'Loading...' : `${clients.length} of ${total} results`}
                </Col>
              </Row>
            </CardBody>

            <CardBody>
              <div className="table-responsive table-card">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>#</th>
                      <th>Organization</th>
                      <th>Unique ID</th>
                      <th>Contact</th>
                      <th>Type</th>
                      <th>Branches</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="text-center py-5"><Spinner color="primary" /></td></tr>
                    ) : clients.length === 0 ? (
                      <tr><td colSpan={9} className="text-center text-muted py-5">No clients found</td></tr>
                    ) : clients.map((c, i) => (
                      <tr key={c.id}>
                        <td>{(page - 1) * 15 + i + 1}</td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div className="avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], fontSize: 11 }}>
                              {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                            </div>
                            <div className="fw-semibold">{c.org_name}</div>
                          </div>
                        </td>
                        <td><span className="fw-medium text-primary font-monospace">{c.unique_number}</span></td>
                        <td>
                          <div>{c.email}</div>
                          {c.phone && <div className="text-muted fs-12">{c.phone}</div>}
                        </td>
                        <td><Badge color="info-subtle" className="text-info text-uppercase">{c.org_type}</Badge></td>
                        <td>
                          <Badge color="warning" pill>{c.branches_count ?? 0}</Badge>
                        </td>
                        <td>
                          <Badge color="primary-subtle" className="text-primary">{c.plan?.name || 'Free'}</Badge>
                          {c.plan && c.plan.price > 0 && <span className="text-success fw-semibold ms-2 fs-12">₹{c.plan.price.toLocaleString()}/yr</span>}
                        </td>
                        <td><Badge color={c.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{c.status}</Badge></td>
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-soft-success" title="View" onClick={() => onNavigate('client-view', { clientId: c.id })}>
                              <i className="ri-eye-fill"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-primary" title="Edit" onClick={() => onNavigate('client-form', { editId: c.id })}>
                              <i className="ri-pencil-fill"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-danger" title="Delete" disabled={deleting === c.id} onClick={() => handleDeleteClick(c)}>
                              <i className="ri-delete-bin-5-fill"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-info" title="Branches" onClick={() => onNavigate('client-branches', { clientId: c.id, clientName: c.org_name })}>
                              <i className="ri-git-branch-line"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-warning" title="Permissions" onClick={() => onNavigate('client-permissions', { clientId: c.id, clientName: c.org_name })}>
                              <i className="ri-shield-check-line"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-success" title="Payments" onClick={() => onNavigate('client-payments', { clientId: c.id, clientName: c.org_name })}>
                              <i className="ri-money-rupee-circle-line"></i>
                            </button>
                            <button className="btn btn-sm btn-soft-secondary" title="Settings" onClick={() => onNavigate('client-settings', { clientId: c.id, clientName: c.org_name })}>
                              <i className="ri-settings-3-line"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <span className="text-muted fs-13">Showing {clients.length} of {total} entries</span>
                  <nav>
                    <ul className="pagination pagination-sm mb-0">
                      <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
                        <button className="page-link" onClick={() => setPage(p => Math.max(1, p - 1))}>
                          <i className="ri-arrow-left-s-line"></i>
                        </button>
                      </li>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                        <li key={n} className={`page-item ${n === page ? 'active' : ''}`}>
                          <button className="page-link" onClick={() => setPage(n)}>{n}</button>
                        </li>
                      ))}
                      <li className={`page-item ${page === totalPages ? 'disabled' : ''}`}>
                        <button className="page-link" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                          <i className="ri-arrow-right-s-line"></i>
                        </button>
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
        open={deleteOpen}
        clientName={selectedClient?.org_name}
        onClose={() => { setDeleteOpen(false); setSelectedClient(null); }}
        onConfirm={confirmDelete}
        loading={deleting !== null}
      />
    </>
  );
}
