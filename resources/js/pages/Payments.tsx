import { useState } from 'react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatCard from '../components/StatCard';
import { Table, Td } from '../components/ui/Table';
import { IndianRupee, Receipt, Clock, XCircle, Download, CheckCircle } from 'lucide-react';

const payments = [
  { txn: 'TXN-20250320-001', client: 'Rajesh Meshram', plan: 'Pro', total: 5899, method: 'UPI', date: '2025-03-20', cycle: 'Yearly', expiry: '2026-03-20', status: 'success' },
  { txn: 'TXN-20250315-002', client: 'Hockey Maharashtra', plan: 'Enterprise', total: 17699, method: 'Credit Card', date: '2025-03-15', cycle: 'Yearly', expiry: '2026-03-15', status: 'success' },
  { txn: 'TXN-20250308-003', client: 'Thane Boxing', plan: 'Pro', total: 5899, method: 'Net Banking', date: '2025-03-08', cycle: 'Yearly', expiry: '2026-03-08', status: 'success' },
  { txn: 'TXN-20250128-006', client: 'DSYS', plan: 'Basic', total: 2359, method: 'Credit Card', date: '2025-01-28', cycle: 'Yearly', expiry: '2026-01-28', status: 'expired' },
  { txn: 'TXN-20250210-009', client: 'Vidarbha Traders', plan: 'Basic', total: 2359, method: 'Credit Card', date: '2025-02-10', cycle: 'Monthly', expiry: '2025-03-10', status: 'expired' },
  { txn: 'TXN-20250105-010', client: 'Gaurav Jagtap', plan: 'Free', total: 0, method: '—', date: '2025-01-05', cycle: '—', expiry: '—', status: 'failed' },
];

const statusBadge: Record<string, 'success' | 'warning' | 'danger'> = { success: 'success', expired: 'warning', failed: 'danger' };

export default function Payments() {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? payments : payments.filter(p => p.status === filter);
  const successTotal = payments.filter(p => p.status === 'success').reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Revenue & Payment History</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Track all billing and subscription cycles</p>
        </div>
        <Button variant="outline" size="sm"><Download size={13} /> Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard icon={IndianRupee} color="green" label="Total Revenue" value={`₹${successTotal.toLocaleString()}`} change={`${payments.filter(p => p.status === 'success').length} successful`} up />
        <StatCard icon={Receipt} color="blue" label="Transactions" value={payments.length} />
        <StatCard icon={Clock} color="amber" label="Expired" value={payments.filter(p => p.status === 'expired').length} />
        <StatCard icon={XCircle} color="red" label="Failed" value={payments.filter(p => p.status === 'failed').length} />
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {['all', 'success', 'expired', 'failed'].map(f => (
          <Button key={f} variant={filter === f ? 'primary' : 'outline'} size="sm" onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${payments.length})` : `${f} (${payments.filter(p => p.status === f).length})`}
          </Button>
        ))}
      </div>

      <Table headers={['Txn ID', 'Client', 'Plan', 'Amount', 'Method', 'Date', 'Cycle', 'Status']}>
        {filtered.map(p => (
          <tr key={p.txn} className="hover:bg-primary/5 transition-colors">
            <Td><span className="font-mono text-[10.5px] text-primary">{p.txn}</span></Td>
            <Td><strong className="text-text">{p.client}</strong></Td>
            <Td><Badge variant="primary">{p.plan}</Badge></Td>
            <Td><strong className="text-text">₹{p.total.toLocaleString()}</strong></Td>
            <Td>{p.method}</Td>
            <Td className="text-muted">{p.date}</Td>
            <Td>{p.cycle}<div className="text-[10px] text-muted">Exp: {p.expiry}</div></Td>
            <Td><Badge variant={statusBadge[p.status] || 'muted'} dot>{p.status}</Badge></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
