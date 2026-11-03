import type { CredentialRow } from '../cvApi';
import {
  ActBtn, CategoryCell, EmptyRow, IC, IdCell, NameCell, OwnerCell, RiskFlag, ShimRows, StrengthCell, Svg, TwofaCell,
  UpdatedCell, useCvMeta,
} from '../shared';

export interface CredentialTableProps {
  rows: CredentialRow[];
  startIndex: number;          
  loading: boolean;
  emptyTitle: string;
  emptySub: string;
  onAdd?: () => void;          
  onEdit: (row: CredentialRow) => void;
  onShare: (row: CredentialRow) => void;
  onView: (row: CredentialRow) => void;
  onCopy: (row: CredentialRow) => void;
  onDelete: (row: CredentialRow) => void;
}

const USER_SHOWN = 12;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const COLS = ['Sr. No', 'Credential ID', 'Credential Name', 'Category', 'Username', 'Owner', 'Risk', 'Strength', '2FA', 'Last Updated', 'Action'];

export default function CredentialTable({ rows, startIndex, loading, emptyTitle, emptySub, onAdd, onEdit, onShare, onView, onCopy, onDelete }: CredentialTableProps) {
  const { typeOf } = useCvMeta();

  return (
    <div className="whm-tblwrap">
      <table className="whm-tbl mv-tbl">
        <thead><tr>{COLS.map((c, i) => <th key={c} className={`mv-th-${i}`}>{c}</th>)}</tr></thead>
        <tbody>
          {loading ? <ShimRows cols={COLS.length} rows={8} />
            : rows.length === 0 ? (
              <EmptyRow cols={COLS.length} title={emptyTitle} sub={emptySub}
                action={onAdd ? (
                  <button type="button" className="mv-empty__btn" onClick={onAdd}><Svg d={IC.plus} size={13} />Add Credential</button>
                ) : undefined} />
            ) : rows.map((r, i) => {
              const can = r.can;
              const binTitle = can?.remove ? 'Remove from your vault' : 'Move to Bin';
              const canCopy = !!can?.copy;
              return (
                <tr key={r.id}>
                  <td><span className="whm-sr">{startIndex + i + 1}</span></td>
                  <td><IdCell code={r.code} date={r.created_at} /></td>
                  <td><NameCell row={r} typeIcon={typeOf(r.type)?.icon} /></td>
                  <td><CategoryCell label={r.type_label} group={r.category_group} /></td>
                  <td><span className="mv-user" title={r.username || undefined}>{r.username ? clip(r.username, USER_SHOWN) : <span className="mv-str--na">—</span>}</span></td>
                  <td><OwnerCell row={r} /></td>
                  <td><RiskFlag risk={r.risk} /></td>
                  <td><StrengthCell row={r} /></td>
                  <td><TwofaCell twofa={r.twofa} /></td>
                  <td><UpdatedCell iso={r.updated_at} /></td>
                  <td>
                    <div className="whm-acts">
                      <ActBtn icon={IC.edit} title="Edit" tone="edit" disabled={!can?.edit} onClick={() => onEdit(r)} />
                      <ActBtn icon={IC.share} title="Share" disabled={!can?.share} onClick={() => onShare(r)} />
                      <ActBtn icon={IC.view} title="View" onClick={() => onView(r)} />
                      <ActBtn icon={IC.copy} title="Copy Password" disabled={!canCopy} onClick={() => onCopy(r)} />
                      <ActBtn icon={IC.del} title={binTitle} tone="danger" disabled={!(can?.delete || can?.remove)} onClick={() => onDelete(r)} />
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
