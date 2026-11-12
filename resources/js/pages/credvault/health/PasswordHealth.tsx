import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Tooltip from '../../../components/ui/Tooltip';
import { useToast } from '../../../contexts/ToastContext';
import WorklistPager from '../../../components/ui/WorklistPager';
import { cvApi, CV_ROUTES, type CredentialDetail, type HealthIssue, type Loose, type PageMeta } from '../cvApi';
import {
  ActBtn, CvBrief, CvCard, CvPage, CvStrip, CvTabsRow, EmptyRow, IC, ShimRows, StrengthCell, StripBtn, Svg,
  cap, errMsg, fmtDay, initials, useCvMeta, useDebounced, type CvTab,
} from '../shared';
import CredentialFormModal from '../form/CredentialFormModal';
import ViewDrawer from '../my-vault/ViewDrawer';
import GeneratorModal from '../my-vault/GeneratorModal';
import './health.css';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault · Password Health — weak, reused and overdue passwords, missing
 * 2FA and over-shared credentials, with a one-click Fix (prototype:
 * passwordHealthBody / phSummaryHtml / phListHtml / phFix).
 * ───────────────────────────────────────────────────────────────────────── */

const PH_I: Record<string, string> = {
  all: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  weak: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  reused: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  twofa: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
  rotation: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  shared: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  fixed: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
};
const ICO = {
  pulse: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><polyline points="3.5 12 8 12 10 9 13 15 15 12 20.5 12"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
};

const TABS: [string, string][] = [['all', 'All Issues'], ['weak', 'Weak'], ['reused', 'Reused'], ['twofa', '2FA Off'], ['rotation', 'Rotation Due'], ['shared', 'Over-shared']];
/** Fixed severity per issue type — not raised or lowered by the credential's risk level. */
const SEV_BY_TYPE: Record<string, 'critical' | 'high' | 'medium'> = { weak: 'critical', reused: 'high', twofa: 'medium', rotation: 'critical', shared: 'medium' };
const CARD_LBL: Record<string, string> = { weak: 'Weak passwords', reused: 'Reused passwords', twofa: 'Missing 2FA', rotation: 'Rotation due', shared: 'Over-shared' };
const FIX_LBL: Record<string, string> = {
  weak: 'Opens the credential form to set a strong password',
  reused: 'Opens the credential form to set a unique password',
  rotation: 'Opens the credential form to rotate the password',
  twofa: 'Opens the credential form to switch on 2FA',
  shared: 'Opens Shared By Me to revoke extra access',
};
const PERM_LBL: Record<string, string> = { use: 'Use Only', view: 'View', copy: 'Copy', full: 'Full Access' };
const STR_LBL = ['None', 'Weak', 'Fair', 'Good', 'Strong'];
const PER_PAGE = 10;
const RING = 2 * Math.PI * 34;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

const FILTER_ICO = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>';
const CLEAR_ICO = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';

/**
 * The score ring + five issue cards (phSummaryHtml). Each card is one issue type — Weak, Reused, Missing 2FA,
 * Rotation due, Over-shared — and filters the list to that tab; clicking the active card clears it (phCardFilter).
 */
