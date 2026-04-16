/* ── Base Shimmer ── */
export function Shimmer({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`shimmer rounded-lg ${className}`} style={style} />;
}

/* ── Stat Cards ── */
export function ShimmerStatCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-2xl p-4 space-y-3">
          <Shimmer className="w-10 h-10 rounded-xl" />
          <Shimmer className="h-7 w-20" />
          <Shimmer className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/* ── Card Grid ── */
export function ShimmerCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-2xl overflow-hidden">
          <Shimmer className="h-1.5 w-full rounded-none" />
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Shimmer className="w-11 h-11 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-2"><Shimmer className="h-4 w-3/4" /><Shimmer className="h-3 w-1/2" /></div>
            </div>
            <div className="space-y-2"><Shimmer className="h-3 w-full" /><Shimmer className="h-3 w-5/6" /><Shimmer className="h-3 w-2/3" /></div>
            <div className="flex gap-2"><Shimmer className="h-6 w-16 rounded-full" /><Shimmer className="h-6 w-20 rounded-full" /></div>
            <Shimmer className="h-14 w-full rounded-xl" />
            <div className="flex gap-1.5 pt-2"><Shimmer className="h-9 flex-1 rounded-lg" /><Shimmer className="h-9 flex-1 rounded-lg" /><Shimmer className="h-9 flex-1 rounded-lg" /><Shimmer className="h-9 w-9 rounded-lg" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Table ── */
export function ShimmerTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 bg-surface-2 border-b border-border/50 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => <Shimmer key={i} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3.5 border-b border-border/20 flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => <Shimmer key={c} className={`h-4 flex-1 ${c === 0 ? 'max-w-[40px]' : ''}`} />)}
        </div>
      ))}
    </div>
  );
}

/* ── List Items ── */
export function ShimmerList({ count = 5 }: { count?: number }) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex items-center gap-3">
        <Shimmer className="w-8 h-8 rounded-lg" /><Shimmer className="h-4 w-32" />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-5 py-3.5 border-b border-border/20 flex items-center gap-3.5">
          <Shimmer className="w-10 h-10 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2"><Shimmer className="h-4 w-2/3" /><Shimmer className="h-3 w-1/2" /></div>
          <Shimmer className="h-6 w-16 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

/* ── Payment Rows ── */
export function ShimmerPaymentList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-4">
          <Shimmer className="w-11 h-11 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2"><Shimmer className="h-4 w-1/3" /><Shimmer className="h-3 w-1/2" /></div>
          <div className="space-y-2 text-right"><Shimmer className="h-5 w-20 ml-auto" /><Shimmer className="h-3 w-14 ml-auto" /></div>
          <div className="flex gap-1.5"><Shimmer className="w-8 h-8 rounded-lg" /><Shimmer className="w-8 h-8 rounded-lg" /></div>
        </div>
      ))}
    </div>
  );
}

/* ── Chart ── */
export function ShimmerChart() {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3"><Shimmer className="w-10 h-10 rounded-xl" /><div className="space-y-2"><Shimmer className="h-4 w-28" /><Shimmer className="h-3 w-20" /></div></div>
        <Shimmer className="h-6 w-24" />
      </div>
      <div className="p-5"><div className="flex items-end gap-2 h-[220px]">
        {[40,65,45,80,55,90,70,60,85,50,75,95].map((h,i) => <div key={i} className="flex-1 flex flex-col justify-end"><Shimmer className="w-full rounded-t-md" style={{ height: `${h}%` }} /></div>)}
      </div></div>
    </div>
  );
}

/* ── Hero Header ── */
export function ShimmerHero() {
  return (
    <div className="bg-surface-2 border border-border rounded-2xl p-8 flex items-center gap-6">
      <Shimmer className="w-14 h-14 rounded-2xl flex-shrink-0" />
      <div className="flex-1 space-y-3"><Shimmer className="h-6 w-64" /><div className="flex gap-3"><Shimmer className="h-6 w-32 rounded-lg" /><Shimmer className="h-6 w-20 rounded-full" /></div><Shimmer className="h-3 w-48" /></div>
    </div>
  );
}

