import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type ReactNode } from 'react';
import { Svg } from '../shared';

/* ─────────────────────────────────────────────────────────────────────────
 * Vault Dashboard — the prototype's building blocks (VD_I icons, palettes,
 * vdCard, vdLink, vdRing, vdArcGauge, vdMini, count-up numbers, the
 * .cvd-anim "grow in" switch).
 * ───────────────────────────────────────────────────────────────────────── */

export const VD_I = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldok: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  req: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  fp: '<path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>',
};

export const VD_GRP_C: [string, string][] = [['#22d3ee', '#0891b2'], ['#a78bfa', '#7c3aed'], ['#f472b6', '#db2777'], ['#60a5fa', '#2563eb'], ['#d4a24a', '#a16207']];
export const VD_GRP_I: Record<string, string> = {
  'Logins & Access': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  'Finance & Banking': '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  'Development & IT': '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  'Identity & Documents': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0"/><line x1="15" y1="10" x2="18" y2="10"/><line x1="15" y1="14" x2="18" y2="14"/>',
  'Personal & Lifestyle': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
};
/** [key, label, light, dark] */
export const VD_RISK: [string, string, string, string][] = [['critical', 'Critical', '#fb7185', '#e11d48'], ['high', 'High', '#fb923c', '#ea580c'], ['medium', 'Medium', '#fbbf24', '#d97706'], ['low', 'Low', '#34d399', '#059669']];
export const VD_SEV: Record<'info' | 'warn' | 'critical', [string, string, string]> = {
  info: ['Info', '#22d3ee', '#0891b2'], warn: ['Warning', '#fbbf24', '#d97706'], critical: ['Critical', '#fb7185', '#e11d48'],
};
export const SEV_KEYS = ['info', 'warn', 'critical'] as const;

/** The audit actions' icons (the prototype's AL_ACT), for the Recent activity timeline. */
export const AL_ICO: Record<string, string> = {
  view: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  reveal: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  launch: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  create: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  share: VD_I.share,
  revoke: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  request: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  approve: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  reject: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  cancel: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lock: VD_I.lock,
  otp_failed: VD_I.alert,
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  purge: VD_I.bin,
  restore: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  policy: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>',
  importx: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  backup: VD_I.db,
  backupfail: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/>',
  health_fixed: VD_I.shieldok,
  totp_linked: VD_I.shieldok,
};

/* ── helpers ── */

export const vdPct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

/** The prototype's vdAgo — "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function vdAgo(iso?: string | null): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Tooltip HTML is built from API text — escape every value that goes in. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Inline style with CSS custom properties (--w, --a, --len…). */
export const cssv = (o: Record<string, string | number>) => o as CSSProperties;

/** "YYYY-MM-DD" as a local date (no UTC shift). */
export function localDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/* ── grow-in animation: .cvd-anim gets .is-in one frame after the widgets mount ── */

export const AnimCtx = createContext(false);
export function useAn(): (extra?: string) => string {
  const on = useContext(AnimCtx);
  return (extra = '') => `cvd-anim${on ? ' is-in' : ''}${extra ? ' ' + extra : ''}`;
}

/** The count-up number (vdNum + vdAnimate): eases from 0 to `v` over 900ms. */
export function Num({ v }: { v: number }) {
  const [shown, setShown] = useState(0);
  const dec = String(v).includes('.');
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const f = (t: number) => {
      const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      setShown(v * e);
      if (k < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <span>{dec ? shown.toFixed(1) : Math.round(shown)}</span>;
}

/* ── card + link ── */

export function VdCard({ ico, title, sub, extra, cls, children }: {
  ico: string; title: string; sub: string; extra?: ReactNode; cls?: string; children: ReactNode;
}) {
  return (
    <section className={`cvd-card${cls ? ' ' + cls : ''}`}>
      <header className="cvd-card__hd">
        <span className="cvd-card__ico"><Svg d={ico} size={16} /></span>
        <div><b>{title}</b><small>{sub}</small></div>
        {extra}
      </header>
      <div className="cvd-card__bd">{children}</div>
    </section>
  );
}

export function VdLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" data-h40="skip" className="cvd-link" onClick={onClick}>{label}<Svg d={VD_I.chev} size={12} /></button>
  );
}

