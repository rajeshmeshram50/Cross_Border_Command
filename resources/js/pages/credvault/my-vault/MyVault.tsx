import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import DataTable, { ActionCell, IdCell, PillCell, TruncCell, type DataTableColumn, type DataTableTab } from '../../../components/ui/DataTable';
import { cvApi, CvApiError, type CredentialRow, type PageMeta, type ShareRow } from '../cvApi';
import { credentialColumns, cvTableProps, emptyState, PERM_TONE, TwoLine, type Tone } from '../shared';
import UnlockModal from '../critical/UnlockModal';
import CredentialFormModal from '../form/CredentialFormModal';
import {
  ConfirmModal, copyText, CvBrief, CvPage, CvStrip, errMsg, fmtDate, fmtDay, fmtTime,
  IC, StripBtn, useCvMeta, useDebounced,
} from '../shared';
import BinConfirm from './BinConfirm';
import GeneratorModal from './GeneratorModal';
import ShareModal from './ShareModal';
import ViewDrawer from './ViewDrawer';

type TabKey = 'all' | 'mine' | 'team' | 'shared' | 'sharedby';

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
const STEPS = [
  { icon: STEP_ICO.cred, title: 'Add Credential', desc: 'Save a login, secure note, card, or API key with its URL, username, and password.' },
  { icon: STEP_ICO.folder, title: 'Organise with Folders & Tags', desc: 'Group credentials by system, project, or purpose so they are quick to find.' },
  { icon: IC.shield, title: 'Keep Passwords Strong', desc: 'Generate strong passwords and fix weak, reused, or expiring ones flagged by Password Health.' },
  { icon: IC.share, title: 'Share Securely When Needed', desc: 'Share a credential with a colleague or team, with view-only or edit access you can revoke.' },
];
const BAN = '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>';

