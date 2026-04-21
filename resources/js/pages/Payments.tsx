import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner,
  Modal, ModalHeader, ModalBody, ModalFooter, Form, Label,
} from 'reactstrap';
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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [viewPayment, setViewPayment] = useState<Payment | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<{ id: number; org_name: string }[]>([]);
  const [plans, setPlans] = useState<{ id: number; name: string; price: number }[]>([]);
  const [sendingReminder, setSendingReminder] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payments', {
        params: { search: search || undefined, status: statusFilter || undefined, page, per_page: 15 },
      });
      setPayments(res.data.data || []);
      setTotalPages(res.data.last_page || 1);
      setTotal(res.data.total || 0);
    } catch { setPayments([]); }
    finally { setLoading(false); }
  }, [search, statusFilter, page]);

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
            <CardHeader className="border-0">
              <Row className="align-items-center gy-3">
                <div className="col-sm">
                  <h5 className="card-title mb-0">Payment List <span className="badge bg-primary-subtle text-primary ms-1">{total}</span></h5>
                </div>
                {isSuperAdmin && (
                  <div className="col-sm-auto">
                    <div className="d-flex gap-2 flex-wrap">
                      <Button color="light" onClick={handleExport} disabled={exporting}>
                        {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                        Export
                      </Button>
                      <Button color="success" onClick={openAddModal}>
                        <i className="ri-add-line align-bottom me-1"></i> Record Payment
                      </Button>
                    </div>
                  </div>
                )}
              </Row>
            </CardHeader>

            <CardBody className="border border-dashed border-end-0 border-start-0 py-3">
              <Row className="g-2">
                <Col md={4}>
                  <div className="search-box">
                    <Input type="text" className="form-control search" placeholder="Search by txn ID, invoice, client..."
                      value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                    <i className="ri-search-line search-icon"></i>
                  </div>
                </Col>
                <Col md={8}>
                  <div className="d-flex gap-1 flex-wrap">
                    {['', 'success', 'pending', 'failed', 'refunded'].map(s => (
                      <Button key={s} color={statusFilter === s ? 'primary' : 'light'} size="sm"
                        onClick={() => { setStatusFilter(s); setPage(1); }}>
                        {s || 'All'}
                      </Button>
                    ))}
                  </div>
                </Col>
              </Row>
            </CardBody>

            <CardBody>
              <div className="table-responsive table-card">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Plan</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={8} className="text-center py-5"><Spinner color="primary" /></td></tr>
                    ) : payments.length === 0 ? (
                      <tr><td colSpan={8} className="text-center text-muted py-5">
                        <i className="ri-bill-line display-4 d-block text-muted mb-2"></i>
                        No payments found
                      </td></tr>
                    ) : payments.map(p => {
                      const cfg = statusCfg[p.status] || statusCfg.pending;
                      return (
                        <tr key={p.id}>
                          <td><span className="fw-medium font-monospace text-primary">{p.invoice_number || `#${p.id}`}</span></td>
                          <td>{p.client?.org_name || <span className="text-muted">—</span>}</td>
                          <td>{p.plan?.name || <span className="text-muted">—</span>}</td>
                          <td>
                            <Badge color="light" className="text-dark">{methodLabels[p.method] || p.method}</Badge>
                          </td>
                          <td className="fw-bold">₹{parseFloat(p.total).toLocaleString()}</td>
                          <td>
                            <Badge color={cfg.bsColor} pill className="text-uppercase">
                              <i className={`${cfg.icon} me-1`}></i>{p.status}
                            </Badge>
                          </td>
                          <td className="text-muted">{new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                          <td>
                            <div className="d-flex gap-1">
                              <button className="btn btn-sm btn-soft-info" title="View" onClick={() => setViewPayment(p)}>
                                <i className="ri-eye-fill"></i>
                              </button>
                              {p.status === 'success' && (
                                <button className="btn btn-sm btn-soft-primary" title="Invoice PDF" onClick={() => viewInvoice(p)}>
                                  <i className="ri-file-pdf-2-line"></i>
                                </button>
                              )}
                              {isSuperAdmin && p.status === 'success' && (
                                <button className="btn btn-sm btn-soft-success" title="Send Reminder" disabled={sendingReminder === p.id} onClick={() => handleSendReminder(p)}>
                                  {sendingReminder === p.id ? <Spinner size="sm" /> : <i className="ri-send-plane-fill"></i>}
                                </button>
                              )}
                              {isSuperAdmin && (
                                <button className="btn btn-sm btn-soft-danger" title="Delete" onClick={() => handleDelete(p)}>
                                  <i className="ri-delete-bin-5-fill"></i>
                                </button>
                              )}
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
                  <span className="text-muted fs-13">Showing {payments.length} of {total} entries</span>
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
