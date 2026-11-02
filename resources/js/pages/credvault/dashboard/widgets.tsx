import { useState, type ReactNode } from 'react';
import { Svg, bytes, initials } from '../shared';
import type { AuditEvent, Loose, TransferRow } from '../cvApi';
import {
  AL_ICO, SEV_KEYS, VD_GRP_C, VD_GRP_I, VD_I, VD_RISK, VD_SEV, VdArcGauge, VdCard, VdLink, VdMini, VdRing, Num,
  cssv, esc, localDay, num, useAn, vdAgo, vdPct,
} from './vdKit';

/* ─────────────────────────────────────────────────────────────────────────
 * Vault Dashboard widgets — each one is a prototype vd* function, fed by the
 * matching key of GET /credvault/dashboard.
 * ───────────────────────────────────────────────────────────────────────── */

type Go = (path: string) => void;
export interface Routes {
  myVault: string; teamVault: string; critical: string; requests: string; health: string;
  audit: string; importRecovery: string; bin: string;
}

const dm = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const dmIso = (iso?: string | null) => (iso ? dm(new Date(iso)) : '—');

/* ══════════════════════════ HERO ══════════════════════════ */

export function Hero({ score }: { score: Loose }) {
  const an = useAn();
  const value = num(score.value);
  const lvl: [string, string, string] = value >= 80 ? ['Strong', 'is-good', 'Your vault is well protected.']
    : value >= 60 ? ['Needs care', 'is-fair', 'A few fixes will lift the score.'] : ['At risk', 'is-bad', 'Fix the critical items first.'];
  const R = 56, C = 2 * Math.PI * R;
  const checked = num(score.checked), healthy = num(score.healthy);
  const F: Record<string, Loose> = Object.fromEntries(((score.factors ?? []) as Loose[]).map(f => [f.key, f]));
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * 2 * Math.PI - Math.PI / 2, on = i / 60 < value / 100, inner = i % 5 ? 63 : 61;
    return <line key={i} x1={(70 + Math.cos(a) * 66).toFixed(1)} y1={(70 + Math.sin(a) * 66).toFixed(1)}
      x2={(70 + Math.cos(a) * inner).toFixed(1)} y2={(70 + Math.sin(a) * inner).toFixed(1)} className={on ? 'is-on' : ''} />;
  });
  const fac = (ico: string, l: string, p: number, w: number, sub: string) => (
    <div className="cvd-fac" key={l} data-vtip={`<b>${esc(l)} · ${p}%</b><br>${esc(sub)}<br>Counts for ${w}% of the score`}>
      <span className="cvd-fac__ico"><Svg d={ico} size={13} /></span>
      <div className="cvd-fac__m">
        <div className="cvd-fac__t"><span>{l}</span><b><Num v={p} />%</b></div>
        <div className="cvd-fac__bar"><i className={an()} style={cssv({ '--w': `${p}%` })} /></div>
        <small>{sub}</small>
      </div>
      <em>{w}%</em>
    </div>
  );
  const h = F.health ?? {}, t = F.twofa ?? {}, r = F.rotation ?? {}, b = F.backups ?? {};
  return (
    <section className={`cvd-hero ${lvl[1]}`}>
      <span className="cvd-hero__dots" /><span className="cvd-hero__glow" /><span className="cvd-hero__glow2" />
      <div className="cvd-hero__top">
        <div className="cvd-ring">
          <svg viewBox="0 0 140 140">
            <defs><linearGradient id="cvdRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#a5f3fc" /></linearGradient></defs>
            <g className="cvd-ticks">{ticks}</g>
            <circle cx="70" cy="70" r={R} className="cvd-ring__bg" />
            <circle cx="70" cy="70" r={R} className={an('cvd-ring__fg cvd-arcp')} transform="rotate(-90 70 70)"
              style={cssv({ '--len': C.toFixed(1), '--off': ((1 - value / 100) * C).toFixed(1) })} />
          </svg>
          <div><b><Num v={value} /></b><small>out of 100</small></div>
        </div>
        <div className="cvd-hero__t">
          <small><Svg d={VD_I.shieldok} size={12} />Vault security score</small>
          <b>{lvl[0]}</b>
          <span>{lvl[2]} The score weighs four checks below.</span>
          <em><Svg d={VD_I.lock} size={11} />{healthy} of {checked} credentials have no open issues</em>
        </div>
      </div>
      <div className="cvd-facs">
        {fac(VD_I.pulse, 'Password health', num(h.value), num(h.weight) || 40, `${checked - healthy} of ${checked} credentials need a fix`)}
        {fac(VD_I.shieldok, 'Two-factor sign-in', num(t.value), num(t.weight) || 25, `${num(t.enabled)} of ${num(t.applies)} logins use 2FA`)}
        {fac(VD_I.clock, 'Rotation on time', num(r.value), num(r.weight) || 20, `${num(r.overdue)} overdue · ${num(r.due_soon)} due soon`)}
        {fac(VD_I.db, 'Backups', num(b.value), num(b.weight) || 15,
          `${num(b.locked)} of ${num(b.downloaded)} password-locked${b.last_backup_at ? ' · last ' + vdAgo(b.last_backup_at) : ''}`)}
      </div>
    </section>
  );
}

/* ══════════════════════════ KPI CARDS ══════════════════════════ */

