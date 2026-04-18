import { useState, useEffect, useRef } from 'react';
import Badge from '../../components/ui/Badge';
import {
  Building2, Users, GitBranch, IndianRupee,
  TrendingUp, CheckCircle2, Clock, XCircle,
  Sparkles, BarChart3, PieChart as PieChartIcon, Receipt,
  ArrowUpRight, ArrowDownRight, Zap, Award, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

/* ─── TYPES ──────────────────────────────────────────────────── */
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

/* ─── CONSTANTS ──────────────────────────────────────────────── */
const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', card: 'Card',
};

/* ─── ANIMATED NUMBER ────────────────────────────────────────── */
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

/* ─── PROGRESS RING ──────────────────────────────────────────── */
function ProgressRing({ value, max, color, size = 80, strokeWidth = 8 }: {
  value: number; max: number; color: string; size?: number; strokeWidth?: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" className="transition-all duration-1000 ease-out" />
    </svg>
  );
}

/* ─── CHART TOOLTIP ──────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
      rounded-xl px-4 py-3 shadow-2xl text-[11px] backdrop-blur-sm">
      <div className="font-bold text-slate-800 dark:text-white mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="text-slate-600 dark:text-slate-300 font-semibold">
          {prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  );
};

/* ─── SECTION LABEL ──────────────────────────────────────────── */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500
    uppercase tracking-[0.12em] mb-2.5 px-0.5">{children}</div>
);

