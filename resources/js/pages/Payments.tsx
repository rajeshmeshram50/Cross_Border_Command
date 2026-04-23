import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner,
  Modal, ModalHeader, ModalBody, ModalFooter, Form, Label,
} from 'reactstrap';
import TableContainer from '../velzon/Components/Common/TableContainerReactTable';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

interface Payment {
  id: number; client_id: number; plan_id: number | null;
  txn_id: string | null; order_id: string | null;
  amount: string; gst: string | null; discount: string | null; total: string;
  currency: string | null; method: string; gateway: string | null;
  status: string; billing_cycle: string | null;
  valid_from: string | null; valid_until: string | null;
  auto_renew: boolean; invoice_number: string | null; invoice_path: string | null;
  notes: string | null; created_at: string;
  client?: { id: number; org_name: string };
  plan?: { id: number; name: string; price: number };
  processed_by_user?: { id: number; name: string };
}

interface Stats {
  total_revenue: number; total_transactions: number;
  successful: number; pending: number; failed: number;
  refunded: number; refund_amount: number;
}

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};

const statusCfg: Record<string, { color: string; icon: string; bsColor: string }> = {
  success:  { color: '#0ab39c', icon: 'ri-checkbox-circle-line', bsColor: 'success' },
  pending:  { color: '#f7b84b', icon: 'ri-time-line',           bsColor: 'warning' },
  failed:   { color: '#f06548', icon: 'ri-close-circle-line',   bsColor: 'danger' },
  refunded: { color: '#299cdb', icon: 'ri-refresh-line',        bsColor: 'info' },
};

