import { useState, useEffect, useRef } from 'react';
import Badge from '../../components/ui/Badge';
import {
  Building2, Users, GitBranch, IndianRupee,
  TrendingUp, CheckCircle2, Clock, XCircle,
  Sparkles, Activity, BarChart3, PieChart as PieChartIcon, Receipt,
  ArrowUpRight, ArrowDownRight, Zap, Award
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

/* ── Animated Counter ── */
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1200;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <span ref={ref}>{prefix}{display.toLocaleString()}{suffix}</span>;
}

/* ── Progress Ring ── */
function ProgressRing({ value, max, color, size = 80, strokeWidth = 8 }: { value: number; max: number; color: string; size?: number; strokeWidth?: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-border" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-1000 ease-out" />
    </svg>
  );
}

/* ── Tooltip ── */
const ChartTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1e293b] border border-white/10 rounded-xl px-4 py-3 shadow-2xl text-[11px]">
      <div className="font-bold text-white mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="text-slate-300">{prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</div>
      ))}
    </div>
  );
};

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    api.get('/dashboard/admin-stats').then(res => {
      setData(res.data);
      setTimeout(() => setAnimate(true), 100);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/30 animate-pulse">
            <Activity size={28} className="text-white" />
          </div>
          <div className="absolute -inset-2 rounded-3xl border-2 border-indigo-500/20 animate-ping" />
        </div>
        <span className="text-[14px] text-muted font-semibold">Loading dashboard...</span>
      </div>
    );
  }

  if (!data) return null;
  const { counts, revenue } = data;
  const successRate = counts.total_payments > 0 ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;
  const activeRate = counts.total_clients > 0 ? Math.round((counts.active_clients / counts.total_clients) * 100) : 0;

  const statCards = [
    { label: 'Total Clients', value: counts.total_clients, icon: Building2, gradient: 'from-indigo-500 via-indigo-600 to-violet-700', glow: 'shadow-indigo-500/30', change: '+12%', up: true },
    { label: 'Active Clients', value: counts.active_clients, icon: CheckCircle2, gradient: 'from-emerald-500 via-emerald-600 to-teal-700', glow: 'shadow-emerald-500/30', change: `${activeRate}%`, up: true },
    { label: 'Total Users', value: counts.total_users, icon: Users, gradient: 'from-sky-500 via-sky-600 to-blue-700', glow: 'shadow-sky-500/30', change: '+8%', up: true },
    { label: 'Branches', value: counts.total_branches, icon: GitBranch, gradient: 'from-amber-500 via-amber-600 to-orange-700', glow: 'shadow-amber-500/30', change: '+5%', up: true },
    { label: 'Revenue', value: revenue.total, icon: IndianRupee, gradient: 'from-emerald-500 via-green-600 to-emerald-700', glow: 'shadow-emerald-500/30', change: '+24%', up: true, isRevenue: true },
    { label: 'Payments', value: counts.total_payments, icon: Receipt, gradient: 'from-violet-500 via-purple-600 to-fuchsia-700', glow: 'shadow-violet-500/30', change: `${successRate}% success`, up: successRate > 80 },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-extrabold text-text tracking-tight">Platform Overview</h1>
          <p className="text-[13px] text-muted mt-1">Real-time analytics and insights</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-emerald-600">Live</span>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((s, idx) => (
          <div key={s.label}
            className={`bg-gradient-to-br ${s.gradient} rounded-2xl p-4 text-white relative overflow-hidden shadow-xl ${s.glow} hover:scale-[1.04] hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 cursor-default transform ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
            style={{ transitionDelay: `${idx * 100}ms` }}>
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-10 translate-x-10 blur-xl" />
            <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-6 -translate-x-6" />
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <s.icon size={17} />
              </div>
              <div className="text-[24px] font-extrabold tracking-tight leading-none mb-1">
                {s.isRevenue ? (
                  <span>₹<AnimatedNumber value={Math.round(revenue.total / 1000)} suffix="K" /></span>
                ) : (
                  <AnimatedNumber value={s.value} />
                )}
              </div>
              <div className="text-[10px] font-semibold text-white/70 uppercase tracking-widest">{s.label}</div>
              <div className="flex items-center gap-1 mt-2">
                {s.up ? <ArrowUpRight size={11} className="text-white/80" /> : <ArrowDownRight size={11} className="text-white/80" />}
                <span className="text-[10px] text-white/80 font-semibold">{s.change}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Revenue + Radial Gauges ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Revenue Chart */}
        <div className={`lg:col-span-8 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500 transform ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          style={{ transitionDelay: '600ms' }}>
          <div className="px-6 py-5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <TrendingUp size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-[15px] font-extrabold text-text">Revenue Analytics</h3>
                <p className="text-[11px] text-muted mt-0.5">6-month performance trend</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[22px] font-extrabold text-emerald-600">₹{revenue.total.toLocaleString()}</div>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <ArrowUpRight size={12} className="text-emerald-500" />
                <span className="text-[11px] text-emerald-500 font-bold">+24% vs last period</span>
              </div>
            </div>
          </div>
          <div className="px-4 py-5">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.revenue_trend} margin={{ top: 5, right: 15, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="50%" stopColor="#10b981" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" opacity={0.3} vertical={false} />
                <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip content={<ChartTooltip prefix="₹" />} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} fill="url(#revGrad2)"
                  dot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 3 }}
                  activeDot={{ r: 7, fill: '#10b981', stroke: '#fff', strokeWidth: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Radial Gauges */}
        <div className={`lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-4 transform transition-all duration-700 ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          style={{ transitionDelay: '700ms' }}>
          {/* Success Rate */}
          <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 hover:shadow-xl transition-all duration-300 group">
            <div className="relative flex-shrink-0">
              <ProgressRing value={counts.success_payments} max={counts.total_payments} color="#10b981" size={72} strokeWidth={7} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[16px] font-extrabold text-emerald-600">{successRate}%</span>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-extrabold text-text">Payment Success</div>
              <div className="text-[11px] text-muted mt-0.5">{counts.success_payments} of {counts.total_payments}</div>
              <div className="flex items-center gap-1 mt-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-emerald-600 font-semibold">Healthy</span>
              </div>
            </div>
          </div>

          {/* Active Rate */}
          <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 hover:shadow-xl transition-all duration-300 group">
            <div className="relative flex-shrink-0">
              <ProgressRing value={counts.active_clients} max={counts.total_clients} color="#6366f1" size={72} strokeWidth={7} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[16px] font-extrabold text-indigo-600">{activeRate}%</span>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-extrabold text-text">Client Activity</div>
              <div className="text-[11px] text-muted mt-0.5">{counts.active_clients} active of {counts.total_clients}</div>
              <div className="flex items-center gap-1 mt-1.5">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <span className="text-[10px] text-indigo-600 font-semibold">Strong</span>
              </div>
            </div>
          </div>

          {/* Monthly Revenue */}
          <div className="bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-700 rounded-2xl p-5 text-white hover:shadow-xl hover:shadow-indigo-500/20 transition-all duration-300 col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold text-white/70 uppercase tracking-widest">This Month</div>
              <Zap size={16} className="text-amber-300" />
            </div>
            <div className="text-[26px] font-extrabold tracking-tight">₹{revenue.monthly.toLocaleString()}</div>
            <div className="text-[11px] text-white/60 mt-1">Monthly collection</div>
          </div>
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Client Growth */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-500 transform ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          style={{ transitionDelay: '800ms' }}>
          <div className="px-6 py-5 flex items-center gap-3 border-b border-border/50">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <BarChart3 size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-[14px] font-extrabold text-text">Client Growth</h3>
              <p className="text-[11px] text-muted">Monthly registrations</p>
            </div>
          </div>
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.client_growth}>
                <defs>
                  <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" opacity={0.3} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="clients" fill="url(#barG)" radius={[8, 8, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Plan Distribution */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-500 transform ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          style={{ transitionDelay: '900ms' }}>
          <div className="px-6 py-5 flex items-center gap-3 border-b border-border/50">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
              <PieChartIcon size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-[14px] font-extrabold text-text">Plan Distribution</h3>
              <p className="text-[11px] text-muted">Subscription breakdown</p>
            </div>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.plan_breakdown} dataKey="count" nameKey="plan_name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} strokeWidth={0}>
                  {data.plan_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Org Types + User Roles */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-500 transform ${animate ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
          style={{ transitionDelay: '1000ms' }}>
          <div className="px-6 py-5 flex items-center gap-3 border-b border-border/50">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-[14px] font-extrabold text-text">Organization Types</h3>
              <p className="text-[11px] text-muted">Client categories</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            {data.org_types.map((o, i) => {
              const pct = counts.total_clients > 0 ? (o.count / counts.total_clients) * 100 : 0;
              return (
                <div key={o.org_type} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shadow-md group-hover:scale-110 transition-transform duration-300" style={{ background: COLORS[i % COLORS.length] }}>
                        {o.org_type.charAt(0)}
                      </div>
                      <span className="text-[12.5px] font-semibold text-text">{o.org_type}</span>
                    </div>
                    <span className="text-[12px] font-extrabold text-text">{o.count}</span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000 ease-out group-hover:brightness-110" style={{ width: `${Math.max(pct, 8)}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t border-border/50">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2.5">User Roles</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.user_types).map(([type, count], i) => (
                  <div key={type} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all duration-200"
                    style={{ borderLeftColor: COLORS[i % COLORS.length], borderLeftWidth: 3 }}>
                    <span className="text-[10px] text-muted capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] font-extrabold text-text">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Clients */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-shadow duration-500">
          <div className="px-6 py-5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <Building2 size={18} className="text-white" />
              </div>
              <h3 className="text-[14px] font-extrabold text-text">Recent Clients</h3>
            </div>
            <span className="text-[10px] font-bold text-primary bg-primary/8 px-3 py-1 rounded-lg">Last 5</span>
          </div>
          <div className="divide-y divide-border/20">
            {data.recent_clients.map((c: any, i: number) => (
              <div key={c.id} className={`flex items-center gap-3.5 px-6 py-3.5 hover:bg-primary/[.03] transition-all duration-300 transform ${animate ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${1100 + i * 80}ms` }}>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-extrabold shadow-md flex-shrink-0">
                  {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-text truncate">{c.org_name}</div>
                  <div className="text-[10.5px] text-muted mt-0.5">{c.email}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge>
                  <Badge variant="primary">{c.plan?.name || 'Free'}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Payments */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-shadow duration-500">
          <div className="px-6 py-5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <IndianRupee size={18} className="text-white" />
              </div>
              <h3 className="text-[14px] font-extrabold text-text">Recent Payments</h3>
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg">Last 5</span>
          </div>
          <div className="divide-y divide-border/20">
            {data.recent_payments.map((p: any, i: number) => (
              <div key={p.id} className={`flex items-center gap-3.5 px-6 py-3.5 hover:bg-primary/[.03] transition-all duration-300 transform ${animate ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${1100 + i * 80}ms` }}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  p.status === 'success' ? 'bg-emerald-50' : p.status === 'failed' ? 'bg-red-50' : 'bg-amber-50'
                }`}>
                  {p.status === 'success' ? <CheckCircle2 size={18} className="text-emerald-500" /> :
                   p.status === 'failed' ? <XCircle size={18} className="text-red-500" /> :
                   <Clock size={18} className="text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-text truncate">{p.client?.org_name || 'Unknown'}</div>
                  <div className="text-[10.5px] text-muted mt-0.5">{p.invoice_number} · {methodLabels[p.method] || p.method}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[14px] font-extrabold ${p.status === 'success' ? 'text-emerald-600' : p.status === 'failed' ? 'text-red-500' : 'text-text'}`}>
                    ₹{parseFloat(p.total).toLocaleString()}
                  </div>
                  <div className="text-[9.5px] text-muted mt-0.5">{new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Top Clients ── */}
      {data.top_clients.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-xl transition-shadow duration-500">
          <div className="px-6 py-5 flex items-center justify-between border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
                <Award size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-extrabold text-text">Top Revenue Clients</h3>
                <p className="text-[11px] text-muted">Highest contributors</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-border/20">
            {data.top_clients.map((tc: any, i: number) => {
              const pct = revenue.total > 0 ? (parseFloat(tc.total_revenue) / revenue.total) * 100 : 0;
              return (
                <div key={tc.client_id} className="flex items-center gap-4 px-6 py-4 hover:bg-primary/[.02] transition-all duration-300 group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[12px] font-extrabold shadow-lg flex-shrink-0 group-hover:scale-110 transition-transform duration-300" style={{ background: COLORS[i] }}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-text mb-1.5">{tc.client?.org_name || 'Unknown'}</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2.5 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${pct}%`, background: COLORS[i] }} />
                      </div>
                      <span className="text-[11px] text-muted font-bold w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 pl-4">
                    <div className="text-[17px] font-extrabold text-text">₹{parseFloat(tc.total_revenue).toLocaleString()}</div>
                    <div className="text-[10px] text-muted font-medium">{tc.payments_count} payment{tc.payments_count !== 1 ? 's' : ''}</div>
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
