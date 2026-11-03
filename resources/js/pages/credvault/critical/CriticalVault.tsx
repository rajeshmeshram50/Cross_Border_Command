import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable, { ActionCell, PillCell, type DataTableColumn } from '../../../components/ui/DataTable';
import { cvApi, type CredentialRow, type PageMeta } from '../cvApi';
import { credentialColumns, cvTableProps, emptyState, TwoLine } from '../shared';
import { CvBrief, CvPage, CvStrip, IC, StripBtn, errMsg, mmss, useCvMeta, useDebounced, useNow } from '../shared';
import CredentialFormModal from '../form/CredentialFormModal';
import ViewDrawer from '../my-vault/ViewDrawer';
import ShareModal from '../my-vault/ShareModal';
import BinConfirm from '../my-vault/BinConfirm';
import UnlockModal from './UnlockModal';

const SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
const BRIEF_IC = {
  req: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  approve: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
};

const TABS = [
  { key: 'all', api: 'all', label: 'All Critical Credentials', icon: SHIELD },
  { key: 'mine', api: 'mine', label: 'My Critical Credentials', icon: IC.user },
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

function AccessCell({ row, left }: { row: CredentialRow; left: number | null }) {
  const a = row.unlock;
  if (!a) return <TwoLine top={<PillCell value="Open" />} sub="No unlock steps" />;
  if (a.state === 'open') {
    const l = Math.max(0, left ?? 0);
    return <TwoLine top={<PillCell value="Unlocked" tone={l < 60 ? 'warning' : 'success'} />} sub={<><b>{mmss(l)}</b> left</>} />;
  }
  if (a.state === 'pending') {
    return <TwoLine top={<PillCell value="Pending" tone="warning" />} sub={a.waiting_for ? `${a.waiting_for.role} · ${a.waiting_for.name}` : a.label} />;
  }
  if (a.state === 'progress') return <TwoLine top={<PillCell value="In progress" tone="info" />} sub={a.label} />;
  return <TwoLine top={<PillCell value="Locked" tone="danger" />} sub="Approval needed" />;
}

function lockAction(row: CredentialRow): { icon: string; tone: 'info' | 'success' | 'warning' | 'danger'; title: string } {
  const s = row.unlock?.state;
  if (!row.unlock) return { icon: 'ri-eye-line', tone: 'info', title: 'View credential' };
  if (s === 'open') return { icon: 'ri-lock-unlock-line', tone: 'success', title: 'Unlocked — view credential' };
  if (s === 'pending') return { icon: 'ri-time-line', tone: 'warning', title: 'Waiting for approval — view request' };
  if (s === 'progress') return { icon: 'ri-time-line', tone: 'warning', title: 'Continue unlocking' };
  return { icon: 'ri-lock-line', tone: 'danger', title: 'Unlock credential' };
}

export default function CriticalVault() {
  const { typeOf } = useCvMeta();
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
      const r = await cvApi.list({ risk: 'critical', tab: apiTab, q: dq.trim() || undefined, page, per_page: perPage });
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

  const anyOpen = rows.some(r => r.unlock?.state === 'open');
  const anyWaiting = rows.some(r => r.unlock?.state === 'pending' || r.unlock?.state === 'progress');
  const now = useNow(anyOpen);
  const leftOf = useCallback((r: CredentialRow) => (r.unlock?.state === 'open'
    ? (r.unlock.seconds_left ?? 0) - (now - fetchedAt) / 1000 : null), [now, fetchedAt]);
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
  const emptyText = error ? `Could not load critical credentials — ${error}`
    : dq ? 'No credentials match your search'
      : tab === 'team' ? 'Critical credentials owned by your team will appear here.'
        : tab === 'mine' ? 'Critical credentials you add will appear here.' : 'Critical credentials you add, or that your team owns, will appear here.';

  const columns = useMemo<DataTableColumn<CredentialRow>[]>(() => [
    ...credentialColumns({ critical: true, typeOf }),
    {
      header: 'Access Status', id: 'access', meta: { width: '10%' },
      cell: ({ row: { original: r } }) => <AccessCell row={r} left={leftOf(r)} />,
    },
    {
      header: 'Action', id: 'actions', meta: { width: '8%', align: 'center' },
      cell: ({ row: { original: r } }) => {
        const lk = lockAction(r);
        return (
          <div className="d-flex justify-content-center gap-1">
            <ActionCell title="Edit" icon="edit-svg" disabled={!r.can?.edit} onClick={() => setOverlay({ kind: 'edit', id: r.id })} />
            <ActionCell title={lk.title} icon={lk.icon} tone={lk.tone} onClick={() => openRow(r)} />
            <ActionCell title="Move to Bin" icon="trash-svg" tone="danger" disabled={!r.can?.delete} onClick={() => setOverlay({ kind: 'bin', row: r })} />
          </div>
        );
      },
    },
  ], [leftOf, openRow, typeOf]);

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

      <DataTable<CredentialRow> data={rows} columns={columns}
        {...cvTableProps({
          tabs: TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: tabs ? tabs[t.api] ?? 0 : undefined })),
          activeTab: tab, onTabChange: k => setTab(k as TabKey), search: q, onSearch: setQ,
          placeholder: 'Search by credential ID, name, category, username or owner...',
          loading, empty: emptyState(emptyText, 'ri-shield-keyhole-line'), minWidth: 1200,
          paging: { meta, page, setPage, setPerPage },
        })} />

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
