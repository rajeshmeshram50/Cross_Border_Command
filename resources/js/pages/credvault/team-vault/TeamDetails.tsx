import { useEffect, useMemo, useRef, useState } from 'react';
import { cvApi, type Loose } from '../cvApi';
import { errMsg, initials, Svg } from '../shared';
import { buildHierarchy, deptIcon, LV_ORDER, LV_SHORT, toCounts, TV_IC, type Hierarchy, type LevelCounts, type TreeNode } from './tvShared';

/**
 * Team Vault · left pane "Team Details": the department cards (with the
 * admin card on top) and, once one is opened, its hero, level counts and the
 * expandable team hierarchy. Picking a person narrows the credential list.
 */

export interface OpenDept { key: 'admin' | number; name: string }

function Dist({ cnt, cls = 'tvx-dist' }: { cnt: LevelCounts; cls?: string }) {
  return (
    <div className={cls}>
      {LV_ORDER.filter(l => cnt[l]).map(l => (
        <i key={l} className={`tvx-lv--${l}`} style={{ flex: cnt[l] }} title={`${LV_SHORT[l]}: ${cnt[l]}`} />
      ))}
    </div>
  );
}

function Node({ x, open, sel, onTog, onSel }: {
  x: TreeNode; open: Record<string, boolean>; sel: string | null;
  onTog: (id: string) => void; onSel: (x: TreeNode) => void;
}) {
  const has = x.kids.length > 0;
  const isOpen = open[x.id] !== false;
  return (
    <div className={`tvx-n${isOpen ? ' is-open' : ''}`}>
      <div className={`tvx-card tvx-lv--${x.lv}${sel === x.id ? ' is-sel' : ''}`} onClick={() => onSel(x)} title={`${x.name} — ${x.desig}`}>
        <span className="tvx-av">{x.initials}</span>
        <span className="tvx-tx"><b>{x.name}</b><small><em>{LV_SHORT[x.lv]}</em>{x.desig}</small></span>
        {has && (
          <span className="tvx-rep" title={`${isOpen ? 'Hide' : 'Show'} ${x.kids.length} direct report${x.kids.length > 1 ? 's' : ''}`}
            onClick={e => { e.stopPropagation(); onTog(x.id); }}>
            {x.kids.length}<Svg d={TV_IC.chevDown} size={11} sw={2.8} />
          </span>
        )}
      </div>
      {/* Closed branches are hidden by CSS anyway; not rendering them keeps a large organisation light. */}
      {has && isOpen && (
        <div className="tvx-kids">
          {x.kids.map(k => <Node key={k.id} x={k} open={open} sel={sel} onTog={onTog} onSel={onSel} />)}
        </div>
      )}
    </div>
  );
}