/* ── Plan Cards ── */
export function ShimmerPlanCards({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border rounded-2xl overflow-hidden"><Shimmer className="h-1.5 w-full rounded-none" />
          <div className="p-5 space-y-4"><Shimmer className="w-11 h-11 rounded-xl" /><Shimmer className="h-5 w-24" /><Shimmer className="h-8 w-28" />
            <div className="grid grid-cols-2 gap-2"><Shimmer className="h-14 rounded-xl" /><Shimmer className="h-14 rounded-xl" /><Shimmer className="h-14 rounded-xl" /><Shimmer className="h-14 rounded-xl" /></div>
            <div className="space-y-2"><Shimmer className="h-3 w-full" /><Shimmer className="h-3 w-5/6" /><Shimmer className="h-3 w-4/6" /></div>
            <Shimmer className="h-11 w-full rounded-xl" /></div>
        </div>
      ))}
    </div>
  );
}

/* ── Profile ── */
export function ShimmerProfile() {
  return (
    <div className="space-y-6"><ShimmerHero />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-5"><ShimmerList count={4} /><div className="bg-surface border border-border rounded-2xl p-5 space-y-3"><Shimmer className="h-4 w-24" /><Shimmer className="h-6 w-32" /><Shimmer className="h-10 w-full rounded-xl" /></div></div>
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface border border-border rounded-2xl p-6 space-y-4"><div className="flex items-center gap-3 mb-2"><Shimmer className="w-9 h-9 rounded-xl" /><div className="space-y-2"><Shimmer className="h-4 w-36" /><Shimmer className="h-3 w-28" /></div></div><div className="grid grid-cols-2 gap-4"><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /></div></div>
          <div className="bg-surface border border-border rounded-2xl p-6 space-y-4"><div className="flex items-center gap-3 mb-2"><Shimmer className="w-9 h-9 rounded-xl" /><div className="space-y-2"><Shimmer className="h-4 w-32" /><Shimmer className="h-3 w-40" /></div></div><Shimmer className="h-12 w-full rounded-lg" /><div className="grid grid-cols-2 gap-4"><Shimmer className="h-12 rounded-lg" /><Shimmer className="h-12 rounded-lg" /></div></div>
        </div>
      </div>
    </div>
  );
}

/* ── Settings ── */
export function ShimmerSettings() {
  return (
    <div className="space-y-6"><ShimmerHero />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <div className="bg-surface border border-border rounded-2xl p-3 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl"><Shimmer className="w-9 h-9 rounded-xl flex-shrink-0" /><div className="flex-1 space-y-2"><Shimmer className="h-3 w-20" /><Shimmer className="h-2 w-28" /></div></div>)}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-border/50"><Shimmer className="w-10 h-10 rounded-xl" /><div className="space-y-2"><Shimmer className="h-4 w-28" /><Shimmer className="h-3 w-36" /></div></div>
          <div className="grid grid-cols-2 gap-4"><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /><Shimmer className="h-16 rounded-lg" /></div>
          <Shimmer className="h-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/* ── Permissions ── */
export function ShimmerPermissions() {
  return (
    <div className="space-y-5"><ShimmerHero /><div className="flex items-center justify-between"><Shimmer className="h-10 w-80 rounded-xl" /><Shimmer className="h-10 w-24 rounded-lg" /></div><ShimmerTable rows={6} cols={8} /></div>
  );
}

/* ── Dashboard ── */
export function ShimmerDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div className="space-y-2"><Shimmer className="h-7 w-48" /><Shimmer className="h-4 w-64" /></div><Shimmer className="h-8 w-16 rounded-xl" /></div>
      <ShimmerStatCards count={6} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8"><ShimmerChart /></div>
        <div className="lg:col-span-4 space-y-4">
          {[1,2].map(i => <div key={i} className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4"><Shimmer className="w-[72px] h-[72px] rounded-full" /><div className="space-y-2"><Shimmer className="h-4 w-28" /><Shimmer className="h-3 w-20" /></div></div>)}
          <Shimmer className="h-24 w-full rounded-2xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5"><ShimmerChart /><ShimmerChart /><ShimmerList count={3} /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><ShimmerList count={5} /><ShimmerList count={5} /></div>
    </div>
  );
}