function Kpi({ c, ico, n, l, p, tip, stats, onClick, i }: {
  c: string; ico: string; n: number; l: string; p: number; tip: string; stats: [string | number, string][]; onClick: () => void; i: number;
}) {
  return (
    <button type="button" data-h40="skip" className={`cvd-kpi cvd-kpi--${c}`} onClick={onClick}>
      <span className="cvd-kpi__glow" /><span className="cvd-kpi__shine" />
      <div className="cvd-kpi__top">
        <span className="cvd-kpi__ico"><Svg d={ico} size={17} /></span>
        <span className="cvd-kpi__l">{l}</span>
        <span className="cvd-kpi__go"><Svg d={VD_I.arrow} size={12} /></span>
      </div>
      <div className="cvd-kpi__mid">
        <b className="cvd-kpi__n"><Num v={n} /></b>
        <VdRing p={p} c1="var(--c2)" c2="var(--c1)" sz={58} sw={6} id={`cvdK${i}`} className="cvd-kpi__ring" tip={tip}><b>{p}%</b></VdRing>
      </div>
      <small className="cvd-kpi__cap">{tip.replace(/<[^>]+>/g, '')}</small>
      <div className="cvd-kpi__st">{stats.map(([v, s]) => <span key={s}><b>{v}</b><small>{s}</small></span>)}</div>
    </button>
  );
}

export function Kpis({ k, go, R }: { k: Loose; go: Go; R: Routes }) {
  const t = k.total ?? {}, cr = k.critical ?? {}, ap = k.approvals ?? {}, is = k.issues ?? {}, sh = k.shares ?? {}, bn = k.bin ?? {};
  const total = num(t.value), mine = num(t.mine), crit = num(cr.value), pend = num(ap.value), bin = num(bn.value), soon = num(bn.expiring);
  const oldestMs = ap.oldest_at ? Date.now() - new Date(ap.oldest_at).getTime() : 0;
  const oldest = oldestMs > 0 ? (oldestMs < 36e5 ? `${Math.round(oldestMs / 6e4)}m` : `${Math.round(oldestMs / 36e5)}h`) : '—';
  return (
    <div className="cvd-kpis">
      <Kpi i={1} c="teal" ico={VD_I.lock} n={total} l="Total credentials" p={vdPct(mine, total)} tip={`<b>${mine}</b> of ${total} are owned by you`}
        stats={[[num(t.personal), 'Personal'], [num(t.team), 'Team'], [num(t.shared_with_me), 'Shared with you']]} onClick={() => go(R.myVault)} />
      <Kpi i={2} c="violet" ico={VD_I.shield} n={crit} l="Critical credentials" p={vdPct(crit, total)} tip={`<b>${vdPct(crit, total)}%</b> of all credentials are critical`}
        stats={[[num(cr.locked), 'Locked'], [num(cr.unlocked_now), 'Unlocked now'], [num(cr.open_requests), 'Open requests']]} onClick={() => go(R.critical)} />
      <Kpi i={3} c="amber" ico={VD_I.req} n={pend} l="Pending approvals" p={vdPct(pend, num(ap.total))} tip={`<b>${pend}</b> of ${num(ap.total)} requests still open`}
        stats={[[num(ap.admin_stage), 'Vault Admin'], [num(ap.manager_stage), 'Manager'], [oldest, 'Oldest']]} onClick={() => go(R.requests)} />
      <Kpi i={4} c="rose" ico={VD_I.pulse} n={num(is.value)} l="Password issues" p={vdPct(num(is.credentials), num(is.of))} tip={`<b>${num(is.credentials)}</b> of ${num(is.of)} credentials affected`}
        stats={[[num(is.critical), 'Critical'], [num(is.high), 'High'], [num(is.medium), 'Medium']]} onClick={() => go(R.health)} />
      <Kpi i={5} c="sky" ico={VD_I.share} n={num(sh.value)} l="Active shares" p={vdPct(num(sh.credentials), num(sh.of))} tip={`<b>${num(sh.credentials)}</b> of your ${num(sh.of)} credentials are shared`}
        stats={[[num(sh.credentials), 'Credentials'], [num(sh.ongoing), 'Ongoing'], [num(sh.ending_this_week), 'End this week']]} onClick={() => go(`${R.myVault}?tab=sharedby`)} />
      <Kpi i={6} c="slate" ico={VD_I.bin} n={bin} l="In Recycle Bin" p={vdPct(soon, bin)} tip={`<b>${soon}</b> of ${bin} auto-delete within 7 days`}
        stats={[[num(bn.by_me), 'By you'], [num(bn.by_team), 'By team'], [soon, 'Expiring']]} onClick={() => go(R.bin)} />
    </div>
  );
}

/* ══════════════════════════ COMPOSITION ══════════════════════════ */

