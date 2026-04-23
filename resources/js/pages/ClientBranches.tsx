import { useState, useEffect } from 'react';
import { Col, Row, Input, Spinner } from 'reactstrap';
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

  const KPI_CARDS = [
    { label: 'Total',       value: branches.length,    icon: 'ri-git-branch-line',      gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active',      value: activeBranches,     icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Main',        value: mainBranch ? 1 : 0, icon: 'ri-star-fill',            gradient: 'linear-gradient(135deg,#f7b84b,#ffd47a)' },
    { label: 'Total Users', value: totalUsers,         icon: 'ri-user-3-line',          gradient: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
  ];

  return (
    <>
      <style>{`
        .branches-surface { background: #ffffff; }
        [data-bs-theme="dark"] .branches-surface { background: #1c2531; }
      `}</style>

      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: 32, height: 32 }} onClick={onBack}>
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

      <Row>
        <Col xs={12}>
          <div
            className="branches-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── KPI cards (single row, equal height) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="branches-surface"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          {k.value.toLocaleString()}
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Main branch callout ── */}
            {mainBranch && (
              <div
                className="d-flex align-items-center gap-2 mb-3 px-3 py-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(247,184,75,0.12), rgba(255,212,122,0.06))',
                  border: '1px solid rgba(247,184,75,0.35)',
                  borderRadius: 12,
                  color: 'var(--vz-heading-color, var(--vz-body-color))',
                  fontSize: 13,
                }}
              >
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                  style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#f7b84b,#ffd47a)', boxShadow: '0 2px 6px rgba(247,184,75,0.35)' }}
                >
                  <i className="ri-star-fill" style={{ color: '#fff', fontSize: 13 }}></i>
                </span>
                <div>
                  <strong>Main Branch</strong> — {mainBranch.name}
                  <span className="text-muted ms-2">·  Main branch users can view all branches data</span>
                </div>
              </div>
            )}

            {/* ── Search row ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col xs={12}>
                <div className="search-box w-100">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by name, code, city..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
            </Row>

            {/* ── Table ── */}
            <div className="table-responsive  border rounded Borderradius-20">
              <table className="table align-middle table-nowrap mb-0 ">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Branch Name</th>
                    <th scope="col">Code</th>
                    <th scope="col">Type</th>
                    <th scope="col">Location</th>
                    <th scope="col">Users</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center py-5"><Spinner color="primary" /></td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-muted py-5">No branches found</td></tr>
                  ) : filtered.map(b => {
                    const typeIcon = typeIconMap[b.branch_type || ''] || 'ri-git-branch-line';
                    const isActive = b.status === 'active';
                    const color = isActive ? 'success' : 'danger';
                    return (
                      <tr key={b.id}>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div
                              className={`avatar-xs rounded d-flex align-items-center justify-content-center text-white fw-bold ${b.is_main ? 'bg-warning' : 'bg-info'}`}
                              style={{ fontSize: 10 }}
                            >
                              {b.code?.substring(0, 2) || b.name.charAt(0)}
                            </div>
                            <div>
                              <div className="fw-semibold d-flex align-items-center gap-1">
                                {b.name}
                                {b.is_main && <i className="ri-star-fill text-warning fs-12"></i>}
                              </div>
                              {b.description && <div className="text-muted fs-12 text-truncate" style={{ maxWidth: 220 }}>{b.description}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          {b.code ? (
                            <span className="fw-medium text-primary font-monospace fs-13">{b.code}</span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {b.branch_type ? (
                            <span className="d-inline-flex align-items-center gap-1 fs-13">
                              <i className={`${typeIcon} text-muted`}></i>
                              <span className="text-capitalize">{b.branch_type}</span>
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {b.city ? (
                            <span className="fs-13">{b.city}{b.state ? `, ${b.state}` : ''}</span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          <span className="d-inline-flex align-items-center gap-1 fs-13">
                            <i className="ri-user-3-line text-muted"></i>
                            <span className="fw-semibold">{b.users_count ?? 0}</span>
                          </span>
                        </td>
                        <td>
                          <span className={`badge rounded-pill border border-${color} text-${color} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}>
                            <span className={`bg-${color} rounded-circle`} style={{ width: 6, height: 6 }} />
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Col>
      </Row>
    </>
  );
}
