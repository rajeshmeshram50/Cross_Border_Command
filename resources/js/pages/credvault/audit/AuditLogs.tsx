import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type AuditEvent, type PageMeta } from '../cvApi';
import { CvPage, CvStrip, StripBtn, CvPager, CvTabsRow, Svg, IC, cap, errMsg, useCvMeta, useDebounced } from '../shared';
import './audit.css';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault Audit Logs — the prototype's auditLogsBody: tabs (all / mine /
 * team / alerts), the time-range switch with its custom date popover, search,
 * the summary strip, and the day-grouped timeline (alListHtml). The API
 * scopes it: a Vault Admin sees the company, anyone else their own events
 * and the events on credentials they own.
 * ───────────────────────────────────────────────────────────────────────── */

const CAL = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
const PULSE = '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>';
const LOG = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>';
const ALERT = '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
const GRID = '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>';
const MONITOR = '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>';
const SLIDERS = '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>';
const FILTER = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>';

/** Each action's timeline icon (the prototype's AL_ACT[k][1]). */
const ACT_ICON: Record<string, string> = {
  view: IC.view, reveal: IC.view, copy: IC.copy,
  launch: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  create: IC.plus, edit: IC.edit, share: IC.share,
  revoke: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  request: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  approve: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  reject: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  cancel: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  unlock: IC.unlock, lock: IC.lock,
  otp_failed: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  export: IC.download,
  bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  restore: IC.restore, purge: IC.del, policy: SLIDERS, importx: IC.upload, backup: IC.backup, backupfail: ALERT.replace(/<line x1="12" y1="17"[^>]*>/, ''),
  health_fixed: IC.shield, totp_linked: IC.key,
};

