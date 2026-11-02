import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type AuditEvent, type CredentialDetail, type DetailField, type PageMeta } from '../cvApi';
import UnlockModal from '../critical/UnlockModal';
import { bytes, cap, copyText, CvPortal, errMsg, fmtDay, fmtTime, Svg, useCvMeta } from '../shared';
import BinConfirm from './BinConfirm';

/**
 * CredVault · View Credential right drawer — Overview / Details / Access /
 * Activity, header actions (Launch, Reveal, Copy, Share, Bin). A locked
 * (protected) credential opens the unlock modal instead.
 */
export interface ViewDrawerProps {
  credentialId: number;
  onClose: () => void;
  onChanged?: () => void;                 // something changed — refresh the list
  onEdit?: (id: number) => void;
  onShare?: (id: number) => void;
}

type Tab = 'overview' | 'details' | 'access' | 'activity';

const I = {
  launch: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  bin: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  shieldOk: 'M9 12l2 2 4-4M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eyeOff: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22',
};
/** Timeline icon for an audit action. */
const ACT_ICO: Record<string, string> = {
  view: 'eye', reveal: 'eye', copy: 'copy', launch: I.launch, share: 'share', revoke: 'share',
  create: 'plus', update: I.edit, edit: I.edit, bin: I.bin, restore: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
  request: 'lock', approve: 'check', reject: 'x', unlock: 'lock', lock: 'lock',
};
const VIA_LABEL: Record<string, string> = {
  owner: 'Owner · Full control', admin: 'Admin · Team access', hod: 'HOD · Team access', team: 'Team access', share: 'Shared access',
};

const dt = (iso?: string | null) => (iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : '—');
const mask = (n = 10, max = 14) => '•'.repeat(Math.min(max, n));
const fileKind = (n: string) => {
  const e = (n.split('.').pop() || '').toLowerCase();
  return /^(png|jpe?g|gif|webp)$/.test(e) ? 'img' : e === 'pdf' ? 'pdf' : /^(xlsx?|csv)$/.test(e) ? 'xls' : 'doc';
};
/** A launchable website, as the prototype's check: a URL or a bare domain, no spaces or wildcards. */
const launchUrl = (u?: string | null) =>
  u && /^(https?:\/\/|[\w-]+(\.[\w-]+)+(\/|$))/i.test(u) && !/\s/.test(u) && !u.includes('*') ? (/^https?:/i.test(u) ? u : `https://${u}`) : '';

function Badge({ cls, children, dot }: { cls: string; children: ReactNode; dot?: boolean }) {
  return <span className={`vd-b vd-b--${cls}`}>{dot && <i />}{children}</span>;
}

