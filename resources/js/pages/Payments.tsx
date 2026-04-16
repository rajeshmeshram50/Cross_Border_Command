import { useState, useEffect, useCallback } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import {
  IndianRupee, Receipt, Clock, XCircle, Loader2, Search, Plus, Eye,
  Trash2, Download, Filter, ChevronLeft, ChevronRight, X,
  CheckCircle2, RefreshCw, CreditCard, TrendingUp, Banknote, FileText
} from 'lucide-react';
import { ShimmerPaymentList } from '../components/ui/Shimmer';
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

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle2; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
  success: { color: 'emerald', icon: CheckCircle2, variant: 'success' },
  pending: { color: 'amber', icon: Clock, variant: 'warning' },
  failed: { color: 'red', icon: XCircle, variant: 'danger' },
  refunded: { color: 'sky', icon: RefreshCw, variant: 'info' },
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
      title: 'Delete Payment?',
      html: `<div style="font-size:14px;color:#64748b">Delete payment <strong style="color:#1e293b">${p.invoice_number || '#' + p.id}</strong>?</div>`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8',
      confirmButtonText: 'Delete', customClass: { popup: 'rounded-2xl' },
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/payments/${p.id}`);
      Swal.fire({ title: 'Deleted!', icon: 'success', timer: 1500, showConfirmButton: false, customClass: { popup: 'rounded-2xl' } });
      fetchPayments(); fetchStats();
    } catch { toast.error('Failed', 'Could not delete payment'); }
  };

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/payments', { params: { per_page: 9999 } });
      const allPayments: Payment[] = res.data.data || [];

      const rows = allPayments.map((p, i) => ({
        '#': i + 1,
        'Invoice': p.invoice_number || '',
        'Client': p.client?.org_name || '',
        'Plan': p.plan?.name || '',
        'Amount (₹)': parseFloat(p.amount),
        'GST (₹)': p.gst ? parseFloat(p.gst) : 0,
        'Discount (₹)': p.discount ? parseFloat(p.discount) : 0,
        'Total (₹)': parseFloat(p.total),
        'Method': methodLabels[p.method] || p.method,
        'Gateway': p.gateway || '',
        'Status': p.status,
        'Billing Cycle': p.billing_cycle || '',
        'Transaction ID': p.txn_id || '',
        'Order ID': p.order_id || '',
        'Valid From': p.valid_from || '',
        'Valid Until': p.valid_until || '',
        'Date': new Date(p.created_at).toLocaleDateString('en-IN'),
        'Notes': p.notes || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0] || {}).map(key => ({
        wch: Math.max(key.length, ...rows.map(r => String((r as any)[key]).length)) + 2,
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Payments');

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);

      toast.success('Exported', `${allPayments.length} payments exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export payments');
    } finally { setExporting(false); }
  };

  const viewInvoice = (p: Payment) => {
    const token = localStorage.getItem('cbc_token');
    window.open(`/api/payments/${p.id}/invoice/view?token=${token}`, '_blank');
  };

  return (
    <div className="space-y-5">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-red-500/10 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-orange-500/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-3xl" />

        <div className="relative px-8 py-7">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-red-500/30">
                  <IndianRupee size={24} className="text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-emerald-500 border-[3px] border-slate-900 flex items-center justify-center">
                  <CheckCircle2 size={10} className="text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-[24px] font-extrabold text-white tracking-tight">Revenue & Payments</h1>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg">
                    <CreditCard size={11} /> Billing
                  </span>
                  <p className="text-white/50 text-[13px]">Track subscriptions and payment history</p>
                </div>
              </div>
            </div>
            {isSuperAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="!bg-white/10 !border-white/20 !text-white hover:!bg-white/20">
                  {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {exporting ? 'Exporting...' : 'Export Excel'}
                </Button>
                <Button size="sm" onClick={openAddModal} className="!bg-gradient-to-r !from-red-500 !to-orange-600 !text-white hover:!brightness-110 !shadow-lg !shadow-red-500/25 !border-0">
                  <Plus size={13} /> Record Payment
                </Button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Revenue', value: `₹${(stats?.total_revenue || 0).toLocaleString()}`, icon: TrendingUp, sub: `${stats?.successful || 0} successful`, gradient: 'from-emerald-500/20 to-emerald-500/5' },
              { label: 'Transactions', value: stats?.total_transactions || 0, icon: Receipt, sub: `${stats?.pending || 0} pending`, gradient: 'from-indigo-500/20 to-indigo-500/5' },
              { label: 'Failed', value: stats?.failed || 0, icon: XCircle, sub: 'need attention', gradient: 'from-red-500/20 to-red-500/5' },
              { label: 'Refunded', value: `₹${(stats?.refund_amount || 0).toLocaleString()}`, icon: RefreshCw, sub: `${stats?.refunded || 0} refunds`, gradient: 'from-amber-500/20 to-amber-500/5' },
            ].map(s => (
              <div key={s.label} className={`bg-gradient-to-br ${s.gradient} backdrop-blur-sm rounded-xl px-4 py-3 border border-white/10`}>
                <div className="flex items-center gap-2 mb-1">
                  <s.icon size={13} className="text-white/60" />
                  <span className="text-[10px] font-semibold text-white/60 uppercase tracking-wider">{s.label}</span>
                </div>
                <div className="text-[22px] font-extrabold text-white">{s.value}</div>
                <div className="text-[10px] text-white/40 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[340px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by transaction ID, invoice, client..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none focus:border-primary/50 focus:ring-3 focus:ring-primary/10 placeholder:text-muted/60 transition-all duration-300" />
          {searchInput && <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer"><X size={12} /></button>}
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-muted" />
          {['', 'success', 'pending', 'failed', 'refunded'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-200 cursor-pointer ${
                statusFilter === s ? 'bg-primary text-white border-primary shadow-md shadow-primary/25' : 'border-border bg-surface text-secondary hover:border-primary/40 hover:text-primary'
              }`}>{s || 'All'}</button>
          ))}
        </div>
        <span className="text-[11px] text-muted ml-auto">{loading ? 'Loading...' : `${payments.length} of ${total}`}</span>
      </div>

      {/* Payment List */}
      {loading ? (
        <ShimmerPaymentList count={5} />
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/5 flex items-center justify-center mb-4">
            <Banknote size={28} className="text-emerald-400/40" />
          </div>
          <h3 className="text-[15px] font-bold text-text mb-1">No payments found</h3>
          <p className="text-[12px] text-muted mb-4">Payments will appear here when recorded</p>
          {isSuperAdmin && <Button size="sm" onClick={openAddModal}><Plus size={13} /> Record Payment</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map(p => {
            const sc = statusConfig[p.status] || statusConfig.pending;
            const StatusIcon = sc.icon;
            return (
              <div key={p.id}
                className="group bg-surface border border-border rounded-2xl p-4 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 hover:border-primary/15 transition-all duration-300">
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Status Icon */}
                  <div className={`w-11 h-11 rounded-xl bg-${sc.color}-500/10 flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110`}>
                    <StatusIcon size={18} className={`text-${sc.color}-500`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-extrabold text-text">{p.client?.org_name || 'Unknown'}</span>
                      <Badge variant={sc.variant} dot>{p.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted flex-wrap">
                      {p.invoice_number && <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded">{p.invoice_number}</span>}
                      {p.txn_id && <span>TXN: {p.txn_id}</span>}
                      <span className="flex items-center gap-1"><CreditCard size={10} /> {methodLabels[p.method] || p.method}</span>
                      {p.plan && <span>{p.plan.name}</span>}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right flex-shrink-0">
                    <div className={`text-[18px] font-extrabold ${p.status === 'success' ? 'text-emerald-600' : p.status === 'failed' ? 'text-red-500' : 'text-text'}`}>
                      ₹{parseFloat(p.total).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted">
                      {new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setViewPayment(p)} title="View Details"
                      className="w-8 h-8 rounded-lg border border-border bg-surface text-muted flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-pointer">
                      <Eye size={13} />
                    </button>
                    {p.status === 'success' && (
                      <button onClick={() => viewInvoice(p)} title="View Invoice"
                        className="w-8 h-8 rounded-lg border border-border bg-surface text-muted flex items-center justify-center hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-pointer">
                        <FileText size={13} />
                      </button>
                    )}
                    {isSuperAdmin && (
                      <button onClick={() => handleDelete(p)} title="Delete"
                        className="w-8 h-8 rounded-lg border border-border bg-surface text-muted flex items-center justify-center hover:bg-red-50 hover:text-red-600 hover:border-red-200 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-pointer">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 disabled:opacity-30 cursor-pointer transition-all">
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => setPage(n)}
              className={`w-8 h-8 rounded-lg text-[11px] font-bold flex items-center justify-center border transition-all duration-200 cursor-pointer ${
                n === page ? 'bg-primary text-white border-primary shadow-md shadow-primary/25' : 'border-border text-muted hover:text-primary hover:border-primary/40'
              }`}>{n}</button>
          ))}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 disabled:opacity-30 cursor-pointer transition-all">
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* View Payment Modal */}
      <Modal open={!!viewPayment} onClose={() => setViewPayment(null)} title="Payment Details" size="lg">
        {viewPayment && (() => {
          const sc = statusConfig[viewPayment.status] || statusConfig.pending;
          const StatusIcon = sc.icon;
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-xl" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <StatusIcon size={16} />
                      <span className="text-[12px] font-bold uppercase tracking-wider text-white/80">{viewPayment.status}</span>
                    </div>
                    <div className="text-[28px] font-extrabold">₹{parseFloat(viewPayment.total).toLocaleString()}</div>
                    <div className="text-white/60 text-[12px] mt-1">{viewPayment.client?.org_name}</div>
                  </div>
                  <div className="text-right">
                    {viewPayment.invoice_number && <div className="font-mono text-[11px] bg-white/15 px-2 py-1 rounded-lg mb-1">{viewPayment.invoice_number}</div>}
                    <div className="text-[11px] text-white/60">{new Date(viewPayment.created_at).toLocaleString('en-IN')}</div>
                  </div>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Amount', value: `₹${parseFloat(viewPayment.amount).toLocaleString()}` },
                  { label: 'GST', value: viewPayment.gst ? `₹${parseFloat(viewPayment.gst).toLocaleString()}` : '—' },
                  { label: 'Discount', value: viewPayment.discount ? `₹${parseFloat(viewPayment.discount).toLocaleString()}` : '—' },
                  { label: 'Total', value: `₹${parseFloat(viewPayment.total).toLocaleString()}` },
                  { label: 'Method', value: methodLabels[viewPayment.method] || viewPayment.method },
                  { label: 'Gateway', value: viewPayment.gateway || '—' },
                  { label: 'Plan', value: viewPayment.plan?.name || '—' },
                  { label: 'Billing Cycle', value: viewPayment.billing_cycle || '—' },
                  { label: 'Valid From', value: viewPayment.valid_from ? new Date(viewPayment.valid_from).toLocaleDateString('en-IN') : '—' },
                  { label: 'Valid Until', value: viewPayment.valid_until ? new Date(viewPayment.valid_until).toLocaleDateString('en-IN') : '—' },
                  { label: 'Transaction ID', value: viewPayment.txn_id || '—' },
                  { label: 'Order ID', value: viewPayment.order_id || '—' },
                ].map(d => (
                  <div key={d.label} className="p-3 rounded-xl bg-surface-2 border border-border/50">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{d.label}</div>
                    <div className="text-[13px] font-semibold text-text mt-0.5">{d.value}</div>
                  </div>
                ))}
              </div>

              {viewPayment.notes && (
                <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200/50">
                  <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">Notes</div>
                  <p className="text-[12px] text-amber-800">{viewPayment.notes}</p>
                </div>
              )}

              {/* Invoice Button */}
              {viewPayment.status === 'success' && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => viewInvoice(viewPayment)}>
                    <FileText size={12} /> View Invoice PDF
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Add Payment Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Record New Payment" size="lg">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200/50 text-[11.5px] text-sky-700 mb-2">
            <strong>Note:</strong> If status is "Success", an invoice PDF will be generated and emailed to the client automatically.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select name="client_id" label="Client" required>
              <option value="">Select client...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.org_name}</option>)}
            </Select>
            <Select name="plan_id" label="Plan">
              <option value="">Select plan...</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>)}
            </Select>
            <Input name="amount" label="Amount (₹)" type="number" step="0.01" required placeholder="0.00" />
            <Input name="gst" label="GST (₹)" type="number" step="0.01" placeholder="0.00" />
            <Input name="discount" label="Discount (₹)" type="number" step="0.01" placeholder="0.00" />
            <Input name="total" label="Total (₹)" type="number" step="0.01" required placeholder="0.00" />
            <Select name="method" label="Payment Method" required>
              <option value="">Select method...</option>
              {Object.entries(methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select name="gateway" label="Gateway">
              <option value="">Select gateway...</option>
              <option value="razorpay">Razorpay</option>
              <option value="stripe">Stripe</option>
              <option value="paytm">Paytm</option>
              <option value="manual">Manual</option>
            </Select>
            <Select name="status" label="Status" required>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </Select>
            <Select name="billing_cycle" label="Billing Cycle">
              <option value="">Select...</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </Select>
            <Input name="valid_from" label="Valid From" type="date" />
            <Input name="valid_until" label="Valid Until" type="date" />
            <Input name="txn_id" label="Transaction ID" placeholder="TXN-XXXXXX" />
            <Input name="order_id" label="Order ID" placeholder="ORD-XXXXXX" />
          </div>
          <Textarea name="notes" label="Notes" placeholder="Any additional notes..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {saving ? 'Saving...' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