/* ─── MAIN COMPONENT ─────────────────────────────────────────── */
export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeCard, setActiveCard] = useState(0);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCard((prev) => (prev + 1) % 6);
    }, 2800);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.get('/dashboard/admin-stats').then(res => {
      setData(res.data);
      setTimeout(() => setAnimate(true), 100);
    }).catch(() => { }).finally(() => setLoading(false));
  }, []);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, revenue } = data;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;
  const activeRate = counts.total_clients > 0
    ? Math.round((counts.active_clients / counts.total_clients) * 100) : 0;

  const statCards = [
    {
      label: 'Total Clients',
      value: counts.total_clients,
      icon: Building2,
      gradient: 'from-[#5B5FEF] via-[#7C3AED] to-[#9333EA]',
      glow: 'shadow-purple-500/30',
      ring: 'ring-purple-400/20',
      change: '+12%',
      up: true,
    },

    {
      label: 'Active Clients',
      value: counts.active_clients,
      icon: CheckCircle2,
      gradient: 'from-[#00B894] via-[#00CEC9] to-[#00E5A8]',
      glow: 'shadow-emerald-500/30',
      ring: 'ring-emerald-400/20',
      change: `${activeRate}%`,
      up: true,
    },

    {
      label: 'Total Users',
      value: counts.total_users,
      icon: Users,
      gradient: 'from-[#0984E3] via-[#00A8FF] to-[#48DBFB]',
      glow: 'shadow-sky-500/30',
      ring: 'ring-sky-400/20',
      change: '+8%',
      up: true,
    },

    {
      label: 'Branches',
      value: counts.total_branches,
      icon: GitBranch,
      gradient: 'from-[#F39C12] via-[#FDCB6E] to-[#FFB142]',
      glow: 'shadow-orange-500/30',
      ring: 'ring-orange-400/20',
      change: '+5%',
      up: true,
    },

    {
      label: 'Revenue',
      value: revenue.total,
      icon: IndianRupee,
      gradient: 'from-[#00C853] via-[#2ECC71] to-[#55EFC4]',
      glow: 'shadow-green-500/30',
      ring: 'ring-green-400/20',
      change: '+24%',
      up: true,
      isRevenue: true,
    },

    {
      label: 'Payments',
      value: counts.total_payments,
      icon: Receipt,
      gradient: 'from-[#6C5CE7] via-[#A55EEA] to-[#E056FD]',
      glow: 'shadow-fuchsia-500/30',
      ring: 'ring-fuchsia-400/20',
      change: `${successRate}% ok`,
      up: successRate > 80,
    },
  ];
  return (
    <div className="space-y-6 min-h-screen">

      {/* ── HEADER ── */}
      <div className={`flex items-center justify-between transition-all duration-500
        ${animate ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600
              flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Activity size={14} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Platform Overview
            </h1>
          </div>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 pl-9">
            Real-time analytics and insights
          </p>
        </div>

      </div>

      {/* ── KPI STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 perspective-[1400px]">
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-white/5" />
        {statCards.map((s, idx) => {
          const isActive = activeCard === idx;

          return (
            <div
              key={s.label}
              className="group h-[100px] cursor-pointer"
            >
              {/* Flip Wrapper */}
              <div
                className={`
                relative w-full h-full transition-all duration-700
                [transform-style:preserve-3d]

                ${isActive ? 'rotate-y-180 scale-[1.03]' : ''}

                hover:rotate-y-180
                hover:scale-[1.03]
                hover:-translate-y-1
              `}
              >

                {/* FRONT SIDE */}
                <div
                  className={`
              absolute inset-0 rounded-3xl p-4 text-white overflow-hidden
              bg-gradient-to-br ${s.gradient}
              shadow-xl ${s.glow}
              ring-1 ${s.ring}
              backface-hidden
            `}
                >
                  {/* Glow */}
                  {/* <div className="absolute -top-8 -right-8 w-24 h-24 bg-white/10 rounded-full blur-3xl" /> */}
                  <div className="absolute -top-8 -right-8 w-20 h-20 bg-white/5 rounded-full blur-xl" />

                  <div className="relative z-10 h-full flex flex-col justify-between">
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md">
                      <s.icon size={16} />
                    </div>

                    {/* Number */}
                    <div>
                      <div className="text-[26px] font-black leading-none mb-1">
                        {s.isRevenue ? (
                          <>
                            ₹
                            <AnimatedNumber
                              value={Math.round(revenue.total / 1000)}
                              suffix="K"
                            />
                          </>
                        ) : (
                          <AnimatedNumber value={s.value} />
                        )}
                      </div>

                      <div className="text-[10px] uppercase tracking-[0.14em] text-white font-bold">
                        {s.label}
                      </div>
                    </div>
                  </div>
                </div>

                {/* BACK SIDE */}
                <div
                  className={`
              absolute inset-0 rounded-3xl p-4 text-white overflow-hidden
              bg-slate-900 dark:bg-slate-800
              border border-white/10
              shadow-2xl
              rotate-y-180 backface-hidden
            `}
                >
                  <div className="h-full flex flex-col justify-between">
                    {/* Top */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-bold">
                        Insights
                      </span>

                      {s.up ? (
                        <ArrowUpRight size={15} className="text-emerald-400" />
                      ) : (
                        <ArrowDownRight size={15} className="text-red-400" />
                      )}
                    </div>

                    {/* Middle */}
                    <div>
                      <div className="text-[24px] font-black text-white mb-1">
                        {s.change}
                      </div>

                      <div className="text-[11px] text-slate-400">
                        Compared to last month
                      </div>
                    </div>

                    {/* Bottom */}
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 animate-pulse"
                        style={{ width: `${50 + idx * 8}%` }}
                      />
                    </div>
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>
      {/* ── REVENUE CHART + GAUGES ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Revenue Area Chart */}
        <div
          className={`lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
            hover:shadow-lg dark:hover:shadow-slate-900/50 transition-all duration-500
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '500ms' }}
        >
          {/* top accent line */}
          <div className="h-0.5 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400" />

          <div className="px-6 py-5 flex items-center justify-between
            border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600
                flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <TrendingUp size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-[15px] font-extrabold text-slate-800 dark:text-white">
                  Revenue Analytics
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  6-month performance trend
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[22px] font-black text-emerald-600 dark:text-emerald-400
                tracking-tight">
                ₹{revenue.total.toLocaleString()}
              </div>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <ArrowUpRight size={12} className="text-emerald-500" />
                <span className="text-[11px] text-emerald-500 font-bold">+24% vs last period</span>
              </div>
            </div>
          </div>

          <div className="px-4 py-5 bg-slate-50/50 dark:bg-slate-900">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.revenue_trend} margin={{ top: 5, right: 15, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="60%" stopColor="#10b981" stopOpacity={0.06} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" opacity={0.4} vertical={false} />
                <XAxis dataKey="short"
                  tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                  axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false}
                  tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip content={<ChartTooltip prefix="₹" />} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5}
                  fill="url(#revGrad)"
                  dot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2.5 }}
                  activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gauge + Monthly Cards */}
        <div
          className={`lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-4
            transition-all duration-700
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '600ms' }}
        >
          {/* Payment Success Ring */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl p-5 flex items-center gap-4
            hover:shadow-lg dark:hover:shadow-slate-900/50 hover:border-emerald-200
            dark:hover:border-emerald-700/40 transition-all duration-300 group">
            <div className="relative flex-shrink-0">
              <ProgressRing value={counts.success_payments} max={counts.total_payments}
                color="#10b981" size={72} strokeWidth={7} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[15px] font-black text-emerald-600 dark:text-emerald-400">
                  {successRate}%
                </span>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-extrabold text-slate-800 dark:text-white">
                Payment Success
              </div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {counts.success_payments} of {counts.total_payments}
              </div>
              <div className="flex items-center gap-1.5 mt-2 bg-emerald-50
                dark:bg-emerald-500/10 px-2.5 py-1 rounded-full w-fit">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">
                  Healthy
                </span>
              </div>
            </div>
          </div>

          {/* Client Activity Ring */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl p-5 flex items-center gap-4
            hover:shadow-lg dark:hover:shadow-slate-900/50 hover:border-indigo-200
            dark:hover:border-indigo-700/40 transition-all duration-300 group">
            <div className="relative flex-shrink-0">
              <ProgressRing value={counts.active_clients} max={counts.total_clients}
                color="#6366f1" size={72} strokeWidth={7} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[15px] font-black text-indigo-600 dark:text-indigo-400">
                  {activeRate}%
                </span>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-extrabold text-slate-800 dark:text-white">
                Client Activity
              </div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {counts.active_clients} active of {counts.total_clients}
              </div>
              <div className="flex items-center gap-1.5 mt-2 bg-indigo-50
                dark:bg-indigo-500/10 px-2.5 py-1 rounded-full w-fit">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="text-[10px] text-indigo-700 dark:text-indigo-400 font-bold">
                  Strong
                </span>
              </div>
            </div>
          </div>

          {/* Monthly Revenue Card */}
          <div className="bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-700
            rounded-2xl p-5 text-white col-span-2 lg:col-span-1 relative overflow-hidden
            hover:shadow-2xl hover:shadow-indigo-500/25 hover:-translate-y-1
            transition-all duration-300 cursor-default ring-1 ring-indigo-400/20">
            <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r
              from-transparent via-white/30 to-transparent" />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold text-white/60 uppercase tracking-[0.12em]">
                  This Month
                </div>
                <div className="w-7 h-7 rounded-lg bg-amber-400/20 flex items-center justify-center">
                  <Zap size={14} className="text-amber-300" />
                </div>
              </div>
              <div className="text-[28px] font-black tracking-tight leading-none">
                ₹{revenue.monthly.toLocaleString()}
              </div>
              <div className="text-[11px] text-white/50 mt-1.5">Monthly collection</div>
              <div className="flex items-center gap-1 mt-3">
                <ArrowUpRight size={12} className="text-white/70" />
                <span className="text-[10px] text-white/70 font-bold">+18% vs last month</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CHARTS ROW ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Client Growth Bar Chart */}
        <div
          className={`bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
            hover:shadow-lg dark:hover:shadow-slate-900/50 transition-all duration-500
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '700ms' }}
        >
          <div className="h-0.5 bg-gradient-to-r from-indigo-400 to-violet-500" />
          <div className="px-5 py-4 flex items-center gap-3
            border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600
              flex items-center justify-center shadow-md shadow-indigo-500/30">
              <BarChart3 size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-[13.5px] font-extrabold text-slate-800 dark:text-white">
                Client Growth
              </h3>
              <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                Monthly registrations
              </p>
            </div>
          </div>
          <div className="px-3 py-4 bg-slate-50/50 dark:bg-slate-900">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={data.client_growth}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" opacity={0.4} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false}
                  tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="clients" fill="url(#barGrad)" radius={[7, 7, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Plan Distribution Donut */}
        <div
          className={`bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
            hover:shadow-lg dark:hover:shadow-slate-900/50 transition-all duration-500
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '800ms' }}
        >
          <div className="h-0.5 bg-gradient-to-r from-amber-400 to-orange-500" />
          <div className="px-5 py-4 flex items-center gap-3
            border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500
              flex items-center justify-center shadow-md shadow-amber-500/30">
              <PieChartIcon size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-[13.5px] font-extrabold text-slate-800 dark:text-white">
                Plan Distribution
              </h3>
              <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                Subscription breakdown
              </p>
            </div>
          </div>
          <div className="p-3 bg-slate-50/50 dark:bg-slate-900">
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={data.plan_breakdown} dataKey="count" nameKey="plan_name"
                  cx="50%" cy="50%" innerRadius={48} outerRadius={78}
                  paddingAngle={4} strokeWidth={0}>
                  {data.plan_breakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={7}
                  wrapperStyle={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Org Types + User Roles */}
        <div
          className={`bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
            hover:shadow-lg dark:hover:shadow-slate-900/50 transition-all duration-500
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '900ms' }}
        >
          <div className="h-0.5 bg-gradient-to-r from-violet-400 to-purple-500" />
          <div className="px-5 py-4 flex items-center gap-3
            border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600
              flex items-center justify-center shadow-md shadow-violet-500/30">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-[13.5px] font-extrabold text-slate-800 dark:text-white">
                Organization Types
              </h3>
              <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                Client categories
              </p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4 bg-slate-50/30 dark:bg-slate-900">
            {data.org_types.map((o, i) => {
              const pct = counts.total_clients > 0
                ? (o.count / counts.total_clients) * 100 : 0;
              return (
                <div key={o.org_type} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center
                        text-white text-[10px] font-black shadow-sm
                        group-hover:scale-110 transition-transform duration-200"
                        style={{ background: COLORS[i % COLORS.length] }}>
                        {o.org_type.charAt(0)}
                      </div>
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                        {o.org_type}
                      </span>
                    </div>
                    <span className="text-[11.5px] font-black text-slate-800 dark:text-white">
                      {o.count}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000 ease-out
                      group-hover:brightness-110"
                      style={{ width: `${Math.max(pct, 8)}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              );
            })}

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <SectionLabel>User Roles</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.user_types).map(([type, count], i) => (
                  <div key={type}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                      bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                      hover:border-indigo-300 dark:hover:border-indigo-600
                      hover:bg-indigo-50 dark:hover:bg-indigo-500/10
                      transition-all duration-200 cursor-default"
                    style={{ borderLeftColor: COLORS[i % COLORS.length], borderLeftWidth: 2.5 }}>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">
                      {type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] font-black text-slate-800 dark:text-white">
                      {count as number}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RECENT ACTIVITY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent Clients */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/70
          dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
          hover:shadow-lg dark:hover:shadow-slate-900/50 transition-shadow duration-500">
          <div className="h-0.5 bg-gradient-to-r from-indigo-400 to-violet-500" />
          <div className="px-6 py-5 flex items-center justify-between
            border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600
                flex items-center justify-center shadow-md shadow-indigo-500/30">
                <Building2 size={16} className="text-white" />
              </div>
              <h3 className="text-[14px] font-extrabold text-slate-800 dark:text-white">
                Recent Clients
              </h3>
            </div>
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400
              bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200
              dark:border-indigo-500/25 px-2.5 py-1 rounded-lg">
              Last 5
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recent_clients.map((c: any, i: number) => (
              <div
                key={c.id}
                className={`flex items-center gap-3.5 px-6 py-3.5
                  hover:bg-slate-50 dark:hover:bg-slate-800/50
                  transition-all duration-200 cursor-default
                  ${animate ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${1000 + i * 70}ms` }}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center
                  text-white text-[10px] font-black flex-shrink-0 shadow-sm"
                  style={{ background: COLORS[i % COLORS.length] }}>
                  {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
                    {c.org_name}
                  </div>
                  <div className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                    {c.email}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>
                    {c.status}
                  </Badge>
                  <Badge variant="primary">{c.plan?.name || 'Free'}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Payments */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/70
          dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
          hover:shadow-lg dark:hover:shadow-slate-900/50 transition-shadow duration-500">
          <div className="h-0.5 bg-gradient-to-r from-emerald-400 to-teal-500" />
          <div className="px-6 py-5 flex items-center justify-between
            border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600
                flex items-center justify-center shadow-md shadow-emerald-500/30">
                <IndianRupee size={16} className="text-white" />
              </div>
              <h3 className="text-[14px] font-extrabold text-slate-800 dark:text-white">
                Recent Payments
              </h3>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400
              bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200
              dark:border-emerald-500/25 px-2.5 py-1 rounded-lg">
              Last 5
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recent_payments.map((p: any, i: number) => (
              <div
                key={p.id}
                className={`flex items-center gap-3.5 px-6 py-3.5
                  hover:bg-slate-50 dark:hover:bg-slate-800/50
                  transition-all duration-200 cursor-default
                  ${animate ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${1000 + i * 70}ms` }}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                  ${p.status === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-500/10'
                    : p.status === 'failed'
                      ? 'bg-red-50 dark:bg-red-500/10'
                      : 'bg-amber-50 dark:bg-amber-500/10'}`}>
                  {p.status === 'success'
                    ? <CheckCircle2 size={17} className="text-emerald-500" />
                    : p.status === 'failed'
                      ? <XCircle size={17} className="text-red-500" />
                      : <Clock size={17} className="text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
                    {p.client?.org_name || 'Unknown'}
                  </div>
                  <div className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                    {p.invoice_number} · {methodLabels[p.method] || p.method}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[14px] font-black
                    ${p.status === 'success'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : p.status === 'failed'
                        ? 'text-red-500 dark:text-red-400'
                        : 'text-slate-700 dark:text-slate-200'}`}>
                    ₹{parseFloat(p.total).toLocaleString()}
                  </div>
                  <div className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {new Date(p.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short',
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TOP REVENUE CLIENTS ── */}
      {data.top_clients.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/70
          dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
          hover:shadow-lg dark:hover:shadow-slate-900/50 transition-shadow duration-500">
          <div className="h-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500" />
          <div className="px-6 py-5 flex items-center justify-between
            border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600
                flex items-center justify-center shadow-md shadow-amber-500/30">
                <Award size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-extrabold text-slate-800 dark:text-white">
                  Top Revenue Clients
                </h3>
                <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                  Highest contributors
                </p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.top_clients.map((tc: any, i: number) => {
              const pct = revenue.total > 0
                ? (parseFloat(tc.total_revenue) / revenue.total) * 100 : 0;
              return (
                <div key={tc.client_id}
                  className="flex items-center gap-4 px-6 py-4
                    hover:bg-slate-50 dark:hover:bg-slate-800/50
                    transition-all duration-200 cursor-default group">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center
                    text-white text-[11px] font-black shadow-sm flex-shrink-0
                    group-hover:scale-110 transition-transform duration-200"
                    style={{ background: COLORS[i] }}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold text-slate-800 dark:text-white mb-2">
                      {tc.client?.org_name || 'Unknown'}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${pct}%`, background: COLORS[i] }} />
                      </div>
                      <span className="text-[10.5px] text-slate-400 dark:text-slate-500 font-bold w-10 text-right">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 pl-4">
                    <div className="text-[16px] font-black text-slate-800 dark:text-white">
                      ₹{parseFloat(tc.total_revenue).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                      {tc.payments_count} payment{tc.payments_count !== 1 ? 's' : ''}
                    </div>
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
