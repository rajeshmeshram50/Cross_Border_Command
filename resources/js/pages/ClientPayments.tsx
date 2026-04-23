import { useState, useEffect, useMemo } from 'react';
import { Col, Row, Spinner } from 'reactstrap';
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
  const lastPaymentLabel = lastPayment
    ? new Date(lastPayment.payment_date || lastPayment.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const KPI_CARDS: { label: string; value: string; icon: string; gradient: string }[] = [
    { label: 'Total Paid',   value: `₹${totalPaid.toLocaleString()}`,      icon: 'ri-line-chart-line',     gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Pending',      value: pending.length.toLocaleString(),        icon: 'ri-time-line',           gradient: 'linear-gradient(135deg,#f7b84b,#ffd47a)' },
    { label: 'Transactions', value: payments.length.toLocaleString(),       icon: 'ri-bank-card-line',      gradient: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
    { label: 'Last Payment', value: lastPaymentLabel,                       icon: 'ri-calendar-line',       gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  ];

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
      <style>{`
        .payments-surface { background: #ffffff; }
        [data-bs-theme="dark"] .payments-surface { background: #1c2531; }
      `}</style>

      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: 32, height: 32 }} onClick={onBack}>
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
        <Col xs={12}>
          <div
            className="payments-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── KPI cards (single row, equal height) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="payments-surface"
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
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {k.value}
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Title row ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col xs={12}>
                <h5 className="mb-0 fw-bold d-inline-flex align-items-center gap-2">
                  All Payments
                  <span className="badge bg-primary-subtle text-primary">{payments.length}</span>
                </h5>
              </Col>
            </Row>

            {/* ── Table ── */}
            <TableContainer
              columns={columns}
              data={payments}
              isGlobalFilter={true}
              customPageSize={15}
              tableClass="align-middle table-nowrap mb-0 "
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
          </div>
        </Col>
      </Row>
    </>
  );
}
