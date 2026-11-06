import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorklistPager from '../../../components/ui/WorklistPager';
import type { CredentialRow, LockStep, PageMeta } from '../cvApi';
import { ActBtn, CvBrief, CvCard, CvPage, CvStrip, CvTabsRow, IC, StripBtn, Svg, errMsg, mmss, useDebounced, useNow } from '../shared';
import CredentialTable from '../my-vault/CredentialTable';
import CredentialFormModal from '../form/CredentialFormModal';
import ViewDrawer from '../my-vault/ViewDrawer';
import ShareModal from '../my-vault/ShareModal';
import BinConfirm from '../my-vault/BinConfirm';
import UnlockModal from './UnlockModal';
import { CV_DUMMY, cvData, viewSource } from './cvData';

const SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
const BRIEF_IC = {
  req: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  approve: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
};

type TabKey = 'all' | 'mine' | 'team';
const TABS: { key: TabKey; api: string; label: string; icon: string }[] = [
  { key: 'all', api: 'all', label: 'All Critical Credentials', icon: SHIELD },
  { key: 'mine', api: 'mine', label: 'My Critical Credentials', icon: IC.user },
  { key: 'team', api: 'others', label: 'Teams Critical Credentials', icon: IC.users },
];

type Overlay =
  | { kind: 'add' }
  | { kind: 'edit'; id: number }
  | { kind: 'view'; id: number }
  | { kind: 'share'; id: number }
  | { kind: 'unlock'; id: number }
  | { kind: 'bin'; row: CredentialRow }
  | null;

const STAGE: Record<LockStep, string> = { admin: 'Vault Admin', manager: 'Manager', otp: 'Authenticator' };

/** The Branch Admin (Vault Admin of the credential's branch) opens it directly: the API sends
 *  'open' with no request and no timer (CredVaultController::opensDirectly). Everyone else — owners
 *  included — goes through the unlock steps. */
const isDirect = (u?: CredentialRow['unlock']) => !!u && u.state === 'open' && !u.request_id;

/** Access Status, as the prototype draws it (cv-acc): Locked, Pending, In progress, or Unlocked with its countdown. */
function AccessCell({ row, left }: { row: CredentialRow; left: number | null }) {
  if (isDirect(row.unlock)) return <div className="cv-acc cv-acc--owner"><span className="cv-acc__b"><Svg d={IC.view} size={12} />Vault Admin</span><span className="cv-acc__t">Full access · no approval</span></div>;
  const a = row.unlock;
  if (!a) return <div className="cv-acc cv-acc--locked"><span className="cv-acc__b">Open</span><span className="cv-acc__t">No unlock steps</span></div>;
  // The window ran out: it is locked again, even while the API still reads 'open' until its sweep.
  if (a.state === 'open' && (left ?? 0) <= 0) {
    return <div className="cv-acc cv-acc--locked"><span className="cv-acc__b"><Svg d={IC.lock} size={12} />Locked</span><span className="cv-acc__t">Window ended · request again</span></div>;
  }
  if (a.state === 'open') {
    const l = Math.max(0, left ?? 0);
    const pct = a.total_seconds ? Math.min(100, (l / a.total_seconds) * 100) : 0;
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
        <span className="cv-acc__b"><Svg d={IC.clock} size={12} />In progress</span>
        <span className="cv-acc__t">{a.step ? `Step ${a.step.number} of ${a.step.of}` : a.label}{a.stage ? ` · ${STAGE[a.stage]}` : ''}</span>
      </div>
    );
  }
  return <div className="cv-acc cv-acc--locked"><span className="cv-acc__b"><Svg d={IC.lock} size={12} />Locked</span><span className="cv-acc__t">Approval needed</span></div>;
}

/** The row's unlock button: its icon, title and colour follow the access state (cv-lk). */
function lockAction(row: CredentialRow, left: number | null = null): { icon: string; cls: string; title: string } {
  const s = row.unlock?.state;
  if (!row.unlock) return { icon: IC.view, cls: '', title: 'View credential' };
  if (s === 'open' && left !== null && left <= 0) return { icon: IC.lock, cls: 'cv-lk cv-lk--locked', title: 'Unlock credential' };
  if (s === 'open') return { icon: IC.unlock, cls: 'cv-lk cv-lk--open', title: 'Unlocked — view credential' };
  if (s === 'pending') return { icon: IC.clock, cls: 'cv-lk cv-lk--wait', title: 'Waiting for approval — view request' };
  if (s === 'progress') return { icon: IC.clock, cls: 'cv-lk cv-lk--wait', title: 'Continue unlocking' };
  return { icon: IC.lock, cls: 'cv-lk cv-lk--locked', title: 'Unlock credential' };
}