/** A full ring gauge with a gradient arc (vdRing). */
export function VdRing({ p, c1, c2, sz, sw, id, className = '', tip, children }: {
  p: number; c1: string; c2: string; sz: number; sw: number; id: string; className?: string; tip?: string; children: ReactNode;
}) {
  const an = useAn();
  const r = (sz - sw) / 2 - 1, C = 2 * Math.PI * r, h = sz / 2;
  return (
    <div className={`cvd-gauge${className ? ' ' + className : ''}`} style={{ width: sz, height: sz }} data-vtip={tip}>
      <svg viewBox={`0 0 ${sz} ${sz}`}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: c1 }} /><stop offset="1" style={{ stopColor: c2 }} /></linearGradient></defs>
        <circle cx={h} cy={h} r={r} fill="none" stroke="#edf4f7" strokeWidth={sw} />
        <circle className={an('cvd-arcp')} cx={h} cy={h} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={sw} strokeLinecap="round"
          transform={`rotate(-90 ${h} ${h})`} style={cssv({ '--len': C.toFixed(1), '--off': ((1 - Math.min(100, p) / 100) * C).toFixed(1) })} />
      </svg>
      <div>{children}</div>
    </div>
  );
}

/** The 270° arc gauge with ticks and a knob (vdArcGauge). */
export function VdArcGauge({ p, c1, c2, id, sub }: { p: number; c1: string; c2: string; id: string; sub: string }) {
  const an = useAn();
  const sz = 112, cx = 56, r = 42, sw = 9, C = 2 * Math.PI * r, L = C * 0.75, cp = Math.min(100, p);
  const v = (L * cp) / 100, a = ((135 + (270 * cp) / 100) * Math.PI) / 180;
  const ticks = Array.from({ length: 28 }, (_, t) => {
    const ang = ((135 + (t / 27) * 270) * Math.PI) / 180, on = t / 27 <= p / 100, inner = t % 9 ? 50.5 : 49;
    return <line key={t} x1={(cx + Math.cos(ang) * 53).toFixed(1)} y1={(cx + Math.sin(ang) * 53).toFixed(1)}
      x2={(cx + Math.cos(ang) * inner).toFixed(1)} y2={(cx + Math.sin(ang) * inner).toFixed(1)} style={on ? { stroke: c2 } : undefined} />;
  });
  return (
    <div className="cvd-ag">
      <svg viewBox={`0 0 ${sz} ${sz}`}>
        <defs><linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient></defs>
        <g className="cvd-ag__ticks">{ticks}</g>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#edf3f6" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${L.toFixed(1)} ${C.toFixed(1)}`} transform={`rotate(135 ${cx} ${cx})`} />
        <circle className={an('cvd-arcp')} cx={cx} cy={cx} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={sw} strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cx})`} style={cssv({ '--len': L.toFixed(1), '--off': (L - v).toFixed(1), filter: `drop-shadow(0 3px 4px ${c2}55)` })} />
        <circle className={an('cvd-knob')} cx={(cx + Math.cos(a) * r).toFixed(1)} cy={(cx + Math.sin(a) * r).toFixed(1)} r="5.5" fill="#fff" stroke={c2} strokeWidth="3" />
      </svg>
      <div className="cvd-ag__c"><b><Num v={p} /><i>%</i></b><small>{sub}</small></div>
    </div>
  );
}

/** A small stat tile (vdMini). */
export function VdMini({ ico, v, l, sub, cls }: { ico: string; v: ReactNode; l: string; sub?: string; cls?: string }) {
  return (
    <div className={`cvd-mt${cls ? ' ' + cls : ''}`}>
      <span><Svg d={ico} size={14} /></span>
      <div><b>{v}</b><small>{l}</small>{sub && <em>{sub}</em>}</div>
    </div>
  );
}

/** The cursor tooltip (vdTipInit): one fixed .cvd-tip, fed by the nearest [data-vtip] under the mouse. */
export function useVdTip() {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const onMove = (e: RMouseEvent) => {
    const tip = tipRef.current;
    if (!tip) return;
    const t = (e.target as Element).closest?.('[data-vtip]');
    const html = t?.getAttribute('data-vtip');
    if (!html) { tip.classList.remove('is-on'); return; }
    // Every dynamic value in a data-vtip string has passed through esc().
    if (tip.innerHTML !== html) tip.innerHTML = html;
    tip.classList.add('is-on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 10) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const onLeave = () => tipRef.current?.classList.remove('is-on');
  return { tipRef, onMove, onLeave };
}