export default function TeamDetails({ dept, onOpenDept, selected, onSelect }: {
  dept: OpenDept | null;
  onOpenDept: (d: OpenDept | null) => void;
  selected: TreeNode | null;
  onSelect: (n: TreeNode | null) => void;
}) {
  const [list, setList] = useState<Loose | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tree, setTree] = useState<Hierarchy | null>(null);
  const [stats, setStats] = useState<Loose | null>(null);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [exp, setExp] = useState<'exp' | 'col'>('exp');
  const bdRef = useRef<HTMLDivElement | null>(null);

  const loadList = () => {
    setListErr(null);
    cvApi.departments().then(setList).catch(e => setListErr(errMsg(e)));
  };
  useEffect(loadList, []);

  const admins: Loose[] = list?.admin?.admins ?? [];
  const adminName = admins[0]?.name || 'Vault Administrator';
  const departments: Loose[] = list?.departments ?? [];

  useEffect(() => {
    if (!dept) { setTree(null); setStats(null); setTreeErr(null); return; }
    let on = true;
    setTreeLoading(true); setTreeErr(null); setTree(null);
    const req = dept.key === 'admin' ? cvApi.organisation() : cvApi.department(dept.key);
    req.then(d => {
      if (!on) return;
      const h = buildHierarchy(d.members ?? [], {
        name: adminName,
        desig: dept.key === 'admin' ? 'Vault Administrator · All departments' : 'Vault Administrator',
      });
      setTree(h); setStats(d.stats ?? null);
      // The organisation opens with every HOD folded, as the prototype's "View all" did.
      if (dept.key === 'admin') {
        const o: Record<string, boolean> = {};
        h.root.kids.forEach(k => { o[k.id] = false; });
        setOpen(o); setExp('col');
      } else { setOpen({}); setExp('exp'); }
    }).catch(e => { if (on) setTreeErr(errMsg(e)); }).finally(() => { if (on) setTreeLoading(false); });
    return () => { on = false; };
  // adminName only labels the root; re-fetching when it arrives is not needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept?.key]);

  useEffect(() => { if (bdRef.current) bdRef.current.scrollTop = 0; }, [dept?.key]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return departments.filter(d => !t || String(d.name ?? '').toLowerCase().includes(t) || String(d.hod?.name ?? '').toLowerCase().includes(t));
  }, [departments, q]);

  const tog = (id: string) => setOpen(o => ({ ...o, [id]: o[id] === false }));
  const expandAll = (on: boolean) => {
    setExp(on ? 'exp' : 'col');
    if (on || !tree) { setOpen({}); return; }
    const o: Record<string, boolean> = {};
    tree.all.forEach(m => { if (m.lv !== 'admin' && m.kids.length) o[m.id] = false; });
    setOpen(o);
  };

  /* ── Department list ── */
  const renderList = () => {
    if (listErr) {
      return (
        <div className="tvo-none">
          {listErr}<br />
          <button type="button" data-h40="skip" className="ex-all" style={{ marginTop: 8 }} onClick={loadList}>Try again</button>
        </div>
      );
    }
    if (!list) {
      return (
        <div className="tvo-depts">
          {[0, 1, 2, 3].map(i => <div key={i} className="cv-shimrow" style={{ display: 'block' }}><i style={{ display: 'block', height: 88, borderRadius: 16 }} /></div>)}
        </div>
      );
    }
    const t = q.trim().toLowerCase();
    const showAdm = !t || 'admin administrator'.includes(t) || adminName.toLowerCase().includes(t);
    const adm = list.admin ?? {};
    return (
      <>
        <div className="tvo-meta"><span>{filtered.length} Departments</span><span>{adm.members ?? 0} Members</span></div>
        <div className="tvo-depts">
          {showAdm && (
            <button type="button" data-h40="skip" className="tvx-adm" onClick={() => onOpenDept({ key: 'admin', name: 'Administration' })}>
              <span className="tvx-hero__dots" />
              <span className="tvx-adm__top">
                <span className="tvx-adm__av">{initials(adminName)}<i><Svg d={TV_IC.shieldPlain} size={9} sw={2.6} /></i></span>
                <span className="tvx-adm__t"><small>Admin</small><b>{adminName}</b><span>Vault Administrator{admins.length > 1 ? ` · +${admins.length - 1} more` : ''}</span></span>
                <span className="tvx-adm__n"><b>{adm.members ?? 0}</b><small>Members</small></span>
              </span>
              <span className="tvx-adm__bot">
                <span className="tvx-adm__chip"><Svg d={TV_IC.grid} size={11} sw={2.4} />{adm.departments ?? 0} Departments</span>
                <span className="tvx-adm__chip"><Svg d={TV_IC.people} size={11} sw={2.4} />{adm.hods ?? 0} HODs</span>
                <span className="tvx-dc__go">View all<Svg d={TV_IC.arrow} size={11} sw={2.6} /></span>
              </span>
            </button>
          )}
          {filtered.length ? filtered.map(d => (
            <button key={d.id} type="button" data-h40="skip" className="tvx-dc" onClick={() => onOpenDept({ key: d.id, name: d.name })}>
              <span className="tvx-dc__top">
                <span className="tvx-dc__ico"><Svg d={deptIcon(d.name)} size={17} sw={2.1} /></span>
                <span className="tvx-dc__t">
                  <b>{d.name}</b>
                  <small>
                    {d.hod?.name
                      ? <><span className="tvx-mini">{initials(d.hod.name)}</span>{d.hod.name} · HOD</>
                      : <>No HOD assigned</>}
                  </small>
                </span>
                <span className="tvx-dc__n"><b>{d.members ?? 0}</b><small>Members</small></span>
              </span>
              <span className="tvx-dc__bot">
                <Dist cnt={toCounts(d.levels)} />
                <span className="tvx-dc__go">View team<Svg d={TV_IC.arrow} size={11} sw={2.6} /></span>
              </span>
            </button>
          )) : (!showAdm && <div className="tvo-none">No department matches “{q}”</div>)}
          {!t && !departments.length && <div className="tvo-none">No departments with active members yet. Departments come from HR.</div>}
        </div>
      </>
    );
  };

  /* ── One department / the organisation ── */
  const renderDept = (d: OpenDept) => {
    const isAdm = d.key === 'admin';
    const cnt = tree?.cnt ?? {};
    const lvls = LV_ORDER.filter(l => cnt[l]);
    return (
      <>
        <div className="tvx-hero">
          <span className="tvx-hero__dots" />
          <div className="tvx-hero__top">
            <button type="button" data-h40="skip" className="tvx-back" onClick={() => onOpenDept(null)} title="All departments"><Svg d={TV_IC.chevLeft} size={14} sw={2.6} /></button>
            <span className="tvx-hero__ico"><Svg d={isAdm ? TV_IC.shield : deptIcon(d.name)} size={20} sw={2.1} /></span>
            <div className="tvx-hero__t"><small>{isAdm ? 'Organisation' : 'Department'}</small><b>{d.name}</b></div>
          </div>
          <div className="tvx-hero__stats">
            {isAdm ? (
              <>
                <span><b>{tree?.total ?? '·'}</b>Members</span>
                <span><b>{stats?.departments ?? list?.admin?.departments ?? '·'}</b>Departments</span>
                <span><b>{list?.admin?.hods ?? stats?.hods ?? '·'}</b>HODs</span>
              </>
            ) : (
              <>
                <span><b>{tree?.total ?? '·'}</b>Members</span>
                <span><b>{tree ? lvls.length : '·'}</b>Levels</span>
                <span><b>{stats?.teams ?? cnt.tl ?? 0}</b>Teams</span>
              </>
            )}
          </div>
          <Dist cnt={cnt} cls="tvx-dist tvx-dist--hero" />
        </div>
        <div className="tvx-lvls">
          {lvls.map(l => <div key={l} className={`tvx-lvl tvx-lv--${l}`}><i /><b>{cnt[l]}</b><small>{LV_SHORT[l]}</small></div>)}
        </div>
        <div className="tvx-bar">
          <span><Svg d={TV_IC.tree} size={13} sw={2.2} />Team Hierarchy</span>
          <div className="tvx-seg">
            <button type="button" data-h40="skip" className={exp !== 'col' ? 'is-on' : ''} onClick={() => expandAll(true)}><Svg d={TV_IC.expand} size={12} sw={2.6} />Expand</button>
            <button type="button" data-h40="skip" className={exp === 'col' ? 'is-on' : ''} onClick={() => expandAll(false)}><Svg d={TV_IC.collapse} size={12} sw={2.6} />Collapse</button>
          </div>
        </div>
        <div className="tvx-tree">
          {treeLoading ? (
            [0, 1, 2, 3, 4].map(i => <div key={i} className="cv-shimrow" style={{ display: 'block', marginBottom: 8, marginLeft: i ? 20 : 0 }}><i style={{ display: 'block', height: 44, borderRadius: 12 }} /></div>)
          ) : treeErr ? (
            <div className="tvo-none">{treeErr}</div>
          ) : tree ? (
            <>
              <Node x={tree.root} open={open} sel={selected?.id ?? null} onTog={tog} onSel={x => onSelect(selected?.id === x.id ? null : x)} />
              {!tree.root.kids.length && <div className="tvo-none">No active members in this department yet.</div>}
            </>
          ) : null}
        </div>
      </>
    );
  };

  return (
    <div className="tv-pane__bd tvo-bd" ref={bdRef}>
      {dept ? renderDept(dept) : (
        <>
          <div className="tvo-search">
            <Svg d={TV_IC.search} size={13} sw={2.3} />
            <input placeholder="Search department or HOD..." value={q} onChange={e => setQ(e.target.value)} aria-label="Search department or HOD" />
          </div>
          {renderList()}
        </>
      )}
    </div>
  );
}