export default function CriticalVault() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [tabs, setTabs] = useState<Record<string, number> | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const seq = useRef(0);

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
      const r = await cvData.list({ risk: 'critical', tab: apiTab, q: dq.trim() || undefined, page, per_page: perPage });
      if (my !== seq.current) return;
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
  }, [apiTab, dq, page, perPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, dq]);

  const anyOpen = rows.some(r => r.unlock?.state === 'open' && !isDirect(r.unlock));
  const anyWaiting = rows.some(r => r.unlock?.state === 'pending' || r.unlock?.state === 'progress');
  const now = useNow(anyOpen);
  // `now` can trail a fresh fetchedAt until the next tick: never count up past the server's figure,
  // or an ended window reads above 0 again and the expiry reload loops (the rows blink).
  const leftOf = useCallback((r: CredentialRow) => (r.unlock?.state === 'open' && !isDirect(r.unlock)
    ? (r.unlock.seconds_left ?? 0) - Math.max(0, now - fetchedAt) / 1000 : null), [now, fetchedAt]);
  const expired = useMemo(() => rows.some(r => { const l = leftOf(r); return l !== null && l <= 0; }), [rows, leftOf]);
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
  const openRow = useCallback((r: CredentialRow) => setOverlay(r.unlock ? { kind: 'unlock', id: r.id } : { kind: 'view', id: r.id }), []);

  const emptyTitle = error ? 'Could not load critical credentials' : dq ? 'No credentials match your search' : 'No critical credentials yet';
  const emptySub = error ?? (dq ? 'Try a different credential ID, name, category, username or owner.'
    : tab === 'team' ? 'Critical credentials owned by your team will appear here.'
      : tab === 'mine' ? 'Critical credentials you add will appear here.' : 'Critical credentials you add, or that your team owns, will appear here.');

  return (
    <CvPage className="mv-page tv-page cv-page">
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

      <CvCard pane>
        <CvTabsRow tabs={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: tabs ? tabs[t.api] ?? 0 : null }))}
          active={tab} onTab={k => setTab(k as TabKey)} search={q} onSearch={setQ}
          placeholder="Search by credential ID, name, category, username or owner..." />

        <div className="tvc-list">
          <CredentialTable critical rows={rows} startIndex={(page - 1) * perPage} loading={loading}
            emptyTitle={emptyTitle} emptySub={emptySub}
            onAdd={tab !== 'team' && !dq && !error ? () => setOverlay({ kind: 'add' }) : undefined}
            extra={{ header: 'Access Status', cell: r => <AccessCell row={r} left={leftOf(r)} /> }}
            actions={r => {
              const own = isDirect(r.unlock);   // Branch Admin: straight to the credential
              const lk = own ? { icon: IC.view, title: 'View credential', cls: '' } : lockAction(r, leftOf(r));
              return (
                <>
                  <ActBtn icon={IC.edit} title="Edit" tone="edit" disabled={!r.can?.edit} onClick={() => setOverlay({ kind: 'edit', id: r.id })} />
                  <ActBtn icon={lk.icon} title={lk.title} className={lk.cls} onClick={() => (own ? setOverlay({ kind: 'view', id: r.id }) : openRow(r))} />
                  <ActBtn icon={IC.del} title="Move to Bin" tone="danger" disabled={!r.can?.delete} onClick={() => setOverlay({ kind: 'bin', row: r })} />
                </>
              );
            }} />

          <WorklistPager className="wl-teal" loading={loading}
            total={meta?.total ?? 0} page={meta?.current_page ?? page} pageSize={perPage}
            onPage={setPage} onPageSize={n => { setPerPage(n); setPage(1); }} />
        </div>
      </CvCard>

      {overlay?.kind === 'add' && (
        <CredentialFormModal critical onClose={close}
          onSaved={() => { close(); refresh(); }} />
      )}
      {overlay?.kind === 'edit' && (
        <CredentialFormModal credentialId={overlay.id} critical onClose={close} onSaved={() => { close(); refresh(); }}
          previewRow={CV_DUMMY ? rows.find(r => r.id === overlay.id) : undefined} />
      )}
      {overlay?.kind === 'view' && (
        <ViewDrawer key={overlay.id} credentialId={overlay.id} onClose={close} onChanged={refresh} source={viewSource}
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
