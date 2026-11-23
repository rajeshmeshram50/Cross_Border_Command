import { useState, useEffect, useMemo } from 'react';
import { Col, Row } from 'reactstrap';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import api from '../../api';
import { Shimmer } from '../../components/ui/Shimmer';

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
  const [search, setSearch] = useState('');

  /* Filtering is ours now — TableContainer did its own global filter, the
     DataTable takes a controlled value and the already-filtered rows. */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(p => [
      p.plan?.name, p.txn_id, p.method, p.billing_cycle, p.status,
      p.amount, p.total,
    ].some(v => String(v ?? '').toLowerCase().includes(q)));
  }, [payments, search]);

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

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    {
      header: 'Date',
      id: 'date',
      // Sort by the SAME value the cell renders so the visible ascending
      // order matches the user's expectation. Previously the column used
      // `accessorKey: 'created_at'` while the cell rendered
      // `payment_date || created_at` — sort and display could diverge,
      // making the order look random when the user toggled.
      accessorFn: (row: any) => {
        const raw = row.payment_date || row.created_at;
        const t = raw ? new Date(raw).getTime() : 0;
        return Number.isFinite(t) ? t : 0;
      },
      // Numeric (epoch ms) comparator — react-table's "auto" string
      // sort can pick the wrong direction on ISO strings of different
      // shapes ("YYYY-MM-DD" vs "YYYY-MM-DD HH:MM:SS"). Forcing the
      // alphanumeric/datetime sort here guarantees a deterministic
      // chronological order.
      sortingFn: 'basic' as any,
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
        const raw = String(info.row.original.status || 'pending');
        const cfg = statusCfg[raw] || statusCfg.pending;
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        return (
          <span className={`badge rounded-pill bg-${cfg.color}-subtle text-${cfg.color} fw-semibold px-3 py-2`}>
            {label}
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

        /* KPI cards — clear lift on hover with a layered shadow so the
           card visibly pops above the surface instead of sitting flat. */
        .payments-kpi {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease,
            border-color 220ms ease;
          will-change: transform;
          cursor: default;
        }
        .payments-kpi:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 36px -8px rgba(64, 81, 137, 0.28),
            0 8px 16px -4px rgba(64, 81, 137, 0.18),
            0 2px 4px rgba(0, 0, 0, 0.06);
          border-color: rgba(64, 81, 137, 0.35);
        }
        .payments-kpi:hover .payments-kpi-icon {
          transform: scale(1.08) rotate(-3deg);
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
        }
        .payments-kpi-icon {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease;
        }
        [data-bs-theme="dark"] .payments-kpi:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 8px 16px -4px rgba(0, 0, 0, 0.45),
            0 2px 4px rgba(0, 0, 0, 0.30);
          border-color: rgba(124, 92, 252, 0.50);
        }
      `}</style>

      {/* The .pmt-cstrip family, not a page-title-box: its CSS is global, so
          this page picks up the strip, the button sizing, the 8px page rhythm
          and the violet table head every other admin screen already has. */}
      <div className="pmt-cstrip mb-3">
        <span className="pmt-cstrip-accent" />
        <div className="pmt-cstrip-left">
          <div className="pmt-cstrip-icon"><i className="ri-bill-line" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="pmt-cstrip-title">Payment History</div>
            <div className="pmt-cstrip-sub">
              {clientName
                ? `Plan payments, GST and transactions for ${clientName}.`
                : 'Plan payments, GST and transaction history for this client.'}
            </div>
          </div>
        </div>
        <button type="button" className="pmt-cstrip-export" onClick={onBack}>
          <i className="ri-arrow-left-line" />
          Back to Clients
        </button>
      </div>

      {/* KPI row sits at PAGE level, as it does on Clients. It used to be
          nested inside a padded white panel together with the table, which
          made every tile a card drawn inside another card. */}
      <Row className="g-2 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="payments-surface payments-kpi"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: 11,
                      minHeight: 82,
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 6px' }}>
                          {k.label}
                        </p>
                        {loading ? (
                          <Shimmer width={72} height={26} radius={6} style={{ marginTop: 2 }} />
                        ) : (
                          <h3 style={{ fontSize: 24, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {k.value}
                          </h3>
                        )}
                      </div>
                      <div className="payments-kpi-icon" style={{ width: 38, height: 38, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

      {/* Search + table as one bordered panel, the shape .clients-list-frame
          gives the Clients list. The table drops its own border/rounding so
          the frame is the only edge. */}
      {/* The same DataTable the Clients list uses, with the same `hr-dt` skin
          — the Velzon TableContainer this replaced drew its own header,
          search and pager, which is why the two screens never matched. */}
      <DataTable<any>
        data={filtered}
        columns={columns}
        serial
        className="hr-dt"
        accent="violet"
        title="All Payments"
        subtitle={
          loading
            ? 'Loading…'
            : `${payments.length} ${payments.length === 1 ? 'transaction' : 'transactions'} on record`
        }
        minWidth={1200}
        fitToViewport
        autoFitRows
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by plan, txn ID, method..."
        emptyMessage={
          <>
            <i className="ri-bill-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            No payment records for this client yet
          </>
        }
      />
    </>
  );
}
