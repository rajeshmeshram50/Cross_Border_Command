import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type CredentialRow, type PageMeta, type Perm, type ShareRow } from '../cvApi';
import UnlockModal from '../critical/UnlockModal';
import CredentialFormModal from '../form/CredentialFormModal';
import {
  ConfirmModal, copyText, CvBrief, CvCard, CvPage, CvPager, CvStrip, CvTabsRow, EmptyRow, errMsg, fmtDate, fmtDay, fmtTime,
  IC, ShimRows, StripBtn, Svg, useCvMeta, useDebounced, type CvTab,
} from '../shared';
import BinConfirm from './BinConfirm';
import CredentialTable from './CredentialTable';
import GeneratorModal from './GeneratorModal';
import ShareModal from './ShareModal';
import ViewDrawer from './ViewDrawer';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault · My Vault — the prototype's myVaultBody(): header strip with
 * Generate Password / Add Credential, the "What We Are Doing Here" box, and
 * the tabbed list (All / Mine / Team / Shared With Me / Shared By Me) with a
 * server-side search and pager. Every count and row comes from the API.
 * ───────────────────────────────────────────────────────────────────────── */

type TabKey = 'all' | 'mine' | 'team' | 'shared' | 'sharedby';
const PER_PAGE = 10;

const TABS: { k: TabKey; l: string; i: string }[] = [
  { k: 'all', l: 'All Credentials', i: IC.lock },
  { k: 'mine', l: 'My Credentials', i: IC.user },
  { k: 'team', l: 'Team Credentials', i: IC.users },
  { k: 'shared', l: 'Shared With Me', i: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' },
  { k: 'sharedby', l: 'Shared By Me', i: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>' },
];

const STEP_ICO = {
  cred: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8"/><line x1="15" y1="10" x2="18" y2="10"/><line x1="15" y1="14" x2="18" y2="14"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
};
const BAN = '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>';
const PERM_ICO: Record<Perm, string> = {
  use: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  view: 'eye', copy: 'copy', full: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
};
const STATE_LABEL: Record<ShareRow['state'], string> = { active: 'Active', soon: 'Expiring soon', expired: 'Expired', revoked: 'Revoked' };
const SB_COLS = ['Sr. No', 'Credential ID', 'Credential Name', 'Shared With', 'Permission', 'Shared On', 'Expires', 'Reason', 'Status', 'Action'];

/** The Expires cell's second line, as the prototype's sbLeft(). */
function expiresLeft(s: ShareRow): string {
  if (s.state === 'revoked') return '—';
  const ms = new Date(s.expires_at!).getTime() - Date.now();
  if (ms <= 0) { const d = Math.max(1, Math.round(-ms / 864e5)); return `Expired ${d} ${d === 1 ? 'day' : 'days'} ago`; }
  if (ms < 864e5) return `${Math.max(1, Math.round(ms / 36e5))}h left`;
  const d = Math.round(ms / 864e5);
  return `${d} ${d === 1 ? 'day' : 'days'} left`;
}

export default function MyVault() {
  const toast = useToast();
  const { typeOf } = useCvMeta();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 350);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [pm, setPm] = useState<PageMeta | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);
  const seq = useRef(0);

  const [form, setForm] = useState<{ credentialId?: number; prefillPassword?: string } | null>(null);
  const [gen, setGen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [shareId, setShareId] = useState<number | null>(null);
  const [binRow, setBinRow] = useState<CredentialRow | null>(null);
  const [unlockId, setUnlockId] = useState<number | null>(null);
  const [revoke, setRevoke] = useState<ShareRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Shares of one credential only — set by Password Health's over-shared "Fix" link.
  const [shareCred, setShareCred] = useState<number | null>(null);

  // ?action=add|generate (quick actions) and ?tab=…&credential_id= (Password Health) — apply once, then drop them.
  useEffect(() => {
    const a = params.get('action');
    const t = params.get('tab');
    const cid = Number(params.get('credential_id')) || null;
    if (!a && !t && !cid) return;
    if (a === 'add') setForm({});
    else if (a === 'generate') setGen(true);
    if (t && TABS.some(x => x.k === t)) { setTab(t as TabKey); setPage(1); }
    if (cid) setShareCred(cid);
    const next = new URLSearchParams(params);
    ['action', 'tab', 'credential_id'].forEach(k => next.delete(k));
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => { setPage(1); }, [dq]);

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    setFailed(null);
    (async () => {
      try {
        if (tab === 'sharedby') {
          // The tab badges come from the credentials list; refresh them alongside.
          const [r, c] = await Promise.all([
            cvApi.sharedByMe({ q: dq, page, per_page: PER_PAGE, ...(shareCred ? { credential_id: shareCred } : {}) }),
            cvApi.list({ tab: 'all', page: 1, per_page: 1 }),
          ]);
          if (n !== seq.current) return;
          if (!r.data.length && page > 1 && r.meta.last_page < page) { setPage(Math.max(1, r.meta.last_page)); return; }
          setShares(r.data); setPm(r.meta); setCounts(c.tabs);
        } else {
          const r = await cvApi.list({ tab, q: dq, page, per_page: PER_PAGE });
          if (n !== seq.current) return;
          if (!r.data.length && page > 1 && r.meta.last_page < page) { setPage(Math.max(1, r.meta.last_page)); return; }
          setRows(r.data); setPm(r.meta); setCounts(r.tabs);
        }
      } catch (e) {
        if (n !== seq.current) return;
        setFailed(errMsg(e));
        if (tab === 'sharedby') setShares([]); else setRows([]);
        setPm(null);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    })();
  }, [tab, dq, page, tick, shareCred]);

  const copyPw = async (r: CredentialRow) => {
    try {
      const d = await cvApi.reveal(r.id, 'copy');
      await copyText(d.value, d.clear_clipboard_after);
      toast.success(`${d.label} for ${r.name} copied`, d.clear_clipboard_after ? `The clipboard clears in ${d.clear_clipboard_after} seconds.` : undefined);
    } catch (e) {
      if (e instanceof CvApiError && e.status === 423) { setUnlockId(r.id); return; }
      toast.error('Could not copy', errMsg(e));
    }
  };

  const doRevoke = async () => {
    if (!revoke || revoking) return;
    setRevoking(true);
    try {
      const r = await cvApi.revoke(revoke.id);
      toast.warning(r.message || `${revoke.recipient.name} no longer has access to ${revoke.credential?.name ?? 'the credential'}`);
      setRevoke(null);
      reload();
    } catch (e) {
      toast.error('Could not revoke access', errMsg(e));
    } finally {
      setRevoking(false);
    }
  };

  const tabs: CvTab[] = TABS.map(t => ({ key: t.k, label: t.l, icon: t.i, count: counts ? counts[t.k] ?? 0 : null }));
  const tabLabel = TABS.find(t => t.k === tab)?.l ?? 'My Vault';
  const start = pm ? (pm.current_page - 1) * pm.per_page : 0;

  const emptyTitle = failed ? 'Could not load credentials' : dq ? 'No credentials match your search' : 'No credentials yet';
  const emptySub = failed ? failed
    : dq ? 'Try a different credential ID, name, category, username, or owner.'
      : tab === 'shared' ? 'Credentials that colleagues share with you will appear here.'
        : `Credentials you add to ${tab === 'all' ? 'My Vault' : tabLabel} will appear here. Add your first one to get started.`;

  return (
    <CvPage className="mv-page">
      <CvStrip icon={IC.lock} title="My Vault"
        sub="Store and manage your personal logins, secure notes, and secrets — encrypted and visible only to you."
        actions={(
          <>
            <StripBtn ghost icon={IC.key} onClick={() => setGen(true)}>Generate Password</StripBtn>
            <StripBtn icon={IC.plus} onClick={() => setForm({})}>Add Credential</StripBtn>
          </>
        )} />

      <CvBrief icon={IC.lock} label="My Vault" defaultOpen
        sub="Saving your personal credentials securely, keeping them organised and strong, and sharing them only when needed."
        steps={[
          { icon: STEP_ICO.cred, title: 'Add Credential', desc: 'Save a login, secure note, card, or API key with its URL, username, and password.' },
          { icon: STEP_ICO.folder, title: 'Organise with Folders & Tags', desc: 'Group credentials by system, project, or purpose so they are quick to find.' },
          { icon: IC.shield, title: 'Keep Passwords Strong', desc: 'Generate strong passwords and fix weak, reused, or expiring ones flagged by Password Health.' },
          { icon: IC.share, title: 'Share Securely When Needed', desc: 'Share a credential with a colleague or team, with view-only or edit access you can revoke.' },
        ]} />

      <CvCard>
        <CvTabsRow tabs={tabs} active={tab} onTab={k => { setTab(k as TabKey); setPage(1); setShareCred(null); }} search={q} onSearch={setQ}
          placeholder={tab === 'sharedby' ? 'Search by credential ID, name, person, team or reason...' : 'Search by credential ID, name, category, username or owner...'} />

        {tab === 'sharedby' ? (
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl sb-tbl">
              <thead><tr>{SB_COLS.map((c, i) => <th key={c} className={`sb-th-${i}`}>{c}</th>)}</tr></thead>
              <tbody>
                {loading ? <ShimRows cols={SB_COLS.length} rows={6} />
                  : !shares.length ? (
                    <EmptyRow cols={SB_COLS.length}
                      title={failed ? 'Could not load your shares' : dq ? 'No shares match your search' : 'You haven’t shared any credentials yet'}
                      sub={failed ?? (dq ? 'Try a credential name, ID, person or team.' : 'Use Share on any of your credentials and it will be tracked here.')} />
                  ) : shares.map((s, i) => {
                    const c = s.credential;
                    const team = s.recipient.type === 'team';
                    const dead = s.state === 'revoked' || s.state === 'expired';
                    const sub = c?.url ?? '';
                    return (
                      <tr key={s.id} className={dead ? 'sb-dead' : ''}>
                        <td><span className="whm-sr">{start + i + 1}</span></td>
                        <td><div className="whm-idcell"><span className="whm-idpill">{c?.code ?? '—'}</span><span className="whm-iddate">{fmtDate(c?.updated_at)}</span></div></td>
                        <td>
                          <div className="whm-namecell">
                            <span className="whm-namecell__ico"><Svg icon={typeOf(c?.type)?.icon ?? 'lock'} size={15} /></span>
                            <div className="whm-namecell__t">
                              <b>{c?.name ?? 'Deleted credential'}</b>
                              {sub && <span className="whm-namecell__loc"><Svg icon={/^https?:|\.[a-z]{2,}/i.test(sub) ? 'globe' : 'tag'} size={11} />{sub}</span>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="mv-ownc sb-to">
                            <span className={`mv-ownc__av${team ? ' sb-av--team' : ''}`}>{team ? <Svg d={IC.users} size={13} /> : s.recipient.initials}</span>
                            <div><b>{s.recipient.name ?? '—'}</b><span className="sb-sub">{s.recipient.sub}</span></div>
                          </div>
                        </td>
                        <td><span className={`sb-perm sb-perm--${s.permission}`}><Svg icon={PERM_ICO[s.permission]} size={11} />{s.permission_label}</span></td>
                        <td><div className="whm-idcell"><b className="mv-upd-d">{fmtDay(s.shared_at)}</b><span className="whm-iddate">{fmtTime(s.shared_at)}</span></div></td>
                        <td>
                          <div className="whm-idcell">
                            {s.expires_at
                              ? <><b className="mv-upd-d">{fmtDay(s.expires_at)}</b><span className="whm-iddate sb-left">{expiresLeft(s)}</span></>
                              : <><b>No expiry</b><span className="whm-iddate">Until revoked</span></>}
                          </div>
                        </td>
                        <td><span className="sb-reason" title={s.reason ?? ''}>{s.reason ?? '—'}</span></td>
                        <td><span className={`sb-st sb-st--${s.state}`}><i />{STATE_LABEL[s.state]}</span></td>
                        <td>
                          <div className="whm-acts">
                            <button type="button" className="whm-act" title="View credential" disabled={!c} onClick={() => c && setViewId(c.id)}><Svg d={IC.view} size={14} /></button>
                            <button type="button" className="whm-act" title="Share again" disabled={!c} onClick={() => c && setShareId(c.id)}><Svg d={IC.share} size={14} /></button>
                            {dead
                              ? <button type="button" className="whm-act" disabled title={STATE_LABEL[s.state]} style={{ opacity: .35, cursor: 'not-allowed' }}><Svg d={BAN} size={14} /></button>
                              : <button type="button" className="whm-act whm-act--danger" title="Revoke access" onClick={() => setRevoke(s)}><Svg d={BAN} size={14} /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <CredentialTable rows={rows} startIndex={start} loading={loading} emptyTitle={emptyTitle} emptySub={emptySub}
            onAdd={dq || tab === 'shared' || failed ? undefined : () => setForm({})}
            onEdit={r => setForm({ credentialId: r.id })}
            onShare={r => setShareId(r.id)}
            onView={r => setViewId(r.id)}
            onCopy={copyPw}
            onDelete={r => setBinRow(r)} />
        )}

        {!loading && pm && (
          <CvPager page={pm.current_page} lastPage={pm.last_page} total={pm.total} perPage={pm.per_page}
            noun={tab === 'sharedby' ? 'shares' : 'credentials'} onPage={setPage} />
        )}
      </CvCard>

      {form && (
        <CredentialFormModal credentialId={form.credentialId} prefillPassword={form.prefillPassword}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />
      )}
      {gen && <GeneratorModal onClose={() => setGen(false)} onUse={pw => { setGen(false); setForm({ prefillPassword: pw }); }} />}
      {viewId != null && (
        <ViewDrawer key={viewId} credentialId={viewId} onClose={() => setViewId(null)} onChanged={reload}
          onEdit={id => { setViewId(null); setForm({ credentialId: id }); }}
          onShare={id => { setViewId(null); setShareId(id); }} />
      )}
      {shareId != null && <ShareModal credentialId={shareId} onClose={() => setShareId(null)} onShared={reload} />}
      {binRow && <BinConfirm row={binRow} onClose={() => setBinRow(null)} onDone={() => { setBinRow(null); reload(); }} />}
      {unlockId != null && (
        <UnlockModal credentialId={unlockId} onClose={() => setUnlockId(null)} onChanged={reload}
          onFullDetails={id => { setUnlockId(null); setViewId(id); }} />
      )}
      {revoke && (
        <ConfirmModal title="Revoke access?" icon={BAN}
          sub="They lose access immediately. You can share it again later."
          cred={revoke.credential ? { icon: typeOf(revoke.credential.type)?.icon, name: revoke.credential.name, code: revoke.credential.code, meta: revoke.credential.type_label, risk: revoke.credential.risk } : undefined}
          busy={revoking} confirmLabel="Revoke" confirmIcon={BAN} onConfirm={doRevoke} onClose={() => setRevoke(null)}>
          <div className="dl-text" style={{ textAlign: 'left' }}>
            <b>{revoke.recipient.name}</b> will immediately lose access to <b>{revoke.credential?.name}</b>{' '}
            <span className="dl-id">{revoke.credential?.code}</span>. You can share it again later.
          </div>
        </ConfirmModal>
      )}
    </CvPage>
  );
}
