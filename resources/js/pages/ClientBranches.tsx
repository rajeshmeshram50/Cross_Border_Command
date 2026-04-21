import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Input, Spinner, Alert } from 'reactstrap';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const typeIconMap: Record<string, string> = {
  company: 'ri-building-line',
  division: 'ri-git-branch-line',
  factory: 'ri-home-gear-line',
  warehouse: 'ri-archive-2-line',
};

export default function ClientBranches({ clientId, clientName, onBack }: Props) {
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    api.get('/branches', { params: { client_id: clientId, per_page: 100 } })
      .then(res => setBranches(res.data.data || []))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = branches.filter(b => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return b.name?.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q) || b.city?.toLowerCase().includes(q);
  });

  const totalUsers = branches.reduce((s: number, b: any) => s + (b.users_count || 0), 0);
  const activeBranches = branches.filter(b => b.status === 'active').length;
  const mainBranch = branches.find((b: any) => b.is_main);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Branches
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Clients</a></li>
                <li className="breadcrumb-item"><a href="#">{clientName}</a></li>
                <li className="breadcrumb-item active">Branches</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* Stat cards */}
      <Row>
        {[
          { label: 'Total',       value: branches.length, color: 'primary',   icon: 'ri-git-branch-line' },
          { label: 'Active',      value: activeBranches,  color: 'success',   icon: 'ri-checkbox-circle-line' },
          { label: 'Main',        value: mainBranch ? 1 : 0, color: 'warning', icon: 'ri-star-fill' },
          { label: 'Total Users', value: totalUsers,      color: 'info',      icon: 'ri-user-3-line' },
        ].map(s => (
          <Col md={3} sm={6} key={s.label}>
            <Card className="card-animate">
              <CardBody>
                <div className="d-flex align-items-center">
                  <div className="flex-grow-1">
                    <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">{s.label}</p>
                  </div>
                </div>
                <div className="d-flex align-items-end justify-content-between mt-3">
                  <h4 className="fs-22 fw-semibold mb-0">{s.value}</h4>
                  <div className="avatar-sm">
                    <span className={`avatar-title rounded bg-${s.color}-subtle text-${s.color} fs-3`}>
                      <i className={s.icon}></i>
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Col>
        ))}
      </Row>

      {mainBranch && (
        <Alert color="warning" className="d-flex align-items-center">
          <i className="ri-star-fill me-2"></i>
          <div><strong>Main Branch</strong> — {mainBranch.name} · Main branch users can view all branches data</div>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="border-0">
          <Row className="align-items-center gy-3">
            <div className="col-sm">
              <h5 className="card-title mb-0">Branch List</h5>
            </div>
            <div className="col-sm-auto">
              <div className="search-box">
                <Input type="text" className="form-control search" placeholder="Search by name, code, city..."
                  value={searchInput} onChange={e => setSearchInput(e.target.value)} style={{ width: 260 }} />
                <i className="ri-search-line search-icon"></i>
              </div>
            </div>
          </Row>
        </CardHeader>
        <CardBody>
          <div className="table-responsive table-card">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>Branch Name</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Users</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-5"><Spinner color="primary" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-muted py-5">No branches found</td></tr>
                ) : filtered.map(b => {
                  const typeIcon = typeIconMap[b.branch_type || ''] || 'ri-git-branch-line';
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className={`avatar-xs rounded d-flex align-items-center justify-content-center text-white fw-bold ${b.is_main ? 'bg-warning' : 'bg-info'}`} style={{ fontSize: 10 }}>
                            {b.code?.substring(0, 2) || b.name.charAt(0)}
                          </div>
                          <div>
                            <div className="fw-semibold d-flex align-items-center gap-1">
                              {b.name}
                              {b.is_main && <i className="ri-star-fill text-warning fs-12"></i>}
                            </div>
                            {b.description && <div className="text-muted fs-12 text-truncate" style={{ maxWidth: 200 }}>{b.description}</div>}
                          </div>
                        </div>
                      </td>
                      <td>{b.code ? <span className="fw-medium text-primary font-monospace">{b.code}</span> : <span className="text-muted">—</span>}</td>
                      <td>
                        {b.branch_type ? (
                          <><i className={`${typeIcon} me-1 text-muted`}></i><span className="text-capitalize">{b.branch_type}</span></>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        {b.city ? `${b.city}${b.state ? ', ' + b.state : ''}` : <span className="text-muted">—</span>}
                      </td>
                      <td><Badge color="info" pill>{b.users_count ?? 0}</Badge></td>
                      <td><Badge color={b.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{b.status}</Badge></td>
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
