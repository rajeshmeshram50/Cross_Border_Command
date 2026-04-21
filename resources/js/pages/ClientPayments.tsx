import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Spinner } from 'reactstrap';
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
        <CardHeader><h5 className="card-title mb-0">All Payments</h5></CardHeader>
        <CardBody>
          <div className="table-responsive table-card">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>#</th><th>Date</th><th>Plan</th><th>Amount</th><th>GST</th>
                  <th>Total</th><th>Method</th><th>Transaction ID</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-5"><Spinner color="primary" /></td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-muted py-5">
                    <i className="ri-bill-line display-4 d-block mb-2"></i>No payment records for this client yet.
                  </td></tr>
                ) : payments.map((p, i) => {
                  const cfg = statusCfg[p.status] || statusCfg.pending;
                  return (
                    <tr key={p.id}>
                      <td className="text-muted">{i + 1}</td>
                      <td>{new Date(p.payment_date || p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td>
                        <span className="fw-semibold">{p.plan?.name || '—'}</span>
                        {p.billing_cycle && <div className="text-muted fs-12 text-capitalize">{p.billing_cycle}</div>}
                      </td>
                      <td className="fw-bold">₹{Number(p.amount || 0).toLocaleString()}</td>
                      <td className="text-muted">{p.gst ? `₹${Number(p.gst).toLocaleString()}` : '—'}</td>
                      <td className="text-success fw-bold">₹{Number(p.total || p.amount || 0).toLocaleString()}</td>
                      <td className="text-capitalize">{methodLabels[p.method] || p.method || '—'}</td>
                      <td>
                        {p.txn_id ? (
                          <span className="badge bg-primary-subtle text-primary font-monospace">{p.txn_id}</span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <Badge color={cfg.color} pill className="text-uppercase">
                          <i className={`${cfg.icon} me-1`}></i>{p.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