const TABS: [string, string, string][] = [
  ['all', 'All Activity', PULSE],
  ['mine', 'My Activity', IC.user],
  ['team', 'Team Activity', IC.users],
  ['alerts', 'Security Alerts', ALERT],
];
const RANGES: [string, string][] = [['24h', '24h'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All']];
const SEV_FALLBACK: Record<string, string> = { info: 'Info', warn: 'Warning', critical: 'Critical' };
const PER_PAGE = 15;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtD = (v: string) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '');

interface Summary {
  events: number; by_me: number; team_members: number; views_reveals: number; copies_exports: number;
  access_changes: number; security_alerts: number;
  most_active: { user_id: number; name: string; is_me: boolean; label: string; events: number } | null;
}

export default function AuditLogs() {
  const toast = useToast();
  const { meta, typeOf } = useCvMeta();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState('all');
  const [range, setRange] = useState('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState(params.get('action') ?? '');
  const [credId, setCredId] = useState<number | null>(Number(params.get('credential_id')) || null);
  const [credLabel, setCredLabel] = useState<string>(params.get('credential') ?? '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());

  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [pm, setPm] = useState<PageMeta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [pop, setPop] = useState(false);

  const actions = useMemo(() => new Map((meta?.audit_actions ?? []).map(a => [a.key, a])), [meta]);

  const filters = useMemo(() => ({
    tab, range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined,
    action: action || undefined, credential_id: credId ?? undefined, q: dq || undefined,
  }), [tab, range, from, to, action, credId, dq]);

  // The page belongs to one set of filters: any filter change starts again at page 1.
  const fkey = JSON.stringify(filters);
  const [pg, setPg] = useState({ key: fkey, page: 1 });
  const page = pg.key === fkey ? pg.page : 1;
  const setPage = useCallback((p: number) => setPg({ key: fkey, page: p }), [fkey]);

  // A stale response must not overwrite a newer one when filters change quickly.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await cvApi.audit({ ...filters, page, per_page: PER_PAGE });
      if (my !== seq.current) return;
      setRows(r.data);
      setTabs(r.tabs ?? {});
      setPm(r.meta);
      setSummary(r.summary as Summary);
      if (r.meta && page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
    } catch (e) {
      if (my !== seq.current) return;
      setErr(errMsg(e));
      setRows([]);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [filters, page, setPage]);
  useEffect(() => { load(); }, [load]);

  function clearCred() {
    setCredId(null); setCredLabel('');
    const p = new URLSearchParams(params); p.delete('credential_id'); p.delete('credential'); setParams(p, { replace: true });
  }
  function pickCred(e: AuditEvent) {
    if (!e.credential) return;
    setCredId(e.credential.id);
    setCredLabel(`${e.credential.name ?? ''}${e.credential.code ? ` · ${e.credential.code}` : ''}`);
  }
  function toggle(id: number) {
    setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function exportLogs() {
    if (!pm?.total) { toast.warning('No events to export for this view'); return; }
    setExporting(true);
    try {
      const f = await cvApi.auditExport(filters);
      const n = Number(f.headers['x-credvault-count']) || pm.total;
      toast.success(`${n} events exported as CSV`, f.name);
      load();
    } catch (e) {
      if (e instanceof CvApiError && e.status === 422) toast.warning(errMsg(e));
      else toast.error('Export failed', errMsg(e));
    } finally {
      setExporting(false);
    }
  }

  const rangeLabel = range === 'custom'
    ? `${fmtD(from) || 'start'} – ${fmtD(to) || 'today'}`
    : range === '24h' ? 'last 24 hours' : range === '7d' ? 'last 7 days' : range === '30d' ? 'last 30 days' : 'all time';

  /* ── summary strip (alSummaryHtml) ── */
  const card = (cls: string, ico: string, v: number | string, l: string, sub: string) => (
    <div className={`phx-card phx-card--${cls}`} key={cls}>
      <span className="phx-card__glow" />
      <div className="phx-card__top"><span className="phx-card__ico"><Svg d={ico} size={16} /></span><b className="phx-card__n">{v}</b></div>
      <span className="phx-card__l">{l}</span>
      <small className="phx-card__s rb-sub">{sub}</small>
    </div>
  );
  const S = summary;
  const summaryStrip = (
    <div className="rbx al-sum">
      <div className="phx-score rb-hero">
        <span className="phx-score__dots" />
        <span className="rb-hero__ico"><Svg d={PULSE} size={26} /></span>
        <div className="phx-score__t">
          <small>{cap(rangeLabel)}</small>
          <b>{S ? S.events : '—'} events</b>
          <span>{S ? `${S.by_me} by you · ${S.events - S.by_me} by ${S.team_members} team member${S.team_members === 1 ? '' : 's'}` : 'Loading…'}</span>
        </div>
      </div>
      {card('teal', IC.view, S?.views_reveals ?? '—', 'Views & reveals', 'Credentials opened')}
      {card('sky', IC.copy, S?.copies_exports ?? '—', 'Copies & exports', 'Secrets taken out')}
      {card('amber', IC.share, S?.access_changes ?? '—', 'Access changes', 'Shares, requests, approvals')}
      {card('rose', ALERT, S?.security_alerts ?? '—', 'Security alerts', 'Critical-level events')}
      {card('green', '<circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.38 8.38 0 0 1 13 0"/>', S?.most_active?.events ?? 0, 'Most active', S?.most_active?.label ?? '—')}
    </div>
  );

  /* ── timeline (alListHtml) ── */
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const dayLbl = (iso: string) => {
    const x = new Date(iso); x.setHours(0, 0, 0, 0);
    const diff = Math.round((t0.getTime() - x.getTime()) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : x.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  };
  const groups: { k: string; d: string; L: AuditEvent[] }[] = [];
  rows.forEach(e => {
    const k = dayLbl(e.at);
    const g = groups[groups.length - 1];
    if (!g || g.k !== k) groups.push({ k, d: e.at, L: [e] }); else g.L.push(e);
  });
  const filtered = !!(dq || action || credId);

  const list = () => {
    if (err) {
      return (
        <div className="alh-empty">
          <span><Svg d={ALERT} size={24} /></span><b>Could not load the audit log</b><small>{err}</small>
          <button type="button" data-h40="skip" className="al-pop__btn is-pri cva-retry" onClick={load}>Try again</button>
        </div>
      );
    }
    if (loading && !rows.length) {
      return <div className="alh cva-shim">{Array.from({ length: 6 }, (_, i) => <div key={i} className="cva-shim__row"><i /><i /><i /></div>)}</div>;
    }
    if (!rows.length) {
      return (
        <div className="alh-empty">
          <span><Svg d={PULSE} size={24} /></span>
          <b>{filtered ? 'No events match your search' : 'No activity in this period'}</b>
          <small>{filtered ? 'Try a user, credential, action or event ID.' : 'Choose a longer period to see older events.'}</small>
        </div>
      );
    }
    return (
      <div className={`alh${loading ? ' cva-busy' : ''}`}>
        {groups.map(g => (
          <div className="alh-day" key={g.k}>
            <div className="alh-day__hd">
              <span className="alh-day__ico"><Svg d={CAL} size={13} /></span><b>{g.k}</b>
              {(g.k === 'Today' || g.k === 'Yesterday') && <small>{new Date(g.d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</small>}
              <em>{g.L.length} event{g.L.length > 1 ? 's' : ''}</em>
            </div>
            <div className="alh-list">
              {g.L.map(e => {
                const a = actions.get(e.action);
                const base = a?.severity ?? e.severity;
                const d = new Date(e.at);
                const c = e.credential;
                const T = typeOf(c?.type);
                const isOpen = open.has(e.id);
                const label = a?.label ?? e.label;
                const hasDet = !!e.detail && e.detail !== label;
                return (
                  <div className={`alh-it alh-it--${e.severity}`} key={e.id}>
                    <span className="alh-time">
                      {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      <small>{String(d.getSeconds()).padStart(2, '0')}s</small>
                    </span>
                    <span className={`alh-node alh-node--${base}`}><Svg d={ACT_ICON[e.action] ?? IC.view} size={14} /></span>
                    <div className="alh-card alh2">
                      <span className={`alh-av${e.actor.is_me ? ' is-me' : ''}`}>{e.actor.initials}</span>
                      <div className="alh2-b">
                        <div className="alh2-l1">
                          <p>
                            <b title={e.actor.full_name}>{e.actor.name}</b> {e.verb || a?.verb || 'updated'}
                            {c && <> <b className="alh-cr cva-link" role="button" tabIndex={0} title="Show only this credential's events"
                              onClick={() => pickCred(e)} onKeyDown={k => { if (k.key === 'Enter') pickCred(e); }}>{c.name ?? c.code}</b></>}
                          </p>
                          <span className="alh2-role">{e.actor.role}</span>
                          <span className={`al-sev al-sev--${e.severity}`}><i />{e.severity_label || SEV_FALLBACK[e.severity]}</span>
                        </div>
                        <div className="alh2-l2">
                          <span className={`alh-tag alh-tag--act alh-tag--${base}`}>{label}</span>
                          {hasDet ? (
                            <span className={`alh2-det cva-det${isOpen ? ' is-open' : ''}`} title={isOpen ? 'Collapse' : e.detail ?? ''}
                              role="button" tabIndex={0} aria-expanded={isOpen}
                              onClick={() => toggle(e.id)} onKeyDown={k => { if (k.key === 'Enter') toggle(e.id); }}>{e.detail}</span>
                          ) : <span className="alh2-det" />}
                          <span className="alh2-meta">
                            {c
                              ? <span><Svg icon={T?.icon ?? 'lock'} size={11} />{c.code ?? '—'}{c.risk ? ` · ${cap(c.risk)}` : ''}</span>
                              : <span><Svg d={SLIDERS} size={11} />{e.target || 'Vault settings'}</span>}
                            <span><Svg d={GRID} size={11} />{e.module ?? '—'}</span>
                            <span><Svg d={MONITOR} size={11} />{e.ip ?? '—'}</span>
                            <b className="alh-id">{e.event_id}</b>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <CvPage className="mv-page al-page">
      <CvStrip icon={LOG} title="Audit Logs"
        sub="Every view, copy, share, approval and policy change across CredVault — for you and your team, time-stamped."
        actions={<StripBtn icon={IC.download} onClick={exportLogs} disabled={exporting || loading}>{exporting ? 'Exporting…' : 'Export Logs'}</StripBtn>} />

      {summaryStrip}

      <div className="bst-wrap"><div className="bst-card">
        <CvTabsRow className="tvc-top al-top"
          tabs={TABS.map(([k, l, ico]) => ({ key: k, label: l, icon: ico, count: tabs[k] }))}
          active={tab} onTab={k => setTab(k as typeof tab)}
          extra={
          <div className="al-tools">
            <div className="cva-rangewrap">
              <div className="al-range">
                {RANGES.map(([k, l]) => (
                  <button key={k} type="button" data-h40="skip" className={range === k ? 'is-on' : ''} onClick={() => { setRange(k); setPop(false); }}>{l}</button>
                ))}
                <button type="button" data-h40="skip" className={`al-cust${range === 'custom' ? ' is-on' : ''}`} onClick={() => setPop(p => !p)}>
                  <Svg d={CAL} size={12} />{range === 'custom' ? `${fmtD(from) || 'Start'} – ${fmtD(to) || 'Today'}` : 'Custom'}
                </button>
              </div>
              {pop && <CustomRange from={from} to={to} onClose={() => setPop(false)}
                onApply={(f, t) => { setFrom(f); setTo(t); setRange('custom'); setPop(false); }} />}
            </div>
            <div className="bst-search parch-search whm-main-search">
              <Svg d={IC.search} size={14} stroke="#94a3b8" />
              <input type="text" value={q} placeholder="Search user, credential, action or event ID..." onChange={e => setQ(e.target.value)} aria-label="Search" autoComplete="off" />
              {q && <button type="button" className="bst-search-clear" onClick={() => setQ('')} aria-label="Clear search"><Svg d={IC.close} size={13} sw={2.4} /></button>}
            </div>
          </div>
          } />

        <div className="cva-filters">
          <span className="cva-filters__l"><Svg d={FILTER} size={12} />Filter</span>
          <select className="cva-sel" value={action} onChange={e => setAction(e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            {(meta?.audit_actions ?? []).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          {credId && (
            <span className="cva-chip"><Svg icon="lock" size={11} />{credLabel || `Credential #${credId}`}
              <button type="button" data-h40="skip" onClick={clearCred} aria-label="Clear credential filter"><Svg d={IC.close} size={11} sw={2.6} /></button>
            </span>
          )}
          {(action || credId) && (
            <button type="button" data-h40="skip" className="cva-clear" onClick={() => { setAction(''); clearCred(); }}>Clear filters</button>
          )}
          <span className="cva-filters__n">Tip: click a credential name to see only its events.</span>
        </div>

        {list()}
        {pm && !err && <CvPager page={pm.current_page} lastPage={pm.last_page} total={pm.total} perPage={pm.per_page} noun="events" onPage={setPage} />}
      </div></div>
    </CvPage>
  );
}

/** "Custom date range" popover (alCustOpen / alCustApply). */
function CustomRange({ from, to, onApply, onClose }: { from: string; to: string; onApply: (f: string, t: string) => void; onClose: () => void }) {
  const today = ymd(new Date());
  const [f, setF] = useState(from || ymd(new Date(Date.now() - 29 * 864e5)));
  const [t, setT] = useState(to || today);
  const [e, setE] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node) && !(ev.target as HTMLElement).closest('.al-cust')) onClose(); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  function apply() {
    if (f && t && f > t) { setE('“From” must be on or before “To”.'); return; }
    onApply(f, t);
  }
  return (
    <div className="al-pop cva-pop" ref={ref} role="dialog" aria-label="Custom date range">
      <div className="al-pop__hd"><Svg d={CAL} size={14} /><b>Custom date range</b></div>
      <div className="al-pop__f"><label>From</label><input type="date" max={today} value={f} onChange={x => { setF(x.target.value); setE(''); }} /></div>
      <div className="al-pop__f"><label>To</label><input type="date" max={today} value={t} onChange={x => { setT(x.target.value); setE(''); }} /></div>
      <div className="al-pop__err">{e}</div>
      <div className="al-pop__a">
        <button type="button" data-h40="skip" className="al-pop__btn" onClick={onClose}>Cancel</button>
        <button type="button" data-h40="skip" className="al-pop__btn is-pri" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

