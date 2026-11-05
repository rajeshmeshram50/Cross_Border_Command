import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import WorklistPager from '../../../components/ui/WorklistPager';
import { cvApi, type BinCounts, type BinRow, type BinVault, type CredentialRow, type Loose, type PageMeta } from '../cvApi';
import {
  ActBtn, CategoryCell, ConfirmModal, CvBrief, CvCard, CvPage, CvPortal, CvStrip, CvTabsRow, EmptyRow, NameCell, RiskFlag, ShimRows, StripBtn,
  Svg, IC, UpdatedCell, errMsg, fmtDay, initials, useCvMeta, useDebounced,
} from '../shared';

const I_ALL = '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><line x1="10" y1="12" x2="14" y2="12"/>';
const I_SOON = '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>';
const I_CLOCK = '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>';
const I_SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
const I_GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
const I_INFO = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';

const TABS: { key: string; label: string; icon: string }[] = [
  { key: 'all', label: 'All Items', icon: I_ALL },
  { key: 'mine', label: 'Deleted by Me', icon: IC.user },
  { key: 'team', label: 'Team Credentials', icon: IC.users },
  { key: 'soon', label: 'Expiring Soon', icon: I_SOON },
];
/* Sub-tabs under the main tabs: each vault keeps its own bin (retention, who may restore). */
const VAULT_TABS: { key: BinVault; label: string; icon: string }[] = [
  { key: 'normal', label: 'Normal Credentials', icon: IC.lock },
  { key: 'critical', label: 'Critical Credentials', icon: I_SHIELD },
];
const VAULT_LABEL: Record<BinVault, string> = { normal: 'Normal Vault', critical: 'Critical Vault' };
const COLS = ['Sr. No', 'Credential ID', 'Credential Name', 'Category', 'Owner', 'Risk', 'Deleted By', 'Deleted On', 'Auto-delete In', 'Action'];

type Ask = { kind: 'purge'; row: BinRow } | { kind: 'empty' } | null;

