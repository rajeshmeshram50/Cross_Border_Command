import { useState, useEffect, useMemo } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Spinner } from 'reactstrap';
import TableContainer from '../velzon/Components/Common/TableContainerReactTable';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const statusCfg: Record<string, { color: string; icon: string }> = {
  success:  { color: 'success', icon: 'ri-checkbox-circle-line' },
  pending:  { color: 'warning', icon: 'ri-time-line' },
  failed:   { color: 'danger',  icon: 'ri-close-circle-line' },
  refunded: { color: 'info',    icon: 'ri-refresh-line' },
};

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};

export default function ClientPayments({ clientId, clientName, onBack }: Props) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/payments', { params: { client_id: clientId, per_page: 100 } })
      .then(res => setPayments(res.data.data || []))
      .finally(() => setLoading(false));
  }, [clientId]);

  const totalPaid = payments.filter(p => p.status === 'success').reduce((s, p) => s + Number(p.total || p.amount || 0), 0);
  const pending = payments.filter(p => p.status === 'pending');
  const lastPayment = payments.find(p => p.status === 'success');

  const columns = useMemo(() => [
    {
      header: '#',
      accessorKey: 'index',
      cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
    },
    {
      header: 'Date',
      accessorKey: 'created_at',
      cell: (info: any) => {
        const d = info.row.original.payment_date || info.row.original.created_at;
        return <span className="fs-13">{new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>;
      },
    },
    {
      header: 'Plan',
      accessorKey: 'plan_name',
      cell: (info: any) => (
        <div>
          <span className="fw-semibold fs-13">{info.row.original.plan?.name || '—'}</span>
          {info.row.original.billing_cycle && (
            <div className="text-muted fs-11 text-capitalize">{info.row.original.billing_cycle}</div>
          )}
        </div>
      ),
    },
    {
      header: 'Amount',
      accessorKey: 'amount',
      cell: (info: any) => (
        <span className="fw-semibold fs-13">₹{Number(info.row.original.amount || 0).toLocaleString()}</span>
      ),
    },
    {
      header: 'GST',
      accessorKey: 'gst',
      cell: (info: any) => info.row.original.gst
        ? <span className="text-muted fs-13">₹{Number(info.row.original.gst).toLocaleString()}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Total',
      accessorKey: 'total',
      cell: (info: any) => (
        <span className="text-success fw-semibold fs-13">
          ₹{Number(info.row.original.total || info.row.original.amount || 0).toLocaleString()}
        </span>
      ),
    },
    {
      header: 'Method',
      accessorKey: 'method',
      cell: (info: any) => (
        <span className="text-capitalize fs-13">
          {methodLabels[info.row.original.method] || info.row.original.method || '—'}
        </span>
      ),
    },
    {
      header: 'Transaction ID',
      accessorKey: 'txn_id',
      cell: (info: any) => info.row.original.txn_id
        ? <span className="badge bg-primary-subtle text-primary font-monospace">{info.row.original.txn_id}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info: any) => {
        const cfg = statusCfg[info.row.original.status] || statusCfg.pending;
        return (
          <span className={`badge rounded-pill border border-${cfg.color} text-${cfg.color} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}>
            <span className={`bg-${cfg.color} rounded-circle`} style={{ width: 6, height: 6 }} />
            {info.row.original.status}
          </span>
        );
      },
    },
  ], []);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Payment History
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Clients</a></li>
                <li className="breadcrumb-item"><a href="#">{clientName}</a></li>
                <li className="breadcrumb-item active">Payments</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Total Paid</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">₹{totalPaid.toLocaleString()}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-success-subtle text-success fs-3"><i className="ri-line-chart-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Pending</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">{pending.length}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-warning-subtle text-warning fs-3"><i className="ri-time-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Transactions</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">{payments.length}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-info-subtle text-info fs-3"><i className="ri-bank-card-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={3} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Last Payment</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h6 className="mb-0">
                  {lastPayment ? new Date(lastPayment.payment_date || lastPayment.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </h6>
                <div className="avatar-sm"><span className="avatar-title rounded bg-primary-subtle text-primary fs-3"><i className="ri-calendar-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Card>
        <CardHeader className="border-0 py-2">
          <h5 className="card-title mb-0 fs-15">
            All Payments <span className="badge bg-primary-subtle text-primary ms-1">{payments.length}</span>
          </h5>
        </CardHeader>
        <CardBody className="pt-2">
          <TableContainer
            columns={columns}
            data={payments}
            isGlobalFilter={true}
            customPageSize={15}
            tableClass="align-middle table-nowrap mb-0"
            theadClass="table-light"
            divClass="table-responsive table-card border rounded"
            SearchPlaceholder="Search by plan, txn ID, method..."
          />
          {loading && <div className="text-center py-5"><Spinner color="primary" /></div>}
          {!loading && payments.length === 0 && (
            <div className="text-center text-muted py-5">
              <i className="ri-bill-line display-4 d-block mb-2"></i>
              No payment records for this client yet.
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
