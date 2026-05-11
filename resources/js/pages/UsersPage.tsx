import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Spinner, Input } from 'reactstrap';
import api from '../api';
import { ShimmerTableRows } from '../components/ui/Shimmer';

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

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

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
        setUsers(Array.isArray(data) ? data : []);
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

  const initialsOf = (name: string) => {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  };
  const accentFor = (id: number) => AVATAR_COLORS[id % AVATAR_COLORS.length];
  const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              {onBack && (
                <button
                  className="btn btn-soft-primary btn-icon rounded-circle"
                  style={{ width: 36, height: 36 }}
                  onClick={onBack}
                  title="Back"
                >
                  <i className="ri-arrow-left-line fs-16"></i>
                </button>
              )}
              <h4 className="mb-sm-0">Users</h4>
            </div>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Branches</a></li>
                {displayBranchName && (
                  <li className="breadcrumb-item"><a href="#">{displayBranchName}</a></li>
                )}
                <li className="breadcrumb-item active">Users</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Card className="shadow-sm">
        <CardBody className="p-3 p-md-4">
          <Row className="g-2 align-items-center mb-3">
            <Col md={6} sm={12}>
              <div className="search-box">
                <Input
                  type="text"
                  className="form-control"
                  placeholder="Search by name, email or role..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <i className="ri-search-line search-icon"></i>
              </div>
            </Col>
            <Col md={6} sm={12} className="text-md-end text-muted fs-13">
              {loading
                ? <Spinner size="sm" />
                : <>Showing <strong className="text-dark">{filtered.length}</strong> of <strong className="text-dark">{users.length}</strong> users{displayBranchName ? <> in <strong className="text-dark">{displayBranchName}</strong></> : null}</>
              }
            </Col>
          </Row>

          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th className="ps-3" style={{ width: 50 }}>#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ShimmerTableRows rows={5} cols={5} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-5 text-muted">
                      <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                      {users.length === 0
                        ? `No users found${displayBranchName ? ` for ${displayBranchName}` : ''}`
                        : 'No users match your search'}
                    </td>
                  </tr>
                ) : filtered.map((u, idx) => {
                  const accent = accentFor(u.id);
                  const isActive = u.status === 'active';
                  return (
                    <tr key={u.id}>
                      <td className="ps-3 text-muted fs-13">{idx + 1}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div
                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                            style={{
                              width: 34, height: 34, fontSize: 12,
                              background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                              boxShadow: `0 2px 6px ${accent}40`,
                            }}
                          >
                            {initialsOf(u.name)}
                          </div>
                          <span className="fw-semibold fs-13">{u.name}</span>
                        </div>
                      </td>
                      <td className="fs-13"><i className="ri-mail-line me-1 text-muted"></i>{u.email}</td>
                      <td>
                        <span className="badge bg-primary-subtle text-primary fw-semibold px-3 py-2">
                          {typeLabel(u.user_type)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge rounded-pill bg-${isActive ? 'success' : 'danger'}-subtle text-${isActive ? 'success' : 'danger'} fw-semibold px-3 py-2`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
