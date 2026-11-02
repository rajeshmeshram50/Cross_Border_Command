import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cvApi, type CredentialRow, type PageMeta } from '../cvApi';
import {
  CategoryCell, CvBrief, CvCard, CvPage, CvPager, CvStrip, CvTabsRow, EmptyRow, IC, IdCell, NameCell, OwnerCell,
  RiskFlag, ShimRows, StrengthCell, StripBtn, Svg, TwofaCell, UpdatedCell, errMsg, mmss, useCvMeta, useDebounced, useNow,
} from '../shared';
import CredentialFormModal from '../form/CredentialFormModal';
import ViewDrawer from '../my-vault/ViewDrawer';
import ShareModal from '../my-vault/ShareModal';
import BinConfirm from '../my-vault/BinConfirm';
import UnlockModal from './UnlockModal';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault · Critical Vault — the critical-risk credentials, each behind
 * the Critical Access Protection steps. Tabs All / My / Teams', the access
 * status cell (locked · pending · in progress · unlocked with a countdown)
 * and the lock button that opens the unlock modal.
 * ───────────────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 10;
const COLS = ['Sr. No', 'Credential ID', 'Credential Name', 'Category', 'Username', 'Owner', 'Risk', 'Strength', '2FA', 'Last Updated', 'Access Status', 'Action'];

const SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
const CLOCK = '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>';
const BRIEF_IC = {
  req: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  approve: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
};

