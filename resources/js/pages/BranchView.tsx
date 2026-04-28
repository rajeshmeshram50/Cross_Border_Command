import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Progress } from 'reactstrap';
import api from '../api';

interface Props {
  branchId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

export default function BranchView({ branchId, onBack, onNavigate }: Props) {
  const [branch, setBranch] = useState<any>(null);
  const [branchUser, setBranchUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/branches/${branchId}`)
      .then(res => {
        setBranch(res.data.branch);
        setBranchUser(res.data.branch_user);
      })
      .finally(() => setLoading(false));
  }, [branchId]);

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;
  if (!branch) return (
    <div className="text-center py-5">
      <p className="text-muted">Branch not found.</p>
      <Button color="light" onClick={onBack}><i className="ri-arrow-left-line me-1"></i> Back</Button>
    </div>
  );

  // Profile completeness
  const completionFields = [
    branch.name, branch.branch_type, branch.code, branch.industry,
    branch.contact_person, branch.email, branch.phone,
    branch.address, branch.city, branch.state, branch.country, branch.pincode,
    branch.description, branchUser,
  ];
  const filled = completionFields.filter(Boolean).length;
  const completionPct = Math.round((filled / completionFields.length) * 100);

  const location = [branch.city, branch.state, branch.country].filter(Boolean).join(', ');
  const initials = `${branch.name.charAt(0)}${branch.name.split(' ')[1]?.charAt(0) || ''}`.toUpperCase();

  // ── Shared style tokens (mirrors ClientView / Profile palette) ──
  // Background uses var(--vz-card-bg) so the surface flips automatically
  // when the user switches between light and dark themes.
  const cardStyle: React.CSSProperties = {
    borderRadius: 20,
    border: '1px solid var(--vz-border-color)',
    boxShadow: '0 4px 24px rgba(64,81,137,0.08), 0 1px 2px rgba(64,81,137,0.04)',
    background: 'var(--vz-card-bg)',
    overflow: 'hidden',
    transition: 'transform .18s ease, box-shadow .18s ease',
  };
  const onCardEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    el.style.transform = 'translateY(-2px)';
    el.style.boxShadow = '0 10px 32px rgba(64,81,137,0.12), 0 2px 4px rgba(64,81,137,0.06)';
  };
  const onCardLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    el.style.transform = 'translateY(0)';
    el.style.boxShadow = '0 4px 24px rgba(64,81,137,0.08), 0 1px 2px rgba(64,81,137,0.04)';
  };

  const GRAD_PRIMARY = 'linear-gradient(135deg, #405189 0%, #6691e7 100%)';
  const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
  const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
  const GRAD_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
  const GRAD_INFO    = 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)';
  const GRAD_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';

  const SectionHeader = ({ title, gradient, icon, action }: { title: string; gradient: string; icon: string; action?: React.ReactNode }) => (
    <div className="d-flex align-items-center gap-2 mb-2">
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-3"
        style={{ width: 36, height: 36, background: gradient, boxShadow: '0 4px 10px rgba(64,81,137,0.2)' }}
      >
        <i className={icon} style={{ color: '#fff', fontSize: 16 }} />
      </span>
      <h5 className="card-title mb-0 flex-grow-1">{title}</h5>
      {action}
    </div>
  );

  return (
    <>
      {/* Compact info-table — mirrors ClientView so card spacing & label/value
          density stay consistent across both profile views. */}
      <style>{`
        .bv-info-table { font-size: 13px; line-height: 1.4; }
        .bv-info-table th,
        .bv-info-table td {
          padding: 6px 0;
          vertical-align: baseline;
          border: none;
          background: transparent !important;
        }
        .bv-info-table th {
          width: 1%;
          white-space: nowrap;
          padding-right: 14px !important;
          font-weight: 600;
          color: var(--vz-heading-color, var(--vz-body-color)) !important;
        }
        .bv-info-table td {
          padding-left: 0 !important;
          word-break: break-word;
          color: var(--vz-secondary-color);
        }
        [data-bs-theme="dark"] .bv-info-table td,
        [data-layout-mode="dark"] .bv-info-table td {
          color: rgba(255, 255, 255, 0.78);
        }
        [data-bs-theme="dark"] .bv-info-table th,
        [data-layout-mode="dark"] .bv-info-table th {
          color: rgba(255, 255, 255, 0.94) !important;
        }
      `}</style>

      {/* ── Page title + back + Edit ── */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
                style={{ width: 32, height: 32 }}
                onClick={onBack}
              >
                <i className="ri-arrow-left-line"></i>
              </button>
              Branch Profile
            </h4>
            <div className="page-title-right">
              <Button
                color="secondary"
                className="btn-label waves-effect waves-light rounded-pill"
                onClick={() => onNavigate('branch-form', { editId: branchId })}
              >
                <i className="ri-pencil-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Edit Profile
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── Hero banner ── */}
      <Card className="overflow-hidden mb-0 border-0" style={{ borderRadius: 20 }}>
        <div
          className="position-relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #405189 0%, #4a63a8 45%, #6691e7 100%)',
            padding: '32px 32px 28px',
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 40%),' +
                'radial-gradient(circle at 85% 80%, rgba(10,179,156,0.22) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <Row className="g-4 align-items-center position-relative flex-nowrap">
            <Col xs="auto">
              <div
                className="rounded-circle fw-bold d-flex align-items-center justify-content-center"
                style={{
                  width: 110, height: 110, fontSize: 40,
                  background: 'linear-gradient(135deg,rgba(255,255,255,0.28),rgba(255,255,255,0.08))',
                  color: '#fff',
                  border: '3px solid rgba(255,255,255,0.3)',
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                }}
              >
                {initials}
              </div>
            </Col>

            <Col className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                <h3 className="text-white mb-0 fw-semibold">{branch.name}</h3>
                {branch.is_main && (
                  <span
                    className="badge rounded-pill text-uppercase fw-semibold d-inline-flex align-items-center gap-1"
                    style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 10, padding: '3px 10px' }}
                  >
                    <i className="ri-star-fill" style={{ color: '#ffd47a' }} />
                    Main Branch
                  </span>
                )}
                <span
                  className="badge rounded-pill text-uppercase fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: branch.status === 'active' ? 'rgba(10,179,156,0.85)' : 'rgba(240,101,72,0.85)',
                    color: '#fff',
                    fontSize: 10,
                    padding: '3px 10px',
                  }}
                >
                  <span className="rounded-circle bg-white" style={{ width: 5, height: 5 }} />
                  {branch.status}
                </span>
              </div>
              <p className="mb-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <i className="ri-git-branch-line align-bottom me-1"></i>
                {branch.branch_type || 'Branch'}
                {branch.industry && <> &middot; {branch.industry}</>}
                {branch.code && <> &middot; <code className="text-white">{branch.code}</code></>}
              </p>
              <div className="d-flex gap-3 flex-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {location && (
                  <div>
                    <i className="ri-map-pin-user-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {location}
                  </div>
                )}
                {branch.phone && (
                  <div>
                    <i className="ri-phone-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {branch.phone}
                  </div>
                )}
              </div>
            </Col>

            <Col xs="auto">
              <div className="d-flex align-items-center gap-3">
                <div
                  className="text-center px-3 py-2"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 14,
                    backdropFilter: 'blur(6px)',
                    minWidth: 92,
                  }}
                >
                  <h3 className="text-white mb-0 fw-bold lh-1">{branch.users_count ?? 0}</h3>
                  <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>Users</p>
                </div>
                <div
                  className="text-center px-3 py-2"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 14,
                    backdropFilter: 'blur(6px)',
                    minWidth: 92,
                  }}
                >
                  <h3 className="text-white mb-0 fw-bold lh-1">{branch.departments_count ?? 0}</h3>
                  <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>Departments</p>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Card>

      {/* ── ROW 1 — Complete Profile (narrow) + About (wide) ── */}
      <Row className="mt-2 g-2 align-items-stretch">
        <Col xxl={4} lg={5}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Complete Branch Profile"
                gradient={GRAD_DANGER}
                icon="ri-git-branch-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-secondary rounded-circle"
                    onClick={() => onNavigate('branch-form', { editId: branchId })}
                  >
                    <i className="ri-edit-box-line align-bottom"></i>
                  </button>
                )}
              />
              <Progress
                value={completionPct}
                color="danger"
                className="animated-progess custom-progress progress-label"
              >
                <div className="label">{completionPct}%</div>
              </Progress>
              <p className="text-muted fs-12 mb-0 mt-3">
                {completionPct < 100
                  ? `Add the missing details to complete this branch profile.`
                  : `All branch details are filled in.`}
              </p>
            </CardBody>
          </Card>
        </Col>

        <Col xxl={8} lg={7}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="About" gradient={GRAD_PRIMARY} icon="ri-information-line" />
              <p className="text-muted mb-3">
                <strong>{branch.name}</strong> is a {branch.is_main ? 'main' : ''} {branch.branch_type || 'branch'}
                {branch.industry && <> operating in the <strong>{branch.industry}</strong> sector</>}
                {location && <> based in <strong>{location}</strong></>}.
                Manage contact details, branch user, address and operations from this page.
              </p>

              <Row className="g-3">
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_PRIMARY, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}>
                        <i className="ri-git-branch-line" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Branch Type</p>
                      <h6 className="text-truncate mb-0">{branch.branch_type || '—'}</h6>
                    </div>
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(41,156,219,0.06), rgba(95,200,255,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_INFO, boxShadow: '0 4px 10px rgba(41,156,219,0.25)' }}>
                        <i className="ri-hashtag" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Branch Code</p>
                      <h6 className="text-truncate mb-0 font-monospace">{branch.code || '—'}</h6>
                    </div>
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(247,184,75,0.08), rgba(255,212,122,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_WARNING, boxShadow: '0 4px 10px rgba(247,184,75,0.3)' }}>
                        <i className="ri-briefcase-line" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Industry</p>
                      <h6 className="text-truncate mb-0">{branch.industry || '—'}</h6>
                    </div>
                  </div>
                </Col>
              </Row>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── ROW 2 — Info + Contact + Address ── */}
      <Row className="g-2 mt-2 align-items-stretch">
        <Col xxl={4} lg={4} md={6}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Info" gradient={GRAD_PRIMARY} icon="ri-information-line" />
              <div className="table-responsive">
                <table className="table table-borderless mb-0 bv-info-table">
                  <tbody>
                    <tr>
                      <th className="ps-0 text-nowrap" scope="row">Name :</th>
                      <td className="text-muted">{branch.name}</td>
                    </tr>
                    {branch.branch_type && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Type :</th>
                        <td className="text-muted">{branch.branch_type}</td>
                      </tr>
                    )}
                    {branch.code && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Code :</th>
                        <td className="text-muted font-monospace">{branch.code}</td>
                      </tr>
                    )}
                    {branch.industry && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Industry :</th>
                        <td className="text-muted">{branch.industry}</td>
                      </tr>
                    )}
                    {location && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Location :</th>
                        <td className="text-muted">{location}</td>
                      </tr>
                    )}
                    {branch.created_at && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Created :</th>
                        <td className="text-muted">
                          {new Date(branch.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </Col>

        <Col xxl={4} lg={4} md={6}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Contact"
                gradient={GRAD_SUCCESS}
                icon="ri-contacts-book-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-primary rounded-pill"
                    onClick={() => onNavigate('branch-form', { editId: branchId })}
                  >
                    Manage
                  </button>
                )}
              />
              {(branch.contact_person || branch.email || branch.phone) ? (
                <div className="table-responsive">
                  <table className="table table-borderless mb-0 bv-info-table">
                    <tbody>
                      {branch.contact_person && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Contact :</th>
                          <td className="text-muted">{branch.contact_person}</td>
                        </tr>
                      )}
                      {branch.email && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">E-mail :</th>
                          <td className="text-muted">
                            <a href={`mailto:${branch.email}`} className="text-muted text-decoration-none">{branch.email}</a>
                          </td>
                        </tr>
                      )}
                      {branch.phone && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Phone :</th>
                          <td className="text-muted font-monospace">
                            <a href={`tel:${branch.phone}`} className="text-muted text-decoration-none">{branch.phone}</a>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-contacts-book-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No contact info</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xxl={4} lg={4} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Address" gradient={GRAD_INFO} icon="ri-map-pin-line" />
              {(branch.address || branch.city || branch.state) ? (
                <div className="table-responsive">
                  <table className="table table-borderless mb-0 bv-info-table">
                    <tbody>
                      {branch.address && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Street :</th>
                          <td className="text-muted">{branch.address}</td>
                        </tr>
                      )}
                      {branch.city && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">City :</th>
                          <td className="text-muted">{branch.city}</td>
                        </tr>
                      )}
                      {branch.state && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">State :</th>
                          <td className="text-muted">{branch.state}</td>
                        </tr>
                      )}
                      {branch.country && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Country :</th>
                          <td className="text-muted">{branch.country}</td>
                        </tr>
                      )}
                      {branch.pincode && (
                        <tr>
                          <th className="ps-0" scope="row">Pincode :</th>
                          <td className="text-muted font-monospace">{branch.pincode}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-map-pin-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No address added</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── ROW 3 — Branch User + Description ── */}
      <Row className="mb-3 g-2 mt-2 align-items-stretch">
        <Col xxl={4} lg={5} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Branch User"
                gradient={GRAD_PURPLE}
                icon="ri-user-3-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-primary rounded-pill"
                    onClick={() => onNavigate('branch-users', { branchId, branchName: branch.name })}
                  >
                    Manage
                  </button>
                )}
              />
              {branchUser ? (
                <div className="d-flex align-items-center p-3" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(106,90,205,0.05), rgba(167,139,250,0.03))', border: '1px solid var(--vz-border-color)' }}>
                  <div className="flex-shrink-0">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-bold"
                      style={{ width: 42, height: 42, background: GRAD_PURPLE, fontSize: 16, boxShadow: '0 4px 10px rgba(106,90,205,0.25)' }}
                    >
                      {branchUser.name?.charAt(0)?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="flex-grow-1 ms-3 overflow-hidden">
                    <h6 className="mb-1 text-truncate">{branchUser.name}</h6>
                    <p className="text-muted mb-0 text-truncate fs-12">{branchUser.email}</p>
                  </div>
                  <span className={`badge rounded-pill bg-${branchUser.status === 'active' ? 'success' : 'danger'}-subtle text-${branchUser.status === 'active' ? 'success' : 'danger'} text-uppercase`}>
                    {branchUser.status}
                  </span>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-user-3-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No branch user assigned</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xxl={8} lg={7} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Description" gradient={GRAD_WARNING} icon="ri-file-text-line" />
              {branch.description ? (
                <p className="mb-0" style={{ color: 'var(--vz-body-color)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {branch.description}
                </p>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-file-text-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No description added</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
