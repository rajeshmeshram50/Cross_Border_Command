import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner,
  Modal, ModalHeader, ModalBody, ModalFooter, Form, Label,
  InputGroup, InputGroupText, FormText,
} from 'reactstrap';
import TableContainer from '../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
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
  const [search, setSearch] = useState('');
  const [viewPayment, setViewPayment] = useState<Payment | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<{ id: number; org_name: string }[]>([]);
  const [plans, setPlans] = useState<{ id: number; name: string; price: number }[]>([]);
  const [sendingReminder, setSendingReminder] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; payment: Payment | null }>({ open: false, payment: null });
  const [deleting, setDeleting] = useState(false);

  // Live state for the Record Payment form — lets us auto-compute the Total
  // as amount + gst − discount so the admin doesn't need to do math.
  const [formAmount, setFormAmount]     = useState('');
  const [formGst, setFormGst]           = useState('');
  const [formDiscount, setFormDiscount] = useState('');
  const [formTotal, setFormTotal]       = useState('');
  const [totalEdited, setTotalEdited]   = useState(false);
  useEffect(() => {
    if (totalEdited) return;
    const a = parseFloat(formAmount)   || 0;
    const g = parseFloat(formGst)      || 0;
    const d = parseFloat(formDiscount) || 0;
    const t = Math.max(0, +(a + g - d).toFixed(2));
    setFormTotal(t ? String(t) : '');
  }, [formAmount, formGst, formDiscount, totalEdited]);
  const resetPaymentForm = () => {
    setFormAmount(''); setFormGst(''); setFormDiscount('');
    setFormTotal(''); setTotalEdited(false);
  };

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

  // Status filter + search are applied client-side before the data hits TableContainer.
  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.txn_id || '').toLowerCase().includes(q) ||
        (p.invoice_number || '').toLowerCase().includes(q) ||
        (p.client?.org_name || '').toLowerCase().includes(q) ||
        (p.plan?.name || '').toLowerCase().includes(q)
      );
    });
  }, [payments, statusFilter, search]);

  const fetchStats = async () => {
    try { const res = await api.get('/payments/stats'); setStats(res.data); } catch {}
  };

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchStats(); }, []);

  const openAddModal = async () => {
    resetPaymentForm();
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
      resetPaymentForm();
      fetchPayments();
      fetchStats();
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not save payment');
    } finally { setSaving(false); }
  };

  const openDeleteModal = (p: Payment) => setDeleteModal({ open: true, payment: p });
  const confirmDelete = async () => {
    if (!deleteModal.payment) return;
    setDeleting(true);
    try {
      await api.delete(`/payments/${deleteModal.payment.id}`);
      toast.success('Deleted', `Payment ${deleteModal.payment.invoice_number || `#${deleteModal.payment.id}`} has been deleted`);
      setDeleteModal({ open: false, payment: null });
      fetchPayments();
      fetchStats();
    } catch {
      toast.error('Failed', 'Could not delete payment');
    } finally {
      setDeleting(false);
    }
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
      data-color={color}
      className="btn p-0 d-inline-flex align-items-center justify-content-center pmt-action-btn"
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
        <Badge className="fw-medium pmt-method-badge">
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
            <span className={`bg-${cfg.bsColor} rounded-circle pmt-status-dot`} />
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
              <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger" onClick={() => openDeleteModal(p)} />
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isSuperAdmin, sendingReminder]);

  const KPI_CARDS = [
    {
      label: 'Total Revenue',
      value: `₹${(stats?.total_revenue || 0).toLocaleString()}`,
      hint: `${stats?.successful || 0} successful`,
      icon: 'ri-money-rupee-circle-fill',
      gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
    },
    {
      label: 'Transactions',
      value: (stats?.total_transactions || 0).toLocaleString(),
      hint: `${stats?.pending || 0} pending`,
      icon: 'ri-bank-card-fill',
      gradient: 'linear-gradient(135deg,#405189,#6691e7)',
    },
    {
      label: 'Failed',
      value: (stats?.failed || 0).toLocaleString(),
      hint: 'need attention',
      icon: 'ri-close-circle-fill',
      gradient: 'linear-gradient(135deg,#f06548,#f4907b)',
    },
    {
      label: 'Refunded',
      value: `₹${(stats?.refund_amount || 0).toLocaleString()}`,
      hint: `${stats?.refunded || 0} refunds`,
      icon: 'ri-refresh-fill',
      gradient: 'linear-gradient(135deg,#f7b84b,#f1963b)',
    },
  ];

  const STATUS_FILTERS = ['', 'success', 'pending', 'failed', 'refunded'];

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

      <Row>
        <Col xs={12}>
          <div className="payments-surface pmt-page-card">
            {/* ── KPI cards (admin-dashboard style) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div className="payments-surface pmt-kpi-card">
                    <div className="pmt-kpi-top-bar" style={{ background: k.gradient }} />
                    <div className="pmt-kpi-row">
                      <div>
                        <p className="pmt-kpi-label">{k.label}</p>
                        <h3 className="pmt-kpi-value">{k.value}</h3>
                        <small className="pmt-kpi-hint">{k.hint}</small>
                      </div>
                      <div className="pmt-kpi-icon" style={{ background: k.gradient }}>
                        <i className={k.icon} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Single toolbar row: search + status pills + export + record ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col lg={4} md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by txn ID, invoice, client..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>

              <Col lg md={12} sm={12} className="d-flex flex-wrap gap-1">
                {STATUS_FILTERS.map(s => {
                  const isActive = statusFilter === s;
                  return (
                    <Button
                      key={s || 'all'}
                      color={isActive ? 'primary' : 'light'}
                      size="sm"
                      onClick={() => setStatusFilter(s)}
                      className="rounded-pill px-3 text-capitalize"
                    >
                      {s || 'All'}
                    </Button>
                  );
                })}
              </Col>

              {isSuperAdmin && (
                <Col lg="auto" md={12} sm={12} className="d-flex justify-content-md-end gap-2 flex-wrap">
                  <Button
                    onClick={handleExport}
                    disabled={exporting}
                    className="rounded-pill px-3 pmt-btn-export"
                  >
                    {exporting ? <Spinner size="sm" className="me-1" /> : <i className="ri-download-2-line align-bottom me-1"></i>}
                    {exporting ? 'Exporting...' : 'Export'}
                  </Button>
                  <Button
                    color="secondary"
                    className="btn-label waves-effect waves-light rounded-pill"
                    onClick={openAddModal}
                  >
                    <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                    Record Payment
                  </Button>
                </Col>
              )}
            </Row>

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <TableContainer
                  columns={columns}
                  data={filteredPayments}
                  isGlobalFilter={false}
                  customPageSize={10}
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
          </div>
        </Col>
      </Row>

      {/* ── View Payment Details Modal ── */}
      <Modal
        isOpen={!!viewPayment}
        toggle={() => setViewPayment(null)}
        size="lg"
        centered
        scrollable
        className="cbc-view-payment"
        contentClassName="border-0 shadow-lg"
      >
        {viewPayment && (() => {
          const cfg      = statusCfg[viewPayment.status] || statusCfg.pending;
          const fmtMoney = (n: string | null | undefined) =>
            n ? `₹${parseFloat(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
          const fmtDate  = (d: string | null | undefined) =>
            d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

          return (
            <>
              {/* ── Header — title on left, invoice number pill on right (no X; Close button in footer) ── */}
              <ModalHeader tag="div" className="border-bottom px-4 pmt-modal-header">
                <div className="d-flex align-items-center w-100 gap-2">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0 pmt-modal-icon">
                    <i className="ri-file-list-3-line" />
                  </span>
                  <div className="min-w-0">
                    <h5 className="mb-0 fw-bold">Payment Details</h5>
                    <p className="mb-0 text-muted">Transaction summary and breakdown</p>
                  </div>
                  <span className="pmt-invoice-pill flex-shrink-0 ms-auto">
                    <i className="ri-hashtag" />
                    {viewPayment.invoice_number || `#${viewPayment.id}`}
                  </span>
                </div>
              </ModalHeader>

              <ModalBody className="px-4 py-3 pmt-modal-body-scroll">
                {/* ── Hero — inline total + client + status ── */}
                <div
                  className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3 pmt-view-hero"
                  data-status={viewPayment.status}
                >
                  <div className="d-flex align-items-center flex-wrap gap-2 min-w-0">
                    <span className="pmt-small-caps">Total Amount</span>
                    <span className="fw-bold pmt-total-value">{fmtMoney(viewPayment.total)}</span>
                    <span className="pmt-hero-sep">·</span>
                    <span className="text-muted text-truncate pmt-client-line">
                      <i className="ri-building-line me-1" />
                      {viewPayment.client?.org_name || '—'}
                    </span>
                  </div>
                  <span
                    className={`badge rounded-pill border border-${cfg.bsColor} text-${cfg.bsColor} text-uppercase fw-semibold d-inline-flex align-items-center gap-1 flex-shrink-0 pmt-status-pill`}
                  >
                    <span className={`bg-${cfg.bsColor} rounded-circle pmt-status-dot`} />
                    {viewPayment.status}
                  </span>
                </div>

                <Row className="g-2">
                  {/* Amount Breakdown — receipt style */}
                  <Col md={6}>
                    <div className="pmt-view-group h-100">
                      <div className="pmt-view-group-head">
                        <i className="ri-money-rupee-circle-line" />Amount Breakdown
                      </div>
                      <div className="pmt-view-group-body">
                        <div className="pmt-view-receipt-row">
                          <span className="k">Amount</span>
                          <span className="v">{fmtMoney(viewPayment.amount)}</span>
                        </div>
                        <div className="pmt-view-receipt-row">
                          <span className="k">GST</span>
                          <span className="v">{fmtMoney(viewPayment.gst)}</span>
                        </div>
                        <div className="pmt-view-receipt-row">
                          <span className="k">Discount</span>
                          <span className="v">
                            {viewPayment.discount && parseFloat(viewPayment.discount) > 0
                              ? `−${fmtMoney(viewPayment.discount)}`
                              : fmtMoney(viewPayment.discount)}
                          </span>
                        </div>
                        <div className="pmt-view-receipt-row pmt-view-receipt-total">
                          <span className="k">Total</span>
                          <span className="v">{fmtMoney(viewPayment.total)}</span>
                        </div>
                      </div>
                    </div>
                  </Col>

                  {/* Payment Method */}
                  <Col md={6}>
                    <div className="pmt-view-group h-100">
                      <div className="pmt-view-group-head">
                        <i className="ri-bank-card-line" />Payment Method
                      </div>
                      <div className="pmt-view-group-body">
                        <div className="pmt-view-kv">
                          <span className="k">Method</span>
                          <span className="v">{methodLabels[viewPayment.method] || viewPayment.method || '—'}</span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Gateway</span>
                          <span className="v">
                            {viewPayment.gateway
                              ? viewPayment.gateway.charAt(0).toUpperCase() + viewPayment.gateway.slice(1)
                              : '—'}
                          </span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Plan</span>
                          <span className="v">{viewPayment.plan?.name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </Col>

                  {/* Billing Period */}
                  <Col md={6}>
                    <div className="pmt-view-group h-100">
                      <div className="pmt-view-group-head">
                        <i className="ri-calendar-2-line" />Billing Period
                      </div>
                      <div className="pmt-view-group-body">
                        <div className="pmt-view-kv">
                          <span className="k">Cycle</span>
                          <span className="v">
                            {viewPayment.billing_cycle
                              ? viewPayment.billing_cycle.charAt(0).toUpperCase() + viewPayment.billing_cycle.slice(1)
                              : '—'}
                          </span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Valid From</span>
                          <span className="v">{fmtDate(viewPayment.valid_from)}</span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Valid Until</span>
                          <span className="v">{fmtDate(viewPayment.valid_until)}</span>
                        </div>
                      </div>
                    </div>
                  </Col>

                  {/* Reference */}
                  <Col md={6}>
                    <div className="pmt-view-group h-100">
                      <div className="pmt-view-group-head">
                        <i className="ri-hashtag" />Reference
                      </div>
                      <div className="pmt-view-group-body">
                        <div className="pmt-view-kv">
                          <span className="k">Transaction ID</span>
                          <span className="v font-monospace" title={viewPayment.txn_id || ''}>
                            {viewPayment.txn_id || '—'}
                          </span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Order ID</span>
                          <span className="v font-monospace" title={viewPayment.order_id || ''}>
                            {viewPayment.order_id || '—'}
                          </span>
                        </div>
                        <div className="pmt-view-kv">
                          <span className="k">Processed By</span>
                          <span className="v">{viewPayment.processed_by_user?.name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Notes (only if present) */}
                {viewPayment.notes && (
                  <div className="rounded-3 mt-2 p-3 pmt-view-notes">
                    <div className="mb-1 pmt-small-caps">Notes</div>
                    <div className="pmt-notes-text">{viewPayment.notes}</div>
                  </div>
                )}
              </ModalBody>

              <ModalFooter className="border-top px-4">
                <Button
                  type="button"
                  onClick={() => setViewPayment(null)}
                  className="rounded-pill fw-semibold px-4 pmt-btn-ghost"
                >
                  Close
                </Button>
                {viewPayment.status === 'success' && (
                  <Button
                    color="primary"
                    onClick={() => viewInvoice(viewPayment)}
                    className="btn-label waves-effect waves-light rounded-pill"
                  >
                    <i className="ri-file-pdf-2-line label-icon align-middle rounded-pill fs-16 me-2" />
                    View Invoice PDF
                  </Button>
                )}
              </ModalFooter>
            </>
          );
        })()}
      </Modal>

      {/* Add Payment Modal — <form> flex-chain rules live in app.css (.cbc-payment-modal) */}
      <Modal
        isOpen={addModal}
        toggle={() => { setAddModal(false); resetPaymentForm(); }}
        size="lg"
        centered
        scrollable
        className="cbc-payment-modal"
        contentClassName="border-0 shadow-lg"
      >
        <ModalHeader
          toggle={() => { setAddModal(false); resetPaymentForm(); }}
          className="border-bottom px-4 pmt-modal-header"
        >
          <div className="d-flex align-items-center gap-2">
            <span className="d-inline-flex align-items-center justify-content-center rounded-3 text-white flex-shrink-0 pmt-modal-icon pmt-modal-icon-success">
              <i className="ri-money-rupee-circle-line fs-18" />
            </span>
            <div>
              <h5 className="mb-0 fs-16 fw-bold">Record New Payment</h5>
              <p className="mb-0 fs-11 text-muted">Capture a transaction against a client and plan</p>
            </div>
          </div>
        </ModalHeader>

        <Form onSubmit={handleAdd} className="d-flex flex-column flex-grow-1 overflow-hidden">
          <ModalBody className="px-4 py-3 pmt-modal-body-scroll">
            {/* Hint banner */}
            <div className="d-flex align-items-start gap-2 rounded-3 mb-4 p-3 pmt-hint-banner">
              <i className="ri-information-line fs-16 flex-shrink-0" />
              <div className="fs-12 pmt-hint-banner-text">
                If status is <strong>"Success"</strong>, an invoice PDF is generated and emailed to the client automatically.
              </div>
            </div>

            {/* ── Section: Customer & Plan ── */}
            <SectionHeader icon="ri-user-3-line" title="Customer & Plan" />
            <Row className="g-3 mb-4">
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Client <span className="text-danger">*</span></Label>
                <InputGroup>
                  <InputGroupText><i className="ri-building-line" /></InputGroupText>
                  <Input type="select" name="client_id" required>
                    <option value="">— Select client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.org_name}</option>)}
                  </Input>
                </InputGroup>
              </Col>
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Plan</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-vip-crown-line" /></InputGroupText>
                  <Input type="select" name="plan_id">
                    <option value="">— Select plan —</option>
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>)}
                  </Input>
                </InputGroup>
              </Col>
            </Row>

            {/* ── Section: Amount ── */}
            <SectionHeader icon="ri-money-rupee-circle-line" title="Amount Breakdown" hint="Total is auto-calculated (Amount + GST − Discount). Override if needed." />
            <Row className="g-3 mb-4">
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Amount <span className="text-danger">*</span></Label>
                <InputGroup>
                  <InputGroupText>₹</InputGroupText>
                  <Input
                    type="number" name="amount" step="0.01" min="0" required placeholder="0.00"
                    value={formAmount}
                    onChange={e => setFormAmount(e.target.value)}
                  />
                </InputGroup>
              </Col>
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">GST</Label>
                <InputGroup>
                  <InputGroupText>₹</InputGroupText>
                  <Input
                    type="number" name="gst" step="0.01" min="0" placeholder="0.00"
                    value={formGst}
                    onChange={e => setFormGst(e.target.value)}
                  />
                </InputGroup>
              </Col>
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Discount</Label>
                <InputGroup>
                  <InputGroupText>₹</InputGroupText>
                  <Input
                    type="number" name="discount" step="0.01" min="0" placeholder="0.00"
                    value={formDiscount}
                    onChange={e => setFormDiscount(e.target.value)}
                  />
                </InputGroup>
              </Col>
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1 d-flex align-items-center gap-2">
                  Total <span className="text-danger">*</span>
                  {!totalEdited && <span className="badge bg-success-subtle text-success fs-10 fw-semibold">AUTO</span>}
                </Label>
                <InputGroup>
                  <InputGroupText>₹</InputGroupText>
                  <Input
                    type="number" name="total" step="0.01" min="0" required placeholder="0.00"
                    value={formTotal}
                    onChange={e => { setFormTotal(e.target.value); setTotalEdited(true); }}
                  />
                  {totalEdited && (
                    <Button
                      type="button"
                      color="light"
                      className="border"
                      onClick={() => setTotalEdited(false)}
                      title="Reset to auto-calculated"
                    >
                      <i className="ri-refresh-line" />
                    </Button>
                  )}
                </InputGroup>
              </Col>
            </Row>

            {/* ── Section: Payment Method ── */}
            <SectionHeader icon="ri-bank-card-line" title="Payment Method" />
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Method <span className="text-danger">*</span></Label>
                <InputGroup>
                  <InputGroupText><i className="ri-wallet-3-line" /></InputGroupText>
                  <Input type="select" name="method" required>
                    <option value="">— Select method —</option>
                    {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Input>
                </InputGroup>
              </Col>
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Gateway</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-global-line" /></InputGroupText>
                  <Input type="select" name="gateway">
                    <option value="">— Select gateway —</option>
                    <option value="razorpay">Razorpay</option>
                    <option value="stripe">Stripe</option>
                    <option value="paytm">Paytm</option>
                    <option value="manual">Manual</option>
                  </Input>
                </InputGroup>
              </Col>
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Status <span className="text-danger">*</span></Label>
                <InputGroup>
                  <InputGroupText><i className="ri-checkbox-circle-line" /></InputGroupText>
                  <Input type="select" name="status" required defaultValue="success">
                    <option value="success">Success</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                  </Input>
                </InputGroup>
              </Col>
            </Row>

            {/* ── Section: Validity Window ── */}
            <SectionHeader icon="ri-calendar-2-line" title="Billing Period" />
            <Row className="g-3 mb-4">
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Billing Cycle</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-refresh-line" /></InputGroupText>
                  <Input type="select" name="billing_cycle">
                    <option value="">—</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </Input>
                </InputGroup>
              </Col>
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Valid From</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-calendar-check-line" /></InputGroupText>
                  <Input type="date" name="valid_from" />
                </InputGroup>
              </Col>
              <Col md={4}>
                <Label className="fw-semibold fs-12 mb-1">Valid Until</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-calendar-event-line" /></InputGroupText>
                  <Input type="date" name="valid_until" />
                </InputGroup>
              </Col>
            </Row>

            {/* ── Section: Reference & Notes ── */}
            <SectionHeader icon="ri-hashtag" title="Reference & Notes" />
            <Row className="g-3">
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Transaction ID</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-hashtag" /></InputGroupText>
                  <Input type="text" name="txn_id" placeholder="e.g. TXN202604221234" />
                </InputGroup>
                <FormText className="text-muted fs-11">The gateway's reference for this payment (optional)</FormText>
              </Col>
              <Col md={6}>
                <Label className="fw-semibold fs-12 mb-1">Order ID</Label>
                <InputGroup>
                  <InputGroupText><i className="ri-shopping-bag-3-line" /></InputGroupText>
                  <Input type="text" name="order_id" placeholder="e.g. ORD-A1B2C3" />
                </InputGroup>
                <FormText className="text-muted fs-11">Internal / gateway order identifier (optional)</FormText>
              </Col>
              <Col xs={12}>
                <Label className="fw-semibold fs-12 mb-1">Notes</Label>
                <Input
                  type="textarea" name="notes" rows={3}
                  placeholder="Any additional details about this payment…"
                />
              </Col>
            </Row>
          </ModalBody>

          <ModalFooter className="border-top">
            <Button
              color="light"
              type="button"
              onClick={() => { setAddModal(false); resetPaymentForm(); }}
            >
              <i className="ri-close-line me-1" />Cancel
            </Button>
            <Button
              color="primary"
              type="submit"
              disabled={saving}
              className="btn-label waves-effect waves-light rounded-pill"
            >
              {saving ? (
                <>
                  <Spinner size="sm" className="label-icon align-middle rounded-pill me-2" />
                  Saving…
                </>
              ) : (
                <>
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2" />
                  Record Payment
                </>
              )}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleteModal.open}
        title="Delete Payment"
        itemName={deleteModal.payment?.invoice_number || (deleteModal.payment ? `#${deleteModal.payment.id}` : '')}
        subMessage="This action cannot be undone. The payment record and its invoice will be permanently removed."
        onClose={() => !deleting && setDeleteModal({ open: false, payment: null })}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}

/** Small labelled section header used inside the Record Payment modal. */
function SectionHeader({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="d-flex align-items-center gap-2 mb-2 pb-2 pmt-section-head">
      <span className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0 bg-primary-subtle text-primary pmt-section-chip">
        <i className={icon} />
      </span>
      <div className="flex-grow-1 min-w-0">
        <div className="fw-bold text-uppercase pmt-section-title">{title}</div>
        {hint && <div className="text-muted fs-11 pmt-section-hint">{hint}</div>}
      </div>
    </div>
  );
}
