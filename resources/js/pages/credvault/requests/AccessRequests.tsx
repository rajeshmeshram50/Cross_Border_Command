import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, CV_ROUTES, type AccessRequestRow, type PageMeta } from '../cvApi';
import {
  ConfirmModal, CvBrief, CvCard, CvPage, CvPager, CvStrip, CvTabsRow, EmptyRow, ShimRows, StripBtn, Svg,
  errMsg, fmtDate, fmtTime, mmss, useCvMeta, useDebounced, useNow, type CvTab,
} from '../shared';
import './requests.css';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault · Access Request Management — requests to unlock critical
 * credentials, each approved by the Vault Admin and then the requester's
 * Reporting Manager (prototype: accessRequestsBody / arListHtml / arReject).
 * ───────────────────────────────────────────────────────────────────────── */

const I = {
  all: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  pending: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  approved: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  rejected: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  toMe: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  mine: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  req: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  mgr: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
  vault: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  ok: '<polyline points="20 6 9 17 4 12"/>',
  no: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  rejectHd: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9l-6 6M9 9l6 6"/>',
  shieldO: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

const TABS: { key: string; label: string; icon: string; empty: string }[] = [
  { key: 'all', label: 'All Requests', icon: I.all, empty: 'No access requests yet' },
  { key: 'pending', label: 'Pending Requests', icon: I.pending, empty: 'No pending requests' },
  { key: 'approved', label: 'Approved Requests', icon: I.approved, empty: 'No approved requests' },
  { key: 'rejected', label: 'Rejected Requests', icon: I.rejected, empty: 'No rejected requests' },
  { key: 'to_me', label: 'Awaiting My Approval', icon: I.toMe, empty: 'Nothing is waiting for you' },
  { key: 'mine', label: 'My Requests', icon: I.mine, empty: 'You have not raised any requests' },
];

const COLS = ['Sr. No', 'Request ID', 'Credential', 'Requested By', 'Reason', 'Access Window', 'Vault Admin', 'Reporting Manager', 'Status', 'Action'];
const PER_PAGE = 10;
const POLL_MS = 30_000;

type Stage = NonNullable<AccessRequestRow['admin']> | NonNullable<AccessRequestRow['manager']>;

const credSub = (x: AccessRequestRow) => {
  const c = x.credential;
  if (!c) return '';
  return [c.critical_code ?? c.code, c.type_label, c.in_bin ? 'In Recycle Bin' : ''].filter(Boolean).join(' · ');
};
const roleLine = (x: AccessRequestRow) =>
  x.requester.role_line ?? [x.requester.designation, x.requester.department].filter(Boolean).join(' · ');

/** One approver cell (the prototype's arAppr). */
function Approver({ st, role, waitTxt, anyName }: { st: Stage | null; role: string; waitTxt: string; anyName: string }) {
  const s = st?.status;
  if (!st || (s !== 'pending' && s !== 'approved' && s !== 'rejected')) {
    return (
      <div className="ar-ap ar-ap--wait">
        <span className="ar-ap__av"><Svg d={I.clock} size={11} sw={2.1} /></span>
        <div><b>{role}</b><em>{waitTxt}</em></div>
      </div>
    );
  }
  const who = st.decided_by?.name ?? st.user?.name ?? anyName;
  const lbl = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[s];
  const at = st.decided_at ? fmtTime(st.decided_at) : '';
  return (
    <div className={`ar-ap ar-ap--${s}`} title={s === 'rejected' && st.note ? `Reason: ${st.note}` : undefined}>
      <span className="ar-ap__av">{st.decided_by?.initials ?? st.user?.initials ?? '··'}</span>
      <div><b>{who}</b><em><i />{lbl}{at ? ` · ${at}` : ''}</em></div>
    </div>
  );
}

type Dialog = { kind: 'reject' | 'cancel' | 'lock'; row: AccessRequestRow } | null;

export default function AccessRequests() {
  const navigate = useNavigate();
  const toast = useToast();
  const { typeOf } = useCvMeta();

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AccessRequestRow[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, per_page: PER_PAGE, total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  // One flag per row: approving A then B must not re-enable B when A finishes first.
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());
  const setBusy = (id: number, on: boolean) => setBusyIds(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState<string | undefined>();
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await cvApi.requests({ tab, q: dq, page, per_page: PER_PAGE });
      if (my !== seq.current) return;
      setRows(r.data); setTabs(r.tabs); setMeta(r.meta); setError(null); setFetchedAt(Date.now());
      if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
    } catch (e) {
      if (my !== seq.current) return;
      if (!silent) { setError(errMsg(e)); setRows([]); }
    } finally {
      // A silent poll can supersede a normal load, so whichever finishes last clears the shimmer.
      if (my === seq.current) setLoading(false);
    }
  }, [tab, dq, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [dq]);

  // Refresh every 30 s while the page is visible, and on coming back to it.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, POLL_MS);
    const v = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [load]);

  const anyLive = rows.some(r => r.seconds_left > 0);
  const now = useNow(anyLive);
  // `now` is frozen while nothing is live, so it can trail fetchedAt — never count up past the server's figure.
  const left = (r: AccessRequestRow) => Math.max(0, Math.min(r.seconds_left, r.seconds_left - Math.floor(Math.max(0, now - fetchedAt) / 1000)));

  const approve = async (x: AccessRequestRow) => {
    setBusy(x.id, true);
    try {
      const res = await cvApi.approve(x.id);
      const sentOn = x.stage === 'admin' && x.manager;
      toast.success(`${x.code} ${sentOn ? 'approved · sent to Reporting Manager' : 'fully approved'}`, res.message);
      load(true);
    } catch (e) { toast.error('Could not approve', errMsg(e)); load(true); }
    finally { setBusy(x.id, false); }
  };

  const openDialog = (kind: 'reject' | 'cancel' | 'lock', row: AccessRequestRow) => { setNote(''); setNoteErr(undefined); setDialog({ kind, row }); };

  const confirmDialog = async () => {
    if (!dialog) return;
    const x = dialog.row;
    setBusy(x.id, true);
    try {
      if (dialog.kind === 'reject') {
        const res = await cvApi.reject(x.id, note.trim() || undefined);
        toast.warning(`${x.code} rejected`, res.message);
      } else if (dialog.kind === 'cancel') {
        const res = await cvApi.cancel(x.id);
        toast.info(`${x.code} cancelled`, res.message);
      } else {
        const res = await cvApi.lock(x.id);
        toast.info(`${x.credential?.name ?? x.code} locked`, res.message);
      }
      setDialog(null);
      load(true);
    } catch (e) {
      const field = e instanceof CvApiError ? e.field('note') : undefined;
      if (field) setNoteErr(field);
      else { toast.error('Action failed', errMsg(e)); setDialog(null); load(true); }
    } finally { setBusy(x.id, false); }
  };

  const cvTabs: CvTab[] = TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: tabs[t.key] ?? null }));
  const start = (meta.current_page - 1) * meta.per_page;
  const tabDef = TABS.find(t => t.key === tab) ?? TABS[0];

  const statusCell = (x: AccessRequestRow) => {
    if (x.display_status === 'pending') {
      return <><span className="ar-st ar-st--pending"><i />Pending</span><small className="ar-st__sub">{x.status_label}</small></>;
    }
    if (x.display_status === 'approved') {
      const live = left(x);
      return (
        <>
          <span className="ar-st ar-st--approved"><i />{live > 0 ? 'Unlocked' : 'Approved'}</span>
          {live > 0
            ? <small className="ar-st__sub ar-cd" title={`Locks again at ${fmtTime(x.expires_at)}`}><Svg d={I.timer} size={10} />{mmss(live)} left</small>
            : <small className="ar-st__sub">{x.status_label}</small>}
        </>
      );
    }
    if (x.display_status === 'rejected') {
      return <><span className="ar-st ar-st--rejected"><i />Rejected</span><small className="ar-st__sub">{x.status_label.replace(/^Rejected /, '')}</small></>;
    }
    return (
      <>
        <span className={`ar-st ar-st--${x.display_status}`}><i />{x.display_status === 'reset' ? 'Reset' : 'Cancelled'}</span>
        <small className="ar-st__sub">{x.status_label}</small>
      </>
    );
  };

  const d = dialog?.row;
  const dType = d?.credential ? typeOf(d.credential.type) : undefined;

  return (
    <CvPage className="mv-page ar-page">
      <CvStrip
        icon={I.req}
        title="Access Request Management"
        sub="Review requests to unlock critical credentials — each request needs approval from the Vault Admin and the Reporting Manager."
        actions={<StripBtn icon={I.vault} onClick={() => navigate(CV_ROUTES.critical)}>Critical Vault</StripBtn>}
      />
      <CvBrief
        icon={I.req}
        label="Access Request Management"
        sub="Controlling who can unlock critical credentials with two-person approval and time-limited access."
        steps={[
          { icon: I.inbox, title: 'Receive Request', desc: 'A request is raised from the Critical Vault with a reason and the access window needed.' },
          { icon: I.admin, title: 'Vault Admin Review', desc: 'The Vault Admin checks the reason and approves or rejects the request first.' },
          { icon: I.mgr, title: 'Reporting Manager Approval', desc: 'After the Vault Admin, the requester’s reporting manager gives the second approval.' },
          { icon: I.timer, title: 'Time-limited Access', desc: 'Once both approve, the credential unlocks for the requested window and then locks again.' },
        ]}
      />
      <CvCard>
        <CvTabsRow tabs={cvTabs} active={tab} onTab={k => { setTab(k); setPage(1); }}
          search={q} onSearch={setQ} placeholder="Search by request ID, credential, requester or reason..." />
        <div id="arListWrap">
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl ar-tbl">
              <thead><tr>{COLS.map((c, i) => <th key={c} className={`ar-th-${i}`}>{c}</th>)}</tr></thead>
              <tbody>
                {loading ? <ShimRows cols={COLS.length} /> : error ? (
                  <EmptyRow cols={COLS.length} title="Could not load requests" sub={error}
                    action={<button type="button" className="ar-btn ar-btn--no" style={{ marginTop: 10 }} onClick={() => load()}>Try again</button>} />
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={COLS.length} className="mv-empty">
                      <div className="mv-empty__box">
                        <div className="mv-empty__ico"><Svg d={I.all} size={24} /></div>
                        <div className="mv-empty__t">{dq ? 'No requests match your search' : tabDef.empty}</div>
                        <div className="mv-empty__s">{dq ? 'Try a request ID, credential, person or reason.' : 'Requests raised from the Critical Vault will appear here.'}</div>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((x, i) => {
                  const T = x.credential ? typeOf(x.credential.type) : undefined;
                  const asRole = x.stage === 'admin' ? 'Vault Admin' : 'Reporting Manager';
                  const busy = busyIds.has(x.id);
                  const mgrWait = x.manager?.status === 'not_required' || x.admin?.status === 'rejected' ? 'Not required' : 'After Vault Admin';
                  return (
                    <tr key={x.id}>
                      <td><span className="whm-sr">{start + i + 1}</span></td>
                      <td><div className="whm-idcell"><span className="whm-idpill">{x.code}</span><span className="whm-iddate">{fmtDate(x.created_at)} · {fmtTime(x.created_at)}</span></div></td>
                      <td>
                        <div className="whm-namecell">
                          <span className="whm-namecell__ico"><Svg icon={T?.icon ?? 'lock'} size={15} /></span>
                          <div className="whm-namecell__t"><b>{x.credential?.name ?? 'Deleted credential'}</b><span className="whm-namecell__loc">{credSub(x)}</span></div>
                        </div>
                      </td>
                      <td>
                        <div className="mv-ownc">
                          <span className="mv-ownc__av">{x.requester.initials}</span>
                          <div><b>{x.requester.is_me ? 'You' : x.requester.name}</b><span className="ar-sub">{roleLine(x)}</span></div>
                        </div>
                      </td>
                      <td><span className="ar-reason" title={x.reason ?? ''}>{x.reason || '—'}</span></td>
                      <td><span className="ar-win"><Svg d={I.clock} size={11} sw={2.1} />{x.duration_label}</span></td>
                      <td><Approver st={x.admin} role="Vault Admin" waitTxt="Not required" anyName="Any Vault Admin" /></td>
                      <td><Approver st={x.manager} role="Manager" waitTxt={x.manager ? mgrWait : 'Not required'} anyName="Reporting Manager" /></td>
                      <td><div className="ar-stc">{statusCell(x)}</div></td>
                      <td>
                        <div className="ar-acts">
                          <button type="button" data-h40="skip" className="ar-btn ar-btn--ok" disabled={!x.can.approve || busy}
                            title={x.can.approve ? `Approve as ${asRole}` : undefined} onClick={() => approve(x)}>
                            <Svg d={I.ok} size={12} sw={2.1} />Approve
                          </button>
                          <button type="button" data-h40="skip" className="ar-btn ar-btn--no" disabled={!x.can.reject || busy}
                            title={x.can.reject ? `Reject as ${asRole}` : undefined} onClick={() => openDialog('reject', x)}>
                            <Svg d={I.no} size={12} sw={2.1} />Reject
                          </button>
                          {x.can.lock && (
                            <button type="button" data-h40="skip" className="ar-btn ar-btn--no" disabled={busy}
                              title="Lock the credential again before the window ends" onClick={() => openDialog('lock', x)}>
                              <Svg d={I.lock} size={12} sw={2.1} />Lock now
                            </button>
                          )}
                          {x.can.cancel && (
                            <button type="button" data-h40="skip" className="ar-btn ar-btn--no" disabled={busy}
                              title="Withdraw this request" onClick={() => openDialog('cancel', x)}>
                              <Svg d={I.no} size={12} sw={2.1} />Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!loading && !error && (
            <CvPager page={meta.current_page} lastPage={meta.last_page} total={meta.total} perPage={meta.per_page} noun="requests" onPage={setPage} />
          )}
        </div>
      </CvCard>

      {dialog && d && (
        <ConfirmModal
          icon={dialog.kind === 'reject' ? I.rejectHd : dialog.kind === 'lock' ? I.lock : I.no}
          title={dialog.kind === 'reject' ? 'Reject access request?' : dialog.kind === 'lock' ? 'Lock this credential now?' : 'Cancel this request?'}
          sub={dialog.kind === 'reject'
            ? 'The requester will not be able to unlock this credential. They can raise a new request later.'
            : dialog.kind === 'lock'
              ? 'The access window ends now. A new request is needed to unlock it again.'
              : 'The approvers will no longer see it. You can raise a new request later.'}
          confirmLabel={dialog.kind === 'reject' ? 'Reject Request' : dialog.kind === 'lock' ? 'Lock Now' : 'Cancel Request'}
          confirmIcon={dialog.kind === 'lock' ? I.lock : I.no}
          busy={busyIds.has(d.id)}
          onConfirm={confirmDialog}
          onClose={() => { if (!busyIds.has(d.id)) setDialog(null); }}
        >
          <div className="arj">
            <div className="arj-card">
              <div className="arj-row">
                <span className="arj-ico"><Svg icon={dType?.icon ?? 'lock'} size={16} /></span>
                <div className="arj-t"><b>{d.credential?.name ?? 'Deleted credential'}</b><small>{credSub(d)}</small></div>
                <span className="arj-rid">{d.code}</span>
              </div>
              <div className="arj-sep" />
              <div className="arj-row">
                <span className="arj-av">{d.requester.initials}</span>
                <div className="arj-t"><b>{d.requester.is_me ? 'You' : d.requester.name}</b><small>{roleLine(d)}</small></div>
                <span className="arj-win"><Svg d={I.clock} size={11} sw={2.1} />{d.duration_label}</span>
              </div>
            </div>
            {dialog.kind === 'reject' && (
              <>
                <div className="arj-as"><Svg d={I.shieldO} size={12} sw={2.1} />Rejecting as <b>{d.stage === 'admin' ? 'Vault Admin' : 'Reporting Manager'}</b></div>
                <textarea className="ar-why mapsup-finput" maxLength={300} value={note} placeholder="Reason for rejecting (optional) — the requester will see it"
                  onChange={e => { setNote(e.target.value); setNoteErr(undefined); }} aria-label="Reason for rejecting" />
                {noteErr && <span className="cv-ferr">{noteErr}</span>}
              </>
            )}
          </div>
        </ConfirmModal>
      )}
    </CvPage>
  );
}