const STATE_LABEL: Record<ShareRow['state'], string> = { active: 'Active', soon: 'Expiring soon', expired: 'Expired', revoked: 'Revoked' };
const STATE_TONE: Record<ShareRow['state'], Tone> = { active: 'success', soon: 'warning', expired: 'neutral', revoked: 'danger' };

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
  const [perPage, setPerPage] = useState(10);
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

  const [shareCred, setShareCred] = useState<number | null>(null);

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
          const [r, c] = await Promise.all([
            cvApi.sharedByMe({ q: dq, page, per_page: perPage, ...(shareCred ? { credential_id: shareCred } : {}) }),
            cvApi.list({ tab: 'all', page: 1, per_page: 1 }),
          ]);
          if (n !== seq.current) return;
          if (!r.data.length && page > 1 && r.meta.last_page < page) { setPage(Math.max(1, r.meta.last_page)); return; }
          setShares(r.data); setPm(r.meta); setCounts(c.tabs);
        } else {
          const r = await cvApi.list({ tab, q: dq, page, per_page: perPage });
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
  }, [tab, dq, page, perPage, tick, shareCred]);

  const copyPw = useCallback(async (r: CredentialRow) => {
    try {
      const d = await cvApi.reveal(r.id, 'copy');
      await copyText(d.value, d.clear_clipboard_after);
      toast.success(`${d.label} for ${r.name} copied`, d.clear_clipboard_after ? `The clipboard clears in ${d.clear_clipboard_after} seconds.` : undefined);
    } catch (e) {
      if (e instanceof CvApiError && e.status === 423) { setUnlockId(r.id); return; }
      toast.error('Could not copy', errMsg(e));
    }
  }, [toast]);

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

  const credCols = useMemo<DataTableColumn<CredentialRow>[]>(() => [
    ...credentialColumns(),
    {
      header: 'Action', id: 'actions', meta: { width: '11%', align: 'center' },
      cell: ({ row: { original: r } }) => {
        const can = r.can;
        return (
          <div className="d-flex justify-content-center gap-1">
            <ActionCell title="Edit" icon="edit-svg" onClick={() => setForm({ credentialId: r.id })} disabled={!can?.edit} />
            <ActionCell title="Share" icon="ri-share-line" tone="info" onClick={() => setShareId(r.id)} disabled={!can?.share} />
            <ActionCell title="View" icon="ri-eye-line" tone="info" onClick={() => setViewId(r.id)} />
            <ActionCell title="Copy Password" icon="ri-file-copy-line" tone="success" onClick={() => copyPw(r)} disabled={!can?.copy} />
            <ActionCell title={can?.remove ? 'Remove from your vault' : 'Move to Bin'} icon="trash-svg" tone="danger"
              onClick={() => setBinRow(r)} disabled={!(can?.delete || can?.remove)} />
          </div>
        );
      },
    },
  ], [copyPw]);

  const shareCols = useMemo<DataTableColumn<ShareRow>[]>(() => [
    {
      header: 'Credential ID', id: 'code', meta: { width: '9%' },
      cell: ({ row: { original: s } }) => <TwoLine top={<IdCell value={s.credential?.code} />} sub={fmtDate(s.credential?.updated_at)} />,
    },
    {
      header: 'Credential Name', id: 'name', meta: { width: '15%' },
      cell: ({ row: { original: s } }) => <TwoLine top={<b><TruncCell value={s.credential?.name ?? 'Deleted credential'} caseSensitive max={40} /></b>} sub={s.credential?.url ?? undefined} />,
    },
    {
      header: 'Shared With', id: 'to', meta: { width: '14%' },
      cell: ({ row: { original: s } }) => <TwoLine top={s.recipient.name ?? '—'} sub={s.recipient.sub} />,
    },
    {
      header: 'Permission', id: 'perm', meta: { width: '9%', align: 'center' },
      cell: ({ row: { original: s } }) => <PillCell value={s.permission_label} tone={PERM_TONE[s.permission]} />,
    },
    {
      header: 'Shared On', id: 'on', meta: { width: '9%' },
      cell: ({ row: { original: s } }) => <TwoLine top={fmtDay(s.shared_at)} sub={fmtTime(s.shared_at)} />,
    },
    {
      header: 'Expires', id: 'exp', meta: { width: '10%' },
      cell: ({ row: { original: s } }) => (s.expires_at
        ? <TwoLine top={fmtDay(s.expires_at)} sub={expiresLeft(s)} />
        : <TwoLine top="No expiry" sub="Until revoked" />),
    },
    {
      header: 'Reason', id: 'reason', meta: { width: '12%' },
      cell: ({ row: { original: s } }) => <TruncCell value={s.reason} caseSensitive max={40} />,
    },
    {
      header: 'Status', id: 'state', meta: { width: '9%', align: 'center' },
      cell: ({ row: { original: s } }) => <PillCell value={STATE_LABEL[s.state]} tone={STATE_TONE[s.state]} />,
    },
    {
      header: 'Action', id: 'actions', meta: { width: '9%', align: 'center' },
      cell: ({ row: { original: s } }) => {
        const c = s.credential;
        const dead = s.state === 'revoked' || s.state === 'expired';
        return (
          <div className="d-flex justify-content-center gap-1">
            <ActionCell title="View credential" icon="ri-eye-line" tone="info" disabled={!c} onClick={() => c && setViewId(c.id)} />
            <ActionCell title="Share again" icon="ri-share-line" tone="info" disabled={!c} onClick={() => c && setShareId(c.id)} />
            <ActionCell title={dead ? STATE_LABEL[s.state] : 'Revoke access'} icon="ri-forbid-line" tone="danger" disabled={dead} onClick={() => setRevoke(s)} />
          </div>
        );
      },
    },
  ], []);

  const tabs: DataTableTab[] = TABS.map(t => ({ key: t.k, label: t.l, icon: t.i, count: counts ? counts[t.k] ?? 0 : undefined }));
  const tabLabel = TABS.find(t => t.k === tab)?.l ?? 'My Vault';
  const onTab = (k: string) => { setTab(k as TabKey); setPage(1); setShareCred(null); };

  const emptyMessage = tab === 'sharedby'
    ? (failed ? `Could not load your shares — ${failed}` : dq ? 'No shares match your search' : 'You haven’t shared any credentials yet')
    : failed ? `Could not load credentials — ${failed}`
      : dq ? 'No credentials match your search'
        : tab === 'shared' ? 'Credentials that colleagues share with you will appear here.'
          : `Credentials you add to ${tab === 'all' ? 'My Vault' : tabLabel} will appear here.`;

  const common = cvTableProps({
    tabs, activeTab: tab, onTabChange: onTab, search: q, onSearch: setQ,
    placeholder: tab === 'sharedby' ? 'Search by credential ID, name, person, team or reason...' : 'Search by credential ID, name, category, username or owner...',
    loading, empty: emptyState(emptyMessage),
    paging: { meta: pm, page, setPage, setPerPage },
  });

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
        steps={STEPS} />

      {tab === 'sharedby'
        ? <DataTable<ShareRow> key="sharedby" data={shares} columns={shareCols} {...common}
            rowClassName={s => (s.state === 'revoked' || s.state === 'expired' ? 'opacity-50' : undefined)} />
        : <DataTable<CredentialRow> key="creds" data={rows} columns={credCols} {...common} />}

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