export function Types({ byGroup, topTypes, total, go, R }: { byGroup: Loose[]; topTypes: Loose[]; total: number; go: Go; R: Routes }) {
  const an = useAn();
  const max = Math.max(1, ...byGroup.map(g => num(g.count)));
  return (
    <VdCard ico={VD_I.grid} title="Credentials by type" sub="What kind of secrets the vault holds" extra={<VdLink label="My Vault" onClick={() => go(R.myVault)} />}>
      <div className="cvd-hbars">
        {byGroup.map((g, i) => {
          const v = num(g.count), c = VD_GRP_C[i % 5];
          const subs = ((g.top_types ?? []) as Loose[]).map(x => `${esc(x.label)} ${num(x.count)}`).join(' · ');
          return (
            <div key={g.group} className="cvd-hbar" style={cssv({ '--a': c[0], '--b': c[1] })}
              data-vtip={`<b>${esc(g.group)}</b> · ${v} credentials (${vdPct(v, total)}%)<br>${subs}`}>
              <span className="cvd-hbar__ico"><Svg d={VD_GRP_I[g.group] ?? VD_I.lock} size={14} /></span>
              <div className="cvd-hbar__m">
                <div className="cvd-hbar__t"><span>{g.group}</span><b>{v}<small>{vdPct(v, total)}%</small></b></div>
                <div className="cvd-hbar__tr"><span className={an()} style={cssv({ '--w': `${(v / max) * 100}%` })} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cvd-foot">
        <Svg d={VD_I.chart} size={12} />
        <span>Most common: {topTypes.length ? topTypes.map((x, i) => <span key={x.type}>{i ? ' · ' : ''}<b>{x.label}</b> {num(x.count)}</span>) : '—'}</span>
      </div>
    </VdCard>
  );
}

export function RiskCard({ byRisk, total, go, R }: { byRisk: Loose; total: number; go: Go; R: Routes }) {
  const an = useAn();
  const [hl, setHl] = useState(-1);
  const T = total || 1, Rr = 64, SW = 20, C = 2 * Math.PI * Rr;
  let off = 0;
  const segs = VD_RISK.map((k, i) => {
    const v = num(byRisk[k[0]]), len = (v / T) * C;
    if (!v) return null;
    const el = (
      <circle key={k[0]} className={`cvd-sd__s${hl === i ? ' is-on' : ''}`} cx="90" cy="90" r={Rr} fill="none" stroke={k[3]} strokeWidth={SW}
        strokeDasharray={`${Math.max(0.5, len - 2.5).toFixed(2)} ${C.toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)}
        onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(-1)}
        data-vtip={`<b>${k[1]} risk</b><br>${v} of ${T} credentials · ${vdPct(v, T)}%`} />
    );
    off += len;
    return el;
  });
  const src = hl >= 0 ? VD_RISK[hl] : null;
  return (
    <VdCard ico={VD_I.alert} title="Risk level" sub="How damaging a leak of each credential would be" extra={<VdLink label="Critical Vault" onClick={() => go(R.critical)} />}>
      <div className={`cvd-sdx${hl >= 0 ? ' is-hl' : ''}`}>
        <div className="cvd-sd">
          <svg viewBox="0 0 180 180">
            <circle cx="90" cy="90" r={Rr} fill="none" stroke="#eef5f8" strokeWidth={SW} />
            <g transform="rotate(-90 90 90)" className={an('cvd-spin cvd-spin--90')}>{segs}</g>
          </svg>
          <div className="cvd-sd__ctr" style={cssv({ '--tc': src ? src[3] : '#0c2c3a' })}>
            <b>{src ? num(byRisk[src[0]]) : <Num v={total} />}</b>
            <small>{src ? `${src[1].toLowerCase()} risk` : 'credentials'}</small>
          </div>
        </div>
        <div className="cvd-srs">
          {VD_RISK.map((k, i) => {
            const v = num(byRisk[k[0]]);
            return (
              <div key={k[0]} className={`cvd-sr${hl === i ? ' is-on' : ''}`} style={cssv({ '--c': k[3] })}
                onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(-1)}>
                <i /><span>{k[1]}</span><b><Num v={v} /></b><em>{vdPct(v, T)}%</em>
              </div>
            );
          })}
        </div>
      </div>
      <div className="cvd-foot">
        <Svg d={VD_I.shield} size={12} />
        <span><b>{num(byRisk.critical)}</b> critical credentials sit in the Critical Vault and open only after approval</span>
      </div>
    </VdCard>
  );
}

export function Where({ w, total, go, R }: { w: Loose; total: number; go: Go; R: Routes }) {
  const an = useAn();
  const T = total || 1, mine = num(w.owned_by_me), others = num(w.owned_by_others);
  const owners = (w.top_owners ?? []) as Loose[];
  const om = Math.max(1, ...owners.map(o => num(o.count)));
  const tile = (ico: string, l: string, v: number, c: [string, string], sub: string) => (
    <div className="cvd-wt" style={cssv({ '--a': c[0], '--b': c[1] })} data-vtip={`<b>${l}</b><br>${v} credentials · ${vdPct(v, T)}% of all`}>
      <span className="cvd-wt__ico"><Svg d={ico} size={15} /></span>
      <b><Num v={v} /></b>
      <span className="cvd-wt__l">{l}</span>
      <small>{sub}</small>
      <div className="cvd-wt__bar"><i className={an()} style={cssv({ '--w': `${vdPct(v, T)}%` })} /></div>
    </div>
  );
  return (
    <VdCard ico={VD_I.team} title="Where credentials live" sub="Personal, team and shared credentials" extra={<VdLink label="Team Vault" onClick={() => go(R.teamVault)} />}>
      <div className="cvd-wts">
        {tile(VD_I.user, 'Personal', num(w.personal), VD_GRP_C[0], 'Only you')}
        {tile(VD_I.team, 'Team', num(w.team), VD_GRP_C[1], 'Your teams')}
        {tile(VD_I.share, 'Shared with you', num(w.shared_with_me), VD_GRP_C[2], 'From colleagues')}
      </div>
      <div className="cvd-split" data-vtip={`<b>Ownership</b><br>You own ${mine} · team members own ${others}`}>
        <div className="cvd-split__t">
          <span><i />Owned by you <b>{mine}</b></span>
          <span>Team members <b>{others}</b><i className="is-b" /></span>
        </div>
        <div className="cvd-split__bar"><span className={an()} style={cssv({ '--w': `${vdPct(mine, T)}%` })} /></div>
      </div>
      <div className="cvd-sub">Top team owners</div>
      <div className="cvd-owners">
        {owners.length ? owners.map((o, i) => (
          <div className="cvd-own" key={`${o.name}-${i}`} data-vtip={`<b>${esc(o.name)}</b><br>Owns ${num(o.count)} credentials you can see`}>
            <span>{initials(o.name)}</span>
            <div><b>{o.name ?? '—'}</b><div className="cvd-own__bar"><i className={an()} style={cssv({ '--w': `${(num(o.count) / om) * 100}%` })} /></div></div>
            <em>{num(o.count)}</em>
          </div>
        )) : <small className="cvd-none">Only you own credentials here.</small>}
      </div>
    </VdCard>
  );
}

/* ══════════════════════════ ACTIVITY ══════════════════════════ */

export function Activity({ a, range, onRange, busy, go, R }: { a: Loose; range: number; onRange: (n: number) => void; busy: boolean; go: Go; R: Routes }) {
  const B = ((a.days ?? []) as Loose[]).map(d => ({ d: localDay(String(d.date)), info: num(d.info), warn: num(d.warn), critical: num(d.critical), total: num(d.total) }));
  const N = B.length || range;
  const tot = B.map(b => b.total);
  const max = Math.max(4, ...tot), step = Math.ceil(max / 4 / 2) * 2 || 2, top = step * 4;
  const W = 720, H = 305, pl = 30, pr = 10, pt = 14, pb = 26, cw = (W - pl - pr) / N, bw = Math.min(28, cw * 0.58);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / top);
  const lblEvery = N <= 7 ? 1 : N <= 14 ? 2 : 5;
  const sum = num(a.total), avg = num(a.average), prev = num(a.previous_total);
  const dl: number | null = a.change_pct === null || a.change_pct === undefined ? null : num(a.change_pct);

  const grid = Array.from({ length: 5 }, (_, k) => {
    const v = step * k;
    return (
      <g key={k}>
        <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} className={`cvd-gl${k ? '' : ' is-base'}`} />
        <text x={pl - 8} y={y(v) + 3.5} className="cvd-ax" textAnchor="end">{v}</text>
      </g>
    );
  });
  const bars = B.map((b, i) => {
    const x = pl + i * cw + (cw - bw) / 2, today = i === N - 1;
    const lab = today ? 'Today' : dm(b.d);
    const segs = SEV_KEYS.filter(k => b[k]);
    let acc = 0;
    const shapes = segs.map((k, j) => {
      const h = ((H - pt - pb) * b[k]) / top, yy = y(acc + b[k]), last = j === segs.length - 1, hh = Math.max(1.5, h - (j ? 2 : 0)), r = Math.min(5, hh, bw / 2);
      acc += b[k];
      return last
        ? <path key={k} d={`M${x},${yy + hh} V${yy + r} q0,-${r} ${r},-${r} H${x + bw - r} q${r},0 ${r},${r} V${yy + hh} Z`} fill={`url(#cvdA${k})`} />
        : <rect key={k} x={x} y={yy} width={bw} height={hh} fill={`url(#cvdA${k})`} />;
    });
    const tip = `<b>${today ? 'Today · ' : ''}${b.d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</b><br>${b.total} event${b.total === 1 ? '' : 's'}<br>`
      + SEV_KEYS.map(k => `<i class="cvd-tdot" style="background:${VD_SEV[k][2]}"></i>${VD_SEV[k][0]} ${b[k]}`).join(' &nbsp;');
    return (
      <g key={i} className={`cvd-col${today ? ' is-today' : ''}`} data-vtip={tip}>
        <rect x={pl + i * cw + 1} y={pt} width={cw - 2} height={H - pt - pb} rx="6" className="cvd-hit" />
        {shapes}
        {i % lblEvery === (N - 1) % lblEvery && (
          <text x={x + bw / 2} y={H - 8} className={`cvd-ax${today ? ' is-today' : ''}`} textAnchor="middle">{lab}</text>
        )}
      </g>
    );
  });
  const stat = (ico: string, v: ReactNode, l: string, sub: string, cls = '') => (
    <div className={`cvd-astat ${cls}`}>
      <span><Svg d={ico} size={14} /></span>
      <div><b>{v}</b><small>{l}</small>{sub && <em>{sub}</em>}</div>
    </div>
  );
  const busiest = a.busiest as Loose | null;
  return (
    <section className="cvd-card cvd-card--wide" id="cvdAct" style={busy ? { opacity: 0.6, transition: 'opacity .2s' } : undefined}>
      <header className="cvd-card__hd">
        <span className="cvd-card__ico"><Svg d={VD_I.chart} size={16} /></span>
        <div><b>Vault activity</b><small>Views, copies, shares, approvals and changes, by severity</small></div>
        <span className="cvd-rng">
          {[7, 14, 30].map(n => (
            <button key={n} type="button" data-h40="skip" className={range === n ? 'is-on' : ''} onClick={() => onRange(n)} disabled={busy}>{n} days</button>
          ))}
        </span>
        <VdLink label="Audit Logs" onClick={() => go(R.audit)} />
      </header>
      <div className="cvd-card__bd">
        <div className="cvd-astats">
          {stat(VD_I.chart, <Num v={sum} />, 'Events',
            dl === null ? `${prev} in the previous ${N} days` : `${dl >= 0 ? '▲ ' : '▼ '}${Math.abs(dl)}% vs previous ${N} days`,
            dl === null ? '' : dl > 0 ? 'is-up' : 'is-down')}
          {stat(VD_I.pulse, <Num v={avg} />, 'Average per day', `Across ${N} days`)}
          {stat(VD_I.clock, busiest ? dm(localDay(String(busiest.date))) : '—', 'Busiest day', busiest ? `${num(busiest.events)} events` : 'No events yet')}
          {stat(VD_I.alert, <Num v={num(a.critical)} />, 'Critical events', `${num(a.warnings)} warnings`, 'is-crit')}
        </div>
        <div className="cvd-chartw">
          <svg viewBox={`0 0 ${W} ${H}`} className="cvd-chart">
            <defs>
              {SEV_KEYS.map(k => (
                <linearGradient key={k} id={`cvdA${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={VD_SEV[k][1]} /><stop offset="1" stopColor={VD_SEV[k][2]} /></linearGradient>
              ))}
            </defs>
            {grid}
            {bars}
            <line x1={pl} x2={W - pr} y1={y(avg)} y2={y(avg)} className="cvd-avg" />
            <rect x={pl + 4} y={y(avg) - 17} width="62" height="15" rx="7.5" className="cvd-avg__bg" />
            <text x={pl + 35} y={y(avg) - 6.5} className="cvd-avg__t" textAnchor="middle">avg {avg}/day</text>
          </svg>
        </div>
        <div className="cvd-stack__lg cvd-stack__lg--c">
          {SEV_KEYS.map(k => <span key={k}><i style={{ background: `linear-gradient(135deg,${VD_SEV[k][1]},${VD_SEV[k][2]})` }} />{VD_SEV[k][0]}</span>)}
          <span><i className="cvd-lg-dash" />Daily average</span>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════ HYGIENE ══════════════════════════ */

type Part = [string, number, string, string];
function Bars2({ parts, tot }: { parts: Part[]; tot: number }) {
  const an = useAn();
  return (
    <div className="cvd-bars2">
      {parts.map(p => {
        if (!p[1]) return null;
        const pc = vdPct(p[1], tot);
        return (
          <span key={p[0]} className={an()} style={cssv({ '--f': p[1], background: `linear-gradient(180deg,${p[2]},${p[3]})`, '--sh': p[3] })}
            data-vtip={`<b>${esc(p[0])}</b><br>${p[1]} of ${tot} · ${pc}%`}>{pc >= 12 && <em>{pc}%</em>}</span>
        );
      })}
    </div>
  );
}

export function Hygiene({ hy, go, R }: { hy: Loose; go: Go; R: Routes }) {
  const s = hy.strength ?? {}, tw = hy.twofa ?? {}, ro = hy.rotation ?? {}, pol = hy.policy ?? {};
  const PW = num(s.with_password), meets = num(s.meets_policy), sp = num(s.pct);
  const twOn = num(tw.enabled), TW = twOn + num(tw.disabled), tp = num(tw.pct);
  const rot = { ok: num(ro.ok), soon: num(ro.soon), over: num(ro.over) }, rotN = rot.ok + rot.soon + rot.over, rp = num(ro.pct);
  const st = (p: number) => (p >= 85 ? ['Healthy', 'ok'] : p >= 60 ? ['Needs work', 'warn'] : ['At risk', 'bad']);
  const g = (p: number, c1: string, c2: string, id: string, l: string, sub: string, n: string, ico: string) => {
    const x = st(p);
    return (
      <div className="cvd-hg2" key={id} style={cssv({ '--a': c1, '--b': c2 })} data-vtip={`<b>${l} · ${p}%</b><br>${esc(sub)}`}>
        <VdArcGauge p={p} c1={c1} c2={c2} id={id} sub={n} />
        <div className="cvd-hg2__l"><Svg d={ico} size={12} /><b>{l}</b></div>
        <span className={`cvd-hg2__st is-${x[1]}`}><i />{x[0]}</span>
      </div>
    );
  };
  const row = (ico: string, t: string, parts: Part[], tot: number) => (
    <div className="cvd-hy2" key={t}>
      <div className="cvd-hy2__t"><span><Svg d={ico} size={12} /></span><b>{t}</b><small>{tot} total</small></div>
      <Bars2 parts={parts} tot={tot} />
      <div className="cvd-chips2">
        {parts.map(p => <span key={p[0]}><i style={{ background: `linear-gradient(135deg,${p[2]},${p[3]})` }} />{p[0]}<b>{p[1]}</b></span>)}
      </div>
    </div>
  );
  const risks = ((pol.twofa_risks ?? []) as string[]).join(' & ') || '—';
  return (
    <VdCard ico={VD_I.fp} title="Password hygiene" sub="Your vaults · same checks as Password Health" extra={<VdLink label="Password Health" onClick={() => go(R.health)} />}>
      <div className="cvd-hgs2">
        {g(sp, '#6ee7b7', '#059669', 'cvdH1', 'Strength', `${meets} of ${PW} passwords meet the policy`, `of ${PW}`, VD_I.key)}
        {g(tp, '#67e8f9', '#0e7490', 'cvdH2', 'Two-factor', `${twOn} of ${TW} logins use 2FA`, `of ${TW}`, VD_I.shieldok)}
        {g(rp, '#c4b5fd', '#7c3aed', 'cvdH3', 'Rotation', `${rot.ok + rot.soon} of ${rotN} rotated on time`, `of ${rotN}`, VD_I.clock)}
      </div>
      {row(VD_I.key, 'Password strength', [['Strong', num(s.strong), '#6ee7b7', '#059669'], ['Good', num(s.good), '#67e8f9', '#0891b2'], ['Fair', num(s.fair), '#fcd34d', '#d97706'], ['Weak', num(s.weak), '#fda4af', '#e11d48']], PW)}
      {row(VD_I.shieldok, 'Two-factor sign-in', [['Enabled', twOn, '#67e8f9', '#0891b2'], ['Not enabled', TW - twOn, '#fda4af', '#e11d48']], TW)}
      {row(VD_I.clock, 'Rotation schedule', [['On time', rot.ok, '#6ee7b7', '#059669'], ['Due soon', rot.soon, '#fcd34d', '#d97706'], ['Overdue', rot.over, '#fda4af', '#e11d48']], rotN)}
      <div className="cvd-foot">
        <Svg d={VD_I.key} size={12} />
        <span>
          Policy: at least <b>{pol.min_strength_label || 'Good'}</b> · {pol.rotation_default ? <>rotate every <b>{pol.rotation_default} days</b></> : <>no default rotation</>} · 2FA for <b>{risks}</b> risk
        </span>
      </div>
    </VdCard>
  );
}

/* ══════════════════════════ ATTENTION / RECENT / DEPARTMENTS ══════════════════════════ */

const ATT_ICO: Record<string, string> = {
  critical_issues: VD_I.pulse, twofa_missing: VD_I.shieldok, backup_failed: VD_I.db, requests: VD_I.req, rotation: VD_I.clock,
  weak: VD_I.fp, reused: VD_I.key, shared: VD_I.share, backup_unlocked: VD_I.db, bin_expiring: VD_I.bin,
};

export function Attention({ rows, summary, go, R }: { rows: Loose[]; summary: Loose; go: Go; R: Routes }) {
  const target = (open: string) => ({
    health: R.health, 'import-recovery': R.importRecovery, backup: `${R.importRecovery}?tab=backup`, 'access-requests': R.requests, 'recycle-bin': R.bin,
  } as Record<string, string>)[open] ?? R.health;
  const urgent = summary?.urgent ?? rows.filter(r => r.level === 'bad').length;
  const areas = summary?.areas ?? rows.length;
  return (
    <VdCard ico={VD_I.alert} title="Needs attention" sub="Red first, then amber — click a row to fix it" cls="cvd-card--fix"
      extra={<span className="cvd-tag is-bad">{num(urgent)} urgent · {num(areas)} areas</span>}>
      {rows.length ? (
        <div className="cvd-att">
          {rows.map(x => (
            <button key={x.key} type="button" data-h40="skip" className={`cvd-att__i is-${x.level}`} onClick={() => go(target(x.open))}>
              <span className="cvd-att__ico"><Svg d={ATT_ICO[x.key] ?? VD_I.alert} size={15} /></span>
              <span className="cvd-att__t"><b>{x.label}</b><small>{x.sub}</small></span>
              <span className="cvd-att__n">{num(x.count)}</span>
              <span className="cvd-att__go"><Svg d={VD_I.chev} size={13} /></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="cvd-empty"><Svg d={VD_I.shieldok} size={26} /><b>All clear</b><small>Nothing needs your attention right now.</small></div>
      )}
    </VdCard>
  );
}

export function Recent({ rows, go, R }: { rows: AuditEvent[]; go: Go; R: Routes }) {
  return (
    <VdCard ico={VD_I.log} title="Recent activity" sub="Latest events from every CredVault module" cls="cvd-card--fix"
      extra={<VdLink label="All logs" onClick={() => go(R.audit)} />}>
      {rows.length ? (
        <div className="cvd-tl">
          {rows.map(e => {
            const sev = (VD_SEV[e.severity] ? e.severity : 'info') as keyof typeof VD_SEV;
            return (
              <div key={e.id} className={`cvd-tl__i is-${sev}`}>
                <span className="cvd-tl__ico"><Svg d={AL_ICO[e.action] ?? AL_ICO.view} size={13} /></span>
                <div className="cvd-tl__t">
                  <b>{e.actor?.is_me ? 'You' : e.actor?.name} <em>{(e.label || '').toLowerCase()}</em> {e.credential?.name ?? ''}</b>
                  <small>{e.module || 'CredVault'} · {vdAgo(e.at)}</small>
                </div>
                <span className={`cvd-sev cvd-sev--${sev}`}>{VD_SEV[sev][0]}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cvd-empty"><Svg d={VD_I.log} size={26} /><b>No activity yet</b><small>Views, copies and changes will show up here.</small></div>
      )}
    </VdCard>
  );
}

export function Depts({ rows, total, go, R }: { rows: Loose[]; total: number; go: Go; R: Routes }) {
  const an = useAn();
  const max = Math.max(1, ...rows.map(x => num(x.count)));
  return (
    <VdCard ico={VD_I.team} title="Credentials by department" sub="Which teams hold the most secrets" cls="cvd-card--fix"
      extra={<VdLink label="Team Vault" onClick={() => go(R.teamVault)} />}>
      {rows.length ? (
        <div className="cvd-depts">
          {rows.map(x => {
            const n = num(x.count), c = num(x.critical), p = num(x.members);
            return (
              <div key={x.id} className="cvd-dept" data-vtip={`<b>${esc(x.name)}</b><br>${n} credentials · ${c} critical<br>${p} people in the team`}>
                <span className="cvd-dept__ico"><Svg d={VD_I.team} size={13} /></span>
                <span className="cvd-dept__l">{x.name}<small>{p} people · {c} critical</small></span>
                <div className="cvd-dept__tr"><span className={an()} style={cssv({ '--w': `${(n / max) * 100}%` })}><i style={{ width: `${n ? (c / n) * 100 : 0}%` }} /></span></div>
                <b>{n}</b>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cvd-empty"><Svg d={VD_I.team} size={26} /><b>No departments yet</b><small>Departments with people in them show up here.</small></div>
      )}
      <div className="cvd-stack__lg"><span><i style={{ background: '#67e8f9' }} />Other credentials</span><span><i style={{ background: '#0e7490' }} />Critical</span></div>
      {rows.length > 1 && (
        <div className="cvd-foot">
          <Svg d={VD_I.team} size={12} />
          <span><b>{rows[0].name}</b> and <b>{rows[1].name}</b> hold {vdPct(num(rows[0].count) + num(rows[1].count), total)}% of all credentials</span>
        </div>
      )}
    </VdCard>
  );
}

/* ══════════════════════════ BACKUPS & IMPORTS ══════════════════════════ */

function SourceBars({ label, items, empty }: { label: string; items: { k: string; v: number; tip: string }[]; empty?: string }) {
  const an = useAn();
  const m = Math.max(1, ...items.map(x => x.v));
  return (
    <div className="cvd-bf">
      <span className="cvd-sub">{label}</span>
      {items.length ? items.map(x => (
        <div key={x.k} className="cvd-bf__i" data-vtip={x.tip}>
          <span>{x.k}</span>
          <div className="cvd-bf__tr"><i className={an()} style={cssv({ '--w': `${(x.v / m) * 100}%` })} /></div>
          <b>{x.v}</b>
        </div>
      )) : <small className="cvd-none">{empty}</small>}
    </div>
  );
}

export function Backup({ b, go, R }: { b: Loose; go: Go; R: Routes }) {
  const an = useAn();
  const ok = num(b.downloaded), lk = num(b.locked), fail = num(b.failed), vp = num(b.locked_pct), last = b.last as Loose | null;
  const Rr = 34, C = 2 * Math.PI * Rr;
  const ST: [string, number, string][] = [['Password locked', lk, '#0e7490'], ['Not locked', num(b.not_locked), '#d97706'], ['Failed', fail, '#e11d48']];
  const latest = (b.latest ?? []) as TransferRow[];
  const fmts = ((b.by_format ?? []) as Loose[]).map(f => {
    const v = num(f.count);
    return { k: String(f.label), v, tip: `<b>${esc(f.label)}</b><br>${v} backup${v === 1 ? '' : 's'} downloaded` };
  });
  return (
    <VdCard ico={VD_I.db} title="Backup & Recovery" sub="Credential backups downloaded in Excel, CSV or JSON"
      extra={<VdLink label="Download Backup" onClick={() => go(`${R.importRecovery}?tab=backup`)} />}>
      <div className="cvd-mts">
        <VdMini ico={VD_I.db} v={<Num v={ok} />} l="Downloaded" sub="Backups so far" />
        <VdMini ico={VD_I.lock} v={<Num v={lk} />} l="Password locked" sub={`of ${ok} downloads`} />
        <VdMini ico={VD_I.alert} v={<Num v={fail} />} l="Failed attempts" sub="Every attempt logged" cls={fail ? 'is-bad' : ''} />
        <VdMini ico={VD_I.clock} v={last ? vdAgo(last.at) : '—'} l="Last download" sub={last ? `${last.code} · ${num(last.items)} items` : 'None yet'} />
      </div>
      <div className="cvd-b2">
        <div className="cvd-bh">
          <div className="cvd-bh__r">
            <svg viewBox="0 0 84 84">
              <circle cx="42" cy="42" r={Rr} fill="none" stroke="#edf4f7" strokeWidth="8" />
              <circle className={an('cvd-arcp')} cx="42" cy="42" r={Rr} fill="none" stroke="url(#cvdBhG)" strokeWidth="8" strokeLinecap="round"
                transform="rotate(-90 42 42)" style={cssv({ '--len': C.toFixed(1), '--off': ((1 - vp / 100) * C).toFixed(1) })} />
              <defs><linearGradient id="cvdBhG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#0e7490" /></linearGradient></defs>
            </svg>
            <div><b>{vp}%</b><small>locked</small></div>
          </div>
          <div className="cvd-bh__l">
            <span className="cvd-sub">Protection</span>
            {ST.map(x => <div key={x[0]} className="cvd-bh__i"><i style={{ background: x[2] }} /><span>{x[0]}</span><b>{x[1]}</b></div>)}
          </div>
        </div>
        <SourceBars label="By format" items={fmts} />
      </div>
      <span className="cvd-sub">Recent downloads · oldest to newest</span>
      {latest.length ? (
        <div className="cvd-bstrip">
          {latest.map(t => {
            const f = t.status === 'failed';
            const s = f ? ['Failed', 'bad'] : t.locked ? ['Password locked', 'ok'] : ['Not locked', 'warn'];
            const when = t.at ? new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
            const tail = f ? (t.failure_reason ? ` · ${esc(t.failure_reason)}` : '') : ` · ${t.items} items · ${bytes(t.size_bytes)}`;
            return (
              <div key={t.id} className={`cvd-bs is-${s[1]}`}
                data-vtip={`<b>${esc(t.code)} · ${s[0]}</b><br>${when}<br>${esc(t.by ?? '—')} · ${esc(t.format_label)} · ${esc(t.scope_label ?? '—')}${tail}`}>
                <i /><b>{t.code}</b>
                <small>{dmIso(t.at)} · {t.format_label}</small>
                <em>{f ? 'Not downloaded' : `${t.locked ? 'Locked · ' : 'Open · '}${t.items} items`}</em>
              </div>
            );
          })}
        </div>
      ) : <small className="cvd-none">No backups yet — download one from Import &amp; Recovery.</small>}
      <div className="cvd-bnx">
        <VdMini ico={VD_I.team} v={<Num v={num(b.people)} />} l="People downloading" sub="Admins who took a backup" />
        <VdMini ico={VD_I.lock} v="Password lock" l="How backups are protected" sub="Locked .zip · opens in Windows & 7-Zip" />
      </div>
    </VdCard>
  );
}

export function Imports({ im, go, R }: { im: Loose; go: Go; R: Routes }) {
  const items = num(im.items), weak = num(im.weak), dup = num(im.duplicates), skip = num(im.skipped), clean = num(im.clean), runs = num(im.runs), people = num(im.people);
  const rows = items + skip;
  const src = Object.entries((im.by_source ?? {}) as Record<string, number>).map(([k, v]) => ({ k: k || 'Other', v: num(v) })).sort((a, b) => b.v - a.v);
  const latest = (im.latest ?? []) as TransferRow[];
  return (
    <VdCard ico={VD_I.arrow} title="Imported Credentials Summary" sub="What came in from Excel, browsers and other password managers"
      extra={<VdLink label="Import Credentials" onClick={() => go(R.importRecovery)} />}>
      <div className="cvd-mts">
        <VdMini ico={VD_I.arrow} v={<Num v={items} />} l="Credentials" sub="Imported into My Vault" />
        <VdMini ico={VD_I.db} v={<Num v={runs} />} l="Import runs" sub={`By ${people} admin${people === 1 ? '' : 's'}`} />
        <VdMini ico={VD_I.key} v={<Num v={weak} />} l="Weak passwords" sub="Flagged on import" cls={weak ? 'is-warn' : ''} />
        <VdMini ico={VD_I.team} v={<Num v={dup} />} l="Duplicates found" sub="Skipped or copied" />
      </div>
      <div className="cvd-b2">
        <div className="cvd-iq">
          <div className="cvd-iq__t"><span className="cvd-sub">Import quality</span><small>{rows} rows checked</small></div>
          <Bars2 tot={rows} parts={[['Imported · strong enough', clean, '#6ee7b7', '#059669'], ['Imported · weak password', weak, '#fcd34d', '#d97706'], ['Skipped', skip, '#cbd5e1', '#94a3b8']]} />
          <div className="cvd-chips2">
            <span><i style={{ background: '#059669' }} />Clean<b>{clean}</b></span>
            <span><i style={{ background: '#d97706' }} />Weak<b>{weak}</b></span>
            <span><i style={{ background: '#94a3b8' }} />Skipped<b>{skip}</b></span>
            <span><i style={{ background: '#0891b2' }} />Duplicates found<b>{dup}</b></span>
          </div>
        </div>
        <SourceBars label="By source" empty="No imports yet"
          items={src.map(x => ({ k: x.k, v: x.v, tip: `<b>${esc(x.k)}</b><br>${x.v} credentials imported` }))} />
      </div>
      <span className="cvd-sub">Recent imports</span>
      {latest.length ? (
        <div className="cvd-il">
          {latest.map(h => (
            <div key={h.id} className="cvd-il__i">
              <span className="cvd-il__ico"><Svg d={VD_I.arrow} size={13} /></span>
              <div className="cvd-il__t"><b>{h.code} · {h.source || h.format_label}</b><small>{h.by_me ? 'You' : h.by ?? '—'} · {vdAgo(h.at)}</small></div>
              <div className="cvd-il__c">
                <span className="cvd-ic is-ok">{h.items} imported</span>
                {h.weak > 0 && <span className="cvd-ic is-warn">{h.weak} weak</span>}
                {h.duplicates > 0 && <span className="cvd-ic is-info">{h.duplicates} duplicate{h.duplicates > 1 ? 's' : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : <small className="cvd-none">No imports yet — bring credentials in from Excel, a browser or another password manager.</small>}
      <div className="cvd-foot">
        <Svg d={VD_I.shieldok} size={12} />
        <span>Every import goes into <b>My Vault</b> · duplicates and weak passwords are flagged <b>before</b> anything is saved</span>
      </div>
    </VdCard>
  );
}