export default function RecycleBin() {
  const toast = useToast();
  const { typeOf } = useCvMeta();
  const [tab, setTab] = useState('all');
  const [vault, setVault] = useState<BinVault>('normal');
  const [counts, setCounts] = useState<Record<BinVault | 'total', BinCounts> | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [rows, setRows] = useState<BinRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<Loose | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [retention, setRetention] = useState(false);
  const [reload, setReload] = useState(0);
  const [restoring, setRestoring] = useState<Set<number>>(new Set());

  const days: number = summary?.retention_days ?? 30;
  const purgeAllowed = !!summary?.purge_allowed;
  const canEmpty = !!summary?.can_empty;

  const filt = `${tab}|${vault}|${dq}`;
  const lastFilt = useRef(filt);

  useEffect(() => {
    if (lastFilt.current !== filt) {
      lastFilt.current = filt;
      if (page !== 1) { setPage(1); return; }
    }
    let on = true;
    setLoading(true);
    cvApi.bin({ tab, vault, q: dq, page, per_page: perPage }).then(r => {
      if (!on) return;
      setRows(r.data); setMeta(r.meta); setTabs(r.tabs); setCounts(r.counts ?? null); setSummary(r.summary); setError('');
      if (r.purged > 0) toast.warning(`${r.purged} item${r.purged > 1 ? 's' : ''} permanently deleted after ${r.summary?.retention_days ?? ''} days`);
      if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
    }).catch(e => { if (on) { setError(errMsg(e)); setRows([]); } }).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [tab, vault, dq, page, perPage, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => setReload(n => n + 1), []);

  const restore = async (row: BinRow) => {
    if (restoring.has(row.id)) return;
    setRestoring(s => new Set(s).add(row.id));
    try {
      const r = await cvApi.restore(row.id);
      toast.success(r.message);
      refresh();
    } catch (e) { toast.error('Could not restore', errMsg(e)); }
    finally { setRestoring(s => { const n = new Set(s); n.delete(row.id); return n; }); }
  };

  const confirmAsk = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask.kind === 'purge') {
        const r = await cvApi.purge(ask.row.id);
        toast.warning(r.message);
      } else {
        // Only the vault on screen — the confirm popup names it and counts its items.
        const r = await cvApi.emptyBin(vault);
        toast.warning(r.message);
      }
      setAsk(null);
      refresh();
    } catch (e) {
      toast.error('Could not delete', errMsg(e));
    } finally { setBusy(false); }
  };

  const next = summary?.next_deletion as { name: string; at: string; days: number } | null | undefined;
  const card = (cls: string, ico: string, n: ReactNode, l: string, sub: string) => (
    <div className={`phx-card phx-card--${cls}`}>
      <span className="phx-card__glow" />
      <div className="phx-card__top"><span className="phx-card__ico"><Svg d={ico} size={16} /></span><b className="phx-card__n">{n}</b></div>
      <span className="phx-card__l">{l}</span>
      <small className="phx-card__s rb-sub">{sub}</small>
    </div>
  );

  const start = meta ? (meta.current_page - 1) * meta.per_page : 0;

  const askRow = ask?.kind === 'purge' ? ask.row : null;
  const empty = (summary?.items ?? 0) === 0;

  return (
    <CvPage className="mv-page rb-page tv-page">
      <CvStrip icon={IC.bin} title="Recycle Bin"
        sub={`Credentials moved to the bin stay here for ${days} days — restore them anytime, or delete them permanently.`}
        actions={
          <StripBtn icon={IC.bin} onClick={() => setAsk({ kind: 'empty' })} disabled={empty || !canEmpty}
            title={summary && !purgeAllowed ? 'Permanent delete is turned off in CredVault Policies'
              : summary && !canEmpty ? (summary.is_bin_admin ? 'Only the Branch Admin can empty the Critical Vault bin' : 'Only a Vault Admin (client admin or Branch Admin) can empty the bin') : undefined}>Empty Bin</StripBtn>
        } />

      <CvBrief icon={IC.bin} label="Recycle Bin" sub="Keeping removed credentials safe for a set period so nothing is lost by mistake."
        steps={[
          { icon: IC.bin, title: 'Move to Bin', desc: 'Credentials removed from My Vault, Team Vault or Critical Vault come here instead of being erased.' },
          { icon: IC.restore, title: 'Restore Anytime', desc: 'Restore a credential to its vault with all its fields, owner and settings.' },
          { icon: I_CLOCK, title: `Auto-delete After ${days} Days`, desc: 'Items are permanently deleted when the retention period ends. You can change the period.' },
          { icon: IC.close, title: 'Delete Permanently', desc: 'Erase an item right away, or empty the whole bin. This cannot be undone.' },
        ]} />

      <div className="rbx">
        <div className="phx-score rb-hero">
          <span className="phx-score__dots" />
          <span className="rb-hero__ico"><Svg d={IC.bin} size={26} /></span>
          <div className="phx-score__t">
            <small>Retention period</small>
            <b>{summary ? `${days} days` : '—'}</b>
            <span>{summary?.retention_fixed
              ? `Critical Vault items are permanently deleted ${days} days after they are moved to the bin. This period is fixed.`
              : `Items are permanently deleted ${days} days after they are moved to the bin.`}</span>
            {summary && (
              <button type="button" data-h40="skip" className="rb-hero__btn" onClick={() => setRetention(true)}><Svg d={I_GEAR} size={11} />Change period</button>
            )}
          </div>
        </div>
        {card('teal', I_ALL, summary?.items ?? '—', 'Items in bin', 'Restorable until purged')}
        {card('sky', IC.user, summary?.deleted_by_me ?? '—', 'Deleted by me', 'Moved to bin by you')}
        {card('amber', I_SOON, summary?.expiring_soon ?? '—', 'Expiring soon', 'Auto-deletes within 7 days')}
        {card('rose', I_SHIELD, summary?.critical ?? '—', 'Critical items', 'High-risk credentials in bin')}
        {card('green', I_CLOCK, next ? `${next.days} ${next.days === 1 ? 'day' : 'days'}` : '—', 'Next deletion', next ? `Deletes ${next.name}` : 'Bin is empty')}
      </div>

      <CvCard pane fit>
        <CvTabsRow tabs={TABS.map(t => ({ ...t, count: counts?.total[t.key as keyof BinCounts] ?? tabs[t.key] ?? null }))} active={tab} onTab={setTab}
          search={q} onSearch={setQ} placeholder="Search by credential ID, name, category or owner..." />
        <div className="rb-sub">
          <div className="rb-subtabs" role="tablist" aria-label="Vault">
            {VAULT_TABS.map(v => (
              <button key={v.key} type="button" role="tab" data-h40="skip" aria-selected={vault === v.key}
                className={`rb-subtab${vault === v.key ? ' is-active' : ''}`} onClick={() => setVault(v.key)}>
                <Svg d={v.icon} size={14} />{v.label}
                <span className="rb-subtab-c">{counts?.[v.key]?.[tab as keyof BinCounts] ?? '·'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tvc-list">
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl">
              <thead>
                <tr>
                  {COLS.map(c => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading && !rows.length ? <ShimRows cols={COLS.length} />
                  : error ? <EmptyRow cols={COLS.length} title="Could not load the recycle bin" sub={error}
                    action={<button type="button" className="mv-empty__btn" onClick={refresh}><Svg d={IC.restore} size={13} />Try again</button>} />
                    : !rows.length ? <EmptyRow cols={COLS.length} title={dq ? 'No items match your search' : 'The recycle bin is empty'}
                      sub={dq ? 'Try a credential name, ID, owner or category.' : `Credentials you move to the bin stay here for ${days} days.`} />
                      : rows.map((r, i) => (
                        <tr key={r.id}>
                          <td><span className="whm-sr">{start + i + 1}</span></td>
                          <td><div className="whm-idcell"><span className="whm-idpill">{r.code}</span><span className="whm-iddate">{r.type_label}</span></div></td>
                          <td><NameCell row={{ name: r.name, url: r.url, access: undefined } as unknown as CredentialRow} typeIcon={typeOf(r.type)?.icon} /></td>
                          <td><CategoryCell label={r.type_label} group={r.category_group} /></td>
                          <td>
                            <div className="mv-ownc">
                              <span className="mv-ownc__av">{initials(r.owner.name)}</span>
                              <div><b>{r.owner.is_me ? 'You' : (r.owner.name ?? '—')}</b>{r.scope === 'team' ? <em className="mv-team">Team</em> : <em className="mv-pers">Personal</em>}</div>
                            </div>
                          </td>
                          <td><RiskFlag risk={r.risk} /></td>
                          <td>
                            <div className="mv-ownc">
                              <span className="mv-ownc__av">{r.deleted_by.initials || initials(r.deleted_by.name)}</span>
                              <div><b>{r.deleted_by.name ?? '—'}</b></div>
                            </div>
                          </td>
                          <td><UpdatedCell iso={r.deleted_at} /></td>
                          <td>
                            {/* Days left, a bar of the retention period still left, and the purge date. */}
                            <div className={`rb-left rb-left--${r.urgency}`} title={`Deleted permanently on ${fmtDay(r.purges_at)}`}>
                              <b className="rb-left__n">{r.days_left} {r.days_left === 1 ? 'day' : 'days'}</b>
                              <span className="rb-left__bar"><i style={{ width: `${Math.max(3, Math.min(100, r.left_pct))}%` }} /></span>
                              <small className="rb-left__on">on {fmtDay(r.purges_at).replace(/ \d{4}$/, '')}</small>
                            </div>
                          </td>
                          <td>
                            <div className="whm-acts">
                              <button type="button" data-h40="skip" className="mapsup-footer__btn mapsup-footer__btn--primary"
                                disabled={!r.can_restore || restoring.has(r.id) || busy} title={r.can_restore ? undefined : (r.locked_reason ?? undefined)} onClick={() => restore(r)}>
                                <Svg d={IC.restore} size={13} />{restoring.has(r.id) ? 'Restoring…' : 'Restore'}
                              </button>
                              {r.can_purge && <ActBtn icon={IC.del} title="Delete permanently" tone="danger" onClick={() => setAsk({ kind: 'purge', row: r })} />}
                            </div>
                          </td>
                        </tr>
                      ))}
              </tbody>
            </table>
          </div>
          <WorklistPager className="wl-teal" loading={loading}
            total={error ? 0 : meta?.total ?? 0} page={meta?.current_page ?? page} pageSize={perPage}
            onPage={setPage} onPageSize={n => { setPerPage(n); setPage(1); }} />
        </div>
      </CvCard>

      {ask && (
        <ConfirmModal
          icon={IC.bin}
          title={ask.kind === 'empty' ? 'Empty the recycle bin?' : 'Delete permanently?'}
          sub="This cannot be undone."
          cred={askRow ? { icon: typeOf(askRow.type)?.icon, name: askRow.name, code: askRow.code, meta: ` · ${askRow.type_label}`, risk: askRow.risk } : undefined}
          points={[
            ask.kind === 'purge'
              ? { icon: IC.del, title: 'All saved data is erased', text: <><b>{askRow?.name}</b> and all its saved data will be erased.</> }
              : { icon: IC.del, title: `All ${summary?.items ?? 0} ${VAULT_LABEL[vault]} items will be erased`, text: `Every ${VAULT_LABEL[vault]} item in the bin will be permanently deleted. The other vault's bin is not touched.` },
            { icon: IC.restore, title: 'No way back', text: 'Deleted items cannot be restored from the bin or anywhere else.' },
          ]}
          ackLabel={ask.kind === 'purge' ? 'I understand this credential cannot be restored.' : 'I understand none of these credentials can be restored.'}
          confirmLabel={ask.kind === 'empty' ? 'Empty Bin' : 'Delete Permanently'}
          confirmIcon={IC.bin}
          busy={busy}
          onConfirm={confirmAsk}
          onClose={() => { if (!busy) setAsk(null); }}
        />
      )}

      {retention && summary && (
        <RetentionModal current={days}
          options={(summary.retention_options as number[] | undefined)?.length ? summary.retention_options as number[] : [7, 15, 30, 60, 90]}
          fixed={!!summary.retention_fixed} canChange={!!summary.can_change_retention}
          onClose={() => setRetention(false)}
          onSaved={() => { setRetention(false); refresh(); }} />
      )}
    </CvPage>
  );
}

/**
 * The Change period popup. Normal Vault: a Vault Admin picks 7–90 days. Everyone else sees the
 * period read-only, and the Critical Vault's period is fixed — same popup, Save switched off.
 */
function RetentionModal({ current, options, fixed, canChange, onClose, onSaved }: {
  current: number; options: number[]; fixed: boolean; canChange: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState(current);
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => options, [options]);
  // Locked for the Critical Vault's fixed period, and for anyone who is not a Vault Admin (client admin or Branch Admin).
  const locked = fixed || !canChange;

  const save = async () => {
    if (locked || d === current) { onClose(); return; }
    setBusy(true);
    try {
      const r = await cvApi.saveBinRetention(d);
      const n = r.data.purged ?? 0;
      toast.success(`Retention set to ${d} days${n ? ` · ${n} expired item${n > 1 ? 's' : ''} deleted` : ''}`);
      onSaved();
    } catch (e) {
      toast.error('Could not change the period', errMsg(e));
      setBusy(false);
    }
  };

  return (
    <CvPortal onClose={onClose}>
      <div className="dl-ov">
        <div className="dl-modal rb-ret" role="dialog" aria-modal="true" aria-label="Retention period">
          <div className="dl-ico rb-ret__ico"><Svg icon="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2" size={30} sw={2.1} /></div>
          <div className="dl-title">Retention period</div>
          <div className="dl-text">Choose how long credentials stay in the recycle bin before they are permanently deleted.</div>
          <div className="rb-opts">
            {opts.map(o => (
              <button key={o} type="button" data-h40="skip" className={`rb-opt${o === d ? ' is-on' : ''}`} disabled={locked && o !== d}
                onClick={() => { if (!locked) setD(o); }}><b>{o}</b><small>days</small></button>
            ))}
          </div>
          <div className="rb-ret__note"><Svg d={I_INFO} size={12} />{fixed
            ? `The Critical Vault keeps binned items a fixed ${current} days. This period cannot be changed.`
            : !canChange ? 'Only a Vault Admin (client admin or Branch Admin) can change the retention period.'
              : 'Items already older than the new period are deleted right away.'}</div>
          <div className="dl-actions">
            <button type="button" data-h40="skip" className="dl-cancel" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="button" data-h40="skip" className="dl-go rb-save" disabled={busy || locked} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
