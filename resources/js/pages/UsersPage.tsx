import { useEffect, useMemo, useState } from 'react';
import { Button } from 'reactstrap';
import api from '../api';
import DataTable, { type DataTableColumn } from '../components/ui/DataTable';

interface UserRow {
  id: number;
  name: string;
  email: string;
  user_type: string;
  client_id?: number | null;
  branch_id?: number | null;
  status: string;
}

interface Props {
  branchId?: number;
  branchName?: string;
  onBack?: () => void;
}


export default function UsersPage({ branchId, branchName, onBack }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resolvedBranchName, setResolvedBranchName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, any> = {};
    if (branchId) params.branch_id = branchId;
    api.get('/permissions/users', { params })
      .then(({ data }) => {
        if (cancelled) return;
        // When opened from the Branches → Users action, "users" really
        // means "people working at this branch" → employees only.
        // The /permissions/users endpoint returns every user the admin
        // can manage (branch_user logins, employees, etc.), so we
        // narrow the list client-side. When branchId isn't passed
        // (sidebar entry) we keep the full list.
        const list = Array.isArray(data) ? data : [];
        const narrowed = branchId
          ? list.filter((u: UserRow) => u.user_type === 'employee')
          : list;
        setUsers(narrowed);
      })
      .catch(() => { if (!cancelled) setUsers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId]);

  // Fall back to fetching the branch name if the navigation state didn't
  // carry it (deep links / refresh).
  useEffect(() => {
    if (!branchId || branchName) { setResolvedBranchName(branchName || ''); return; }
    let cancelled = false;
    api.get(`/branches/${branchId}`)
      .then(({ data }) => { if (!cancelled) setResolvedBranchName(data?.name || ''); })
      .catch(() => { if (!cancelled) setResolvedBranchName(''); });
    return () => { cancelled = true; };
  }, [branchId, branchName]);

  const displayBranchName = branchName || resolvedBranchName;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      [u.name, u.email, u.user_type].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    );
  }, [users, search]);

  const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const columns = useMemo<DataTableColumn<UserRow>[]>(() => [
    { header: 'Name', accessorKey: 'name', cell: (info: any) => <span className="fw-semibold fs-13">{info.row.original.name}</span> },
    { header: 'Email', accessorKey: 'email', cell: (info: any) => <span className="fs-13">{info.row.original.email}</span> },
    {
      header: 'Role', id: 'role', enableSorting: false, meta: { align: 'center' },
      cell: (info: any) => <span className="badge bg-primary-subtle text-primary fw-semibold px-3 py-2">{typeLabel(info.row.original.user_type)}</span>,
    },
    {
      header: 'Status', accessorKey: 'status', meta: { align: 'center' },
      cell: (info: any) => {
        const a = info.row.original.status === 'active';
        return <span className={`badge rounded-pill bg-${a ? 'success' : 'danger'}-subtle text-${a ? 'success' : 'danger'} fw-semibold px-3 py-2`}>{a ? 'Active' : 'Inactive'}</span>;
      },
    },
  ], []);

  return (
    <>
      {/* The house header strip (.frm-cstrip, app.css) — the same one the
          Branches, Employee and Customer screens open with. This page had a
          plain page-title-box with a breadcrumb hanging off the right, which
          matched nothing else in the app; the breadcrumb was also decorative,
          since its first two crumbs were href="#" and went nowhere. Back is the
          one that actually navigated, and it stays. */}
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-team-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">{branchId ? 'Employees' : 'Users'}</div>
            <div className="frm-cstrip-sub">
              {displayBranchName
                ? `People with a login at ${displayBranchName}`
                : 'People with a login on this account'}
            </div>
          </div>
        </div>
        {onBack && (
          <div className="d-flex align-items-center gap-2 flex-shrink-0">
            <Button color="light" className="rounded-pill px-3" onClick={onBack}>
              <i className="ri-arrow-left-line align-bottom me-1" />Back
            </Button>
          </div>
        )}
      </div>

      {/* Shared DataTable — same toolbar, violet header, card and pager as the
          Branch list, so this page reads as the same product. */}
      <DataTable<UserRow>
        data={filtered}
        columns={columns}
        serial={{ header: 'Sr No' }}
        className="hr-dt"
        accent="violet"
        title={branchId ? 'Employees' : 'Users'}
        subtitle={
          loading
            ? 'Loading…'
            : [
                `${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`,
                displayBranchName,
              ].filter(Boolean).join(' · ')
        }
        minWidth={820}
        fitToViewport
        autoFitRows
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={branchId ? 'Search employees by name, email or role...' : 'Search by name, email or role...'}
        emptyMessage={
          <>
            <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            No {branchId ? 'employees' : 'users'} found{displayBranchName ? ` for ${displayBranchName}` : ''}
          </>
        }
      />
    </>
  );
}
