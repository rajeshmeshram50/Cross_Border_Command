import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type CredentialDetail, type Loose, type Perm } from '../cvApi';
import { cap, CvPortal, errMsg, Svg, useCvMeta } from '../shared';

export interface ShareModalProps {
  credentialId: number;
  onClose: () => void;
  onShared?: () => void;
}

const PERM_ICO: Record<Perm, string> = {
  use: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  view: 'eye',
  copy: 'copy',
  full: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
};
const PERM_LV: Record<Perm, number> = { use: 0, view: 1, copy: 2, full: 3 };
const CAPS: [string, number][] = [
  ['Sign in / autofill', 0], ['See the password', 1], ['Copy the password', 2],
  ['Edit the credential', 3], ['Re-share with others', 3], ['Delete the credential', 3],
];
const TEAM_ICO = 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 0 0 .01';
const CLOCK = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const longDay = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function endOf(dur: string): Date | null {
  if (dur === '0') return null;
  if (dur.startsWith('date:')) return new Date(`${dur.slice(5)}T23:59:00`);
  return new Date(Date.now() + +dur * 864e5);
}

export default function ShareModal({ credentialId, onClose, onShared }: ShareModalProps) {
  const toast = useToast();
  const { meta, typeOf } = useCvMeta();
  const [cred, setCred] = useState<CredentialDetail | null>(null);
  const [people, setPeople] = useState<{ users: Loose[]; teams: Loose[] } | null>(null);
  const [type, setType] = useState<'user' | 'team'>('user');
  const [who, setWho] = useState('');
  const [perm, setPerm] = useState<Perm>('view');
  const [dur, setDur] = useState('7');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState<{ y: number; m: number } | null>(null);
  const [calPos, setCalPos] = useState<{ left: number; top: number } | null>(null);
  const dateBtn = useRef<HTMLButtonElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const crit = cred?.risk === 'critical';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let on = true;
    Promise.all([cvApi.show(credentialId), cvApi.recipients()])
      .then(([c, r]) => { if (on) { setCred(c); setPeople(r); } })
      .catch(e => { if (on) { toast.error('Could not open sharing', errMsg(e)); closeRef.current(); } });
    return () => { on = false; };
  }, [credentialId, toast]);

  const ready = !!cred && !!meta;
  useEffect(() => {
    if (!cred || !meta) return;
    if (cred.risk === 'critical' && !meta.policy.share_critical) {
      toast.warning('Sharing critical credentials is turned off in CredVault Policies');
      closeRef.current();
      return;
    }
    setPerm(cred.risk === 'critical' ? 'use' : 'view');
    const durs = meta.share_durations;
    setDur(durs.some(d => d.days === 7) ? '7' : String(durs.find(d => d.days !== null)?.days ?? 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const options = useMemo(() => (type === 'user'
    ? (people?.users ?? []).map(u => ({ id: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : u.email ? ` — ${u.email}` : ''}` }))
    : (people?.teams ?? []).map(t => ({ id: String(t.id), label: `${t.name} — Team · ${t.members} members` }))), [people, type]);

  const end = endOf(dur);
  const permDef = meta?.permissions.find(p => p.key === perm);
  const clr = (k: string) => setErrs(p => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; });

  /* ── the end-date calendar (the prototype's sh-cal) ── */
  const openCal = () => {
    if (cal) { setCal(null); return; }
    const cur = dur.startsWith('date:') ? new Date(`${dur.slice(5)}T00:00:00`) : (end ?? new Date());
    setCal({ y: cur.getFullYear(), m: cur.getMonth() });
  };
  useLayoutEffect(() => {
    if (!cal || !dateBtn.current || !calRef.current) { setCalPos(null); return; }
    const r = dateBtn.current.getBoundingClientRect();
    const w = calRef.current.offsetWidth, h = calRef.current.offsetHeight;
    const below = window.innerHeight - r.bottom - 10;
    setCalPos({ left: Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)), top: below >= h ? r.bottom + 6 : Math.max(10, r.top - 6 - h) });
  }, [cal]);
  useEffect(() => {
    if (!cal) return;
    const out = (e: MouseEvent) => {
      const t = e.target as Node;
      if (calRef.current?.contains(t) || dateBtn.current?.contains(t)) return;
      setCal(null);
    };
    document.addEventListener('mousedown', out, true);
    return () => document.removeEventListener('mousedown', out, true);
  }, [cal]);
  const pick = (iso: string) => { setCal(null); setDur(`date:${iso}`); clr('dur'); };
  const nav = (d: number) => setCal(c => {
    if (!c) return c;
    let m = c.m + d, y = c.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    return { y, m };
  });

  const renderCal = () => {
    if (!cal) return null;
    const { y, m } = cal;
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sel = dur.startsWith('date:') ? dur.slice(5) : (end ? isoDay(end) : '');
    const canBack = y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth());
    const quick = (n: number, l: string) => <button key={l} type="button" data-h40="skip" onClick={() => pick(isoDay(new Date(Date.now() + n * 864e5)))}>{l}</button>;
    return (
      <div ref={calRef} className="sh-cal" style={calPos ? { left: calPos.left, top: calPos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
        <div className="sh-cal__hd">
          <button type="button" data-h40="skip" className="sh-cal__nav" onClick={() => nav(-1)} disabled={!canBack}><Svg icon="M15 18l-6-6 6-6" size={14} sw={2.6} /></button>
          <b>{MONTHS[m]} {y}</b>
          <button type="button" data-h40="skip" className="sh-cal__nav" onClick={() => nav(1)}><Svg icon="M9 18l6-6-6-6" size={14} sw={2.6} /></button>
        </div>
        <div className="sh-cal__wk">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(w => <span key={w}>{w}</span>)}</div>
        <div className="sh-cal__g">
          {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1, dt = new Date(y, m, d), iso = `${y}-${pad(m + 1)}-${pad(d)}`;
            const past = dt < today, isT = +dt === +today;
            return (
              <button key={iso} type="button" data-h40="skip" disabled={past} onClick={() => pick(iso)}
                className={`${past ? 'is-past' : ''}${iso === sel ? ' is-sel' : ''}${isT ? ' is-today' : ''}`}>{d}</button>
            );
          })}
        </div>
        <div className="sh-cal__ft">{quick(14, '2 weeks')}{quick(60, '2 months')}{quick(90, '3 months')}</div>
      </div>
    );
  };

  const save = async () => {
    if (!cred || !meta || busy) return;
    const e: Record<string, string> = {};
    if (!who) e.who = 'Select who to share with';
    if (meta.policy.share_reason && reason.trim().length < 5) e.reason = 'Give a reason (at least 5 characters)';
    if (crit && !end) e.dur = 'A critical credential must be shared with an end date.';
    setErrs(e);
    if (Object.keys(e).length) { toast.warning('Please complete the highlighted fields'); return; }

    const body: Loose = { recipient_type: type, recipient_id: +who, permission: perm, reason: reason.trim() || undefined };
    if (dur.startsWith('date:')) body.expires_at = dur.slice(5);
    else if (dur !== '0') body.duration_days = +dur;

    setBusy(true);
    try {
      const r = await cvApi.share(cred.id, body);
      toast.success(r.message, `${cred.name} · ${r.data.permission_label}`);
      onShared?.();
      onClose();
    } catch (err) {
      if (err instanceof CvApiError && Object.keys(err.errors).length) {
        const f = (k: string) => err.field(k);
        setErrs({
          ...(f('recipient_id') || f('recipient_type') ? { who: (f('recipient_id') || f('recipient_type'))! } : {}),
          ...(f('permission') ? { perm: f('permission')! } : {}),
          ...(f('expires_at') || f('duration_days') ? { dur: (f('expires_at') || f('duration_days'))! } : {}),
          ...(f('reason') ? { reason: f('reason')! } : {}),
        });
      }
      toast.error('Could not share', errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const T = cred ? typeOf(cred.type) : undefined;
  const lv = PERM_LV[perm];

  return (
    <CvPortal onClose={cal ? () => setCal(null) : onClose}>
      <div id="crd-host">
        <div className="mapsup-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="mapsup-box crd-box gp-box sh-box" role="dialog" aria-modal="true" aria-label="Share Credential">
            <div className="mapsup-header">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg icon="share" size={22} /></div>
                  <div className="mapsup-title-block"><h3 className="mapsup-title">Share Credential</h3><p className="mapsup-sub">Control who can access this credential, how, and for how long.</p></div>
                </div>
                <div className="crd-hbtns"><button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button></div>
              </div>
            </div>

            <div className="mapsup-body gp-body sh-body">
              {!cred || !meta ? (
                <div className="sh-cred" style={{ opacity: .6 }}><span className="sh-cred__ico"><Svg icon="lock" size={18} /></span><div className="sh-cred__t"><b>Loading…</b></div></div>
              ) : (
                <>
                  <div className="sh-cred">
                    <span className="sh-cred__ico"><Svg icon={T?.icon ?? 'lock'} size={18} /></span>
                    <div className="sh-cred__t"><b>{cred.name}</b><span><i className="whm-idpill">{cred.code}</i>{cred.type_label}{cred.username ? ` · ${cred.username}` : ''}</span></div>
                    <span className={`znm-flag mv-rk mv-rk--${cred.risk}`}><i />{cap(cred.risk)}</span>
                  </div>

                  <div className="mapsup-seccard gp-card">
                    <div className="mapsup-sechead"><span className="mapsup-sechead__ico"><Svg icon="user" size={14} /></span><div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">Recipient</span><span className="mapsup-sechead__sub">A person or a whole team inside your organisation</span></div></div>
                    <div className="sh-row">
                      <div className="gp-seg sh-type">
                        <button type="button" data-h40="skip" className={type === 'user' ? 'is-on' : ''} onClick={() => { setType('user'); setWho(''); }}><Svg icon="user" size={12} />Individual</button>
                        <button type="button" data-h40="skip" className={type === 'team' ? 'is-on' : ''} onClick={() => { setType('team'); setWho(''); }}><Svg icon={TEAM_ICO} size={12} />Team</button>
                      </div>
                    </div>
                    <div className={`mapsup-ffield${errs.who ? ' is-err' : ''}`} data-f="who">
                      <label className="mapsup-flabel" htmlFor="crdF_shwho">Share With <span className="req">*</span></label>
                      <div className="mapsup-inputwrap">
                        <span className="mapsup-input-ico"><Svg icon={type === 'team' ? TEAM_ICO : 'user'} size={13} /></span>
                        <select id="crdF_shwho" className="mapsup-finput has-ico mapsup-fselect" value={who} onChange={e => { setWho(e.target.value); clr('who'); }}>
                          <option value="">Select {type === 'team' ? 'a team' : 'a person'}…</option>
                          {options.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select>
                      </div>
                      {errs.who && <span className="crd-err cv-ferr">{errs.who}</span>}
                      {!options.length && <span className="crd-err cv-ferr" style={{ color: '#64748b' }}>{type === 'team' ? 'No teams with members yet.' : 'No other active users in your company.'}</span>}
                    </div>
                    <div className="sh-note"><Svg icon="shield" size={12} />External sharing is off by policy — use Secure Send or Vendor access for outsiders.</div>
                  </div>

                  <div className="mapsup-seccard gp-card">
                    <div className="mapsup-sechead"><span className="mapsup-sechead__ico"><Svg icon="key" size={14} /></span><div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">Permission &amp; Duration</span><span className="mapsup-sechead__sub">{crit ? 'Critical credential — Full Access and No expiry are disabled' : 'What the recipient can do, and until when'}</span></div></div>
                    <div className="sh-perms">
                      {meta.permissions.map(p => {
                        const dis = crit && p.key === 'full';
                        return (
                          <button key={p.key} type="button" data-h40="skip" disabled={dis} title={dis ? 'Not allowed for Critical credentials' : undefined}
                            className={`sh-perm${perm === p.key ? ' is-on' : ''}${dis ? ' is-off' : ''}`} onClick={() => { setPerm(p.key); clr('perm'); }}>
                            <span className="sh-perm__ico"><Svg icon={PERM_ICO[p.key]} size={16} /></span>
                            <span className="sh-perm__t"><b>{p.label}</b><small>{p.description}</small></span>
                            <span className="sh-perm__ck"><Svg icon="check" size={10} sw={3} /></span>
                          </button>
                        );
                      })}
                    </div>
                    {errs.perm && <span className="crd-err cv-ferr">{errs.perm}</span>}
                    <div className="sh-durrow">
                      <span className="gp-len__top"><b>Access Duration</b></span>
                      <div className="gp-seg sh-dur">
                        {meta.share_durations.map(d => {
                          const k = String(d.days ?? 0);
                          const dis = crit && !d.critical_allowed;
                          return (
                            <button key={k} type="button" data-h40="skip" className={dur === k ? 'is-on' : ''} disabled={dis}
                              title={dis ? 'Critical credentials must expire' : undefined} onClick={() => { setDur(k); clr('dur'); }}>{d.label}</button>
                          );
                        })}
                      </div>
                      <div className="sh-date">
                        <button ref={dateBtn} type="button" data-h40="skip" className={`mapsup-finput has-ico crd-dd sh-date__btn${cal ? ' is-open' : ''}`} onClick={openCal}>
                          <span className="mapsup-input-ico"><Svg icon="cal" size={13} /></span>
                          <span className={`crd-dd__v${dur.startsWith('date:') ? '' : ' is-ph'}`}>{dur.startsWith('date:') ? longDay(new Date(`${dur.slice(5)}T00:00:00`)) : 'Pick an end date'}</span>
                          <span className="crd-dd__chev"><Svg icon="M6 9l6 6 6-6" size={14} sw={2.6} /></span>
                        </button>
                      </div>
                    </div>
                    {errs.dur && <span className="crd-err cv-ferr">{errs.dur}</span>}
                    <div className="sh-caps">
                      <div className="sh-caps__t">What the recipient can do</div>
                      <div className="sh-caps__g">
                        {CAPS.map(([l, need]) => {
                          const ok = lv >= need;
                          return <span key={l} className={`sh-cap${ok ? ' is-yes' : ''}`}><i><Svg icon={ok ? 'check' : 'x'} size={10} sw={3} /></i>{l}</span>;
                        })}
                      </div>
                    </div>
                    <div className="sh-exp">
                      <Svg icon={CLOCK} size={13} />
                      <span>
                        <b>{permDef?.label ?? cap(perm)}</b> access {end
                          ? <>until <b>{longDay(end)}</b>, then revoked automatically</>
                          : <>with <b>no expiry</b> — revoke it any time from Shared By Me</>}.
                      </span>
                    </div>
                  </div>

                  <div className="mapsup-seccard gp-card">
                    <div className="mapsup-sechead"><span className="mapsup-sechead__ico"><Svg icon="note" size={14} /></span><div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">Reason for Sharing</span><span className="mapsup-sechead__sub">The reason is recorded in the audit log</span></div></div>
                    <div className={`mapsup-ffield${errs.reason ? ' is-err' : ''}`} data-f="reason">
                      <label className="mapsup-flabel" htmlFor="shReason">Reason for Sharing {meta.policy.share_reason && <span className="req">*</span>}</label>
                      <div className="mapsup-inputwrap">
                        <span className="mapsup-input-ico"><Svg icon="note" size={13} /></span>
                        <textarea id="shReason" className="mapsup-finput has-ico crd-ta" rows={2} maxLength={500} placeholder="Why is this credential being shared?"
                          value={reason} onChange={e => { setReason(e.target.value); clr('reason'); }} />
                      </div>
                      {errs.reason && <span className="crd-err cv-ferr">{errs.reason}</span>}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg icon="shield" size={12} /> Every share is audit-logged and can be revoked any time</div>
              <div className="mapsup-footer__actions sh-ft" style={{ width: 'auto' }}>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" onClick={save} disabled={!cred || !meta || busy}>
                  <Svg icon="share" size={13} />{busy ? 'Sharing…' : 'Share Credential'}
                </button>
              </div>
            </div>
          </div>
          {renderCal()}
        </div>
      </div>
    </CvPortal>
  );
}
