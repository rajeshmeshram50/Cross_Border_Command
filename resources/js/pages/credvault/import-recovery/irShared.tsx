import type { ReactNode } from 'react';
import type { PageMeta, TransferRow } from '../cvApi';
import { CvPager, Svg, bytes, fmtDay, fmtTime, initials } from '../shared';

/* Import & Recovery — the prototype's IR_I icons, irCard and irHistHtml. */

export const IR_I = {
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="11" x2="12" y2="19"/>',
  code: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 13 8 15 10 17"/><polyline points="14 13 16 15 14 17"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  hist: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  zip: '<path d="M21 8v13H3V3h12l6 5z"/><line x1="10" y1="3" x2="10" y2="5"/><line x1="10" y1="7" x2="10" y2="9"/><line x1="10" y1="11" x2="10" y2="13"/><rect x="8.5" y="14" width="3" height="4" rx=".8"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  tick: '<polyline points="20 6 9 17 4 12"/>',
  chev: '<polyline points="9 18 15 12 9 6"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
};

/** Icon for a file format key or label. */
export function fmtIcon(f?: string | null): string {
  const k = String(f ?? '').toLowerCase();
  if (k === 'json') return IR_I.code;
  if (k === 'xlsx' || k === 'excel' || k === 'xml' || k === 'excel 2003' || k === 'sample') return IR_I.sheet;
  return IR_I.file;
}

/** The prototype's irCard: a titled panel. */
export function IrCard({ icon, title, sub, extra, className, children }: {
  icon: string; title: ReactNode; sub: ReactNode; extra?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div className={`irc${className ? ` ${className}` : ''}`}>
      <div className="irc-hd">
        <span className="irc-hd__ico"><Svg d={icon} size={17} /></span>
        <div><b>{title}</b><small>{sub}</small></div>
        {extra}
      </div>
      <div className="irc-bd">{children}</div>
    </div>
  );
}

function Who({ t }: { t: TransferRow }) {
  return (
    <div className="mv-ownc">
      <span className="mv-ownc__av">{initials(t.by)}</span>
      <div><b>{t.by_me ? 'You' : (t.by ?? '—')}</b><span className="al-sub">{t.by_role ?? ''}</span></div>
    </div>
  );
}
function When({ iso }: { iso: string | null }) {
  return <div className="whm-idcell"><b className="mv-upd-d">{fmtDay(iso)}</b><span className="whm-iddate">{fmtTime(iso)}</span></div>;
}
function FmtBadge({ t }: { t: TransferRow }) {
  return <span className="ir-fmt"><Svg d={fmtIcon(t.format)} size={11} />{t.format_label || 'CSV'}</span>;
}

type Col = [label: string, align: 'c' | 'l', width: number];
const IMPORT_COLS: Col[] = [['Sr. No', 'c', 64], ['Import ID', 'c', 105], ['Imported On', 'c', 120], ['Imported By', 'l', 190], ['File', 'l', 210], ['Format', 'c', 100], ['Imported', 'c', 90], ['Skipped', 'c', 85], ['Weak', 'c', 80], ['Duplicates', 'c', 95]];
const BACKUP_COLS: Col[] = [['Sr. No', 'c', 64], ['Backup ID', 'c', 105], ['Downloaded On', 'c', 125], ['Downloaded By', 'l', 190], ['Format', 'c', 100], ['Scope', 'c', 110], ['Items', 'c', 75], ['Size', 'c', 80], ['Protection', 'c', 150], ['Status', 'c', 110]];