function Summary({ s, tabs, active, onPick }: { s: Loose | null; tabs: Record<string, number>; active: string; onPick: (k: string) => void }) {
  const score = num(s?.score ?? 0);
  const level = s ? (score >= 80 ? ['Good', 'is-good'] : score >= 60 ? ['Fair', 'is-fair'] : ['At risk', 'is-bad']) : ['—', 'is-good'];
  const pwN = s ? num(s.with_passwords) : 0;
  const all = s ? num(s.checked) : 0;
  const pctOf = (n: number, of: number) => (of ? Math.round(n / of * 100) : 0);
  // The API's per-card numbers (GET /health/summary · cards): credentials failing the check, out of those it applies to.
  const api = (k: string) => ((s?.cards ?? []) as Loose[]).find(c => c.key === k);
  const card = (cls: string, ico: string, k: string, l: string, sub: (n: number) => string, fallbackOf: number) => {
    const c = api(k);
    const value = s ? num(c ? c.failed : tabs[k] ?? 0) : 0;
    const of = c ? num(c.of) : fallbackOf;
    const on = active === k;
    const p = c ? num(c.pct) : pctOf(value, of);
    return (
    <div key={k} className={`phx-card phx-card--${cls} phx-card--clickable${on ? ' is-active' : ''}`} role="button" tabIndex={0} aria-pressed={on}
      title={on ? 'Clear filter — show all issues' : `Filter the list to ${l}`} onClick={() => onPick(k)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(k); } }}>
      <span className="phx-card__glow" />
      <div className="phx-card__top">
        <span className="phx-card__ico"><Svg d={ico} size={16} /></span>
        <b className="phx-card__n">{s ? value : '—'}</b>
        <span className="phx-card__pct">{p}%</span>
      </div>
      <span className="phx-card__l">{l}</span>
      <div className="phx-card__bar"><i style={{ width: `${p}%` }} /></div>
      <small className="phx-card__s">{s ? (c?.sub ?? sub(value)) : '…'}</small>
      <small className="phx-card__hint"><Svg d={on ? CLEAR_ICO : FILTER_ICO} size={11} />{on ? 'Showing — click to clear' : 'Click to filter list'}</small>
    </div>
    );
  };
  return (
    <div className="phx">
      <div className={`phx-score ${level[1]}`}>
        <span className="phx-score__dots" />
        <div className="phx-ring" style={{ ['--p' as string]: score }}>
          <svg viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" className="phx-ring__bg" />
            <circle cx="40" cy="40" r="34" className="phx-ring__fg" style={{ strokeDasharray: RING.toFixed(1), strokeDashoffset: ((1 - score / 100) * RING).toFixed(1) }} />
          </svg>
          <div><b>{s ? score : '—'}</b><small>/100</small></div>
        </div>
        <div className="phx-score__t">
          <small>Vault health score</small>
          <b>{level[0]}</b>
          <span>{s ? `${num(s.passed ?? s.safe)} of ${num(s.total ?? s.checked)} credentials are healthy` : 'Checking your credentials…'}</span>
          <em><Svg d={PH_I.weak} size={11} />{s ? `${num(s.failed ?? s.at_risk)} need attention` : '…'}</em>
        </div>
      </div>
      {card('teal', PH_I.weak, 'weak', 'Weak passwords', n => `${n} of ${pwN} passwords below policy`, pwN)}
      {card('sky', PH_I.reused, 'reused', 'Reused passwords', n => `${n} of ${pwN} share a password`, pwN)}
      {/* Each card's "of" and line come from the API; the fallbacks cover an older API. */}
      {card('amber', PH_I.twofa, 'twofa', 'Missing 2FA', n => `${n} of ${all} credentials without 2FA`, all)}
      {card('rose', PH_I.rotation, 'rotation', 'Rotation due', n => `${n} of ${pwN} passwords past policy age`, pwN)}
      {card('green', PH_I.shared, 'shared', 'Over-shared', n => `${n} of ${all} credentials shared too widely`, all)}
    </div>
  );
}

/** The Details column (phDetail), read from the issue's structured `details`. */
const REF_SHOWN = 2;

