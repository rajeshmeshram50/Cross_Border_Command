import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type CredentialRow, type PageMeta } from '../cvApi';
import { copyText, CvBrief, CvPage, CvStrip, errMsg, StripBtn, Svg, useDebounced } from '../shared';
import WorklistPager from '../../../components/ui/WorklistPager';
import CredentialTable from '../my-vault/CredentialTable';
import ViewDrawer from '../my-vault/ViewDrawer';
import ShareModal from '../my-vault/ShareModal';
import BinConfirm from '../my-vault/BinConfirm';
import CredentialFormModal from '../form/CredentialFormModal';
import UnlockModal from '../critical/UnlockModal';
import TeamDetails, { type OpenDept } from './TeamDetails';
import ExportModal from './ExportModal';
import { tvData, TV_DUMMY } from './tvData';
import { LV_SHORT, TV_IC, type TreeNode } from './tvShared';

/**
 * CredVault · Team Vault — header strip with Export, the "What We Are Doing
 * Here" box, and the 2:8 split: Team Details (departments → hierarchy) on the
 * left, the credential list (My / Team tabs) on the right. Opening a
 * department narrows the list to it; picking a person narrows the Team tab to
 * what that person can open.
 */

type Tab = 'mine' | 'team';
const TABS: { k: Tab; l: string; i: string }[] = [
  { k: 'mine', l: 'My Credentials', i: TV_IC.user },
  { k: 'team', l: 'Team Credentials', i: TV_IC.team },
];

type Overlay =
  | { kind: 'view'; id: number }
  | { kind: 'form'; id?: number }
  | { kind: 'share'; id: number }
  | { kind: 'bin'; row: CredentialRow }
  | { kind: 'unlock'; id: number }
  | { kind: 'export' }
  | null;