/* The UI's tab keys; "team" is the API's "others" (critical credentials owned by anyone else). */
const TABS = [
  { key: 'all', api: 'all', label: 'All Critical Credentials', icon: SHIELD },
  { key: 'mine', api: 'mine', label: 'My Critical Credentials', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  { key: 'team', api: 'others', label: 'Teams Critical Credentials', icon: IC.users },
] as const;
type TabKey = typeof TABS[number]['key'];

type Overlay =
  | { kind: 'add' }
  | { kind: 'edit'; id: number }
  | { kind: 'view'; id: number }
  | { kind: 'share'; id: number }
  | { kind: 'unlock'; id: number }
  | { kind: 'bin'; row: CredentialRow }
  | null;

/** The Access Status cell, in the prototype's four states. */
function AccessCell({ row, left }: { row: CredentialRow; left: number | null }) {
  const a = row.unlock;
  if (!a) return <div className="cv-acc"><span className="cv-acc__t">No unlock steps</span></div>;
  if (a.state === 'open') {
    const l = Math.max(0, left ?? 0);
    const pct = Math.max(0, Math.min(100, (l / (a.total_seconds || 1)) * 100));
    return (
      <div className={`cv-acc cv-acc--open${l < 60 ? ' is-low' : ''}`}>
        <span className="cv-acc__b"><Svg d={IC.unlock} size={12} />Unlocked</span>
        <span className="cv-acc__t"><b>{mmss(l)}</b> left</span>
        <span className="cv-acc__bar"><i style={{ width: `${pct}%` }} /></span>
      </div>
    );
  }
  if (a.state === 'pending') {
    return (
      <div className="cv-acc cv-acc--wait">
        <span className="cv-acc__b"><span className="cp-spin cp-spin--sm" />Pending</span>
        <span className="cv-acc__t">{a.waiting_for ? `${a.waiting_for.role} · ${a.waiting_for.name}` : a.label}</span>
      </div>
    );
  }
  if (a.state === 'progress') {
    return (
      <div className="cv-acc cv-acc--prog">
        <span className="cv-acc__b"><Svg d={CLOCK} size={12} />In progress</span>
        <span className="cv-acc__t">{a.label}</span>
      </div>
    );
  }
  return (
    <div className="cv-acc cv-acc--locked">
      <span className="cv-acc__b"><Svg d={IC.lock} size={12} />Locked</span>
      <span className="cv-acc__t">Approval needed</span>
    </div>
  );
}

function LockBtn({ row, onClick }: { row: CredentialRow; onClick: () => void }) {
  const s = row.unlock?.state;
  const [cls, icon, title] = !row.unlock ? ['cv-lk cv-lk--open', IC.view, 'View credential']
    : s === 'open' ? ['cv-lk cv-lk--open', IC.unlock, 'Unlocked — view credential']
      : s === 'pending' ? ['cv-lk cv-lk--wait', CLOCK, 'Waiting for approval — view request']
        : s === 'progress' ? ['cv-lk cv-lk--wait', CLOCK, 'Continue unlocking']
          : ['cv-lk cv-lk--locked', IC.lock, 'Unlock credential'];
  return (
    <button type="button" className={`whm-act ${cls}`} title={title} aria-label={`${title} ${row.critical_code ?? row.code}`} onClick={onClick}>
      <Svg d={icon} size={14} />
    </button>
  );
}

export default function CriticalVault() {
  const { typeOf } = useCvMeta();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [tabs, setTabs] = useState<Record<string, number> | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const seq = useRef(0);

  // ?action=add (dashboard quick action) opens the form once, then leaves the URL clean.
  useEffect(() => {
    if (params.get('action') === 'add') {
      setOverlay({ kind: 'add' });
      const n = new URLSearchParams(params);
      n.delete('action');
      setParams(n, { replace: true });
    }
  }, [params, setParams]);

  const apiTab = TABS.find(t => t.key === tab)!.api;
  const load = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await cvApi.list({ risk: 'critical', tab: apiTab, q: dq.trim() || undefined, page, per_page: PAGE_SIZE });
      if (my !== seq.current) return;
      // A page emptied by a delete or a narrower search falls back to the last one.
      if (!r.data.length && page > 1 && r.meta.last_page < page) { setPage(Math.max(1, r.meta.last_page)); return; }
      setRows(r.data);
      setTabs(r.tabs);
      setMeta(r.meta);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(errMsg(e));
      if (!silent) setRows([]);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [apiTab, dq, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, dq]);

  /* Live refresh: the countdowns tick each second; a window that runs out, or a
     request waiting on someone else, brings the list back from the server. */
  const anyOpen = rows.some(r => r.unlock?.state === 'open');
  const anyWaiting = rows.some(r => r.unlock?.state === 'pending' || r.unlock?.state === 'progress');
  const now = useNow(anyOpen);
  const leftOf = useCallback((r: CredentialRow) => (r.unlock?.state === 'open'
    ? (r.unlock.seconds_left ?? 0) - (now - fetchedAt) / 1000 : null), [now, fetchedAt]);
  const expired = useMemo(() => rows.some(r => { const l = leftOf(r); return l !== null && l <= 0; }), [rows, leftOf]);
  // The server can still report the window open at zero for a moment: look again shortly, a few times at most.
  const expiredTries = useRef(0);
  useEffect(() => {
    if (!expired) { expiredTries.current = 0; return; }
    if (expiredTries.current > 3) return;
    const t = setTimeout(() => { expiredTries.current += 1; load(true); }, expiredTries.current ? 1500 : 0);
    return () => clearTimeout(t);
  }, [expired, fetchedAt, load]);
  useEffect(() => {
    if (!anyWaiting || overlay) return;
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
  }, [anyWaiting, overlay, load]);

  const refresh = useCallback(() => { load(true); }, [load]);
  const close = useCallback(() => setOverlay(null), []);

  const openRow = (r: CredentialRow) => setOverlay(r.unlock ? { kind: 'unlock', id: r.id } : { kind: 'view', id: r.id });
  const start = ((meta?.current_page ?? page) - 1) * (meta?.per_page ?? PAGE_SIZE);
  // The prototype shows the team wording on "All" too; "All" includes your own, so it reads as "mine" here.
  const emptyT = dq ? 'No credentials match your search' : tab === 'team' ? 'No team critical credentials' : 'No critical credentials yet';
  const emptyS = dq ? 'Try a different credential ID, name, category, username, or owner.'
    : tab === 'team' ? 'Critical credentials owned by your team will appear here.'
      : tab === 'mine' ? 'Critical credentials you add will appear here.' : 'Critical credentials you add, or that your team owns, will appear here.';

  return (
    <CvPage className="mv-page cv-page">
      <CvStrip
        icon={SHIELD}
        title="Critical Vault"
        sub="High-risk credentials such as bank, tax, root and treasury accounts — unlocked only after approval, for a limited time."
        actions={<StripBtn icon={IC.plus} onClick={() => setOverlay({ kind: 'add' })}>Add Critical Credential</StripBtn>}
      />

      <CvBrief
        icon={SHIELD}
        label="Critical Vault"
        sub="Protecting the company's most sensitive credentials with approval-based, time-limited access and a full record of every use."
        steps={[
          { icon: BRIEF_IC.req, title: 'Request Access', desc: 'Ask for access to a critical credential with a reason and how long you need it.' },
          { icon: BRIEF_IC.approve, title: 'Get Approval', desc: 'The credential owner or an admin reviews the request and approves or rejects it.' },
          { icon: IC.unlock, title: 'Unlock for a Limited Time', desc: 'Approved access opens a short unlock window; every reveal and copy is recorded.' },
          { icon: BRIEF_IC.timer, title: 'Auto-Lock & Review', desc: 'Access locks again automatically when the window ends, and all activity is kept for review.' },
        ]}
      />

      <CvCard>
        <CvTabsRow
          tabs={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: tabs ? tabs[t.api] ?? 0 : null }))}
          active={tab}
          onTab={k => setTab(k as TabKey)}
          search={q}
          onSearch={setQ}
          placeholder="Search by credential ID, name, category, username or owner..."
        />
        <div id="cvListWrap">
          {error && !loading && (
            <div className="cp-note cp-note--bad" style={{ margin: '10px 0' }}>
              <Svg d={IC.shieldAlert} size={13} /><span>{error}</span>
              <button type="button" className="rv-link" onClick={() => load()}>Try again</button>
            </div>
          )}
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl">
              <thead><tr>{COLS.map((c, i) => <th key={c} className={`mv-th-${i}`}>{c}</th>)}</tr></thead>
              <tbody>
                {loading ? <ShimRows cols={COLS.length} />
                  : !rows.length ? <EmptyRow cols={COLS.length} title={emptyT} sub={emptyS} />
                    : rows.map((r, i) => (
                      <tr key={r.id}>
                        <td><span className="whm-sr">{start + i + 1}</span></td>
                        <td><IdCell code={r.critical_code ?? r.code} date={r.updated_at} /></td>
                        <td><NameCell row={r} typeIcon={typeOf(r.type)?.icon} /></td>
                        <td><CategoryCell label={r.type_label} group={r.category_group} /></td>
                        <td><span className="mv-user">{r.username ? r.username : <span className="mv-str--na">—</span>}</span></td>
                        <td><OwnerCell row={r} /></td>
                        <td><RiskFlag risk={r.risk} /></td>
                        <td><StrengthCell row={r} /></td>
                        <td><TwofaCell twofa={r.twofa} /></td>
                        <td><UpdatedCell iso={r.updated_at} /></td>
                        <td><AccessCell row={r} left={leftOf(r)} /></td>
                        <td>
                          <div className="whm-acts">
                            <button type="button" className="whm-act whm-act--edit" title="Edit" aria-label={`Edit ${r.critical_code ?? r.code}`}
                              disabled={!r.can?.edit} style={!r.can?.edit ? { opacity: .35, cursor: 'not-allowed' } : undefined}
                              onClick={() => setOverlay({ kind: 'edit', id: r.id })}>
                              <Svg d={IC.edit} size={14} />
                            </button>
                            <LockBtn row={r} onClick={() => openRow(r)} />
                            <button type="button" className="whm-act whm-act--danger" title="Move to Bin" aria-label={`Move to Bin ${r.critical_code ?? r.code}`}
                              disabled={!r.can?.delete} style={!r.can?.delete ? { opacity: .35, cursor: 'not-allowed' } : undefined}
                              onClick={() => setOverlay({ kind: 'bin', row: r })}>
                              <Svg d={IC.del} size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!loading && meta && (
            <CvPager page={meta.current_page} lastPage={meta.last_page} total={meta.total} perPage={meta.per_page} onPage={setPage} />
          )}
        </div>
      </CvCard>

      {overlay?.kind === 'add' && (
        <CredentialFormModal critical onClose={close}
          onSaved={() => { close(); refresh(); }} />
      )}
      {overlay?.kind === 'edit' && (
        <CredentialFormModal credentialId={overlay.id} critical onClose={close} onSaved={() => { close(); refresh(); }} />
      )}
      {overlay?.kind === 'view' && (
        <ViewDrawer key={overlay.id} credentialId={overlay.id} onClose={close} onChanged={refresh}
          onEdit={id => setOverlay({ kind: 'edit', id })} onShare={id => setOverlay({ kind: 'share', id })} />
      )}
      {overlay?.kind === 'share' && (
        <ShareModal credentialId={overlay.id} onClose={close} onShared={refresh} />
      )}
      {overlay?.kind === 'unlock' && (
        <UnlockModal credentialId={overlay.id} onClose={close} onChanged={refresh}
          onFullDetails={id => setOverlay({ kind: 'view', id })} />
      )}
      {overlay?.kind === 'bin' && (
        <BinConfirm row={overlay.row} onClose={close} onDone={() => { close(); refresh(); }} />
      )}
    </CvPage>
  );
}