function RefList({ items }: { items: { id: number; code: string; name: string }[] }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const rest = items.slice(REF_SHOWN);
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
    return { top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 300) };
  };
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.ph-refpop') || btn.current?.contains(t)) return;
      setPos(null);
    };
    const follow = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.ph-refpop')) return;
      setPos(place());
    };
    const away = () => setPos(null);
    document.addEventListener('mousedown', close, true);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', close, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);
  const toggle = () => setPos(pos ? null : place());
  const ref = (o: { id: number; code: string; name: string }) => (
    <span className="ph-ref" key={o.id} title={`${o.code} · ${o.name}`}><i className="whm-idpill">{o.code}</i><span className="ph-ref__n">{o.name}</span></span>
  );
  return (
    <>
      {items.slice(0, REF_SHOWN).map(ref)}
      {rest.length > 0 && (
        <button ref={btn} type="button" data-h40="skip" className={`ph-more${pos ? ' is-on' : ''}`} aria-expanded={!!pos}
          title={`Show the other ${rest.length}`} onClick={toggle}>+{rest.length}</button>
      )}
      {pos && createPortal(
        <div className="cvx">
          <div className="ph-refpop" role="dialog" aria-label="Same password as" style={{ top: pos.top, left: pos.left }}>
            <small>Also the same password · {rest.length}</small>
            {rest.map(ref)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Detail({ x }: { x: HealthIssue }) {
  const d = (x.details ?? {}) as Loose;
  const c = x.credential;
  if (x.type === 'weak') {
    const st = num(d.strength ?? c.strength);
    return <StrengthCell row={{ has_password: c.has_password !== false, strength_level: st, strength: d.strength_label || STR_LBL[st] || 'Weak' }} />;
  }
  if (x.type === 'reused') {
    const same = (d.same_as ?? []) as { id: number; code: string; name: string }[];
    return (
      <div className="ph-dl">
        <small>Same password as</small>
        <RefList items={same} />
      </div>
    );
  }
  if (x.type === 'twofa') {
    return <div className="ph-dl"><b>2FA is turned off</b><small>Login needs only the password — no phone or app code to confirm it is really you</small></div>;
  }
  if (x.type === 'rotation') {
    const age = num(d.age_days), od = num(d.overdue_days);
    return (
      <div className="ph-dl">
        <b>{plural(age, 'day')} old</b>
        <small>Policy {num(d.policy_days)} days · {od > 0 ? <em className="is-bad">overdue by {plural(od, 'day')}</em> : `due ${fmtDay(d.due_at)}`}</small>
      </div>
    );
  }
  if (x.type === 'shared') {
    const by = (d.by_permission ?? {}) as Record<string, number>;
    const parts = Object.keys(PERM_LBL).filter(k => num(by[k]) > 0).map(k => `${by[k]} ${PERM_LBL[k]}`);
    const had = num(d.exposed_since_reset ?? d.active_shares);
    const live = num(d.active_shares);
    return (
      <div className="ph-dl">
        <b>{had} {had === 1 ? 'person' : 'people'} since the last password change</b>
        <small>{live} active {live === 1 ? 'share' : 'shares'}{parts.length ? ` · ${parts.join(' · ')}` : ''}{d.needs_reset ? ' · revoked access still knows the password' : ''}</small>
      </div>
    );
  }
  return <div className="ph-dl"><small>{x.detail}</small></div>;
}

export default function PasswordHealth() {
  const navigate = useNavigate();
  const toast = useToast();
  const { typeOf } = useCvMeta();

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE);
  const [rows, setRows] = useState<HealthIssue[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<Loose | null>(null);
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, per_page: PER_PAGE, total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [gen, setGen] = useState(false);
  const [newPw, setNewPw] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  /** A summary card filters the list to its issue type; the active card clears it (phCardFilter). */
  const pickCard = (k: string) => {
    const next = tab === k ? 'all' : k;
    setTab(next); setPage(1);
    toast.info(next === 'all' ? 'Filter cleared — showing all issues' : `Filtered to ${CARD_LBL[k] ?? k}`);
    listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const load = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await cvApi.health({ tab, q: dq, page, per_page: perPage });
      if (my !== seq.current) return null;
      setRows(r.data); setTabs(r.tabs); setSummary(r.summary); setMeta(r.meta); setError(null);
      if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
      return r;
    } catch (e) {
      if (my !== seq.current) return null;
      setError(errMsg(e)); setRows([]);
      return null;
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [tab, dq, page, perPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq]);

  const scan = async () => {
    setScanning(true);
    toast.info(`Scanning ${summary ? num(summary.checked) : 'your'} credentials…`);
    const r = await load();
    setScanning(false);
    if (r) toast.success(`Health check complete · ${plural(num(r.summary.open_issues), 'open issue')}`);
    else toast.error('Health check failed', 'Please try again.');
  };

  const fix = (x: HealthIssue) => {
    if (x.type === 'shared' && !(x.details as Loose)?.needs_reset) {
      // Shared By Me, filtered to this credential (its credential_id filter).
      navigate(`${CV_ROUTES.myVault}?tab=sharedby&credential_id=${x.credential.id}`);
      toast.info(`Showing who has access to ${x.credential.name}`, 'Revoke what is no longer needed.');
      return;
    }
    setEditId(x.credential.id);
  };

  const onSaved = (c: CredentialDetail) => {
    setEditId(null);
    setNewPw(null);
    const gone = c.health?.resolved?.length ?? 0;
    if (c.health) {
      if (gone) toast.success(`${plural(gone, 'health issue')} resolved`);
      else toast.warning('Saved — the issue is still open');
    }
    load(true);
  };

  const cols = ['Sr. No', 'Credential ID', 'Credential Name', 'Owner', 'Issue', 'Severity', 'Details', 'Suggested Action', 'Action'];
  const cvTabs: CvTab[] = TABS.map(([k, l]) => ({ key: k, label: l, icon: PH_I[k], count: tabs[k] ?? null }));
  const start = (meta.current_page - 1) * meta.per_page;
  const tabLabel = TABS.find(t => t[0] === tab)?.[1] ?? '';

  return (
    <CvPage className="mv-page ph-page tv-page">
      <CvStrip
        icon={ICO.pulse}
        title="Password Health"
        sub="Find weak, reused and overdue passwords, missing 2FA and over-shared credentials — and fix them in one click."
        actions={<>
          <StripBtn ghost icon={ICO.key} onClick={() => setGen(true)}>Generate Password</StripBtn>
          <StripBtn icon={ICO.scan} onClick={scan} disabled={scanning}>Run Health Check</StripBtn>
        </>}
      />
      <CvBrief
        icon={ICO.pulse}
        label="Password Health"
        sub="Checking every credential you own or manage against the password policy, and helping you fix what is at risk."
        steps={[
          { icon: ICO.scan, title: 'Scan Credentials', desc: 'Each credential is checked for strength, reuse, 2FA, rotation age and how widely it is shared.' },
          { icon: PH_I.weak, title: 'Prioritise by Severity', desc: 'Critical issues on high-risk credentials appear first so the biggest risks are fixed first.' },
          { icon: ICO.tool, title: 'Fix in One Click', desc: 'Generate a strong password, confirm 2FA or revoke extra access straight from the list.' },
          { icon: PH_I.fixed, title: 'Re-check Any Time', desc: 'Run Health Check again after fixing — resolved issues drop off the list and the score goes up.' },
        ]}
      />
      <div id="phSum"><Summary s={summary} tabs={tabs} active={tab} onPick={pickCard} /></div>
      <CvCard pane fit>
        <CvTabsRow tabs={cvTabs} active={tab} onTab={k => { setTab(k); setPage(1); }}
          search={q} onSearch={setQ} placeholder="Search by credential, owner or issue..." />
        <div id="phListWrap" ref={listRef} className="tvc-list">
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl">
              <thead><tr>{cols.map((c, i) => <th key={c} className={`ph-th-${i}`}>{c}</th>)}</tr></thead>
              <tbody>
                {loading ? <ShimRows cols={cols.length} /> : error ? (
                  <EmptyRow cols={cols.length} title="Could not run the health check" sub={error}
                    action={<button type="button" className="mv-empty__btn" onClick={() => load()}><Svg d={IC.restore} size={13} />Try again</button>} />
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={cols.length} className="mv-empty">
                      <div className="mv-empty__box">
                        <div className="mv-empty__ico"><Svg d={PH_I.fixed} size={24} /></div>
                        <div className="mv-empty__t">{dq ? 'No issues match your search' : `All clear — no ${tab === 'all' ? '' : tabLabel.toLowerCase() + ' '}issues`}</div>
                        <div className="mv-empty__s">{dq ? 'Try a credential name, ID, owner or issue.' : 'Every credential in this check is healthy.'}</div>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((x, i) => {
                  const c = x.credential;
                  const T = typeOf(c.type);
                  // Severity is fixed per issue type, whatever the credential (Weak / Rotation critical, Reused high, 2FA / Over-shared medium).
                  const sev = SEV_BY_TYPE[x.type] ?? x.severity;
                  const urlIco = c.url && /^https?:|\.[a-z]{2,}/i.test(c.url) ? 'globe' : 'tag';
                  return (
                    <tr key={`${c.id}-${x.type}-${x.resolved_at ?? i}`}>
                      <td><span className="whm-sr">{start + i + 1}</span></td>
                      <td><div className="whm-idcell"><span className="whm-idpill">{c.code}</span><span className="whm-iddate">{c.type_label ?? c.category_group ?? ''}</span></div></td>
                      <td>
                        <div className="whm-namecell">
                          <span className="whm-namecell__ico"><Svg icon={T?.icon ?? 'lock'} size={15} /></span>
                          <div className="whm-namecell__t">
                            <b>{c.name}</b>
                            {c.url && <span className="whm-namecell__loc"><Svg icon={urlIco} size={11} />{c.url}</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="mv-ownc">
                          <span className="mv-ownc__av">{initials(c.owner)}</span>
                          <div><Tooltip label={c.owner || '—'} disabled={!c.owner}><b className="ph-own">{c.owner || '—'}</b></Tooltip>{c.scope === 'team' ? <em className="mv-team">Team</em> : c.scope ? <em className="mv-pers">Personal</em> : null}</div>
                        </div>
                      </td>
                      <td><span className={`ph-iss ph-iss--${x.type ?? 'weak'}`}><Svg d={PH_I[x.type] ?? PH_I.all} size={12} /><span>{x.issue}</span></span></td>
                      <td><div className="znm-flagcell">{sev ? <span className={`znm-flag mv-rk mv-rk--${sev}`}><i />{cap(sev)}</span> : '—'}</div></td>
                      <td><Detail x={x} /></td>
                      <td><span className="ph-act">{x.action}</span></td>
                      <td>
                        <div className="whm-acts">
                          <ActBtn icon={ICO.tool} tone="edit" disabled={!x.can_fix}
                            title={x.can_fix ? `Fix — ${FIX_LBL[x.type]}` : 'You can only use this credential — ask its owner to fix it'}
                            onClick={() => fix(x)} />
                          {c.id ? <ActBtn icon={IC.view} title="View credential" onClick={() => setViewId(c.id)} /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <WorklistPager className="wl-teal" loading={loading}
            total={error ? 0 : meta.total} page={meta.current_page} pageSize={perPage}
            onPage={setPage} onPageSize={n => { setPerPage(n); setPage(1); }} />
        </div>
      </CvCard>

      {editId !== null && (
        <CredentialFormModal credentialId={editId} onClose={() => setEditId(null)} onSaved={onSaved} />
      )}
      {newPw !== null && (
        <CredentialFormModal prefillPassword={newPw} onClose={() => setNewPw(null)} onSaved={onSaved} />
      )}
      {viewId !== null && (
        <ViewDrawer fieldLabels key={viewId} credentialId={viewId} onClose={() => setViewId(null)} onChanged={() => load(true)}
          onEdit={id => { setViewId(null); setEditId(id); }} />
      )}
      {gen && <GeneratorModal onClose={() => setGen(false)} onUse={pw => { setGen(false); setNewPw(pw); }} />}
    </CvPage>
  );
}
