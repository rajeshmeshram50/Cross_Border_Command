import { useState, useEffect } from 'react';
import Badge from '../components/ui/Badge';
import {
  IndianRupee, ArrowLeft, Loader2, CheckCircle2, Clock, XCircle,
  RefreshCw, CreditCard, Search, FileText, Calendar, TrendingUp
} from 'lucide-react';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const statusConfig: Record<string, { icon: typeof CheckCircle2; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
  success: { icon: CheckCircle2, variant: 'success' },
  pending: { icon: Clock, variant: 'warning' },
  failed: { icon: XCircle, variant: 'danger' },
  refunded: { icon: RefreshCw, variant: 'info' },
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
          <ArrowLeft size={16} />
        </button>
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <IndianRupee size={18} className="text-emerald-500" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-text tracking-tight">Payment History</h1>
          <p className="text-[12px] text-muted mt-0.5">{clientName} · {payments.length} transactions</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp size={14} className="text-emerald-500" />
            </div>
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Total Paid</span>
          </div>
          <div className="text-[22px] font-extrabold text-emerald-600">₹{totalPaid.toLocaleString()}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock size={14} className="text-amber-500" />
            </div>
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Pending</span>
          </div>
          <div className="text-[22px] font-extrabold text-amber-600">{pending.length}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
              <CreditCard size={14} className="text-sky-500" />
            </div>
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Transactions</span>
          </div>
          <div className="text-[22px] font-extrabold text-sky-600">{payments.length}</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Calendar size={14} className="text-violet-500" />
            </div>
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Last Payment</span>
          </div>
          <div className="text-[14px] font-bold text-text">
            {lastPayment ? new Date(lastPayment.payment_date || lastPayment.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          </div>
        </div>
      </div>

      {/* Payment Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted text-[13px]">
            <Loader2 size={20} className="animate-spin mr-3" /> Loading payments...
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
              <IndianRupee size={24} className="text-emerald-300" />
            </div>
            <p className="text-[14px] font-semibold text-text">No Payments Found</p>
            <p className="text-[12px] text-muted mt-1">No payment records for this client yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-border border-b border-border">
                  {['#', 'Date', 'Plan', 'Amount', 'GST', 'Total', 'Method', 'Transaction ID', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[9.5px] font-bold tracking-wider uppercase text-secondary">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {payments.map((p: any, i: number) => {
                  const sc = statusConfig[p.status] || statusConfig.pending;
                  return (
                    <tr key={p.id} className="hover:bg-primary/[.03] transition-colors">
                      <td className="px-4 py-3.5 text-[12px] text-muted">{i + 1}</td>
                      <td className="px-4 py-3.5 text-[12px] text-text font-medium">
                        {new Date(p.payment_date || p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[12px] font-semibold text-text">{p.plan?.name || '—'}</span>
                        {p.billing_cycle && <div className="text-[10px] text-muted capitalize">{p.billing_cycle}</div>}
                      </td>
                      <td className="px-4 py-3.5 text-[13px] font-bold text-text">₹{Number(p.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-[12px] text-muted">{p.gst ? `₹${Number(p.gst).toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-3.5 text-[13px] font-extrabold text-emerald-600">₹{Number(p.total || p.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-[11px] text-text capitalize">{methodLabels[p.method] || p.method || '—'}</td>
                      <td className="px-4 py-3.5">
                        {p.txn_id ? (
                          <span className="font-mono text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-md">{p.txn_id}</span>
                        ) : <span className="text-[11px] text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={sc.variant} dot>{p.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
