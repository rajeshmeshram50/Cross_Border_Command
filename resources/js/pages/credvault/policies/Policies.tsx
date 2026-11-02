import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type Loose, type Policy, type PolicyRule, type Risk } from '../cvApi';
import { CvPage, CvStrip, StripBtn, ConfirmModal, Svg, IC, cap, errMsg, initials, useCvMeta } from '../shared';
import './policies.css';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault Policies — the prototype's policiesBody / polGridHtml: one card
 * per policy area (rules + insight box + "Live in your vault" numbers), the
 * Change History card, and the unsaved-changes bar. Vault Admins edit; anyone
 * else reads the same cards with every control disabled.
 * ───────────────────────────────────────────────────────────────────────── */

const ICO = {
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  rot: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  manager: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.38 8.38 0 0 1 13 0"/>',
  purge: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="14" y2="15"/><line x1="14" y1="11" x2="10" y2="15"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  ok: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  restore: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
};

const SEC_ICON: Record<string, string> = { password: ICO.key, twofa: ICO.shield, sharing: ICO.share, critical: ICO.lock, bin: ICO.bin };

/** Each rule's row icon, as polBodyHtml draws them. */
const RULE_ICON: Record<string, string> = {
  min_strength: ICO.pulse, rotation_default: ICO.rot, rotation_warn: ICO.clock, gen_length: ICO.key, gen_symbols: ICO.hash,
  twofa_risks: ICO.shield,
  share_critical: ICO.lock, share_max_days: ICO.clock, share_reason: ICO.msg, overshare_limit: ICO.users,
  cp_admin: ICO.shield, cp_admin_user_id: ICO.person, cp_manager: ICO.manager, cp_otp: ICO.phone, cp_max_minutes: ICO.clock,
  bin_days: ICO.clock, bin_purge: ICO.purge,
};

