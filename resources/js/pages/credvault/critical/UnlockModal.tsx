import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Shimmer } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { CvApiError, type AccessRequestRow, type CredentialDetail, type LockStep, type UnlockState } from '../cvApi';
import { CvPortal, IC, Svg, copyText, errMsg, fmtTime, initials, mmss, useCvMeta, useNow } from '../shared';
import OtpDigits from './OtpDigits';
import { cvData, type OtpSetup } from './cvData';
import './unlock.css';

/**
 * CredVault · Critical Access Protection unlock modal — the stepper
 * (Vault Admin → Manager → Authenticator → Reveal), request card, OTP pane,
 * reveal pane with countdown, Lock now / Full details.
 */
export interface UnlockModalProps {
  credentialId: number;
  onClose: () => void;
  onChanged?: () => void;               // a request / unlock / lock happened
  onFullDetails?: (id: number) => void;  // "Full details" once unlocked
}

type Stage = LockStep | 'done';

/* The prototype's CP_I icon set. */
const CP_I = {
  lock: IC.lock,
  unlock: IC.unlock,
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  mgr: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  prev: '<polyline points="15 18 9 12 15 6"/>',
  next: '<polyline points="9 18 15 12 9 6"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
};
/** Stage 3 when the credential's 2FA is Gmail: the code is emailed (send-otp), not read from an app. */
const META_MAIL: [string, string, string] = ['Gmail', CP_I.mail, 'Enter code'];
const META: Record<LockStep, [string, string, string]> = {
  admin: ['Vault Admin', CP_I.admin, 'Request access'],
  manager: ['Manager', CP_I.mgr, 'Request approval'],
  otp: ['Authenticator', CP_I.phone, 'Enter OTP'],
};
const FOOT_NAMES: Record<LockStep, string> = { admin: 'Vault Admin access', manager: 'Manager approval', otp: 'Authenticator OTP' };
const MASK = '••••••••••••';
const RING = 144.5;
const blank = () => Array.from({ length: 6 }, () => '');

function durLabel(m: number): [string | number, string] {
  return m < 60 ? [m, 'min'] : [m / 60, m / 60 > 1 ? 'hours' : 'hour'];
}

function Approver({ who, role, note }: { who: string; role: string; note: ReactNode }) {
  return (
    <div className="rv-to">
      <span className="cp-av">{initials(who)}</span>
      <div><b>{who}</b><em>{role}</em></div>
      <span className="rv-to__n">{note}</span>
    </div>
  );
}

/** While the credential loads: the stepper, the request card and the footer, as shimmer blocks. */
function UnlockSkeleton() {
  const col = (gap: number): CSSProperties => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap });
  return (
    <>
      <div className="rv-body"><div className="rv-pane">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '4px 0 18px', borderBottom: '1px solid var(--shim-border, #e3eff3)' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={col(6)}>
              <Shimmer width={44} height={44} radius={13} />
              <Shimmer width={42} height={8} />
              <Shimmer width={i === 3 ? 54 : 82} height={12} />
              <Shimmer width={64} height={9} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          <Shimmer width={150} height={24} radius={999} />
          <Shimmer width="46%" height={18} />
          <Shimmer width="70%" height={11} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, border: '1px solid var(--shim-border, #e3eff3)', marginTop: 4 }}>
            <Shimmer width={46} height={46} radius={13} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}><Shimmer width={140} height={13} /><Shimmer width={80} height={10} /></div>
            <Shimmer width={120} height={26} radius={999} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, border: '1px solid var(--shim-border, #e3eff3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><Shimmer width={130} height={10} /><Shimmer width={46} height={10} /></div>
            <Shimmer width="100%" height={96} radius={12} />
            <Shimmer width={190} height={10} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[0, 1, 2, 3].map(i => <Shimmer key={i} height={66} radius={14} />)}
            </div>
          </div>
        </div>
      </div></div>
      <div className="rv-foot">
        <div className="rv-foot__l">
          <div style={{ display: 'flex', gap: 5 }}>{[0, 1, 2].map(i => <Shimmer key={i} width={i ? 18 : 34} height={6} radius={999} />)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Shimmer width={80} height={12} /><Shimmer width={104} height={9} /></div>
        </div>
        <div className="rv-foot__r">
          <Shimmer width={104} height={44} radius={12} />
          <Shimmer width={84} height={44} radius={12} />
          <Shimmer width={240} height={46} radius={12} />
        </div>
      </div>
    </>
  );
}