export default function ViewDrawer({ credentialId, onClose, onChanged, onEdit, onShare }: ViewDrawerProps) {
  const toast = useToast();
  const { typeOf, meta } = useCvMeta();
  const [d, setD] = useState<CredentialDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [shown, setShown] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [acts, setActs] = useState<{ rows: AuditEvent[]; meta: PageMeta | null; loading: boolean }>({ rows: [], meta: null, loading: true });
  const [binAsk, setBinAsk] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const viewed = useRef(false);
  const actSeq = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A refresh (page 1) supersedes any page still in flight, so "Load more" can't append onto fresh rows.
  const loadActivity = useCallback(async (page = 1) => {
    const seq = ++actSeq.current;
    setActs(a => ({ ...a, loading: true }));
    try {
      const r = await cvApi.activity(credentialId, page);
      if (seq !== actSeq.current) return;
      setActs(a => ({ rows: page === 1 ? r.data : [...a.rows, ...r.data], meta: r.meta, loading: false }));
    } catch {
      if (seq === actSeq.current) setActs(a => ({ ...a, loading: false }));
    }
  }, [credentialId]);

  const load = useCallback(async () => {
    try {
      const c = await cvApi.show(credentialId);
      setD(c);
      setFailed(null);
      if (!c.locked) {
        if (!viewed.current) { viewed.current = true; cvApi.event(credentialId, 'view').catch(() => {}); }
        loadActivity(1);
      }
    } catch (e) {
      setFailed(errMsg(e));
    }
  }, [credentialId, loadActivity]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); clearTimeout(closeTimer.current); };
  }, []);
  // Slide in once there is something to show.
  useEffect(() => {
    if (!d || d.locked) return;
    const f = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(f);
  }, [d]);

  const close = useCallback(() => {
    setOpen(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 260);
  }, [onClose]);

  if (failed) {
    return (
      <CvPortal onClose={onClose}>
        <div className="vd-ov is-open">
          <div className="vd-scrim" onClick={onClose} />
          <aside className="vd" role="dialog" aria-label="Credential">
            <div className="vd-body"><div className="vd-pane">
              <div className="vd-empty"><Svg icon="lock" size={20} /><b>Could not open this credential</b><span>{failed}</span>
                <button type="button" data-h40="skip" className="vd-btn" onClick={onClose}>Close</button></div>
            </div></div>
          </aside>
        </div>
      </CvPortal>
    );
  }
  if (!d) {
    return (
      <CvPortal onClose={onClose}>
        <div className="vd-ov is-open">
          <div className="vd-scrim" onClick={onClose} />
          <aside className="vd" role="dialog" aria-label="Loading credential">
            <div className="vd-body"><div className="vd-pane"><table style={{ width: '100%' }}><tbody>
              {Array.from({ length: 8 }, (_, i) => <tr key={i} className="cv-shimrow"><td><i style={{ width: `${50 + (i * 11) % 45}%` }} /></td></tr>)}
            </tbody></table></div></div>
          </aside>
        </div>
      </CvPortal>
    );
  }
  if (d.locked) {
    return <UnlockModal credentialId={credentialId} onClose={onClose} onChanged={onChanged} onFullDetails={() => { setD(null); load(); }} />;
  }

  const T = typeOf(d.type);
  const crit = d.risk === 'critical';
  const can = d.can;
  const fields = d.fields ?? [];
  const secF: DetailField | undefined = fields.find(f => f.key === T?.sec && f.masked) ?? fields.find(f => f.masked);
  const hasSec = !!secF?.has_value;
  const url = launchUrl(d.url);
  const shared = d.access?.via === 'share';
  const vault = shared ? 'Shared with you' : d.scope === 'team' ? 'Team vault' : 'Personal vault';
  const detF = fields.filter(f => f.has_value);
  const shares = d.shares ?? [];
  const extras = T?.extras;
  const hasXt = !!extras && (extras.reg_email || extras.reg_phone || extras.recovery_key || extras.attachments);
  const permLabel = meta?.permissions.find(p => p.key === d.access?.permission)?.label ?? cap(d.access?.permission);

  /* ── reveal & copy ── */
  const hideLater = (key: string, secs: number) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setShown(s => { const n = { ...s }; delete n[key]; return n; }), secs * 1000);
  };
  const lockedErr = (e: unknown) => {
    if (e instanceof CvApiError && e.status === 423) { setD(null); load(); }
    toast.error('Not allowed', errMsg(e));
  };
  const reveal = async (key: string) => {
    if (shown[key] !== undefined) { setShown(s => { const n = { ...s }; delete n[key]; return n; }); clearTimeout(timers.current[key]); return; }
    try {
      const r = await cvApi.reveal(d.id, 'reveal', key);
      setShown(s => ({ ...s, [key]: r.value }));
      hideLater(key, r.hide_after_seconds || 30);
      loadActivity(1);
    } catch (e) { lockedErr(e); }
  };
  const copySecret = async (key: string) => {
    try {
      const r = await cvApi.reveal(d.id, 'copy', key);
      await copyText(r.value, r.clear_clipboard_after);
      toast.success('Copied to clipboard', r.clear_clipboard_after ? `${r.label} · clears in ${r.clear_clipboard_after}s` : r.label);
      loadActivity(1);
    } catch (e) { lockedErr(e); }
  };
  /** A plain value; `field` logs it as "Field copied" when it is one of the credential's fields. */
  const copyPlain = async (value: string, field?: string) => {
    try {
      await copyText(value);
      toast.success('Copied to clipboard');
      if (field) cvApi.event(d.id, 'copy', field).then(() => loadActivity(1)).catch(() => {});
    } catch { toast.error('Could not copy', 'Your browser blocked clipboard access.'); }
  };
  const download = async (key: string) => {
    try { await cvApi.attachment(d.id, key); loadActivity(1); } catch (e) { toast.error('Could not open the file', errMsg(e)); }
  };

  const copyBtn = (fn: () => void) => <button type="button" data-h40="skip" className="vd-ic" title="Copy" onClick={fn}><Svg icon="copy" size={13} /></button>;
  const revealBtn = (key: string, allowed: boolean) => (
    <button type="button" data-h40="skip" className={`vd-ic${shown[key] !== undefined ? ' is-on' : ''}`} disabled={!allowed}
      title={allowed ? (shown[key] !== undefined ? 'Hide' : crit ? 'Reveal (logged)' : 'Reveal') : 'Your access is Use Only'} onClick={() => reveal(key)}>
      <Svg icon={shown[key] !== undefined ? I.eyeOff : 'eye'} size={13} />
    </button>
  );
  const kv = (label: string, value: ReactNode, actions?: ReactNode) => (
    <div className="vd-kv" key={label}>
      <span className="vd-kv__l">{label}</span>
      <span className="vd-kv__v">{value === '' || value == null ? <i className="vd-dash">Not added</i> : value}{value !== '' && value != null && actions}</span>
    </div>
  );

  /** One type field's value cell, for the Details tab. */
  const fieldValue = (f: DetailField) => {
    if (f.masked) {
      return (
        <>
          <b className="vd-mask">{shown[f.key] ?? mask(12)}</b>
          {revealBtn(f.key, !!can?.reveal)}
          {can?.copy && copyBtn(() => copySecret(f.key))}
        </>
      );
    }
    const v = f.value ?? '';
    if (f.kind === 'file') {
      return (
        <>
          <b>{v}</b>
          {f.attachment_key && <button type="button" data-h40="skip" className="vd-ic" title="Open" onClick={() => download(f.attachment_key!)}><Svg icon="eye" size={13} /></button>}
        </>
      );
    }
    const link = f.kind === 'url' ? launchUrl(v) : '';
    return (
      <>
        {link ? <a className="vd-a" href={link} target="_blank" rel="noopener noreferrer">{v}</a>
          : <b className={f.kind === 'textarea' ? 'vd-multi' : ''} style={f.kind === 'textarea' ? { whiteSpace: 'pre-line' } : undefined}>
            {f.kind === 'date' && /^\d{4}-\d\d-\d\d$/.test(v) ? fmtDay(`${v}T00:00:00`) : v}
          </b>}
        {copyBtn(() => copyPlain(v, f.key))}
      </>
    );
  };

  /* ── header ── */
  const hdr = (
    <div className="vd-hd">
      <div className="vd-hd__bg" />
      <div className="vd-hd__top">
        <span className="vd-hd__ico"><Svg icon={T?.icon ?? 'lock'} size={24} /></span>
        <div className="vd-hd__t">
          <h3>{d.name}</h3>
          <span>{url ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => cvApi.event(d.id, 'launch').catch(() => {})}>{d.url}</a> : `${d.type_label} · ${d.category_group}`}</span>
          <div className="vd-chips">
            <Badge cls="glass">{d.code}</Badge>
            <Badge cls="glass">{d.type_label}</Badge>
            <Badge cls={`glass vd-b--g-${d.risk}`} dot>{cap(d.risk)} risk</Badge>
            <Badge cls="glass">{vault}</Badge>
          </div>
        </div>
        <button type="button" data-h40="skip" className="vd-x" onClick={close} aria-label="Close"><Svg icon="x" size={14} sw={2.6} /></button>
      </div>
      <div className="vd-acts">
        {url && (
          <a className="vd-btn vd-btn--p" href={url} target="_blank" rel="noopener noreferrer"
            onClick={() => cvApi.event(d.id, 'launch').then(() => loadActivity(1)).catch(() => {})}>
            <Svg icon={I.launch} size={14} />Launch
          </a>
        )}
        {hasSec && secF && (
          <>
            <button type="button" data-h40="skip" className="vd-btn" disabled={!can?.reveal} title={can?.reveal ? undefined : 'Your access is Use Only'}
              onClick={() => { setTab('overview'); reveal(secF.key); }}>
              <Svg icon={shown[secF.key] !== undefined ? I.eyeOff : 'eye'} size={14} /><span>{shown[secF.key] !== undefined ? 'Hide' : 'Reveal'}</span>
            </button>
            <button type="button" data-h40="skip" className="vd-btn" disabled={!can?.copy} title={can?.copy ? undefined : 'Your access does not allow copying'} onClick={() => copySecret(secF.key)}>
              <Svg icon="copy" size={14} />Copy {secF.label}
            </button>
          </>
        )}
        {can?.share && onShare && (
          <button type="button" data-h40="skip" className="vd-btn" onClick={() => onShare(d.id)}><Svg icon="share" size={14} />Share</button>
        )}
        {(can?.delete || can?.remove) && (
          <button type="button" data-h40="skip" className="vd-btn vd-btn--del" title={can?.remove ? 'Remove from your vault' : 'Move to Bin'} onClick={() => setBinAsk(true)}>
            <Svg icon={I.bin} size={14} />
          </button>
        )}
      </div>
    </div>
  );

  const tabs: [Tab, string, string, number | null][] = [
    ['overview', 'Overview', I.grid, null],
    ['details', `${d.type_label} Details`, T?.icon ?? 'lock', detF.length],
    ['access', 'Access', 'share', 1 + shares.length],
    ['activity', 'Activity', I.clock, acts.meta?.total ?? null],
  ];

  /* ── panes ── */
  let body: ReactNode;
  if (tab === 'overview') {
    const pct = d.strength_pct;
    const lv = ['', 'weak', 'fair', 'good', 'strong'][d.strength] || 'weak';
    const due = d.next_rotation_due;
    const left = due ? Math.ceil((new Date(due).getTime() - Date.now()) / 864e5) : 0;
    const plain = fields.filter(f => !f.masked && f.kind !== 'file' && f.value && (f.value === d.url || f.value === d.username));
    body = (
      <>
        {hasSec && secF && (
          <>
            <div className={`vd-secret${crit ? ' is-crit' : ''}`}>
              <span className="vd-secret__ico"><Svg icon="key" size={16} /></span>
              <div className="vd-secret__t"><small>{secF.label}</small><b className={shown[secF.key] !== undefined ? 'is-shown' : ''}>{shown[secF.key] ?? mask(18, 18)}</b></div>
              {revealBtn(secF.key, !!can?.reveal)}
              {can?.copy && copyBtn(() => copySecret(secF.key))}
            </div>
            {crit && <div className="vd-note"><Svg icon="shield" size={12} />Critical credential — handle with care. Reveals and copies are recorded in Activity.</div>}
          </>
        )}
        <div className="vd-kvs">
          {kv('Credential ID', <Badge cls="teal">{d.code}</Badge>)}
          {kv('Type', d.type_label)}
          {kv('Category', d.category_group)}
          {plain.map(f => kv(f.label,
            f.kind === 'url' && url ? <a className="vd-a" href={url} target="_blank" rel="noopener noreferrer">{f.value}</a> : <b>{f.value}</b>,
            copyBtn(() => copyPlain(f.value!, f.key))))}
          {kv('Vault', <Badge cls="teal">{vault}</Badge>)}
          {kv('Owner', (
            <span className="vd-own">
              <span className="mv-ownc__av">{d.owner.initials}</span>
              <span><b>{d.owner.is_me ? 'You' : d.owner.name}</b><small>{shared ? 'Shared this credential with you' : 'Credential owner'}</small></span>
            </span>
          ))}
          {kv('Your access', <Badge cls="teal">{d.access?.via === 'share' ? `${VIA_LABEL.share} · ${permLabel}` : VIA_LABEL[d.access?.via ?? 'owner'] ?? 'Access'}</Badge>)}
          {kv('Risk level', <Badge cls={d.risk} dot>{cap(d.risk)}</Badge>)}
          {d.has_password && kv('Password strength', (
            <div className={`mv-sg mv-sg--${lv} vd-sg`}>
              <div className="mv-sg__top"><span className="mv-sg__lbl"><i />{d.strength_label}</span><span className="mv-sg__sc">{pct}<small>/100</small></span></div>
              <div className="mv-sg__track"><span className="mv-sg__fill" style={{ width: `${pct}%` }} /><span className="mv-sg__knob" style={{ left: `${pct}%` }} /></div>
            </div>
          ))}
          {d.twofa !== 'na' && kv('Two-factor (2FA)', d.twofa === 'yes' ? <Badge cls="ok" dot>Enabled</Badge> : <Badge cls="off" dot>Disabled</Badge>)}
          {d.has_password && kv('Password rotation', d.rotation_days ? <b>Every {d.rotation_days} days</b> : <Badge cls="off">Not set</Badge>)}
          {due && kv('Next rotation due', (
            <>
              <b>{fmtDay(due)}</b>
              {left < 0 ? <Badge cls="critical" dot>Overdue by {-left} days</Badge> : <Badge cls={left <= 15 ? 'medium' : 'ok'} dot>in {left} days</Badge>}
            </>
          ))}
          {kv('Last updated', <><b>{dt(d.updated_at)}</b><small className="vd-sub">by {d.updated_by ?? d.owner.name ?? '—'}</small></>)}
          {kv('Notes', d.notes ? <span style={{ whiteSpace: 'pre-line' }}>{d.notes}</span> : '')}
        </div>
      </>
    );
  } else if (tab === 'details') {
    const rec = d.recovery;
    const att = d.attachments ?? [];
    body = (
      <>
        {detF.length ? (
          <div className="vd-kvs">
            {detF.map(f => <div className="vd-kv" key={f.key}><span className="vd-kv__l">{f.label}</span><span className="vd-kv__v">{fieldValue(f)}</span></div>)}
          </div>
        ) : (
          <div className="vd-empty"><Svg icon={T?.icon ?? 'lock'} size={20} /><b>No details added</b><span>Edit this credential to add {d.type_label} details.</span></div>
        )}
        {hasXt && (
          <div className="vd-xt">
            <div className="vd-xt__hd"><Svg icon={I.shieldOk} size={13} /><b>Recovery &amp; Proof</b></div>
            <div className="vd-kvs">
              {extras?.reg_email && kv('Registered email', rec?.reg_email ? <b>{rec.reg_email}</b> : '', copyBtn(() => copyPlain(rec!.reg_email!, 'reg_email')))}
              {extras?.reg_phone && kv('Registered phone', rec?.reg_phone ? <b>{rec.reg_phone}</b> : '', copyBtn(() => copyPlain(rec!.reg_phone!, 'reg_phone')))}
              {extras?.recovery_key && kv('Secret / recovery key', rec?.has_recovery_key ? <b className="vd-mask">{shown.recovery_key ?? mask(14)}</b> : '', (
                <>{revealBtn('recovery_key', !!can?.reveal)}{can?.copy && copyBtn(() => copySecret('recovery_key'))}</>
              ))}
            </div>
            {extras?.attachments && (
              <div className="vd-xt__att">
                <small>Attachments · {att.length}</small>
                {att.length ? att.map(f => {
                  const k = fileKind(f.name);
                  return (
                    <div key={f.key} className={`crd-att__f crd-att__f--${k}`}>
                      <span className="crd-att__fi">{k.toUpperCase()}</span>
                      <div><b title={f.name}>{f.name}</b><small>{bytes(f.size)}{f.at ? ` · ${fmtDay(f.at)}` : ''}</small></div>
                      <button type="button" data-h40="skip" className="crd-att__b" title="Open" onClick={() => download(f.key)}><Svg icon="eye" size={13} /></button>
                    </div>
                  );
                }) : <i className="vd-dash">No files attached — edit the credential to add proof</i>}
              </div>
            )}
          </div>
        )}
      </>
    );
  } else if (tab === 'access') {
    body = (
      <>
        <div className="vd-person is-owner">
          <span className="mv-ownc__av">{d.owner.initials}</span>
          <div><b>{d.owner.is_me ? `${d.owner.name ?? 'You'} (You)` : d.owner.name}</b><small>Credential owner</small></div>
          <Badge cls="teal">Owner · Full control</Badge>
        </div>
        {shared && !d.shares && (
          <div className="vd-person">
            <span className="mv-ownc__av">{meta ? meta.me.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() : 'Y'}</span>
            <div><b>You</b><small>Shared with you by {d.owner.name}</small></div>
            <Badge cls="teal">{permLabel}</Badge>
          </div>
        )}
        {shares.length ? shares.map(s => (
          <div className="vd-person" key={s.id}>
            <span className="mv-ownc__av">{s.recipient.type === 'team' ? <Svg icon="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 0 0 .01" size={13} /> : s.recipient.initials}</span>
            <div><b>{s.recipient.name}</b><small>{s.expires_at ? `Until ${fmtDay(s.expires_at)}` : 'No expiry'}{s.reason ? ` · ${s.reason}` : ''}</small></div>
            <Badge cls="teal">{s.permission_label}</Badge>
          </div>
        )) : !shared && (
          <div className="vd-empty">
            <Svg icon="share" size={20} /><b>Not shared yet</b><span>Only the owner has access to this credential.</span>
            {can?.share && onShare && <button type="button" data-h40="skip" className="vd-btn vd-btn--p" onClick={() => onShare(d.id)}><Svg icon="share" size={13} />Share credential</button>}
          </div>
        )}
      </>
    );
  } else {
    body = acts.loading && !acts.rows.length ? (
      <table style={{ width: '100%' }}><tbody>{Array.from({ length: 5 }, (_, i) => <tr key={i} className="cv-shimrow"><td><i style={{ width: `${45 + i * 9}%` }} /></td></tr>)}</tbody></table>
    ) : acts.rows.length ? (
      <>
        <div className="vd-tl">
          {acts.rows.map(a => (
            <div className="vd-tl__i" key={a.id}>
              <span className="vd-tl__dot"><Svg icon={ACT_ICO[a.action] ?? I.clock} size={12} /></span>
              <div><b>{a.detail || a.label}</b><small>{a.actor.is_me ? 'You' : a.actor.name} · {dt(a.at)}</small></div>
            </div>
          ))}
        </div>
        {acts.meta && acts.meta.current_page < acts.meta.last_page && (
          <button type="button" data-h40="skip" className="vd-btn" style={{ marginTop: 10 }} disabled={acts.loading} onClick={() => loadActivity(acts.meta!.current_page + 1)}>
            {acts.loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    ) : (
      <div className="vd-empty"><Svg icon={I.clock} size={20} /><b>No activity yet</b><span>Views, reveals, copies and changes appear here.</span></div>
    );
  }

  return (
    <>
      <CvPortal onClose={binAsk ? undefined : close}>
        <div className={`vd-ov${open ? ' is-open' : ''}`}>
          <div className="vd-scrim" onClick={close} />
          <aside className="vd" role="dialog" aria-label={d.name}>
            <>
              {hdr}
              <div className="vd-body">
                <div className="smt-proctype-tabs vd-ptabs">
                  {tabs.map(([k, l, ico, n]) => (
                    <button key={k} type="button" data-h40="skip" className={`smt-proctype-tab${tab === k ? ' is-active' : ''}`} data-pt="svc-phys" onClick={() => setTab(k)}>
                      <span className="smt-proctype-tab__ico"><Svg icon={ico} size={13} /></span>
                      <span className="smt-proctype-tab__lbl">{l}</span>
                      {n != null && <span className="bst-tab-c parch-main-c">{n}</span>}
                    </button>
                  ))}
                </div>
                <div className="vd-pane">{body}</div>
              </div>
              <div className="vd-ft">
                <span className="vd-ft__i"><Svg icon="shield" size={14} /><span><b>{d.code}</b><small>Updated {dt(d.updated_at)}</small></span></span>
                <div className="vd-ft__a">
                  <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost vd-fb" data-h40="skip" onClick={close}>Close</button>
                  {can?.edit && onEdit && (
                    <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary vd-fb" data-h40="skip" onClick={() => onEdit(d.id)}>
                      <Svg icon={I.edit} size={13} />Edit Credential
                    </button>
                  )}
                </div>
              </div>
            </>
          </aside>
        </div>
      </CvPortal>
      {binAsk && (
        <BinConfirm row={d} onClose={() => setBinAsk(false)} onDone={() => { setBinAsk(false); onChanged?.(); onClose(); }} />
      )}
    </>
  );
}
