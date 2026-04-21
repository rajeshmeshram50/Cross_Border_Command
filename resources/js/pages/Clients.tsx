import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Spinner } from 'reactstrap';
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

  // Table columns for TableContainer
  const columns = [
    {
      header: '#',
      accessorKey: 'index',
      cell: (info: any) => (page - 1) * 15 + info.row.index + 1,
    },
    {
      header: 'Organization',
      accessorKey: 'org_name',
      cell: (info: any) => (
        <div className="d-flex align-items-center gap-2">
          <div className="avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: AVATAR_COLORS[info.row.index % AVATAR_COLORS.length], fontSize: 11 }}>
            {info.row.original.org_name.charAt(0)}{info.row.original.org_name.split(' ')[1]?.charAt(0) || ''}
          </div>
          <span className="fw-semibold text-dark">{info.row.original.org_name}</span>
        </div>
      ),
    },
    {
      header: 'Unique ID',
      accessorKey: 'unique_number',
      cell: (info: any) => <span className="fw-medium text-primary font-monospace">{info.row.original.unique_number}</span>,
    },
    {
      header: 'Contact',
      accessorKey: 'email',
      cell: (info: any) => (
        <>
          <div>{info.row.original.email}</div>
          {info.row.original.phone && <div className="text-muted fs-12">{info.row.original.phone}</div>}
        </>
      ),
    },
    {
      header: 'Type',
      accessorKey: 'org_type',
      cell: (info: any) => <span className="text-uppercase text-muted small">{info.row.original.org_type}</span>,
    },
    {
      header: 'Branches',
      accessorKey: 'branches_count',
      cell: (info: any) => <span className="text-dark">{info.row.original.branches_count ?? 0}</span>,
    },
    {
      header: 'Plan',
      accessorKey: 'plan',
      cell: (info: any) => (
        <>
          <span className="text-dark fw-semibold">{info.row.original.plan?.name || 'Free'}</span>
          {info.row.original.plan && info.row.original.plan.price > 0 && <span className="text-success fw-semibold ms-2 fs-12">₹{info.row.original.plan.price.toLocaleString()}/yr</span>}
        </>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info: any) => <Badge color={info.row.original.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{info.row.original.status}</Badge>,
    },
 {
  header: 'Actions',
  id: 'actions',
  cell: (info: any) => (
    <div className="d-flex gap-2">
      {/* View - Primary (Blue) */}
      <button
        className="btn btn-outline-primary btn-icon btn-sm border-0"
        title="View"
        onClick={() => onNavigate('client-view', { clientId: info.row.original.id })}
      >
        <i className="ri-eye-line"></i>
      </button>

      {/* Edit - Warning (Orange/Yellow) */}
      <button
        className="btn btn-outline-warning btn-icon btn-sm border-0"
        title="Edit"
        onClick={() => onNavigate('client-form', { editId: info.row.original.id })}
      >
        <i className="ri-pencil-line"></i>
      </button>

      {/* Delete - Danger (Red) */}
      <button
        className="btn btn-outline-danger btn-icon btn-sm border-0"
        title="Delete"
        disabled={deleting === info.row.original.id}
        onClick={() => handleDeleteClick(info.row.original)}
      >
        <i className="ri-delete-bin-line"></i>
      </button>

      {/* Branches - Info (Cyan) */}
      <button
        className="btn btn-outline-info btn-icon btn-sm border-0"
        title="Branches"
        onClick={() => onNavigate('client-branches', { clientId: info.row.original.id, clientName: info.row.original.org_name })}
      >
        <i className="ri-git-branch-line"></i>
      </button>

      {/* Permissions - Secondary (Gray) with custom purple tint? Use purple variant if available */}
      <button
        className="btn btn-outline-secondary btn-icon btn-sm border-0"
        title="Permissions"
        onClick={() => onNavigate('client-permissions', { clientId: info.row.original.id, clientName: info.row.original.org_name })}
      >
        <i className="ri-shield-check-line" style={{ color: '#9b72cf' }}></i>
      </button>

      {/* Payments - Success (Green) */}
      <button
        className="btn btn-outline-success btn-icon btn-sm border-0"
        title="Payments"
        onClick={() => onNavigate('client-payments', { clientId: info.row.original.id, clientName: info.row.original.org_name })}
      >
        <i className="ri-money-rupee-circle-line"></i>
      </button>

      {/* Settings - Dark (Black/Dark Gray) */}
      <button
        className="btn btn-outline-dark btn-icon btn-sm border-0"
        title="Settings"
        onClick={() => onNavigate('client-settings', { clientId: info.row.original.id, clientName: info.row.original.org_name })}
      >
        <i className="ri-settings-3-line"></i>
      </button>
    </div>
  ),
}
  ];

  return (
    <>
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
            <CardBody>
              <TableContainer
                columns={columns}
                data={clients}
                isGlobalFilter={true}
                customPageSize={15}
                tableClass="align-middle table-nowrap mb-0"
                theadClass="table-light"
                divClass="table-responsive table-card border rounded"
                SearchPlaceholder="Search by name or ID..."
              />
              {loading && <div className="text-center py-5"><Spinner color="primary" /></div>}
              {!loading && clients.length === 0 && <div className="text-center text-muted py-5">No clients found</div>}
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
