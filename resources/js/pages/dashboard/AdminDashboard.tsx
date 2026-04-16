import { useState, useEffect } from 'react';
import Badge from '../../components/ui/Badge';
import {
  Building2, Users, CreditCard, GitBranch, Loader2, IndianRupee,
  TrendingUp, TrendingDown, CheckCircle2, Clock, XCircle, ArrowUpRight,
  Sparkles, Activity, BarChart3, PieChart as PieChartIcon, Receipt
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import api from '../../api';

interface DashboardData {
  counts: {
    total_clients: number; active_clients: number; inactive_clients: number;
    total_users: number; total_branches: number; total_payments: number;
    success_payments: number; pending_payments: number; failed_payments: number;
  };
  revenue: { total: number; monthly: number };
  plan_distribution: Record<string, number>;
  plan_breakdown: { plan_name: string; count: number }[];
  revenue_trend: { month: string; short: string; revenue: number; count: number }[];
  client_growth: { month: string; clients: number }[];
  user_types: Record<string, number>;
  org_types: { org_type: string; count: number }[];
  recent_clients: any[];
  recent_payments: any[];
  top_clients: any[];
}

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', card: 'Card',
};

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/admin-stats').then(res => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-muted text-[13px]">
        <Loader2 size={28} className="animate-spin mr-3" /> Loading dashboard...
      </div>
    );
  }

  if (!data) return <div className="text-center py-20 text-muted">Failed to load dashboard data.</div>;

  const { counts, revenue } = data;

  return (
    <div className="space-y-5">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-6 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4 blur-2xl" />

        <div className="relative flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Activity size={22} />
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight">Admin Dashboard</h1>
            <p className="text-white/60 text-[13px] mt-0.5">Platform overview and analytics</p>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Clients', value: counts.total_clients, icon: Building2, accent: 'from-white/20 to-white/10' },
            { label: 'Active', value: counts.active_clients, icon: CheckCircle2, accent: 'from-emerald-400/20 to-emerald-400/10' },
            { label: 'Total Users', value: counts.total_users, icon: Users, accent: 'from-sky-400/20 to-sky-400/10' },
            { label: 'Branches', value: counts.total_branches, icon: GitBranch, accent: 'from-amber-400/20 to-amber-400/10' },
            { label: 'Revenue', value: `₹${(revenue.total / 1000).toFixed(1)}K`, icon: IndianRupee, accent: 'from-emerald-400/20 to-emerald-400/10' },
            { label: 'Payments', value: counts.total_payments, icon: Receipt, accent: 'from-violet-400/20 to-violet-400/10' },
          ].map(s => (
            <div key={s.label} className={`bg-gradient-to-br ${s.accent} backdrop-blur-sm rounded-xl px-3.5 py-3 border border-white/10`}>
              <div className="flex items-center gap-1.5 mb-1">
                <s.icon size={12} className="text-white/60" />
                <span className="text-[9px] font-semibold text-white/60 uppercase tracking-wider">{s.label}</span>
              </div>
              <div className="text-[20px] font-extrabold">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Revenue & Client Growth Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Revenue Trend */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp size={16} className="text-emerald-500" />
              </div>
              <div>
                <h3 className="text-[13px] font-bold text-text">Revenue Trend</h3>
                <p className="text-[10px] text-muted">Last 6 months</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[16px] font-extrabold text-emerald-600">₹{revenue.total.toLocaleString()}</div>
              <div className="text-[9px] text-muted uppercase tracking-wider">Total Revenue</div>
            </div>
          </div>
          <div className="px-2 py-4">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.revenue_trend}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
                <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                  formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Client Growth */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <BarChart3 size={16} className="text-indigo-500" />
              </div>
              <div>
                <h3 className="text-[13px] font-bold text-text">Client Growth</h3>
                <p className="text-[10px] text-muted">New clients per month</p>
              </div>
            </div>
          </div>
          <div className="px-2 py-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.client_growth} barSize={32}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                />
                <Bar dataKey="clients" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Plan Distribution & Payment Status ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Plan Breakdown Pie */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <PieChartIcon size={16} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-text">Plan Distribution</h3>
              <p className="text-[10px] text-muted">Clients by plan</p>
            </div>
          </div>
          <div className="p-4 flex items-center justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={data.plan_breakdown} dataKey="count" nameKey="plan_name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                  {data.plan_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', fontSize: '12px' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Status */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
              <CreditCard size={16} className="text-sky-500" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-text">Payment Status</h3>
              <p className="text-[10px] text-muted">{counts.total_payments} total transactions</p>
            </div>
          </div>
          <div className="p-5 space-y-3">
            {[
              { label: 'Successful', count: counts.success_payments, color: 'emerald', icon: CheckCircle2 },
              { label: 'Pending', count: counts.pending_payments, color: 'amber', icon: Clock },
              { label: 'Failed', count: counts.failed_payments, color: 'red', icon: XCircle },
            ].map(s => {
              const pct = counts.total_payments > 0 ? (s.count / counts.total_payments) * 100 : 0;
              return (
                <div key={s.label} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <s.icon size={14} className={`text-${s.color}-500`} />
                      <span className="text-[12px] font-semibold text-text">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-extrabold text-text">{s.count}</span>
                      <span className="text-[10px] text-muted">({pct.toFixed(0)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div className={`h-full bg-${s.color}-500 rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}

            <div className="pt-3 mt-3 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted">Monthly Revenue</span>
                <span className="text-[14px] font-extrabold text-emerald-600">₹{revenue.monthly.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Organization Types */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Sparkles size={16} className="text-violet-500" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-text">Organization Types</h3>
              <p className="text-[10px] text-muted">Client categories</p>
            </div>
          </div>
          <div className="p-5 space-y-3">
            {data.org_types.map((o, i) => {
              const pct = counts.total_clients > 0 ? (o.count / counts.total_clients) * 100 : 0;
              return (
                <div key={o.org_type} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: COLORS[i % COLORS.length] }}>
                    {o.org_type.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-semibold text-text">{o.org_type}</span>
                      <span className="text-[11px] font-bold text-muted">{o.count}</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* User Type Breakdown */}
            <div className="pt-3 mt-2 border-t border-border/50">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">User Breakdown</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.user_types).map(([type, count]) => (
                  <div key={type} className="px-2.5 py-1 rounded-lg bg-surface-2 border border-border/50 text-[10px]">
                    <span className="text-muted capitalize">{type.replace('_', ' ')}: </span>
                    <span className="font-bold text-text">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Activity & Top Clients ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Clients */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <Building2 size={16} className="text-indigo-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Recent Clients</h3>
            </div>
            <span className="text-[10px] text-muted">Last 5</span>
          </div>
          <div className="divide-y divide-border/30">
            {data.recent_clients.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3 hover:bg-primary/[.03] transition-colors">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                  {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold text-text truncate">{c.org_name}</div>
                  <div className="text-[10px] text-muted">{c.email}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge>
                  <Badge variant="primary">{c.plan?.name || 'Free'}</Badge>
                </div>
              </div>
            ))}
            {data.recent_clients.length === 0 && (
              <div className="px-5 py-8 text-center text-[12px] text-muted">No clients yet</div>
            )}
          </div>
        </div>

        {/* Recent Payments */}
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <IndianRupee size={16} className="text-emerald-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Recent Payments</h3>
            </div>
            <span className="text-[10px] text-muted">Last 5</span>
          </div>
          <div className="divide-y divide-border/30">
            {data.recent_payments.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-primary/[.03] transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  p.status === 'success' ? 'bg-emerald-500/10' : p.status === 'failed' ? 'bg-red-500/10' : 'bg-amber-500/10'
                }`}>
                  {p.status === 'success' ? <CheckCircle2 size={16} className="text-emerald-500" /> :
                   p.status === 'failed' ? <XCircle size={16} className="text-red-500" /> :
                   <Clock size={16} className="text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold text-text truncate">{p.client?.org_name || 'Unknown'}</div>
                  <div className="text-[10px] text-muted flex items-center gap-2">
                    <span>{p.invoice_number}</span>
                    <span>·</span>
                    <span>{methodLabels[p.method] || p.method}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[13px] font-extrabold ${p.status === 'success' ? 'text-emerald-600' : p.status === 'failed' ? 'text-red-500' : 'text-text'}`}>
                    ₹{parseFloat(p.total).toLocaleString()}
                  </div>
                  <div className="text-[9px] text-muted">
                    {new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </div>
                </div>
              </div>
            ))}
            {data.recent_payments.length === 0 && (
              <div className="px-5 py-8 text-center text-[12px] text-muted">No payments yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Top Clients by Revenue ── */}
      {data.top_clients.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <TrendingUp size={16} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-text">Top Clients by Revenue</h3>
              <p className="text-[10px] text-muted">Highest paying organizations</p>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {data.top_clients.map((tc: any, i: number) => {
              const pct = revenue.total > 0 ? (parseFloat(tc.total_revenue) / revenue.total) * 100 : 0;
              return (
                <div key={tc.client_id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-primary/[.03] transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0" style={{ background: COLORS[i] }}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-text">{tc.client?.org_name || 'Unknown'}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: COLORS[i] }} />
                      </div>
                      <span className="text-[10px] text-muted flex-shrink-0">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[15px] font-extrabold text-text">₹{parseFloat(tc.total_revenue).toLocaleString()}</div>
                    <div className="text-[10px] text-muted">{tc.payments_count} payment{tc.payments_count !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