/** The history card under each tab (irHistHtml), with paging from the API. */
export function HistoryCard({ kind, rows, meta, loading, error, onPage }: {
  kind: 'import' | 'backup'; rows: TransferRow[]; meta: PageMeta | null; loading: boolean; error: string; onPage: (p: number) => void;
}) {
  const head = kind === 'import' ? IMPORT_COLS : BACKUP_COLS;
  const start = meta ? (meta.current_page - 1) * meta.per_page : 0;
  const td = (i: number, node: ReactNode) => <td className={`ir-a${head[i][1]}`}>{node}</td>;

  let body: ReactNode;
  if (loading && !rows.length) {
    body = Array.from({ length: 3 }, (_, r) => (
      <tr key={r} className="cv-shimrow">{head.map((_, c) => <td key={c}><i style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} /></td>)}</tr>
    ));
  } else if (error || !rows.length) {
    body = (
      <tr><td colSpan={10} className="mv-empty"><div className="mv-empty__box">
        <div className="mv-empty__ico"><Svg d={error ? IR_I.warn : IR_I.hist} size={24} /></div>
        <div className="mv-empty__t">{error ? 'Could not load the history' : 'Nothing here yet'}</div>
        <div className="mv-empty__s">{error || (kind === 'import' ? 'Imports you run will be listed here.' : 'Backups you download will be listed here.')}</div>
      </div></td></tr>
    );
  } else if (kind === 'import') {
    body = rows.map((h, i) => (
      <tr key={h.id}>
        {td(0, <span className="whm-sr">{start + i + 1}</span>)}
        {td(1, <span className="whm-idpill">{h.code}</span>)}
        {td(2, <When iso={h.at} />)}
        {td(3, <Who t={h} />)}
        {td(4, <div className="ix-fc"><b title={h.file_name ?? ''}>{h.file_name || '—'}</b><small>{h.source ?? ''} · into {h.scope_label ?? 'My Vault'}</small></div>)}
        {td(5, <FmtBadge t={h} />)}
        {td(6, <b className="ir-n">{h.items}</b>)}
        {td(7, <b className="ir-n is-mute">{h.skipped || 0}</b>)}
        {td(8, <span className={`ir-cnt${h.weak ? ' is-bad' : ''}`}>{h.weak}</span>)}
        {td(9, <span className={`ir-cnt${h.duplicates ? ' is-warn' : ''}`}>{h.duplicates}</span>)}
      </tr>
    ));
  } else {
    body = rows.map((h, i) => {
      const ok = h.status !== 'failed';
      return (
        <tr key={h.id}>
          {td(0, <span className="whm-sr">{start + i + 1}</span>)}
          {td(1, <span className="whm-idpill">{h.code}</span>)}
          {td(2, <When iso={h.at} />)}
          {td(3, <Who t={h} />)}
          {td(4, <FmtBadge t={h} />)}
          {td(5, <span className="ir-src">{h.scope_label ?? '—'}</span>)}
          {td(6, <b className="ir-n">{ok ? h.items : '—'}</b>)}
          {td(7, <span className="ir-src">{ok && h.size_bytes ? bytes(h.size_bytes) : '—'}</span>)}
          {td(8, h.locked
            ? <span className="ix-lk is-on"><Svg d={IR_I.lock} size={11} />Password locked</span>
            : <span className="ix-lk"><Svg d={IR_I.unlock} size={11} />Not locked</span>)}
          {td(9, <span className={`ir-st ir-st--${ok ? 'ok' : 'bad'}`} title={h.failure_reason ?? undefined}><i />{ok ? 'Downloaded' : 'Failed'}</span>)}
        </tr>
      );
    });
  }

  return (
    <div className="irc ir-hist">
      <div className="irc-hd">
        <span className="irc-hd__ico"><Svg d={IR_I.hist} size={17} /></span>
        <div>
          <b>{kind === 'import' ? 'Imported Credentials History' : 'Downloaded Backup History'}</b>
          <small>{kind === 'import' ? 'Every import into My Vault — who ran it, which file and what was checked' : 'Every backup download — format, scope and whether it was password-locked'}</small>
        </div>
        <span className="irc-tag">{meta?.total ?? 0} records</span>
      </div>
      <div className="whm-tblwrap ir-htbl">
        <table className="whm-tbl ir-tbl">
          <colgroup>{head.map(c => <col key={c[0]} style={{ width: c[2] }} />)}</colgroup>
          <thead><tr>{head.map(c => <th key={c[0]} className={`ir-a${c[1]}`}>{c[0]}</th>)}</tr></thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {meta && !error && meta.last_page > 1 && (
        <CvPager page={meta.current_page} lastPage={meta.last_page} total={meta.total} perPage={meta.per_page} noun="records" onPage={onPage} />
      )}
    </div>
  );
}
