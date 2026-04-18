import { useState, useEffect, useRef } from 'react';
import Badge from '../../components/ui/Badge';
import {
  Users, GitBranch, IndianRupee, CheckCircle2, Clock, XCircle,
  TrendingUp, Receipt, Shield, CalendarDays, Star,
  AlertTriangle, Activity, ArrowUpRight, ArrowDownRight, Zap,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

/* ─── CONSTANTS ──────────────────────────────────────────────── */
const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
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
    const interval = duration / (end / step || 1);
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
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
      rounded-xl px-4 py-3 shadow-2xl text-[11px] backdrop-blur-sm">
      <div className="font-bold text-slate-800 dark:text-white mb-1">{label}</div>
      <div className="text-slate-600 dark:text-slate-300 font-semibold">
        ₹{payload[0]?.value?.toLocaleString()}
      </div>
    </div>
  );
};

/* ─── MAIN COMPONENT ─────────────────────────────────────────── */
export default function ClientDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [activeCard, setActiveCard] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCard((prev) => (prev + 1) % 6);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.get('/dashboard/client-stats').then(res => {
      setData(res.data);
      setTimeout(() => setAnimate(true), 100);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, branches, recent_payments, payment_trend, user_roles } = data;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  /* ── Stat cards config (same data, admin style) ── */
  const statCards = [
    {
      label: 'Branches',
      value: counts.total_branches,
      icon: GitBranch,
      gradient: 'from-[#0984E3] via-[#00A8FF] to-[#48DBFB]',
      glow: 'shadow-sky-500/30',
      ring: 'ring-sky-400/20',
      change: `${counts.active_branches} active`,
      up: true,
    },
    {
      label: 'Users',
      value: counts.total_users,
      icon: Users,
      gradient: 'from-[#5B5FEF] via-[#7C3AED] to-[#9333EA]',
      glow: 'shadow-purple-500/30',
      ring: 'ring-purple-400/20',
      change: `${counts.active_users} active`,
      up: true,
    },
    {
      label: 'Total Paid',
      value: counts.total_paid,
      icon: IndianRupee,
      gradient: 'from-[#00C853] via-[#2ECC71] to-[#55EFC4]',
      glow: 'shadow-green-500/30',
      ring: 'ring-green-400/20',
      change: `${counts.success_payments} payments`,
      up: true,
      isAmount: true,
    },
    {
      label: 'Payments',
      value: counts.total_payments,
      icon: Receipt,
      gradient: 'from-[#0f172a] via-[[#0f172a] to-[#E056FD]',
      glow: 'shadow-fuchsia-500/30',
      ring: 'ring-fuchsia-400/20',
      change: `${successRate}% success`,
      up: successRate > 80,
    },
    {
      label: 'Pending',
      value: counts.pending_payments,
      icon: Clock,
      gradient: 'from-[#F39C12] via-[#FDCB6E] to-[#FFB142]',
      glow: 'shadow-orange-500/30',
      ring: 'ring-orange-400/20',
      change: 'awaiting',
      up: counts.pending_payments === 0,
    },
    {
      label: 'Plan Days',
      value: plan.days_remaining ?? 0,
      icon: CalendarDays,
      gradient: plan.days_remaining !== null && plan.days_remaining <= 7
        ? 'from-[#EF4444] via-[#F87171] to-[#FCA5A5]'
        : 'from-[#00B894] via-[#00CEC9] to-[#00E5A8]',
      glow: plan.days_remaining !== null && plan.days_remaining <= 7
        ? 'shadow-red-500/30' : 'shadow-emerald-500/30',
      ring: plan.days_remaining !== null && plan.days_remaining <= 7
        ? 'ring-red-400/20' : 'ring-emerald-400/20',
      change: plan.status === 'expired' ? 'expired' : 'remaining',
      up: plan.status !== 'expired',
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
              Dashboard
            </h1>
          </div>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 pl-9">
            {user?.client_name} · Organization Overview
          </p>
        </div>
      
      </div>

      {/* ── PLAN STATUS BANNER ── */}
      <div className={`rounded-2xl overflow-hidden transition-all duration-500
        ${animate ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        {plan.status === 'expired' ? (
          <div className="bg-gradient-to-r from-red-500 to-rose-600 px-5 py-4
            flex items-center justify-between text-white shadow-xl shadow-red-500/20
            ring-1 ring-red-400/20">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} />
              <div>
                <div className="text-[14px] font-bold">Plan Expired</div>
                <div className="text-[11px] text-white/70">
                  Your {plan.name} plan has expired. Renew to continue.
                </div>
              </div>
            </div>
            <div className="text-[11px] font-semibold bg-white/20 px-3 py-1 rounded-lg">
              Expired {plan.expires_at}
            </div>
          </div>
        ) : plan.days_remaining !== null && plan.days_remaining <= 30 ? (
          <div className="bg-gradient-to-r from-[#101b36] via-[#312e81] to-[#1b0938] px-5 py-4
            flex items-center justify-between text-white shadow-xl shadow-indigo-500/20
            ring-1 ring-indigo-400/20">
            <div className="flex items-center gap-3">
              <Clock size={20} />
              <div>
                <div className="text-[14px] font-bold">{plan.days_remaining} Days Remaining</div>
                <div className="text-[11px] text-white/70">
                  {plan.name} plan expires on {plan.expires_at}
                </div>
              </div>
            </div>
            <div className="text-[11px] font-semibold bg-white/20 px-3 py-1 rounded-lg">
              Renew Soon
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-4
            flex items-center justify-between text-white shadow-xl shadow-indigo-500/20
            ring-1 ring-indigo-400/20">
            <div className="flex items-center gap-3">
              <Shield size={20} />
              <div>
                <div className="text-[14px] font-bold">{plan.name} Plan</div>
                <div className="text-[11px] text-white/70">
                  {plan.days_remaining !== null
                    ? `${plan.days_remaining} days remaining · Expires ${plan.expires_at}`
                    : 'Active subscription'}
                </div>
              </div>
            </div>
            {plan.price > 0 && (
              <div className="text-[18px] font-extrabold">
                ₹{plan.price.toLocaleString()}
                <span className="text-[10px] text-white/60">/yr</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── KPI FLIP CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 perspective-[1400px]">
        {statCards.map((s, idx) => {
          const isActive = activeCard === idx;
          return (
            <div key={s.label} className="group h-[88px] cursor-pointer">
              <div className={`
                relative w-full h-full transition-all duration-700
                [transform-style:preserve-3d]
                ${isActive ? 'rotate-y-180 scale-[1.03]' : ''}
                hover:rotate-y-180 hover:scale-[1.03] hover:-translate-y-1
              `}>

                {/* FRONT */}
                <div className={`
                  absolute inset-0 rounded-3xl p-4 text-white overflow-hidden
                  bg-gradient-to-br ${s.gradient}
                  shadow-xl ${s.glow}
                  ring-1 ${s.ring}
                  backface-hidden
                `}>
                  <div className="absolute -top-8 -right-8 w-20 h-20 bg-white/5 rounded-full blur-xl" />
                  <div className="relative z-10 h-full flex flex-col justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md">
                      <s.icon size={16} />
                    </div>
                    <div>
                      <div className="text-[16px] font-black leading-none mb-1">
                        {s.isAmount ? (
                          <>₹<AnimatedNumber value={Math.round(s.value / 1000)} suffix="K" /></>
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

                {/* BACK */}
                <div className={`
                  absolute inset-0 rounded-3xl p-4 text-white overflow-hidden
                   bg-slate-900 dark:bg-slate-800
                  border border-white/10 shadow-2xl
                  rotate-y-180 backface-hidden
                `}>
                  <div className="h-full flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-bold">
                        Insights
                      </span>
                      {s.up
                        ? <ArrowUpRight size={15} className="text-emerald-400" />
                        : <ArrowDownRight size={15} className="text-red-400" />}
                    </div>
                    <div>
                      <div className="text-[14px] font-black text-white mb-1">{s.change}</div>
                      <div className="text-[11px] text-slate-400">Current status</div>
                    </div>
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

      {/* ── PAYMENT TREND + PLAN INFO ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Payment Trend Area Chart */}
        <div
          className={`lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200/70
            dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
            hover:shadow-lg dark:hover:shadow-slate-900/50 transition-all duration-500
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '400ms' }}
        >
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
                  Payment History
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  Last 6 months
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[22px] font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                ₹{counts.total_paid.toLocaleString()}
              </div>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <ArrowUpRight size={12} className="text-emerald-500" />
                <span className="text-[11px] text-emerald-500 font-bold">Total paid</span>
              </div>
            </div>
          </div>
          <div className="px-4 py-5 bg-slate-50/50 dark:bg-slate-900">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={payment_trend} margin={{ top: 5, right: 15, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="cRevG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="60%" stopColor="#10b981" stopOpacity={0.06} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" opacity={0.4} vertical={false} />
                <XAxis dataKey="month"
                  tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                  axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false}
                  tickLine={false} width={55}
                  tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2.5}
                  fill="url(#cRevG)"
                  dot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2.5 }}
                  activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Side - Gauges + Plan + Roles */}
        <div
          className={`lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-4
            transition-all duration-700
            ${animate ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
          style={{ transitionDelay: '500ms' }}
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

          {/* Monthly Plan Card */}
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
                  Current Plan
                </div>
                <div className="w-7 h-7 rounded-lg bg-amber-400/20 flex items-center justify-center">
                  <Zap size={14} className="text-amber-300" />
                </div>
              </div>
              <div className="text-[22px] font-black tracking-tight leading-none">{plan.name}</div>
              {plan.days_remaining !== null && (
                <>
                  <div className="text-[11px] text-white/50 mt-1.5">
                    {plan.days_remaining} days remaining
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${plan.days_remaining <= 7 ? 'bg-red-400' : 'bg-white/70'}`}
                        style={{ width: `${Math.max(5, 100 - (plan.days_remaining / 365) * 100)}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
              {plan.price > 0 && (
                <div className="flex items-center gap-1 mt-3">
                  <ArrowUpRight size={12} className="text-white/70" />
                  <span className="text-[10px] text-white/70 font-bold">
                    ₹{plan.price.toLocaleString()}/yr
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BRANCHES + RECENT PAYMENTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Branches */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/70
          dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
          hover:shadow-lg dark:hover:shadow-slate-900/50 transition-shadow duration-500">
          <div className="h-0.5 bg-gradient-to-r from-sky-400 to-cyan-500" />
          <div className="px-6 py-5 flex items-center justify-between
            border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600
                flex items-center justify-center shadow-md shadow-sky-500/30">
                <GitBranch size={16} className="text-white" />
              </div>
              <h3 className="text-[14px] font-extrabold text-slate-800 dark:text-white">
                Branches
              </h3>
            </div>
            <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400
              bg-sky-50 dark:bg-sky-500/10 border border-sky-200
              dark:border-sky-500/25 px-2.5 py-1 rounded-lg">
              {branches.length} total
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {branches.map((b: any, i: number) => (
              <div key={b.id}
                className={`flex items-center gap-3.5 px-6 py-3.5
                  hover:bg-slate-50 dark:hover:bg-slate-800/50
                  transition-all duration-200 cursor-default
                  ${animate ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${600 + i * 70}ms` }}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center
                  text-white text-[9px] font-extrabold flex-shrink-0 shadow-sm
                  ${b.is_main
                    ? 'bg-gradient-to-br from-amber-500 to-yellow-400 shadow-amber-500/30'
                    : 'bg-gradient-to-br from-sky-500 to-cyan-400 shadow-sky-500/30'}`}>
                  {b.code?.substring(0, 2) || b.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
                      {b.name}
                    </span>
                    {b.is_main && <Star size={10} className="text-amber-500 flex-shrink-0" />}
                  </div>
                  <div className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {[b.city, b.state].filter(Boolean).join(', ') || 'No location'}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {b.users_count} users
                  </span>
                  <Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>
                    {b.status}
                  </Badge>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <div className="text-center py-8 text-[12px] text-slate-400">No branches yet</div>
            )}
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
            {recent_payments.map((p: any, i: number) => (
              <div key={p.id}
                className={`flex items-center gap-3.5 px-6 py-3.5
                  hover:bg-slate-50 dark:hover:bg-slate-800/50
                  transition-all duration-200 cursor-default
                  ${animate ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
                style={{ transitionDelay: `${700 + i * 70}ms` }}>
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
                    {p.plan?.name || 'Payment'}
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
            {recent_payments.length === 0 && (
              <div className="text-center py-8 text-[12px] text-slate-400">No payments yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ── USER ROLES SECTION ── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/70
        dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm
        hover:shadow-lg dark:hover:shadow-slate-900/50 transition-shadow duration-500">
        <div className="h-0.5 bg-gradient-to-r from-violet-400 to-purple-500" />
        <div className="px-6 py-5 flex items-center gap-3
          border-b border-slate-100 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600
            flex items-center justify-center shadow-md shadow-violet-500/30">
            <Users size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-[14px] font-extrabold text-slate-800 dark:text-white">
              Team Roles
            </h3>
            <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
              User distribution
            </p>
          </div>
        </div>
        <div className="px-6 py-5 bg-slate-50/30 dark:bg-slate-900">
          <div className="flex flex-wrap gap-2">
            {Object.entries(user_roles).map(([role, count], i) => (
              <div key={role}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                  bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                  hover:border-indigo-300 dark:hover:border-indigo-600
                  hover:bg-indigo-50 dark:hover:bg-indigo-500/10
                  transition-all duration-200 cursor-default"
                style={{ borderLeftColor: COLORS[i % COLORS.length], borderLeftWidth: 2.5 }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">
                  {role.replace(/_/g, ' ')}
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
  );
}