export default function TeamVault() {
  const toast = useToast();
  const [dept, setDept] = useState<OpenDept | null>(null);
  const [member, setMember] = useState<TreeNode | null>(null);
  const [leftOff, setLeftOff] = useState(false);

  const [tab, setTab] = useState<Tab>('team');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [memberErr, setMemberErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const seq = useRef(0);
  const bdRef = useRef<HTMLDivElement | null>(null);

  const deptId = dept && dept.key !== 'admin' ? dept.key : null;
  // The admin node sees everything, as in the prototype — no member filter for it.
  const memberEmp = tab === 'team' && member?.employeeId ? member.employeeId : null;

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true); setLoadErr(null); setMemberErr(null);
    tvData.list({ tab, q: dq, page, per_page: pageSize, department_id: deptId, member_employee_id: memberEmp })
      .then(r => {
        if (my !== seq.current) return;
        setRows(r.data); setTabs(r.tabs); setMeta(r.meta);
        if (r.meta.last_page && page > r.meta.last_page) setPage(r.meta.last_page);
      })
      .catch(e => {
        if (my !== seq.current) return;
        setRows([]); setMeta(null);
        // A person with no CredVault login: nothing can be shared with them, so the filter is empty, not broken.
        if (memberEmp && e instanceof CvApiError && e.field('member_employee_id')) setMemberErr(e.message);
        else { setLoadErr(errMsg(e)); toast.error('Could not load credentials', errMsg(e)); }
      })
      .finally(() => { if (my === seq.current) setLoading(false); });
  // toast is stable; listing re-runs on the inputs below only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dq, page, pageSize, deptId, memberEmp, reload]);

  useEffect(() => { setPage(1); }, [dq]);

  const refresh = useCallback(() => setReload(n => n + 1), []);

  const openDept = (d: OpenDept | null) => {
    setDept(d); setMember(null); setPage(1);
    if (d) setTab('team');
  };
  const selectMember = (n: TreeNode | null) => { setMember(n); setPage(1); setTab('team'); };
  const goPage = (p: number) => { setPage(p); if (bdRef.current) bdRef.current.scrollTop = 0; };

  /* On dummy data the rows' ids exist nowhere on the server, so anything that
     would open or change a credential says so instead of failing - except
     Edit, which opens the real form prefilled from the row (nothing saved). */
  const open = (next: Overlay) => {
    if (TV_DUMMY && !(next?.kind === 'form' && next.id)) toast.info('Design preview', 'Team Vault is showing dummy data — this action opens once it is on live data.');
    else setOverlay(next);
  };

  const onCopy = async (row: CredentialRow) => {
    if (TV_DUMMY) { open(null); return; }
    try {
      const r = await cvApi.reveal(row.id, 'copy');
      await copyText(r.value, r.clear_clipboard_after);
      toast.success(`${r.label || 'Password'} copied`, r.clear_clipboard_after ? `Clipboard clears in ${r.clear_clipboard_after}s.` : undefined);
    } catch (e) {
      if (e instanceof CvApiError && e.status === 423) setOverlay({ kind: 'unlock', id: row.id });
      else toast.error('Could not copy', errMsg(e));
    }
  };

  const rightSub = dept
    ? `Credentials shared within ${dept.name}${member ? ` · ${member.name}` : ''}`
    : 'Credentials shared within the selected team';

  const total = meta?.total ?? 0;
  const perPage = meta?.per_page ?? 10;
  const showChip = tab === 'team' && member;

  let emptyTitle: string;
  let emptySub: string;
  if (showChip && member) {
    emptyTitle = `No team credentials for ${member.name}`;
    emptySub = memberErr ?? `${member.name} has not been given access to any credentials yet. Use Share on a credential to give access.`;
  } else if (loadErr) {
    emptyTitle = 'Could not load credentials';
    emptySub = loadErr;
  } else if (dq) {
    emptyTitle = 'No credentials match your search';
    emptySub = `Nothing matches “${dq}”. Try another ID, name, category, username or owner.`;
  } else if (tab === 'mine') {
    emptyTitle = 'No credentials of yours yet';
    emptySub = 'Credentials you own appear here. Add one to keep it in the vault.';
  } else {
    emptyTitle = dept && dept.key !== 'admin' ? `No team credentials in ${dept.name} yet` : 'No team credentials yet';
    emptySub = 'Save logins, API keys and accounts the whole team uses, instead of passing them around in chats or sheets.';
  }

  return (
    <CvPage className="mv-page tv-page">
      <CvStrip
        icon={TV_IC.team}
        title="Team Vault"
        sub="Shared credentials for your team — everyone with access uses the same login, with every view and copy recorded."
        actions={<StripBtn icon={TV_IC.download} onClick={() => open({ kind: 'export' })}>Export Credentials</StripBtn>}
      />

      <CvBrief
        icon={TV_IC.team}
        label="Team Vault"
        sub="Keeping your team's shared logins in one place, giving each member the right access, and tracking how they are used."
        defaultOpen
        steps={[
          { icon: TV_IC.cred, title: 'Add Team Credentials', desc: 'Save logins, API keys and accounts the whole team uses, instead of passing them around in chats or sheets.' },
          { icon: TV_IC.perm, title: 'Control Member Access', desc: 'Decide who can use, view, copy or fully manage each credential, and for how long.' },
          { icon: TV_IC.shield, title: 'Keep Them Secure', desc: 'Rotate passwords on schedule, turn on 2FA, and fix weak or expiring credentials.' },
          { icon: TV_IC.audit, title: 'Review Activity', desc: 'Every view, copy, share and change is recorded, so you always know who used what.' },
        ]}
      />

      <div className={`tv-split${leftOff ? ' is-l-off' : ''}`}>
        <section className="tv-pane tv-pane--l">
          <div className="tv-pane__hd">
            <span className="tv-pane__ico"><Svg d={TV_IC.team} size={14} sw={2.1} /></span>
            <div className="tv-pane__t"><b>Team Details</b><small>{dept ? 'Team structure by designation' : 'Select a department'}</small></div>
            <button type="button" className="tv-pane__tg" data-h40="skip" onClick={() => setLeftOff(true)} title="Hide panel" aria-label="Hide panel">
              <Svg d={TV_IC.chevLeft} size={13} sw={2.1} />
            </button>
          </div>
          <div className="tv-pane__rail" onClick={() => setLeftOff(false)} title="Show Team Details" role="button" aria-label="Show Team Details">
            <Svg d={TV_IC.team} size={14} sw={2.1} /><span>Team Details</span><Svg d={TV_IC.chevRight} size={12} sw={2.1} />
          </div>
          <TeamDetails dept={dept} onOpenDept={openDept} selected={member} onSelect={selectMember} />
        </section>

        <section className="tv-pane tv-pane--r">
          <div className="tv-pane__hd">
            <span className="tv-pane__ico"><Svg d={TV_IC.cred} size={14} sw={2.1} /></span>
            <div className="tv-pane__t"><b>Credentials</b><small>{rightSub}</small></div>
          </div>
          <div className="tv-pane__bd tvc-bd" ref={bdRef}>
            <div className="parch-main-row whm-main-row tvc-top">
              <div className="smt-proctype-tabs parch-main-tabs" role="tablist">
                {TABS.map(t => (
                  <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} data-pt="svc-phys"
                    className={`smt-proctype-tab${tab === t.k ? ' is-active' : ''}`}
                    onClick={() => { setTab(t.k); setPage(1); }}>
                    <span className="smt-proctype-tab__ico"><Svg d={t.i} size={15} /></span>
                    <span className="smt-proctype-tab__lbl">{t.l}</span>
                    <span className="bst-tab-c parch-main-c">{tabs[t.k] ?? '·'}</span>
                  </button>
                ))}
              </div>
              <div className="bst-search parch-search whm-main-search">
                <Svg d={TV_IC.search} size={14} stroke="#94a3b8" />
                <input type="text" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" aria-label="Search"
                  placeholder="Search by credential ID, name, category, username or owner..." />
                {q && (
                  <button type="button" className="bst-search-clear" onClick={() => setQ('')} aria-label="Clear search">
                    <Svg d={TV_IC.close} size={13} sw={2.4} />
                  </button>
                )}
              </div>
            </div>

            <div className="tvc-list">
              {showChip && member && (
                <div className={`tvc-fil tvx-lv--${member.lv}`}>
                  <span className="tvc-fil__av">{member.initials}</span>
                  <span className="tvc-fil__t">
                    <small>Showing credentials accessible to</small>
                    <b>{member.name}<em>{LV_SHORT[member.lv]}</em><i>{member.desig}</i></b>
                  </span>
                  <span className="tvc-fil__n"><b>{loading ? '·' : total}</b> credential{total === 1 ? '' : 's'}</span>
                  <button type="button" data-h40="skip" className="tvc-fil__x" onClick={() => selectMember(null)}>
                    <Svg d={TV_IC.close} size={11} sw={2.8} />Clear filter
                  </button>
                </div>
              )}
              <CredentialTable
                rows={rows}
                startIndex={((meta?.current_page ?? page) - 1) * perPage}
                loading={loading}
                emptyTitle={emptyTitle}
                emptySub={emptySub}
                onAdd={showChip || loadErr || dq ? undefined : () => open({ kind: 'form' })}
                onEdit={r => open({ kind: 'form', id: r.id })}
                onShare={r => open({ kind: 'share', id: r.id })}
                onView={r => open({ kind: 'view', id: r.id })}
                onCopy={onCopy}
                onDelete={r => open({ kind: 'bin', row: r })}
              />
              {/* The house pager (CLM, SPI): Showing pill, Rows per page, page pill, arrows. */}
              <WorklistPager className="wl-teal" loading={loading}
                total={total} page={meta?.current_page ?? page} pageSize={pageSize}
                onPage={goPage} onPageSize={n => { setPageSize(n); setPage(1); }} />

            </div>
          </div>
        </section>
      </div>

      {overlay?.kind === 'view' && (
        <ViewDrawer key={overlay.id} credentialId={overlay.id} onClose={() => setOverlay(null)} onChanged={refresh}
          onEdit={id => setOverlay({ kind: 'form', id })} onShare={id => setOverlay({ kind: 'share', id })} />
      )}
      {overlay?.kind === 'form' && (
        <CredentialFormModal credentialId={overlay.id} scope="team" departmentId={deptId}
          previewRow={TV_DUMMY && overlay.id ? rows.find(r => r.id === overlay.id) : undefined}
          onClose={() => setOverlay(null)} onSaved={() => { setOverlay(null); refresh(); }} />
      )}
      {overlay?.kind === 'share' && (
        <ShareModal credentialId={overlay.id} onClose={() => setOverlay(null)} onShared={refresh} />
      )}
      {overlay?.kind === 'bin' && (
        <BinConfirm row={overlay.row} onClose={() => setOverlay(null)} onDone={() => { setOverlay(null); refresh(); }} />
      )}
      {overlay?.kind === 'unlock' && (
        <UnlockModal credentialId={overlay.id} onClose={() => setOverlay(null)} onChanged={refresh}
          onFullDetails={id => setOverlay({ kind: 'view', id })} />
      )}
      {overlay?.kind === 'export' && <ExportModal scope="team" onClose={() => setOverlay(null)} />}
    </CvPage>
  );
}