export default function UnlockModal({ credentialId, onClose, onChanged, onFullDetails }: UnlockModalProps) {
  const toast = useToast();
  const { typeOf } = useCvMeta();
  const [d, setD] = useState<CredentialDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [shown, setShown] = useState(false);
  const [viewSel, setViewSel] = useState<Stage | null>(null);
  const [reason, setReason] = useState('');
  const [dur, setDur] = useState<number | null>(null);
  const [err, setErr] = useState<{ reason?: string; duration?: string; general?: string }>({});
  const [busy, setBusy] = useState(false);
  const [digits, setDigits] = useState<string[]>(blank);
  const [otpErr, setOtpErr] = useState('');
  const [otpBad, setOtpBad] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const hideTimers = useRef<Record<string, number>>({});
  const relocked = useRef(false);
  const loadSeq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    try {
      const x = await cvData.show(credentialId);
      if (seq !== loadSeq.current) return;   // a newer load (or poll) owns the state
      setD(x);
      setFetchedAt(Date.now());
      setLoadErr(null);
    } catch (e) {
      if (!silent && seq === loadSeq.current) setLoadErr(errMsg(e));
    }
  }, [credentialId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  useEffect(() => {
    const t = hideTimers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  /* ── derived state ── */
  const plan = d?.unlock_plan;
  const steps: LockStep[] = useMemo(() => plan?.steps.map(s => s.key) ?? d?.lock_steps ?? [], [plan, d]);
  const unlock: UnlockState = d?.unlock ?? { state: 'locked', label: 'Approval needed' };
  const req: AccessRequestRow | null = d?.last_request ?? null;
  /* ── countdown ── the API can still read 'open' with 0 seconds left until its sweep locks the
     window; that is an ended window, so the popup starts a new request instead of the old Reveal. */
  const apiOpen = unlock.state === 'open';
  const now = useNow(apiOpen);
  const left = apiOpen ? Math.max(0, (unlock.seconds_left ?? 0) - (now - fetchedAt) / 1000) : 0;
  // Under a second left already reads 00:00, so that is the end of the window too.
  const ended = apiOpen && left < 1;
  const open = apiOpen && !ended;
  const live = req && unlock.request_id === req.id && !ended ? req : null;   // the open request, if any
  const order: Stage[] = useMemo(() => [...steps, 'done'], [steps]);

  const cur: Stage = open ? 'done'
    : (live?.stage ?? unlock.stage ?? steps[0] ?? 'done');
  const ci = order.indexOf(cur);

  /* ── the one-time authenticator setup (QR + key), shown beside the code until the app is linked ── */
  const [setup, setSetup] = useState<OtpSetup | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  useEffect(() => {
    if (cur !== 'otp') return;
    let on = true;
    cvData.otpSetup(credentialId).then(s => { if (on) setSetup(s); }).catch(() => { if (on) setSetup(null); });
    return () => { on = false; };
  }, [cur, credentialId]);
  useEffect(() => {
    let on = true;
    if (!setup) { setQrSvg(''); return; }
    QRCode.toString(setup.otpauth_uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(s => { if (on) setQrSvg(s); }).catch(() => { if (on) setQrSvg(''); });
    return () => { on = false; };
  }, [setup]);
  /* ── Gmail 2FA: POST access-requests/{id}/send-otp mails the code; verify-otp checks it ── */
  const isMail = (live?.otp?.method ?? plan?.otp_method) === 'email';
  const metaOf = (k: LockStep) => (k === 'otp' && isMail ? META_MAIL : META[k]);
  const [mail, setMail] = useState({ sending: false, sentTo: '', wait: 0, expiresIn: 0 });
  const autoSent = useRef<number | null>(null);
  useEffect(() => {
    if (mail.wait <= 0) return;
    const t = setTimeout(() => setMail(m => ({ ...m, wait: Math.max(0, m.wait - 1) })), 1000);
    return () => clearTimeout(t);
  }, [mail.wait]);

  // Leaving a stage behind returns the view to where the request now stands.
  useEffect(() => { setViewSel(null); }, [cur]);
  const view: Stage = viewSel && order.indexOf(viewSel) >= 0 && order.indexOf(viewSel) <= ci ? viewSel : cur;
  const past = view !== cur;

  // Durations and default window, once the plan is in.
  useEffect(() => {
    if (plan && dur === null) setDur(plan.durations.includes(plan.default_minutes) ? plan.default_minutes : (plan.durations[0] ?? plan.default_minutes));
  }, [plan, dur]);

  // The last request, when nothing is open: a rejection, an expired window or a reset to explain.
  const lastRejected = !live && req?.status === 'rejected' ? req : null;
  const rejectedStage: 'admin' | 'manager' | null = lastRejected
    ? (lastRejected.admin?.status === 'rejected' ? 'admin' : lastRejected.manager?.status === 'rejected' ? 'manager' : null) : null;
  const lastReset = !live && req?.status === 'locked' && req.locked_reason === 'otp_failed';
  const lastExpired = (!live && req?.status === 'locked' && req.locked_reason === 'expired') || ended;

  const stageStatus = (k: LockStep): 'done' | 'pend' | 'bad' | null => {
    if (live) {
      if (k === 'otp') return live.otp?.verified_at ? 'done' : null;
      const s = (k === 'admin' ? live.admin?.status : live.manager?.status) ?? null;
      return s === 'approved' ? 'done' : s === 'pending' ? 'pend' : null;
    }
    return k === rejectedStage ? 'bad' : null;
  };
  const decidedAt = (k: LockStep) => (k === 'admin' ? live?.admin?.decided_at : k === 'manager' ? live?.manager?.decided_at : live?.otp?.verified_at) ?? null;
  const approverName = (k: LockStep): string => {
    if (k === 'admin') {
      if (live?.admin) return live.admin.user?.name ?? 'your Branch Admin';
      return plan?.steps.find(s => s.key === 'admin')?.approver?.name ?? 'your Branch Admin';
    }
    if (live?.manager?.user) return live.manager.user.name;
    return plan?.steps.find(s => s.key === 'manager')?.approver?.name ?? 'your reporting manager';
  };
  const deciderName = (k: 'admin' | 'manager', r: AccessRequestRow | null) =>
    (k === 'admin' ? r?.admin?.decided_by?.name ?? r?.admin?.user?.name : r?.manager?.decided_by?.name ?? r?.manager?.user?.name) ?? approverName(k);

  const total = unlock.total_seconds || 1;
  // The window is time-limited: when it ends the popup goes back to Locked (the request step with
  // the "last window ended" note), never stays on the green Reveal. Revealed values are dropped, and
  // it reloads shortly so the API's sweep marks the old window locked.
  const sawOpen = useRef(false);
  useEffect(() => { if (open) sawOpen.current = true; }, [open]);
  useEffect(() => {
    if (!ended || relocked.current) return;
    relocked.current = true;
    setRevealed({});
    onChanged?.();
    if (sawOpen.current) toast.warning(`${d?.name ?? 'Credential'} is locked again`, 'The unlock window ended — send a new request to view it again.');
    const t = window.setTimeout(() => load(true), 1500);
    return () => clearTimeout(t);
  }, [ended, d, toast, onChanged, load]);

  /* ── a pending approval is decided elsewhere: look again every 15 s ── */
  const waiting = unlock.state === 'pending';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { load(true); }, 15000);
    return () => clearInterval(t);
  }, [waiting, load]);
  // Tell the list when the request moved on — after our own actions too (they reload `d`), so those
  // do not call onChanged themselves.
  const stateKey = `${unlock.state}:${unlock.stage ?? ''}`;
  const firstKey = useRef<string | null>(null);
  useEffect(() => {
    if (!d) return;
    if (firstKey.current === null) { firstKey.current = stateKey; return; }
    if (firstKey.current !== stateKey) { firstKey.current = stateKey; onChanged?.(); }
  }, [stateKey, d, onChanged]);

  /* ── actions ── */
  async function send(k: LockStep) {
    if (!d || busy) return;
    setErr({});
    setBusy(true);
    try {
      const body = plan?.asks_reason ? { reason: reason.trim(), duration_minutes: dur ?? undefined } : {};
      await cvData.requestAccess(d.id, body);
      toast.success(`Request sent to ${approverName(k)}`);
      await load(true);
    } catch (e) {
      if (e instanceof CvApiError) {
        if (e.status === 409 && e.data) { await load(true); toast.info(e.message); }
        else setErr({ reason: e.field('reason'), duration: e.field('duration_minutes'), general: Object.keys(e.errors).length ? undefined : e.message });
      } else setErr({ general: errMsg(e) });
    } finally { setBusy(false); }
  }

  /** The requester forwards an admin-approved request to their reporting manager. */
  async function forward() {
    if (!live || busy || !cvData.raiseManager) return;
    setBusy(true);
    try {
      await cvData.raiseManager(live.id);
      toast.success(`Forwarded to ${approverName('manager')}`);
      await load(true);
    } catch (e) {
      if (e instanceof CvApiError) { if (e.status === 409 && e.data) { await load(true); toast.info(e.message); } else setErr({ general: e.message }); }
      else setErr({ general: errMsg(e) });
    } finally { setBusy(false); }
  }

  /** Dummy data only: the prototype's "act as" stands in for the waiting approver. */
  async function actAs(approve: boolean, who: string) {
    if (!live || busy || !cvData.decide) return;
    setBusy(true);
    try {
      await cvData.decide(live.id, approve);
      if (approve) toast.success(`${who} approved your request`); else toast.warning(`${who} rejected your request`);
      await load(true);
    } finally { setBusy(false); }
  }

  async function cancelReq() {
    if (!live || busy) return;
    setBusy(true);
    try {
      await cvData.cancel(live.id);
      toast.info('Request cancelled');
      await load(true);
    } catch (e) { toast.error('Could not cancel', errMsg(e)); } finally { setBusy(false); }
  }

  async function sendMailCode() {
    if (!d || mail.sending || mail.wait > 0) return;
    setMail(m => ({ ...m, sending: true }));
    setOtpErr('');
    try {
      // A Gmail-only lock has no approval step: the request is raised here, already approved.
      let reqId = live?.id;
      if (!reqId) { reqId = (await cvData.requestAccess(d.id, {})).data.id; await load(true); }
      autoSent.current = reqId;
      const r = await cvData.sendOtp(reqId);
      setMail({ sending: false, sentTo: r.data.sent_to, wait: r.data.resend_in, expiresIn: r.data.expires_in });
      toast.success(`Code sent to ${r.data.sent_to}`);
    } catch (e) {
      setMail(m => ({ ...m, sending: false }));
      setOtpErr(errMsg(e, 'Could not send the code.'));
    }
  }
  // Reaching the Gmail stage sends the first code once; Resend is there for another.
  useEffect(() => {
    if (cur !== 'otp' || !isMail || !live?.can.send_otp || autoSent.current === live.id) return;
    sendMailCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, isMail, live?.id, live?.can.send_otp]);

  async function verify() {
    if (!d || busy) return;
    const code = digits.join('');
    if (code.length !== 6) { setOtpErr(isMail ? 'Enter the 6-digit code from the email.' : 'Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true);
    setOtpErr('');
    try {
      // An authenticator-only lock has no approval step: the request is raised here, already approved.
      let reqId = live?.id;
      if (!reqId) reqId = (await cvData.requestAccess(d.id, {})).data.id;
      const r = await cvData.verifyOtp(reqId, code);
      toast.success(`${d.name} unlocked for ${r.data.duration_minutes} min`);
      relocked.current = false;
      setDigits(blank());
      await load(true);
    } catch (e) {
      if (e instanceof CvApiError && e.status === 423) {
        toast.warning('Too many wrong codes — request access again');
        setDigits(blank());
        await load(true);
      } else if (e instanceof CvApiError && e.status === 422) {
        setOtpErr(e.field('code') ?? e.message);
        setOtpBad(true);
        setTimeout(() => { setOtpBad(false); setDigits(blank()); }, 450);
        if (!live) await load(true);
      } else {
        setOtpErr(errMsg(e));
      }
    } finally { setBusy(false); }
  }

  async function lockNow() {
    if (!live || busy) return;
    setBusy(true);
    try {
      await cvData.lock(live.id);
      relocked.current = true;
      toast.warning(`${d?.name ?? 'Credential'} is locked again`);
      onChanged?.();
      onClose();
    } catch (e) { toast.error('Could not lock', errMsg(e)); setBusy(false); }
  }

  function fullDetails() {
    if (!d) return;
    // The parent swaps this modal for the details itself; closing as well would unmount a host drawer.
    if (onFullDetails) onFullDetails(d.id);
    else onClose();
  }

  async function toggleField(key: string) {
    if (!d) return;
    clearTimeout(hideTimers.current[key]);
    if (revealed[key] !== undefined) {
      setRevealed(r => { const n = { ...r }; delete n[key]; return n; });
      return;
    }
    try {
      const r = await cvData.reveal(d.id, 'reveal', key);
      setRevealed(x => ({ ...x, [key]: r.value }));
      clearTimeout(hideTimers.current[key]);
      hideTimers.current[key] = window.setTimeout(() => setRevealed(x => { const n = { ...x }; delete n[key]; return n; }), r.hide_after_seconds * 1000);
    } catch (e) {
      toast.error('Could not reveal', errMsg(e));
      if (e instanceof CvApiError && e.status === 423) load(true);
    }
  }

  async function copyField(key: string, secret: boolean, value: string | null) {
    if (!d) return;
    try {
      if (secret) {
        const r = await cvData.reveal(d.id, 'copy', key);
        await copyText(r.value, r.clear_clipboard_after);
      } else {
        await copyText(value ?? '');
        cvData.event(d.id, 'copy', key).catch(() => {});
      }
      toast.success('Copied to clipboard');
    } catch (e) {
      toast.error('Could not copy', errMsg(e));
      if (e instanceof CvApiError && e.status === 423) load(true);
    }
  }

  const go = (to: Stage | number) => {
    const vi = order.indexOf(view);
    const ni = typeof to === 'number' ? vi + to : order.indexOf(to);
    if (ni < 0 || ni > ci) return;
    setViewSel(order[ni]);
  };

  /* ── render pieces ── */
  const T = typeOf(d?.type);

  function header() {
    return (
      <div className="rv-top">
        <div className="rv-head">
          <span className="rv-head__ico"><Svg d={open ? CP_I.unlock : CP_I.lock} size={22} /></span>
          <div className="rv-head__t">
            <h3>{open ? 'Credential unlocked' : 'Unlock critical credential'}</h3>
            <p>{open ? 'Access is time-limited and every view is recorded.' : 'Complete every stage below to reveal this credential.'}</p>
          </div>
          <button type="button" className="cp-x" onClick={onClose} aria-label="Close"><Svg d={CP_I.x} size={14} /></button>
          {d && (
            <div className="rv-cred">
              <span className="rv-cred__ico"><Svg icon={T?.icon ?? 'lock'} size={17} /></span>
              <div className="rv-cred__t">
                <b>{d.name}</b>
                <span title={`Owner: ${d.owner.name ?? ''}`}>{d.critical_code ?? d.code} · {d.type_label}</span>
              </div>
              <span className={`znm-flag mv-rk mv-rk--${d.risk}`}><i />{d.risk === 'critical' ? 'Critical' : d.risk.charAt(0).toUpperCase() + d.risk.slice(1)}</span>
            </div>
          )}
        </div>
        {d && steps.length > 0 && (
          <div className="rv-steps" style={{ '--n': steps.length + 1 } as CSSProperties}>
            {steps.map((k, i) => {
              const st = stageStatus(k);
              let cls = st === 'done' ? 'is-done' : st === 'pend' ? 'is-pend' : st === 'bad' ? 'is-bad' : k === cur ? 'is-cur' : 'is-todo';
              const at = decidedAt(k);
              const sub = st === 'done' ? (k === 'otp' ? 'Verified' : `Approved · ${fmtTime(at)}`)
                : st === 'pend' ? 'Awaiting approval' : st === 'bad' ? 'Rejected' : k === cur ? metaOf(k)[2] : 'Locked';
              if (k === view) cls += ' is-view';
              const click = st === 'done' && k !== view;
              return (
                <div key={k} className={`rv-node ${cls}${click ? ' is-click' : ''}`}
                  onClick={click ? () => go(k) : undefined} title={click ? 'Go to this stage' : undefined} tabIndex={click ? 0 : undefined}
                  onKeyDown={click ? e => { if (e.key === 'Enter') go(k); } : undefined}>
                  <span className="rv-node__ico">{st === 'done' ? <Svg d={CP_I.check} size={15} /> : <Svg d={metaOf(k)[1]} size={16} />}</span>
                  <div className="rv-node__t"><em>Step {i + 1}</em><b>{metaOf(k)[0]}</b><span>{sub}</span></div>
                </div>
              );
            })}
            {(() => {
              const click = open && view !== 'done';
              return (
                <div className={`rv-node ${open ? 'is-done is-open' : 'is-todo'}${view === 'done' ? ' is-view' : ''}${click ? ' is-click' : ''}`}
                  onClick={click ? () => go('done') : undefined} title={click ? 'Go to reveal' : undefined} tabIndex={click ? 0 : undefined}>
                  <span className="rv-node__ico"><Svg d={open ? CP_I.unlock : CP_I.lock} size={16} /></span>
                  <div className="rv-node__t"><em>Final</em><b>Reveal</b><span>{open ? 'Unlocked' : 'Locked'}</span></div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  }

  function doneList() {
    if (open || past || !live) return null;
    const rows = steps.filter((k): k is 'admin' | 'manager' => k !== 'otp' && stageStatus(k) === 'done');
    if (!rows.length) return null;
    return (
      <div className="rv-oklist">
        {rows.map(k => (
          <div className="rv-ok-row" key={k}>
            <Svg d={CP_I.check} size={13} />
            <span><b>{k === 'admin' ? 'Vault Admin' : 'Manager'} {deciderName(k, live)}</b> approved at {fmtTime(decidedAt(k))}{k === 'admin' ? ` · ${live.duration_minutes} min window` : ''}</span>
          </div>
        ))}
      </div>
    );
  }

  function eyebrow(k: LockStep, role: string) { return `Stage ${steps.indexOf(k) + 1} · ${role}`; }

  function donePane(k: LockStep) {
    const role = k === 'admin' ? 'Vault Admin' : k === 'manager' ? 'Manager' : 'Authenticator';
    let body: ReactNode;
    if (k === 'otp') {
      body = <div className="rv-sum"><div><span>Authenticator</span><b>Code verified</b><em>Verified</em></div><div><span>Method</span><b>Time-based one-time code (6 digits)</b></div></div>;
    } else {
      const who = deciderName(k, live);
      body = (
        <>
          <Approver who={who} role={role} note={`Approved ${fmtTime(decidedAt(k))}`} />
          <div className="rv-sum">
            {k === 'admin' && <>
              <div className="rv-sum__w"><span>Your reason</span><b>{live?.reason ?? '—'}</b></div>
              <div><span>Access window</span><b>{live?.duration_minutes} minutes</b></div>
            </>}
            <div><span>Request ID</span><b>{live?.code ?? '—'}</b></div>
            <div><span>{role}</span><b>{who}</b><em>Approved</em></div>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="rv-hd"><span className="rv-eyebrow">{eyebrow(k, role)} · Completed</span><h4>{role} stage complete</h4><p>This stage is already done. Use Next to return to where you left off.</p></div>
        {body}
      </>
    );
  }

  function previousNote() {
    if (lastRejected) {
      const k = rejectedStage ?? 'admin';
      const note = k === 'admin' ? lastRejected.admin?.note : lastRejected.manager?.note;
      return (
        <div className="cp-note cp-note--bad"><Svg d={CP_I.x} size={13} />
          <span><b>{deciderName(k, lastRejected)}</b> rejected the previous request{note ? ` — ${note}` : ''}. You can send a new one.</span>
        </div>
      );
    }
    if (lastReset) {
      return <div className="cp-note cp-note--bad"><Svg d={CP_I.x} size={13} /><span>Too many wrong authenticator codes on {req?.code} — the approvals were reset. You can send a new request.</span></div>;
    }
    if (lastExpired) {
      return <div className="cp-note"><Svg d={CP_I.clock} size={13} /><span>Your last unlock window{req?.code ? ` (${req.code})` : ''} ended and the credential locked again. You can send a new request.</span></div>;
    }
    return null;
  }

  function reqCard(k: 'admin' | 'manager') {
    const who = approverName(k);
    const role = k === 'admin' ? 'Vault Admin' : 'Manager';
    const st = stageStatus(k);
    if (st !== 'pend') {
      const h = k === 'admin' ? 'Request access from the Vault Admin' : 'Request approval from your Manager';
      const sub = k === 'admin' ? 'Tell the Vault Admin why you need this credential and for how long. Every request is logged.'
        : steps.includes('admin') ? 'The Vault Admin has approved. Your manager must also approve before the authenticator step.'
          : `Your manager must approve before ${steps.includes('otp') ? 'the authenticator step' : 'this credential opens'}. Every request is logged.`;
      const durations = plan?.durations ?? [];
      return (
        <>
          <div className="rv-hd"><span className="rv-eyebrow">{eyebrow(k, role)}</span><h4>{h}</h4><p>{sub}</p></div>
          {previousNote()}
          <Approver who={who} role={role} note="Notified instantly" />
          {k === 'admin' ? (
            <div className="rv-card">
              <div className="rv-fld">
                <div className="rv-lbl"><span>Reason for access <i>*</i></span><em id="cpCnt">{reason.length} / 300</em></div>
                <textarea id="cpReason" className="cp-in" rows={3} maxLength={300} value={reason} autoFocus
                  onChange={e => { setReason(e.target.value); if (err.reason) setErr(x => ({ ...x, reason: undefined })); }}
                  placeholder="e.g. Need the bank portal login to complete the month-end tax payment" />
                {err.reason && <span className="cv-ferr">{err.reason}</span>}
              </div>
              <div className="rv-fld">
                <div className="rv-lbl"><span>How long do you need access?</span></div>
                <div className="rv-chips">
                  {durations.map(m => {
                    const [big, un] = durLabel(m);
                    return (
                      <button key={m} type="button" className={`rv-chip${m === dur ? ' is-on' : ''}`} data-m={m} onClick={() => setDur(m)}>
                        <b>{big}</b><span>{un}</span>
                      </button>
                    );
                  })}
                </div>
                {err.duration && <span className="cv-ferr">{err.duration}</span>}
              </div>
              <div className="cp-err" id="cpErr">{err.general ?? ''}</div>
            </div>
          ) : (
            <>
              {live?.admin && (
                <div className="rv-sum">
                  <div className="rv-sum__w"><span>Your reason</span><b>{live.reason ?? '—'}</b></div>
                  <div><span>Access window</span><b>{live.duration_minutes} minutes</b></div>
                  <div><span>Vault Admin</span><b>{deciderName('admin', live)}</b><em>Approved</em></div>
                </div>
              )}
              {err.general && <div className="cp-err">{err.general}</div>}
            </>
          )}
        </>
      );
    }
    return (
      <>
        <div className="rv-hd"><span className="rv-eyebrow">{eyebrow(k, role)}</span><h4>Waiting for {who}</h4><p>Your request is with the {role.toLowerCase()}. You can close this window — progress is saved.</p></div>
        <Approver who={who} role={role} note="Reviewing…" />
        <div className="rv-wait">
          <span className="cp-spin" />
          <div><b>Request {live?.code ?? ''} sent at {fmtTime(live?.created_at)}</b><em>{role} has been notified</em></div>
          <button type="button" className="rv-link" onClick={cancelReq} disabled={busy}>Cancel request</button>
        </div>
        {cvData.decide && (
          <div className="cp-sim">
            <div className="cp-sim__t">Prototype · Act as {who}</div>
            <p>In production the {role === 'Manager' ? 'manager' : 'vault admin'} approves from their own inbox. Use these buttons to simulate their decision.</p>
            <div className="cp-act">
              <button type="button" className="cp-btn cp-btn--bad" onClick={() => actAs(false, who)} disabled={busy}>Reject</button>
              <button type="button" className="cp-btn cp-btn--ok" onClick={() => actAs(true, who)} disabled={busy}><Svg d={CP_I.check} size={13} /> Approve</button>
            </div>
          </div>
        )}
      </>
    );
  }

  function otpPane() {
    const left3 = live?.otp?.attempts_left;
    if (isMail) {
      const to = mail.sentTo || live?.otp?.sent_to || plan?.otp_sent_to || 'the Gmail set for this credential';
      const sendLbl = mail.sending ? 'Sending…' : mail.wait > 0 ? `Resend in ${mail.wait}s` : mail.sentTo ? 'Resend code' : 'Send code';
      return (
        <>
          <div className="rv-hd">
            <span className="rv-eyebrow">{eyebrow('otp', 'Gmail')}</span>
            <h4>Verify with your Gmail</h4>
            <p>Kryptone emails a 6-digit code to <b>{to}</b>. Open the email from Kryptone and enter the code here.</p>
          </div>
          {!live && previousNote()}
          <div className="rv-otp is-one">
            <div className="rv-otp__one">
              <div className="cp-vcard">
                <div className="cp-vcard__hd">
                  <span className="cp-vcard__ico"><Svg d={CP_I.mail} size={16} /></span>
                  <div><b>Enter the code</b><span>{mail.sentTo ? `Sent to ${mail.sentTo}` : 'Press Send code to get one'}</span></div>
                </div>
                <OtpDigits value={digits} bad={otpBad} onChange={v => { setDigits(v); if (otpErr) setOtpErr(''); }} onEnter={verify} />
                <div className="cp-err cp-err--c" id="cpFormErr">{otpErr}</div>
                <button type="button" className="cp-btn cp-btn--ghost cp-btn--block" onClick={sendMailCode}
                  disabled={mail.sending || mail.wait > 0 || busy}>
                  <Svg d={CP_I.send} size={13} /> {sendLbl}
                </button>
                <div className="cp-vcard__ft">
                  <Svg d={CP_I.clock} size={11} />
                  {mail.expiresIn ? `The code works once and expires in ${Math.round(mail.expiresIn / 60)} min` : 'The code works once'}
                  {left3 !== undefined && left3 < 3 ? ` · ${left3} attempt${left3 === 1 ? '' : 's'} left` : ''}
                </div>
              </div>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="rv-hd">
          <span className="rv-eyebrow">{eyebrow('otp', 'Authenticator')}</span>
          <h4>Verify with your authenticator app</h4>
          <p>{setup
            ? 'Link your authenticator app once; it will then be used every time you unlock a critical credential.'
            : 'Open the authenticator app linked to this credential and enter the current code.'}</p>
        </div>
        {!live && previousNote()}
        <div className={`rv-otp${setup ? '' : ' is-one'}`}>
          {setup && (
            <div className="rv-otp__box rv-setup">
              <div className="cp-qrframe"><i /><i /><i /><i />
                <div className="cp-qrframe__in" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              </div>
              <b>Set up your authenticator (one time)</b>
              <span>Scan with Google or Microsoft Authenticator, then enter the code.</span>
              <code className="rv-setup__key" title="Setup key">{setup.secret_display}</code>
            </div>
          )}
          <div className={setup ? 'rv-otp__box rv-otp__code' : 'rv-otp__one'}>
          <div className="cp-vcard">
            <div className="cp-vcard__hd">
              <span className="cp-vcard__ico"><Svg d={CP_I.phone} size={16} /></span>
              <div><b>Enter your OTP</b><span>6-digit code from your authenticator app</span></div>
            </div>
            <OtpDigits value={digits} bad={otpBad} onChange={v => { setDigits(v); if (otpErr) setOtpErr(''); }} onEnter={verify} />
            <div className="cp-err cp-err--c" id="cpFormErr">{otpErr}</div>
            <div className="cp-vcard__ft"><Svg d={CP_I.clock} size={11} />Codes refresh every 30 seconds{left3 !== undefined && left3 < 3 ? ` · ${left3} attempt${left3 === 1 ? '' : 's'} left` : ''}</div>
          </div>
          </div>
        </div>
      </>
    );
  }

  function revealPane() {
    if (!d) return null;
    type Row = { key: string; label: string; value: string | null; secret: boolean };
    let rows: Row[] = (d.fields ?? []).filter(f => f.kind !== 'file' && f.has_value).map(f => ({ key: f.key, label: f.label, value: f.value, secret: f.masked }));
    if (!rows.length) {
      rows = [
        ...(d.url ? [{ key: 'url', label: 'Website / Host', value: d.url, secret: false }] : []),
        ...(d.username ? [{ key: 'username', label: 'Username', value: d.username, secret: false }] : []),
      ];
    }
    const by: string[] = [];
    if (live?.admin) by.push(`Vault Admin ${deciderName('admin', live)}`);
    if (live?.manager) by.push(`Manager ${deciderName('manager', live)}`);
    if (live?.otp) by.push('2FA verified');
    return (
      <>
        <div className="rv-grant">
          <div className="rv-grant__t"><b>Access granted</b><span>{by.join(' · ')}</span></div>
          <div className="rv-timer">
            <svg width="54" height="54" viewBox="0 0 54 54">
              <circle cx="27" cy="27" r="23" className="rv-timer__bg" />
              <circle cx="27" cy="27" r="23" className="rv-timer__fg" id="rvRing" strokeDasharray={RING} strokeDashoffset={RING * (1 - left / total)} />
            </svg>
            <div><b id="rvTime">{mmss(left)}</b><span>until auto-lock</span></div>
          </div>
        </div>
        <div className="rv-fields">
          {rows.length ? rows.map(x => {
            const val = revealed[x.key];
            return (
              <div className="rv-f" key={x.key}>
                <span className="rv-f__l">{x.label}</span>
                <span className={`rv-f__v${x.secret ? ' is-sec' : ''}${val !== undefined ? ' is-shown' : ''}`}>{x.secret ? (val ?? MASK) : x.value}</span>
                <div className="rv-f__a">
                  {x.secret && <button type="button" className="rv-ib" title="Show / hide" onClick={() => toggleField(x.key)}><Svg d={IC.view} size={14} /></button>}
                  <button type="button" className="rv-ib" title="Copy" onClick={() => copyField(x.key, x.secret, x.value)}><Svg d={IC.copy} size={14} /></button>
                </div>
              </div>
            );
          }) : <div className="rv-empty">No fields stored on this credential.</div>}
        </div>
      </>
    );
  }

  function pane() {
    if (past && view !== 'done') return donePane(view as LockStep);
    if (open && view === 'done') return revealPane();
    if (cur === 'admin' || cur === 'manager') return reqCard(cur);
    if (cur === 'otp') return otpPane();
    return null;
  }

  function nav() {
    const vi = order.indexOf(view);
    return (
      <>
        <button type="button" className="cp-btn cp-btn--ghost cp-nav" onClick={() => go(-1)} disabled={vi <= 0}><Svg d={CP_I.prev} size={13} /> Previous</button>
        <button type="button" className="cp-btn cp-btn--ghost cp-nav" onClick={() => go(1)} disabled={vi >= ci}
          title={vi >= ci ? 'Complete this stage to continue' : undefined}>Next <Svg d={CP_I.next} size={13} /></button>
      </>
    );
  }

  function foot() {
    if (open && view === 'done') {
      return (
        <>
          <div className="rv-foot__l">
            <span className="rv-fico rv-fico--ok"><Svg d={CP_I.check} size={15} /></span>
            <div className="rv-foot__t"><b>All stages complete</b><span>Auto-locks when the timer ends · every view is logged</span></div>
          </div>
          <div className="rv-foot__r">
            {nav()}
            <button type="button" className="cp-btn cp-btn--ghost" onClick={fullDetails}><Svg d={IC.view} size={13} /> Full details</button>
            <button type="button" className="cp-btn cp-btn--bad" onClick={lockNow} disabled={busy}><Svg d={CP_I.lock} size={13} /> Lock now</button>
          </div>
        </>
      );
    }
    const n = steps.length;
    const idx = cur === 'done' ? n : steps.indexOf(cur as LockStep);
    let vidx = steps.indexOf(view as LockStep);
    if (vidx < 0) vidx = Math.max(0, idx);
    const vk = steps[vidx];
    let prim: ReactNode = null;
    if (!past && cur !== 'done') {
      if (cur === 'otp') {
        prim = <button type="button" className="cp-btn cp-btn--pri" onClick={verify} disabled={busy}><Svg d={CP_I.lock} size={13} /> {busy ? 'Verifying…' : 'Verify & reveal'}</button>;
      } else if (cur === 'manager' && unlock.needs_forward) {
        prim = <button type="button" className="cp-btn cp-btn--pri" onClick={forward} disabled={busy}><Svg d={CP_I.send} size={13} /> {busy ? 'Sending…' : `Send to ${approverName('manager')}`}</button>;
      } else if (stageStatus(cur) === 'pend') {
        prim = <button type="button" className="cp-btn cp-btn--pri is-wait" disabled><span className="cp-spin cp-spin--sm" /> Waiting for {approverName(cur)}…</button>;
      } else {
        prim = <button type="button" className="cp-btn cp-btn--pri" onClick={() => send(cur)} disabled={busy}><Svg d={CP_I.send} size={13} /> {busy ? 'Sending…' : `Send request to ${approverName(cur)}`}</button>;
      }
    }
    return (
      <>
        <div className="rv-foot__l">
          <div className="rv-dots">
            {steps.map((k, i) => <i key={k} className={`${i < idx ? 'is-done' : i === idx ? 'is-cur' : ''}${i === vidx && past ? ' is-view' : ''}`} />)}
          </div>
          <div className="rv-foot__t"><b>Stage {vidx + 1} of {n}</b><span>{vk ? (vk === 'otp' && isMail ? 'Gmail code' : FOOT_NAMES[vk]) : ''}{past ? ' · completed' : ''}</span></div>
        </div>
        <div className="rv-foot__r">{nav()}{prim}</div>
      </>
    );
  }

  /* ── the dialog ── */
  let body: ReactNode;
  if (loadErr && !d) {
    body = (
      <div className="rv-body"><div className="rv-pane">
        <div className="cp-note cp-note--bad"><Svg d={CP_I.x} size={13} /><span>{loadErr}</span></div>
        <div className="cp-act" style={{ marginTop: 12 }}><button type="button" className="cp-btn cp-btn--ghost" onClick={() => load()}>Try again</button></div>
      </div></div>
    );
  } else if (!d) {
    body = <UnlockSkeleton />;
  } else if (!steps.length) {
    body = (
      <div className="rv-body"><div className="rv-pane">
        <div className="cp-note"><Svg d={CP_I.check} size={13} /><span>This credential has no unlock steps — open it directly.</span></div>
        {onFullDetails && <div className="cp-act" style={{ marginTop: 12 }}><button type="button" className="cp-btn cp-btn--pri" onClick={fullDetails}><Svg d={IC.view} size={13} /> Full details</button></div>}
      </div></div>
    );
  } else {
    body = (
      <>
        <div className="rv-body"><div className="rv-pane">{doneList()}{pane()}</div></div>
        <div className="rv-foot">{foot()}</div>
      </>
    );
  }

  return (
    <CvPortal onClose={onClose}>
      <div className={`cp-ov${shown ? ' is-open' : ''}`}>
        <div className="cp-scrim" />
        <div className={`cp-box rv-box${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Unlock critical credential" id="cpBox">
          {header()}
          {body}
        </div>
      </div>
    </CvPortal>
  );
}
