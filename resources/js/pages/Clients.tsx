import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Button, Spinner } from 'reactstrap';
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
          <ActionBtn title="Settings"    icon="ri-settings-3-line"  color="secondary" onClick={() => onNavigate('client-settings',  { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
        </div>
      ),
    },
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
            <CardHeader className="border-0 py-3">
              <Row className="align-items-center gy-2">
                <div className="col-sm">
                  <h5 className="card-title mb-0 fs-15">All Clients <span className="badge bg-primary-subtle text-primary ms-1">{total}</span></h5>
                </div>
                <div className="col-sm-auto">
                  <div className="d-flex gap-2 flex-wrap">
                    <Button color="light" size="sm" onClick={handleExport} disabled={exporting}>
                      {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                      {exporting ? 'Exporting...' : 'Export'}
                    </Button>
                    <Button
                      color="secondary"
                      size="md"
                      className="btn-label waves-effect waves-light rounded-pill"
                      onClick={() => onNavigate('client-form')}
                    >
                      <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                      Add Client
                    </Button>
                  </div>
                </div>
              </Row>
            </CardHeader>
            <CardBody className="pt-2">
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
              {loading && <div className="text-center py-5"><Spinner color="secondary" /></div>}
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