export default function Payments() {
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.user_type === 'super_admin';

  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [viewPayment, setViewPayment] = useState<Payment | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<{ id: number; org_name: string }[]>([]);
  const [plans, setPlans] = useState<{ id: number; name: string; price: number }[]>([]);
  const [sendingReminder, setSendingReminder] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // Fetch all payments once. Search + pagination are handled client-side by TableContainer
  // so the UX matches the Clients page (see Clients.tsx).
  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payments', { params: { per_page: 9999 } });
      setPayments(res.data.data || []);
    } catch { setPayments([]); }
    finally { setLoading(false); }
  }, []);

  // Status filter is applied client-side before the data hits TableContainer.
  const filteredPayments = useMemo(() => {
    if (!statusFilter) return payments;
    return payments.filter(p => p.status === statusFilter);
  }, [payments, statusFilter]);

  const fetchStats = async () => {
    try { const res = await api.get('/payments/stats'); setStats(res.data); } catch {}
  };

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchStats(); }, []);

  const openAddModal = async () => {
    setAddModal(true);
    try {
      const [cRes, pRes] = await Promise.all([api.get('/clients', { params: { per_page: 100 } }), api.get('/plans')]);
      setClients((cRes.data.data || []).map((c: any) => ({ id: c.id, org_name: c.org_name })));
      setPlans((pRes.data.data || pRes.data || []).map((p: any) => ({ id: p.id, name: p.name, price: p.price })));
    } catch {}
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const data: Record<string, any> = {};
    fd.forEach((v, k) => { if (v) data[k] = v; });
    data.total = data.total || data.amount;
    try {
      await api.post('/payments', data);
      toast.success('Payment Added', 'Payment recorded successfully');
      setAddModal(false);
      fetchPayments();
      fetchStats();
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not save payment');
    } finally { setSaving(false); }
  };

  const handleDelete = async (p: Payment) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: `Delete payment ${p.invoice_number || '#' + p.id}?`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Delete', confirmButtonColor: '#f06548', cancelButtonColor: '#878a99',
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/payments/${p.id}`);
      Swal.fire({ title: 'Deleted!', icon: 'success', timer: 1500, showConfirmButton: false });
      fetchPayments(); fetchStats();
    } catch { toast.error('Failed', 'Could not delete payment'); }
  };

  const handleSendReminder = async (p: Payment) => {
    setSendingReminder(p.id);
    try {
      const res = await api.post(`/payments/${p.id}/send-reminder`);
      toast.success('Reminder Sent', res.data.message || 'Reminder email sent successfully');
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not send reminder');
    } finally {
      setSendingReminder(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/payments', { params: { per_page: 9999 } });
      const allPayments: Payment[] = res.data.data || [];
      const rows = allPayments.map((p, i) => ({
        '#': i + 1, 'Invoice': p.invoice_number || '', 'Client': p.client?.org_name || '',
        'Plan': p.plan?.name || '', 'Amount (₹)': parseFloat(p.amount),
        'GST (₹)': p.gst ? parseFloat(p.gst) : 0, 'Discount (₹)': p.discount ? parseFloat(p.discount) : 0,
        'Total (₹)': parseFloat(p.total), 'Method': methodLabels[p.method] || p.method,
        'Gateway': p.gateway || '', 'Status': p.status,
        'Transaction ID': p.txn_id || '', 'Date': new Date(p.created_at).toLocaleDateString('en-IN'),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Payments');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${allPayments.length} payments exported`);
    } catch { toast.error('Export Failed', 'Could not export payments'); }
    finally { setExporting(false); }
  };

  const viewInvoice = (p: Payment) => {
    const token = localStorage.getItem('cbc_token');
    window.open(`/api/payments/${p.id}/invoice/view?token=${token}`, '_blank');
  };

  // Outline icon pill — identical to the one used on the Clients page.
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
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );

  const columns = useMemo(() => [
    {
      header: '#',
      accessorKey: 'index',
      cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
    },
    {
      header: 'Invoice',
      accessorKey: 'invoice_number',
      cell: (info: any) => (
        <span className="fw-medium font-monospace text-primary fs-13">
          {info.row.original.invoice_number || `#${info.row.original.id}`}
        </span>
      ),
    },
    {
      header: 'Client',
      accessorKey: 'client_name',
      cell: (info: any) => info.row.original.client?.org_name
        ? <span className="fw-semibold fs-13">{info.row.original.client.org_name}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Plan',
      accessorKey: 'plan_name',
      cell: (info: any) => info.row.original.plan?.name
        ? <span className="fs-13">{info.row.original.plan.name}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Method',
      accessorKey: 'method',
      cell: (info: any) => (
        <Badge color="light" className="text-dark fw-medium">
          {methodLabels[info.row.original.method] || info.row.original.method}
        </Badge>
      ),
    },
    {
      header: 'Amount',
      accessorKey: 'total',
      cell: (info: any) => (
        <span className="text-success fw-semibold fs-13">
          ₹{parseFloat(info.row.original.total).toLocaleString()}
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info: any) => {
        const cfg = statusCfg[info.row.original.status] || statusCfg.pending;
        return (
          <span className={`badge rounded-pill border border-${cfg.bsColor} text-${cfg.bsColor} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}>
            <span className={`bg-${cfg.bsColor} rounded-circle`} style={{ width: 6, height: 6 }} />
            {info.row.original.status}
          </span>
        );
      },
    },
    {
      header: 'Date',
      accessorKey: 'created_at',
      cell: (info: any) => (
        <span className="text-muted fs-13">
          {new Date(info.row.original.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      ),
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: 'actions',
      cell: (info: any) => {
        const p: Payment = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center">
            <ActionBtn title="View" icon="ri-eye-line" color="info" onClick={() => setViewPayment(p)} />
            {p.status === 'success' && (
              <ActionBtn title="Invoice PDF" icon="ri-file-pdf-2-line" color="primary" onClick={() => viewInvoice(p)} />
            )}
            {isSuperAdmin && p.status === 'success' && (
              <ActionBtn
                title="Send Reminder"
                icon={sendingReminder === p.id ? 'ri-loader-4-line' : 'ri-send-plane-line'}
                color="success"
                disabled={sendingReminder === p.id}
                onClick={() => handleSendReminder(p)}
              />
            )}
            {isSuperAdmin && (
              <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger" onClick={() => handleDelete(p)} />
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isSuperAdmin, sendingReminder]);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Revenue & Payments</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Payments</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* Stat cards */}
      <Row>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <div className="d-flex align-items-center">
                <div className="flex-grow-1"><p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Total Revenue</p></div>
              </div>
              <div className="d-flex align-items-end justify-content-between mt-4">
                <div>
                  <h4 className="fs-22 fw-semibold mb-0">₹{(stats?.total_revenue || 0).toLocaleString()}</h4>
                  <p className="mb-0 text-muted mt-2 fs-12">{stats?.successful || 0} successful</p>
                </div>
                <div className="avatar-sm"><span className="avatar-title rounded bg-success-subtle text-success fs-3"><i className="ri-money-rupee-circle-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <div className="d-flex align-items-center">
                <div className="flex-grow-1"><p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Transactions</p></div>
              </div>
              <div className="d-flex align-items-end justify-content-between mt-4">
                <div>
                  <h4 className="fs-22 fw-semibold mb-0">{stats?.total_transactions || 0}</h4>
                  <p className="mb-0 text-muted mt-2 fs-12">{stats?.pending || 0} pending</p>
                </div>
                <div className="avatar-sm"><span className="avatar-title rounded bg-primary-subtle text-primary fs-3"><i className="ri-bank-card-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <div className="d-flex align-items-center">
                <div className="flex-grow-1"><p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Failed</p></div>
              </div>
              <div className="d-flex align-items-end justify-content-between mt-4">
                <div>
                  <h4 className="fs-22 fw-semibold mb-0">{stats?.failed || 0}</h4>
                  <p className="mb-0 text-muted mt-2 fs-12">need attention</p>
                </div>
                <div className="avatar-sm"><span className="avatar-title rounded bg-danger-subtle text-danger fs-3"><i className="ri-close-circle-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <div className="d-flex align-items-center">
                <div className="flex-grow-1"><p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Refunded</p></div>
              </div>
              <div className="d-flex align-items-end justify-content-between mt-4">
                <div>
                  <h4 className="fs-22 fw-semibold mb-0">₹{(stats?.refund_amount || 0).toLocaleString()}</h4>
                  <p className="mb-0 text-muted mt-2 fs-12">{stats?.refunded || 0} refunds</p>
                </div>
                <div className="avatar-sm"><span className="avatar-title rounded bg-warning-subtle text-warning fs-3"><i className="ri-refresh-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Main table */}
      <Row>
        <Col xs={12}>
          <Card>
            <CardHeader className="border-0 py-2">
              <Row className="align-items-center gy-2">
                <div className="col-sm">
                  <h5 className="card-title mb-0 fs-15">
                    Payment List <span className="badge bg-primary-subtle text-primary ms-1">{filteredPayments.length}</span>
                  </h5>
                </div>
                {isSuperAdmin && (
                  <div className="col-sm-auto">
                    <div className="d-flex gap-2 flex-wrap">
                      <Button color="light" size="sm" onClick={handleExport} disabled={exporting}>
                        {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                        {exporting ? 'Exporting...' : 'Export'}
                      </Button>
                      <Button
                        color="primary"
                        size="sm"
                        className="btn-label waves-effect waves-light rounded-pill"
                        onClick={openAddModal}
                      >
                        <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                        Record Payment
                      </Button>
                    </div>
                  </div>
                )}
              </Row>
            </CardHeader>

            {/* Status filter pills — client-side filter applied before data hits the table */}
            <CardBody className="border-top border-dashed py-2">
              <div className="d-flex gap-1 flex-wrap">
                {['', 'success', 'pending', 'failed', 'refunded'].map(s => (
                  <Button
                    key={s || 'all'}
                    color={statusFilter === s ? 'primary' : 'light'}
                    size="sm"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s || 'All'}
                  </Button>
                ))}
              </div>
            </CardBody>

            <CardBody className="pt-2">
              <TableContainer
                columns={columns}
                data={filteredPayments}
                isGlobalFilter={true}
                customPageSize={15}
                tableClass="align-middle table-nowrap mb-0"
                theadClass="table-light"
                divClass="table-responsive table-card border rounded"
                SearchPlaceholder="Search by txn ID, invoice, client..."
              />
              {loading && <div className="text-center py-5"><Spinner color="primary" /></div>}
              {!loading && filteredPayments.length === 0 && (
                <div className="text-center text-muted py-5">
                  <i className="ri-bill-line display-4 d-block text-muted mb-2"></i>
                  No payments found
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* View Modal */}
      <Modal isOpen={!!viewPayment} toggle={() => setViewPayment(null)} size="lg" centered>
        {viewPayment && (() => {
          const cfg = statusCfg[viewPayment.status] || statusCfg.pending;
          return (
            <>
              <ModalHeader toggle={() => setViewPayment(null)}>
                Payment Details
                <Badge color={cfg.bsColor} pill className="ms-2 text-uppercase"><i className={`${cfg.icon} me-1`}></i>{viewPayment.status}</Badge>
              </ModalHeader>
              <ModalBody>
                <div className="text-center mb-4">
                  <h2 className="mb-0">₹{parseFloat(viewPayment.total).toLocaleString()}</h2>
                  <p className="text-muted">{viewPayment.client?.org_name}</p>
                  {viewPayment.invoice_number && <span className="badge bg-primary-subtle text-primary font-monospace">{viewPayment.invoice_number}</span>}
                </div>
                <Row className="g-3">
                  {[
                    { label: 'Amount', value: `₹${parseFloat(viewPayment.amount).toLocaleString()}` },
                    { label: 'GST', value: viewPayment.gst ? `₹${parseFloat(viewPayment.gst).toLocaleString()}` : '—' },
                    { label: 'Discount', value: viewPayment.discount ? `₹${parseFloat(viewPayment.discount).toLocaleString()}` : '—' },
                    { label: 'Method', value: methodLabels[viewPayment.method] || viewPayment.method },
                    { label: 'Gateway', value: viewPayment.gateway || '—' },
                    { label: 'Plan', value: viewPayment.plan?.name || '—' },
                    { label: 'Billing Cycle', value: viewPayment.billing_cycle || '—' },
                    { label: 'Transaction ID', value: viewPayment.txn_id || '—' },
                    { label: 'Order ID', value: viewPayment.order_id || '—' },
                    { label: 'Valid From', value: viewPayment.valid_from ? new Date(viewPayment.valid_from).toLocaleDateString('en-IN') : '—' },
                    { label: 'Valid Until', value: viewPayment.valid_until ? new Date(viewPayment.valid_until).toLocaleDateString('en-IN') : '—' },
                  ].map(d => (
                    <Col md={6} key={d.label}>
                      <div className="p-2 rounded bg-light">
                        <div className="text-uppercase fs-11 text-muted fw-semibold">{d.label}</div>
                        <div className="fw-semibold fs-14 mt-1">{d.value}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
                {viewPayment.notes && (
                  <div className="alert alert-warning mt-3 mb-0">
                    <strong>Notes:</strong> {viewPayment.notes}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                {viewPayment.status === 'success' && (
                  <Button color="primary" onClick={() => viewInvoice(viewPayment)}>
                    <i className="ri-file-pdf-2-line me-1"></i> View Invoice PDF
                  </Button>
                )}
                <Button color="light" onClick={() => setViewPayment(null)}>Close</Button>
              </ModalFooter>
            </>
          );
        })()}
      </Modal>

      {/* Add Payment Modal */}
      <Modal isOpen={addModal} toggle={() => setAddModal(false)} size="lg" centered>
        <ModalHeader toggle={() => setAddModal(false)}>Record New Payment</ModalHeader>
        <Form onSubmit={handleAdd}>
          <ModalBody>
            <div className="alert alert-info mb-3">
              <i className="ri-information-line me-1"></i>
              If status is <strong>"Success"</strong>, an invoice PDF will be generated and emailed to the client automatically.
            </div>
            <Row className="g-3">
              <Col md={6}>
                <Label>Client <span className="text-danger">*</span></Label>
                <Input type="select" name="client_id" required>
                  <option value="">Select client...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.org_name}</option>)}
                </Input>
              </Col>
              <Col md={6}>
                <Label>Plan</Label>
                <Input type="select" name="plan_id">
                  <option value="">Select plan...</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>)}
                </Input>
              </Col>
              <Col md={3}>
                <Label>Amount (₹) <span className="text-danger">*</span></Label>
                <Input type="number" name="amount" step="0.01" required placeholder="0.00" />
              </Col>
              <Col md={3}>
                <Label>GST (₹)</Label>
                <Input type="number" name="gst" step="0.01" placeholder="0.00" />
              </Col>
              <Col md={3}>
                <Label>Discount (₹)</Label>
                <Input type="number" name="discount" step="0.01" placeholder="0.00" />
              </Col>
              <Col md={3}>
                <Label>Total (₹) <span className="text-danger">*</span></Label>
                <Input type="number" name="total" step="0.01" required placeholder="0.00" />
              </Col>
              <Col md={4}>
                <Label>Method <span className="text-danger">*</span></Label>
                <Input type="select" name="method" required>
                  <option value="">Select method...</option>
                  {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Input>
              </Col>
              <Col md={4}>
                <Label>Gateway</Label>
                <Input type="select" name="gateway">
                  <option value="">Select gateway...</option>
                  <option value="razorpay">Razorpay</option>
                  <option value="stripe">Stripe</option>
                  <option value="paytm">Paytm</option>
                  <option value="manual">Manual</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Status <span className="text-danger">*</span></Label>
                <Input type="select" name="status" required>
                  <option value="success">Success</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Billing Cycle</Label>
                <Input type="select" name="billing_cycle">
                  <option value="">Select...</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </Input>
              </Col>
              <Col md={4}>
                <Label>Valid From</Label>
                <Input type="date" name="valid_from" />
              </Col>
              <Col md={4}>
                <Label>Valid Until</Label>
                <Input type="date" name="valid_until" />
              </Col>
              <Col md={6}>
                <Label>Transaction ID</Label>
                <Input type="text" name="txn_id" placeholder="TXN-XXXXXX" />
              </Col>
              <Col md={6}>
                <Label>Order ID</Label>
                <Input type="text" name="order_id" placeholder="ORD-XXXXXX" />
              </Col>
              <Col xs={12}>
                <Label>Notes</Label>
                <Input type="textarea" name="notes" placeholder="Any additional notes..." rows={3} />
              </Col>
            </Row>
          </ModalBody>
          <ModalFooter>
            <Button color="light" type="button" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button color="success" type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-add-line me-1"></i>}
              {saving ? 'Saving...' : 'Record Payment'}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}
