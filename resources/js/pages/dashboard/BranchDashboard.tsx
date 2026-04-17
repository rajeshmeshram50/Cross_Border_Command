import { useState, useEffect } from 'react';
import Badge from '../../components/ui/Badge';
import {
  Users, GitBranch, IndianRupee, CheckCircle2, Clock, XCircle,
  TrendingUp, Receipt, Shield, Star, AlertTriangle, Info
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1e293b] border border-white/10 rounded-lg px-3 py-2 shadow-2xl text-[10px]">
      <div className="font-bold text-white mb-0.5">{label}</div>
      <div className="text-slate-300">₹{payload[0]?.value?.toLocaleString()}</div>
    </div>
  );
};

export default function BranchDashboard() {
  const { user } = useAuth();
  const { isMainBranchUser, selectedBranchId, selectedBranch } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    api.get('/dashboard/client-stats').then(res => {
      setData(res.data);
      setTimeout(() => setAnimate(true), 100);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, branches: allBranches, recent_payments, payment_trend } = data;

  // Filter branches if not main branch user
  const branches = isMainBranchUser && !selectedBranchId
    ? allBranches
    : allBranches.filter((b: any) => b.id === (selectedBranchId || user?.branch_id));

  const displayName = selectedBranch?.name || (isMainBranchUser ? user?.client_name : user?.branch_name);
  const branchUsers = branches.reduce((s: number, b: any) => s + (b.users_count ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold text-text tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-muted mt-0.5">
            {displayName} · {isMainBranchUser && !selectedBranchId ? 'All Branches' : 'Branch Overview'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMainBranchUser && !selectedBranchId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Star size={10} className="text-amber-500" />
              <span className="text-[10px] font-semibold text-amber-600">Main Branch</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-600">Live</span>
          </div>
        </div>
      </div>

      {/* Branch User Info Banner */}
      {!isMainBranchUser && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-50 border border-sky-200/50 text-[11px] text-sky-700 transition-all duration-500 ${animate ? 'opacity-100' : 'opacity-0'}`}>
          <Info size={13} />
          You are viewing <strong className="mx-0.5">{user?.branch_name}</strong> branch data only.
        </div>
      )}

      {/* Plan Status */}
      <div className={`rounded-xl overflow-hidden transition-all duration-500 ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        {plan.status === 'expired' ? (
          <div className="bg-gradient-to-r from-red-500 to-rose-600 px-5 py-3.5 flex items-center gap-3 text-white">
            <AlertTriangle size={18} />
            <div>
              <div className="text-[13px] font-bold">Plan Expired — Access Restricted</div>
              <div className="text-[10px] text-white/70">Contact your admin to renew the {plan.name} plan.</div>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-3.5 flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <Shield size={18} />
              <div>
                <div className="text-[13px] font-bold">{plan.name} Plan</div>
                <div className="text-[10px] text-white/70">
                  {plan.days_remaining !== null ? `${plan.days_remaining} days remaining` : 'Active'}
                </div>
              </div>
            </div>
            {plan.days_remaining !== null && plan.days_remaining <= 30 && (
              <div className="text-[10px] font-bold bg-white/20 px-2.5 py-1 rounded-lg">{plan.days_remaining}d left</div>
            )}
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Branches', value: branches.length, icon: GitBranch, bg: 'bg-sky-50', text: 'text-sky-600' },
          { label: 'Users', value: branchUsers, icon: Users, bg: 'bg-indigo-50', text: 'text-indigo-600' },
          { label: 'Total Paid', value: counts.total_paid, icon: IndianRupee, bg: 'bg-emerald-50', text: 'text-emerald-600', isAmount: true },
          { label: 'Payments', value: counts.total_payments, icon: Receipt, bg: 'bg-violet-50', text: 'text-violet-600' },
        ].map((s: any, idx) => (
          <div key={s.label}
            className={`bg-surface border border-border rounded-xl p-3.5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-default group ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
            style={{ transitionDelay: `${idx * 60}ms` }}>
            <div className="flex items-center justify-between mb-2.5">
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <s.icon size={15} className={s.text} />
              </div>
              <span className="text-[9px] font-bold text-muted uppercase tracking-wider">{s.label}</span>
            </div>
            <div className="text-[20px] font-extrabold text-text leading-none mb-1">
              {s.isAmount ? `₹${Math.round(s.value).toLocaleString()}` : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Payment Trend */}
      <div className={`bg-surface border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-500 ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
        style={{ transitionDelay: '300ms' }}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <TrendingUp size={15} className="text-emerald-500" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-text">Payment Trend</h3>
              <p className="text-[10px] text-muted">Last 6 months</p>
            </div>
          </div>
          <div className="text-[16px] font-extrabold text-emerald-600">₹{counts.total_paid.toLocaleString()}</div>
        </div>
        <div className="px-3 py-4">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={payment_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bRevG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={50} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2.5} fill="url(#bRevG)"
                dot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Branches + Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Branches */}
        <div className={`bg-surface border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-500 ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
          style={{ transitionDelay: '400ms' }}>
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center">
                <GitBranch size={15} className="text-sky-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Branches</h3>
            </div>
            <span className="text-[9px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md">{branches.length}</span>
          </div>
          <div className="divide-y divide-border/30">
            {branches.map((b: any) => (
              <div key={b.id} className="flex items-center gap-3 px-5 py-3 hover:bg-primary/[.03] transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold flex-shrink-0 ${b.is_main ? 'bg-gradient-to-br from-amber-500 to-yellow-400' : 'bg-gradient-to-br from-sky-500 to-cyan-400'}`}>
                  {b.code?.substring(0, 2) || b.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-bold text-text truncate">{b.name}</span>
                    {b.is_main && <Star size={9} className="text-amber-500 flex-shrink-0" />}
                  </div>
                  <div className="text-[9.5px] text-muted">{b.users_count} users</div>
                </div>
                <Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>{b.status}</Badge>
              </div>
            ))}
            {branches.length === 0 && (
              <div className="text-center py-8 text-[12px] text-muted">No branches</div>
            )}
          </div>
        </div>

        {/* Recent Payments */}
        <div className={`bg-surface border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-500 ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
          style={{ transitionDelay: '500ms' }}>
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <IndianRupee size={15} className="text-emerald-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Recent Payments</h3>
            </div>
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Last 5</span>
          </div>
          <div className="divide-y divide-border/30">
            {recent_payments.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-primary/[.03] transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  p.status === 'success' ? 'bg-emerald-50' : p.status === 'failed' ? 'bg-red-50' : 'bg-amber-50'
                }`}>
                  {p.status === 'success' ? <CheckCircle2 size={14} className="text-emerald-500" /> :
                   p.status === 'failed' ? <XCircle size={14} className="text-red-500" /> :
                   <Clock size={14} className="text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-text">{p.plan?.name || 'Payment'}</div>
                  <div className="text-[9.5px] text-muted">{p.invoice_number} · {methodLabels[p.method] || p.method}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[13px] font-extrabold ${p.status === 'success' ? 'text-emerald-600' : 'text-text'}`}>
                    ₹{parseFloat(p.total).toLocaleString()}
                  </div>
                  <div className="text-[9px] text-muted">{new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                </div>
              </div>
            ))}
            {recent_payments.length === 0 && (
              <div className="text-center py-8 text-[12px] text-muted">No payments yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