const RISKS: Risk[] = ['critical', 'high', 'medium', 'low'];
const STR = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/** The grid's compact option labels (polGridHtml shortens "30 days" → "30d" etc.). */
const short = (l: string) => l.replace(/^(\d+) days$/, '$1d').replace(/^No limit$/, 'None').replace(/^(\d+) min$/, '$1m').replace(/^1 hour$/, '1h');

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Section { key: string; title: string; subtitle: string; rules: (keyof Policy)[] }
interface HistoryRow { id: number; key: string; label: string; section: string | null; area: string | null; from_label: string | null; to_label: string | null; by: string | null; at: string }

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}
const dShort = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function Policies() {
  const toast = useToast();
  const { meta } = useCvMeta();
  const [data, setData] = useState<Loose | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBin, setConfirmBin] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const [d, h] = await Promise.all([cvApi.policies(), cvApi.policyHistory(1).catch(() => null)]);
      setData(d);
      setDraft(JSON.parse(JSON.stringify(d.settings)));
      setHistory((h?.data ?? []) as HistoryRow[]);
      setErrors({});
    } catch (e) {
      setLoadErr(errMsg(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saved = (data?.settings ?? null) as Policy | null;
  const canEdit = !!data?.can_edit;
  const sections = (data?.sections ?? []) as Section[];
  const rules = useMemo(() => new Map(((data?.rules ?? []) as PolicyRule[]).map(r => [r.key, r])), [data]);
  const admins = (data?.admins ?? []) as { id: number; name: string; initials: string }[];
  const insights = (data?.insights ?? {}) as Loose;
  const stats = (data?.history ?? {}) as Loose;
  const defaults = (data?.defaults ?? null) as Policy | null;
  // Controls lock while a save is in flight — load() replaces the draft afterwards, so edits made meanwhile would be lost.
  const editable = canEdit && !saving;

  const changed = useMemo(() => (saved && draft
    ? (Object.keys(saved) as (keyof Policy)[]).filter(k => !same(saved[k], draft[k]))
    : []), [saved, draft]);

  function set<K extends keyof Policy>(k: K, v: Policy[K]) {
    if (!editable) return;
    setDraft(d => (d ? { ...d, [k]: v } : d));
    setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  }
  function toggleRisk(r: Risk) {
    if (!draft) return;
    const a = draft.twofa_risks.includes(r) ? draft.twofa_risks.filter(x => x !== r) : [...draft.twofa_risks, r];
    set('twofa_risks', RISKS.filter(x => a.includes(x)));
  }

  /** Lowering the bin retention purges anything already older than the new period, so confirm that first. */
  function requestSave() {
    if (!draft || !changed.length || saving) return;
    if (saved && changed.includes('bin_days') && Number(draft.bin_days) < Number(saved.bin_days)) { setConfirmBin(true); return; }
    save();
  }
  async function save() {
    if (!draft || !changed.length) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(changed.map(k => [k, draft[k]])) as Partial<Policy>;
      const r = await cvApi.savePolicies(body);
      toast.success('Policies saved', r.message);
      cvApi.meta(true).catch(() => {});
      await load();
    } catch (e) {
      if (e instanceof CvApiError && Object.keys(e.errors).length) setErrors(e.errors);
      toast.error('Could not save the policies', errMsg(e));
    } finally {
      setSaving(false);
      setConfirmBin(false);
    }
  }
  function discard() { if (saved) { setDraft(JSON.parse(JSON.stringify(saved))); setErrors({}); } }
  async function restoreDefaults() {
    setResetting(true);
    try {
      const r = await cvApi.resetPolicies();
      toast.success('Defaults restored', r.message);
      setConfirmReset(false);
      cvApi.meta(true).catch(() => {});
      await load();
    } catch (e) {
      toast.error('Could not restore the defaults', errMsg(e));
    } finally {
      setResetting(false);
    }
  }

  /* ── controls ── */
  const sw = (k: keyof Policy) => {
    const on = !!draft?.[k];
    return (
      <button type="button" data-h40="skip" className={`pol-sw${on ? ' is-on' : ''}`} role="switch" aria-checked={on}
        disabled={!editable} onClick={() => set(k, !on as never)}>
        <span className="pol-sw__t"><i /></span><b>{on ? 'On' : 'Off'}</b>
      </button>
    );
  };
  const seg = (k: keyof Policy, opts: { value: unknown; label: string }[]) => (
    <div className="pol-seg">
      {opts.map(o => (
        <button key={String(o.value)} type="button" data-h40="skip" className={same(o.value, draft?.[k]) ? 'is-on' : ''}
          disabled={!editable} onClick={() => set(k, o.value as never)}>{short(o.label)}</button>
      ))}
    </div>
  );
  const multi = () => (
    <div className="pol-seg pol-seg--multi">
      {RISKS.map(r => {
        const on = !!draft?.twofa_risks.includes(r);
        return (
          <button key={r} type="button" data-h40="skip" className={on ? 'is-on' : ''} disabled={!editable} onClick={() => toggleRisk(r)}>
            {on && <Svg d={ICO.check} size={11} />}{cap(r)}
          </button>
        );
      })}
    </div>
  );
  // The prototype picks the Default Vault Admin from a segmented list; a long list becomes a dropdown.
  const adminPicker = () => {
    const opts = [{ value: null as number | null, label: 'Any Vault Admin' }, ...admins.map(a => ({ value: a.id as number | null, label: a.name }))];
    if (opts.length <= 4) return seg('cp_admin_user_id', opts);
    return (
      <select className="cvp-select" value={draft?.cp_admin_user_id ?? ''} disabled={!editable}
        onChange={e => set('cp_admin_user_id', e.target.value ? Number(e.target.value) : null)}>
        {opts.map(o => <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>)}
      </select>
    );
  };
  const control = (r: PolicyRule): ReactNode => {
    if (r.control === 'switch') return sw(r.key);
    if (r.control === 'multi') return multi();
    if (r.control === 'admin') return adminPicker();
    return seg(r.key, r.options ?? []);
  };

  const row = (k: keyof Policy) => {
    const r = rules.get(k);
    if (!r || !saved || !draft) return null;
    const ch = !same(saved[k], draft[k]);
    const err = errors[k]?.[0] ?? (k === 'twofa_risks' ? Object.entries(errors).find(([f]) => f.startsWith('twofa_risks.'))?.[1]?.[0] : undefined);
    return (
      <div className={`pol-row${ch ? ' is-changed' : ''}`} key={k}>
        <span className="pol-row__ico"><Svg d={RULE_ICON[k] ?? ICO.shield} size={16} /></span>
        <div className="pol-row__t">
          <b>{r.label}{ch && <em>Unsaved</em>}</b>
          <small>{r.description}</small>
          <span className="pol-used"><Svg d={ICO.chev} size={10} />Applies to {r.applies_to.map(u => <i key={u}>{u}</i>)}</span>
          {err && <span className="cv-ferr">{err}</span>}
        </div>
        <div className="pol-row__c">{control(r)}</div>
      </div>
    );
  };

  /* ── per-card extras ── */
  const flow = () => {
    if (!draft) return null;
    const steps = [draft.cp_admin, draft.cp_manager, draft.cp_otp].filter(Boolean).length;
    const S: [keyof Policy, string, string][] = [['cp_admin', 'Vault Admin', ICO.shield], ['cp_manager', 'Reporting Manager', ICO.manager], ['cp_otp', 'Authenticator OTP', ICO.phone]];
    return (
      <div className="pol-flow">
        {S.map(([k, l, ico]) => [
          <div key={k} className={`pol-flow__s${draft[k] ? ' is-on' : ''}`}><span><Svg d={ico} size={14} /></span><b>{l}</b><small>{draft[k] ? 'Required' : 'Skipped'}</small></div>,
          <i key={`${k}-ar`} className="pol-flow__ar"><Svg d={ICO.chev} size={12} /></i>,
        ])}
        <div className="pol-flow__s is-end"><span><Svg d={ICO.unlock} size={14} /></span><b>Unlocked</b><small>{steps ? `${steps} check${steps > 1 ? 's' : ''}` : 'No checks'}</small></div>
      </div>
    );
  };

  const box = (t: string, inner: ReactNode) => <div className="pgc-in"><div className="pgc-in__t">{t}</div>{inner}</div>;
  const insight = (sec: string): ReactNode => {
    const I = insights[sec] ?? {};
    if (sec === 'password') {
      const mix = I.strength_mix ?? {};
      const LV: [string, string, string][] = [['strong', 'Strong', '#059669'], ['good', 'Good', '#0891b2'], ['fair', 'Fair', '#d97706'], ['weak', 'Weak', '#e11d48']];
      return box('Password strength mix', <>
        <div className="pgc-mix">{LV.map(([k, l, c]) => (mix[k] ? <i key={k} style={{ flex: mix[k], background: c }} title={`${l}: ${mix[k]}`} /> : null))}</div>
        <div className="pgc-mix__l">{LV.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l} <b>{mix[k] ?? 0}</b></span>)}</div>
      </>);
    }
    if (sec === 'twofa') {
      return box('2FA coverage by risk level', <>
        {(I.by_risk ?? []).map((x: Loose) => {
          const pct = x.applies ? Math.round((x.enabled / x.applies) * 100) : 100;
          return (
            <div className="pgc-bar" key={x.risk}>
              <span className="pgc-bar__l">{cap(x.risk)}{x.required && <em>Required</em>}</span>
              <span className="pgc-bar__t"><i className={pct < 100 && x.required ? 'is-bad' : ''} style={{ width: `${pct}%` }} /></span>
              <b>{x.enabled}/{x.applies}</b>
            </div>
          );
        })}
        <small className="pgc-in__n">Credential types without a 2FA option (cards, documents, keys) are not counted.</small>
      </>);
    }
    if (sec === 'sharing') {
      const L = (I.most_shared ?? []) as Loose[];
      return box('Most shared credentials', L.length ? L.map(x => (
        <div className="pgc-li" key={x.id}>
          <span className="pgc-li__i">{initials(x.name)}</span>
          <div><b>{x.name}</b><small>{x.code} · {cap(x.risk)} risk</small></div>
          <em className={x.over_limit ? 'is-bad' : ''}>{x.shares}{x.shares === 1 ? ' share' : ' shares'}</em>
        </div>
      )) : <small className="pgc-in__n">Nothing is shared yet.</small>);
    }
    if (sec === 'bin') {
      const R = (I.next_bin_deletions ?? []) as Loose[];
      return box('Next permanent deletions', R.length ? R.map(x => {
        const d = Math.max(1, Math.ceil((new Date(x.purges_at).getTime() - Date.now()) / 864e5));
        return (
          <div className="pgc-li" key={x.id}>
            <span className="pgc-li__i is-bin"><Svg d={ICO.bin} size={12} /></span>
            <div><b>{x.name}</b><small>{x.code} · on {dShort(x.purges_at)}</small></div>
            <em className={d <= 3 ? 'is-bad' : d <= 7 ? 'is-warn' : ''}>{d}{d === 1 ? ' day' : ' days'}</em>
          </div>
        );
      }) : <small className="pgc-in__n">The recycle bin is empty.</small>);
    }
    return null;
  };

  const liveStats = (sec: string): [number, string, string?][] => {
    const I = insights[sec] ?? {};
    if (sec === 'password') return [[I.with_password ?? 0, 'Passwords checked'], [I.below_policy ?? 0, `Below ${STR[saved?.min_strength ?? 3]}`, 'warn'], [I.rotation_due ?? 0, 'Rotation due', 'warn']];
    if (sec === 'twofa') return [[I.enabled ?? 0, '2FA enabled'], [I.missing ?? 0, 'Missing 2FA', 'bad'], [I.in_required_levels ?? 0, 'In required levels']];
    if (sec === 'sharing') return [[I.active_shares ?? 0, 'Active shares'], [I.shares_on_critical ?? 0, 'On critical items', 'warn'], [I.over_shared ?? 0, 'Over-shared', 'bad']];
    if (sec === 'critical') return [[I.critical_credentials ?? 0, 'Critical credentials'], [I.pending_requests ?? 0, 'Pending requests', 'warn'], [I.unlocked_now ?? 0, 'Unlocked now']];
    if (sec === 'bin') return [[I.bin_items ?? 0, 'Items in bin'], [I.expiring_soon ?? 0, 'Deleted within 7 days', 'warn'], [I.critical_items ?? 0, 'Critical items', 'bad']];
    return [];
  };
  const statsFoot = (sec: string) => {
    const S = liveStats(sec);
    if (!S.length) return null;
    return (
      <div className="pgc-ft">
        <span className="pgc-ft__l"><Svg d={ICO.pulse} size={12} />Live in your vault</span>
        <div className="pgc-ft__s">
          {S.map(([n, l, tone]) => <div key={l} className={`pgc-st${tone && n ? ` is-${tone}` : ''}`}><b>{n}</b><small>{l}</small></div>)}
        </div>
      </div>
    );
  };

  const logCard = () => {
    const REC: [string, string][] = [['<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'Rule & area'], [ICO.arrow, 'Old → new value'], [ICO.person, 'Who changed it'], [ICO.clock, 'Date & time']];
    const total = stats.total ?? history.length;
    return (
      <div className="pgc-card pgc-card--log">
        <div className="plh-hd">
          <span className="phx-score__dots" />
          <span className="plh-hd__ico"><Svg d={ICO.doc} size={18} /></span>
          <div><b>Change History</b><small>Audit trail of every saved policy change</small></div>
          <span className="plh-live"><i />Live</span>
        </div>
        <div className="plh-stats">
          <div><b>{total}</b><small>Total changes</small></div>
          <div><b>{stats.today ?? 0}</b><small>Today</small></div>
          <div><b>{stats.people ?? 0}</b><small>Changed by</small></div>
        </div>
        <div className="pgc-rows plh-body">
          {history.length ? (
            <>
              <div className="plh-tl">
                {history.slice(0, 5).map((l, i) => (
                  <div key={l.id} className={`plh-it${i === 0 ? ' is-new' : ''}`}>
                    <span className="plh-dot"><Svg d={SEC_ICON[l.section ?? ''] ?? ICO.key} size={13} /></span>
                    <div className="plh-c">
                      <div className="plh-top"><b>{l.label}</b>{i === 0 && <em className="plh-new">Latest</em>}</div>
                      <div className="plh-chg">
                        <span className="plh-from">{l.from_label}</span><Svg d={ICO.arrow} size={11} /><span className="plh-to">{l.to_label}</span>
                        {l.area && <i className="plh-area">{l.area}</i>}
                      </div>
                      <div className="plh-by">
                        <span className="plh-av">{l.by === 'You' ? initials(meta?.me.name ?? 'You') : initials(l.by)}</span>
                        <span>{l.by ?? 'System'}</span><i>·</i>
                        <span title={new Date(l.at).toLocaleString('en-GB')}>{ago(l.at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {total > 5 && <div className="plh-more">+ {total - 5} earlier change{total - 5 > 1 ? 's' : ''} kept for audit</div>}
            </>
          ) : (
            <div className="plh-empty"><span><Svg d={ICO.clock} size={22} /></span><b>No changes yet</b><small>Save a rule change and it appears here instantly.</small></div>
          )}
        </div>
        <div className="plh-rec">
          <div className="pgc-in__t">Every entry records</div>
          <div className="plh-rec__g">{REC.map(([ico, l]) => <span key={l}><Svg d={ico} size={12} />{l}</span>)}</div>
        </div>
      </div>
    );
  };

  const n = changed.length;

  return (
    <CvPage className="mv-page pol-page">
      <CvStrip icon={ICO.shield} title="CredVault Policies"
        sub="Set the rules every CredVault module follows — passwords, 2FA, sharing, critical access and the recycle bin."
        actions={canEdit ? <StripBtn icon={ICO.restore} onClick={() => setConfirmReset(true)}>Reset to Defaults</StripBtn> : undefined} />

      <div className="bst-wrap"><div className="bst-card">
        {data && !canEdit && (
          <div className="cvp-ro"><Svg d={IC.lock} size={14} /><div><b>Read-only view</b><small>Only a Vault Admin can change CredVault policies. These are the rules in force.</small></div></div>
        )}
        <div className="pol-body pgc-wrap">
          {loadErr ? (
            <div className="plh-empty cvp-state">
              <span><Svg d={ICO.warn} size={22} /></span><b>Could not load the policies</b><small>{loadErr}</small>
              <button type="button" data-h40="skip" className="pol-btn pol-btn--ghost" onClick={load}>Try again</button>
            </div>
          ) : !data || !draft ? (
            <div className="pgc-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="pgc-card cvp-shim"><i /><i /><i /><i /></div>)}</div>
          ) : (
            <div className="pgc-grid">
              {sections.map(sc => {
                const ch = sc.rules.filter(k => changed.includes(k)).length;
                const warn = sc.key === 'critical' && !draft.cp_admin && !draft.cp_manager && !draft.cp_otp;
                return (
                  <div key={sc.key} className={`pgc-card pgc-card--${sc.key}`}>
                    <div className="pgc-hd">
                      <span className="pgc-hd__ico"><Svg d={SEC_ICON[sc.key] ?? ICO.shield} size={17} /></span>
                      <div><b>{sc.title}</b><small>{sc.subtitle}</small></div>
                      <span className={`pgc-n${ch ? ' is-ch' : ''}`}>{ch ? `${ch} unsaved` : `${sc.rules.length} rule${sc.rules.length > 1 ? 's' : ''}`}</span>
                    </div>
                    <div className="pgc-rows">
                      {sc.key === 'critical' && flow()}
                      {sc.rules.map(k => row(k))}
                      {warn && <div className="pol-warn"><Svg d={ICO.warn} size={14} />With every check off, critical credentials open without any approval.</div>}
                      {insight(sc.key)}
                    </div>
                    {statsFoot(sc.key)}
                  </div>
                );
              })}
              {logCard()}
            </div>
          )}
        </div>

        {data && canEdit && (
          <div className={`pol-bar${n ? ' is-on' : ''}`}>
            <span className="pol-bar__i"><Svg d={n ? ICO.info : ICO.ok} size={15} /></span>
            <div>
              <b>{n ? `${n} unsaved change${n > 1 ? 's' : ''}` : 'All policies saved'}</b>
              <small>{n ? 'Save to apply them across CredVault' : 'Changes apply as soon as they are saved'}</small>
            </div>
            <div className="pol-bar__a">
              <button type="button" data-h40="skip" className="pol-btn pol-btn--ghost" onClick={discard} disabled={!n || saving}>Discard</button>
              <button type="button" data-h40="skip" className="pol-btn pol-btn--pri" onClick={requestSave} disabled={!n || saving}>
                <Svg d={ICO.check} size={13} />{saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div></div>

      {confirmReset && (
        <ConfirmModal title="Reset to Defaults" sub="Every CredVault policy goes back to its standard value" icon={ICO.restore}
          points={[
            { icon: ICO.shield, title: 'All 17 rules are reset at once', text: 'Password, 2FA, sharing, critical access and recycle bin rules return to their defaults and apply across CredVault immediately.' },
            { icon: ICO.doc, title: 'Each change is logged', text: 'Every rule that changes is written to the Change History and the Audit Logs.' },
            ...(saved && defaults && Number(saved.bin_days) > Number(defaults.bin_days)
              ? [{ icon: ICO.bin, title: `Recycle bin retention drops to ${defaults.bin_days} days`, text: 'Items already older than the new period are deleted right away.' }] : []),
            ...(n ? [{ icon: ICO.warn, title: `${n} unsaved change${n > 1 ? 's' : ''} will be lost`, text: 'Your draft is replaced by the defaults.' }] : []),
          ]}
          ackLabel="I understand every policy will be reset to its default"
          confirmLabel="Reset Policies" confirmIcon={ICO.restore} busy={resetting}
          onConfirm={restoreDefaults} onClose={() => !resetting && setConfirmReset(false)} />
      )}

      {confirmBin && saved && draft && (
        <ConfirmModal title="Shorten bin retention" sub={`Recycle bin retention goes from ${saved.bin_days} to ${draft.bin_days} days`} icon={ICO.bin}
          points={[
            { icon: ICO.purge, title: 'Older items are deleted right away', text: 'Items already older than the new period are deleted right away.' },
            { icon: ICO.doc, title: 'This cannot be undone', text: 'Purged credentials cannot be restored from the recycle bin.' },
          ]}
          ackLabel="I understand older bin items will be permanently deleted"
          confirmLabel="Save Changes" confirmIcon={ICO.check} busy={saving}
          onConfirm={save} onClose={() => !saving && setConfirmBin(false)} />
      )}
    </CvPage>
  );
}
