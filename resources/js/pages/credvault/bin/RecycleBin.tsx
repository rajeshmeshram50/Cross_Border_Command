import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import WorklistPager from '../../../components/ui/WorklistPager';
import { cvApi, type BinRow, type CredentialRow, type Loose, type PageMeta } from '../cvApi';
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
const URGENCY_FLAG = { bad: 'critical', warn: 'medium', ok: 'low' } as const;
const COLS = ['', 'Sr. No', 'Credential ID', 'Credential Name', 'Category', 'Owner', 'Risk', 'Deleted By', 'Deleted On', 'Auto-delete In', 'Action'];

type Ask = { kind: 'purge'; row: BinRow } | { kind: 'bulk'; ids: number[] } | { kind: 'empty' } | null;

export default function RecycleBin() {
  const toast = useToast();
  const { typeOf } = useCvMeta();
  const [tab, setTab] = useState('all');
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
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [retention, setRetention] = useState(false);
  const [reload, setReload] = useState(0);
  const [restoring, setRestoring] = useState<Set<number>>(new Set());

  const days: number = summary?.retention_days ?? 30;
  const purgeAllowed = !!summary?.purge_allowed;

  const filt = `${tab}|${dq}`;
  const lastFilt = useRef(filt);

  useEffect(() => {
    if (lastFilt.current !== filt) {
      lastFilt.current = filt;
      if (page !== 1) { setPage(1); return; }
    }
    let on = true;
    setLoading(true);
    cvApi.bin({ tab, q: dq, page, per_page: perPage }).then(r => {
      if (!on) return;
      setRows(r.data); setMeta(r.meta); setTabs(r.tabs); setSummary(r.summary); setError('');
      setSel(s => new Set([...s].filter(id => r.data.some(x => x.id === id))));
      if (r.purged > 0) toast.warning(`${r.purged} item${r.purged > 1 ? 's' : ''} permanently deleted after ${r.summary?.retention_days ?? ''} days`);
      if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
    }).catch(e => { if (on) setError(errMsg(e)); }).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [tab, dq, page, perPage, reload]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const restoreMany = async (ids: number[]) => {
    setBusy(true);
    const res = await Promise.allSettled(ids.map(id => cvApi.restore(id)));
    setBusy(false);
    const ok = res.filter(r => r.status === 'fulfilled').length;
    const bad = res.length - ok;
    if (ok) toast.success(`${ok} item${ok > 1 ? 's' : ''} restored`);
    if (bad) toast.error(`${bad} item${bad > 1 ? 's' : ''} could not be restored`, errMsg((res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason));
    setSel(new Set());
    refresh();
  };

  const confirmAsk = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask.kind === 'purge') {
        const r = await cvApi.purge(ask.row.id);
        toast.warning(r.message);
      } else if (ask.kind === 'empty') {
        const r = await cvApi.emptyBin();
        toast.warning(r.message);
      } else {
        const res = await Promise.allSettled(ask.ids.map(id => cvApi.purge(id)));
        const ok = res.filter(r => r.status === 'fulfilled').length;
        const bad = res.length - ok;
        if (ok) toast.warning(`${ok} item${ok > 1 ? 's' : ''} permanently deleted`);
        if (bad) toast.error(`${bad} item${bad > 1 ? 's' : ''} could not be deleted`, errMsg((res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason));
      }
      setSel(new Set());
      setAsk(null);
      refresh();
    } catch (e) {
      toast.error('Could not delete', errMsg(e));
    } finally { setBusy(false); }
  };

  const allOnPage = rows.length > 0 && rows.every(r => sel.has(r.id));
  const toggle = (id: number) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allOnPage ? new Set() : new Set(rows.map(r => r.id)));

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
  const bulk = sel.size > 0 ? (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      <span className="text-muted small"><b>{sel.size}</b> selected</span>
      <button type="button" className="btn btn-sm btn-soft-success" disabled={busy} onClick={() => restoreMany([...sel])}>
        <i className="ri-arrow-go-back-line me-1" />Restore
      </button>
      {purgeAllowed && (
        <button type="button" className="btn btn-sm btn-soft-danger" disabled={busy} onClick={() => setAsk({ kind: 'bulk', ids: [...sel] })}>
          <i className="ri-delete-bin-line me-1" />Delete permanently
        </button>
      )}
      <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => setSel(new Set())}>Clear</button>
    </div>
  ) : undefined;

  const askRow = ask?.kind === 'purge' ? ask.row : null;
  const empty = (summary?.items ?? 0) === 0;

  return (
    <CvPage className="mv-page rb-page tv-page">
      <CvStrip icon={IC.bin} title="Recycle Bin"
        sub={`Credentials moved to the bin stay here for ${days} days — restore them anytime, or delete them permanently.`}
        actions={
          <StripBtn icon={IC.bin} onClick={() => setAsk({ kind: 'empty' })} disabled={empty || !purgeAllowed}
            title={summary && !purgeAllowed ? 'Permanent delete is turned off in CredVault Policies' : undefined}>Empty Bin</StripBtn>
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
            <span>Items are permanently deleted {days} days after they are moved to the bin.</span>
            {summary?.can_change_retention && (
              <button type="button" data-h40="skip" className="rb-hero__btn" onClick={() => setRetention(true)}><Svg d={I_GEAR} size={11} />Change period</button>
            )}
          </div>
        </div>
        {card('teal', I_ALL, summary?.items ?? '—', 'Items in bin', 'Restorable until purged')}
        {card('sky', IC.user, summary?.deleted_by_me ?? '—', 'Deleted by me', 'Moved to bin by you')}
        {card('amber', I_SOON, summary?.expiring_soon ?? '—', 'Expiring soon', 'Deleted within 7 days')}
        {card('rose', I_SHIELD, summary?.critical ?? '—', 'Critical items', 'High-risk credentials in bin')}
        {card('green', I_CLOCK, next ? `${next.days} ${next.days === 1 ? 'day' : 'days'}` : '—', 'Next deletion', next ? `Deletes ${next.name}` : 'Bin is empty')}
      </div>

      <CvCard pane fit>
        <CvTabsRow tabs={TABS.map(t => ({ ...t, count: tabs[t.key] ?? null }))} active={tab} onTab={setTab}
          search={q} onSearch={setQ} placeholder="Search by credential ID, name, category or owner..." />
        {bulk}
        <div className="tvc-list">
          <div className="whm-tblwrap">
            <table className="whm-tbl mv-tbl">
              <thead>
                <tr>
                  <th><input type="checkbox" className="form-check-input" checked={allOnPage} onChange={toggleAll} aria-label="Select all on this page" /></th>
                  {COLS.slice(1).map(c => <th key={c}>{c}</th>)}
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
                          <td><input type="checkbox" className="form-check-input" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
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
                              <span className="mv-ownc__av">{initials(r.deleted_by.name)}</span>
                              <div><b>{r.deleted_by.name ?? '—'}</b></div>
                            </div>
                          </td>
                          <td><UpdatedCell iso={r.deleted_at} /></td>
                          <td>
                            <div className="whm-idcell">
                              <span className={`znm-flag mv-rk mv-rk--${URGENCY_FLAG[r.urgency]}`}><i />{r.days_left} {r.days_left === 1 ? 'day' : 'days'}</span>
                              <span className="whm-iddate">on {fmtDay(r.purges_at).replace(/ \d{4}$/, '')}</span>
                            </div>
                          </td>
                          <td>
                            <div className="whm-acts">
                              <ActBtn icon={IC.restore} title={restoring.has(r.id) ? 'Restoring…' : 'Restore'} disabled={restoring.has(r.id) || busy} onClick={() => restore(r)} />
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
              : ask.kind === 'bulk'
                ? { icon: IC.del, title: `${ask.ids.length} item${ask.ids.length > 1 ? 's' : ''} will be erased`, text: 'The selected credentials and all their saved data will be permanently deleted.' }
                : { icon: IC.del, title: `All ${summary?.items ?? 0} items will be erased`, text: 'Every item in the bin will be permanently deleted.' },
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
        <RetentionModal current={days} options={(summary.retention_options as number[] | undefined) ?? [7, 15, 30, 60, 90]}
          onClose={() => setRetention(false)}
          onSaved={() => { setRetention(false); refresh(); }} />
      )}
    </CvPage>
  );
}

function RetentionModal({ current, options, onClose, onSaved }: { current: number; options: number[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState(current);
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => options, [options]);

  const save = async () => {
    if (d === current) { onClose(); return; }
    setBusy(true);
    try {
      const r = await cvApi.savePolicies({ bin_days: d });
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
              <button key={o} type="button" data-h40="skip" className={`rb-opt${o === d ? ' is-on' : ''}`} onClick={() => setD(o)}><b>{o}</b><small>days</small></button>
            ))}
          </div>
          <div className="rb-ret__note"><Svg d={I_INFO} size={12} />Items already older than the new period are deleted right away.</div>
          <div className="dl-actions">
            <button type="button" data-h40="skip" className="dl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" data-h40="skip" className="dl-go rb-save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
