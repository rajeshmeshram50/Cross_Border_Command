import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Progress } from 'reactstrap';
import api from '../api';

interface Props {
  clientId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

export default function ClientView({ clientId, onBack, onNavigate }: Props) {
  const [client, setClient] = useState<any>(null);
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/clients/${clientId}`).then(res => {
      setClient(res.data.client);
      setAdminUser(res.data.admin_user);
    }).finally(() => setLoading(false));
  }, [clientId]);

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;
  if (!client) return (
    <div className="text-center py-5">
      <p className="text-muted">Client not found.</p>
      <Button color="light" onClick={onBack}><i className="ri-arrow-left-line me-1"></i> Back</Button>
    </div>
  );

  // Compute profile completeness — used for "Complete Your Profile" card
  const completionFields = [
    client.org_name, client.email, client.phone, client.website, client.industry || client.sports,
    client.address, client.city, client.state, client.country, client.pincode,
    client.gst_number, client.pan_number, client.logo, adminUser,
  ];
  const filled = completionFields.filter(Boolean).length;
  const completionPct = Math.round((filled / completionFields.length) * 100);

  const location = [client.city, client.state, client.country].filter(Boolean).join(', ');
  const initials = `${client.org_name.charAt(0)}${client.org_name.split(' ')[1]?.charAt(0) || ''}`.toUpperCase();

  return (
    <>
      {/* Compact info-table + dark-mode-friendly card surfaces.
          Labels shrink to their own content width so the value sits right
          next to the label instead of being pushed to the far right by
          auto column-sizing. All colors use Velzon CSS vars so the cards
          look correct in both light and dark themes. */}
      <style>{`
        .cv-info-table { font-size: 13px; line-height: 1.4; }
        .cv-info-table th,
        .cv-info-table td {
          padding: 6px 0;
          vertical-align: baseline;
          border: none;
          background: transparent !important;
        }
        .cv-info-table th {
          width: 1%;
          white-space: nowrap;
          padding-right: 14px !important;
          font-weight: 600;
          color: var(--vz-heading-color, var(--vz-body-color)) !important;
        }
        .cv-info-table td {
          padding-left: 0 !important;
          word-break: break-word;
          color: var(--vz-secondary-color);
        }
        /* Dark mode tweaks — the card-bg adapts via var(--vz-card-bg),
           but boost the value text contrast so it reads cleanly on dark. */
        [data-bs-theme="dark"] .cv-info-table td,
        [data-layout-mode="dark"] .cv-info-table td {
          color: rgba(255, 255, 255, 0.78);
        }
        [data-bs-theme="dark"] .cv-info-table th,
        [data-layout-mode="dark"] .cv-info-table th {
          color: rgba(255, 255, 255, 0.94) !important;
        }
      `}</style>

      {/* ── Page title + back button + Edit Profile ── */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: 32, height: 32 }} onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Client Profile
            </h4>
            <div className="page-title-right">
              <Button
                color="secondary"
                className="btn-label waves-effect waves-light rounded-pill"
                onClick={() => onNavigate('client-form', { editId: clientId })}
              >
                <i className="ri-pencil-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Edit Profile
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── Hero banner — velzon-style profile cover with all hero content inside ── */}
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
              backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 40%), radial-gradient(circle at 85% 80%, rgba(10,179,156,0.22) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <Row className="g-4 align-items-center position-relative flex-nowrap">
            <Col xs="auto">
              {client.logo ? (
                <img
                  src={client.logo}
                  alt=""
                  className="rounded-circle"
                  style={{
                    width: 110, height: 110, objectFit: 'cover',
                    background: '#fff',
                    padding: 4,
                    border: '3px solid rgba(255,255,255,0.3)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                  }}
                />
              ) : (
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
              )}
            </Col>

            <Col className="min-w-0">
              <h3 className="text-white mb-1 fw-semibold">{client.org_name}</h3>
              <p className="mb-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <i className="ri-building-line align-bottom me-1"></i>
                {client.org_type}{client.industry && <> &middot; {client.industry}</>}
              </p>
              <div className="d-flex gap-3 flex-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {location && (
                  <div>
                    <i className="ri-map-pin-user-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {location}
                  </div>
                )}
                {client.website && (
                  <div>
                    <i className="ri-global-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {client.website}
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
                  <h3 className="text-white mb-0 fw-bold lh-1">{client.branches_count ?? 0}</h3>
                  <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>Branches</p>
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
                  <h3 className="text-white mb-0 fw-bold lh-1">{client.users_count ?? 0}</h3>
                  <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>Users</p>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Card>

      {/* ── Overview content ── */}
      {(() => {
              // Shared card style — 20px radius, soft shadow, theme-aware background
              const cardStyle: React.CSSProperties = {
                borderRadius: 20,
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 4px 24px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
                background: 'var(--vz-card-bg)',
                overflow: 'hidden',
                transition: 'transform .18s ease, box-shadow .18s ease',
              };
              const onCardEnter = (e: React.MouseEvent<HTMLDivElement>) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(-2px)';
                el.style.boxShadow = '0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 4px rgba(15, 23, 42, 0.05)';
              };
              const onCardLeave = (e: React.MouseEvent<HTMLDivElement>) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(0)';
                el.style.boxShadow = '0 4px 24px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)';
              };
              // Gradient palettes used to accent section headers
              const GRAD_PRIMARY = 'linear-gradient(135deg, #405189 0%, #6691e7 100%)';
              const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
              const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
              const GRAD_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
              const GRAD_INFO    = 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)';
              const GRAD_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';

              const SectionHeader = ({ title, gradient, icon, action }: { title: string; gradient: string; icon: string; action?: React.ReactNode }) => (
                <div className="d-flex align-items-center gap-2 mb-3">
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
                {/* ── ROW 1 — Complete Your Profile (narrow) + About (wide) ── */}
                <Row className="mt-2 g-2 align-items-stretch">
                  <Col xxl={4} lg={5}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader
                          title="Complete Your Profile"
                          gradient={GRAD_DANGER}
                          icon="ri-user-star-line"
                          action={(
                            <button
                              type="button"
                              className="btn btn-sm btn-soft-secondary rounded-circle"
                              onClick={() => onNavigate('client-form', { editId: clientId })}
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
                      </CardBody>
                    </Card>
                  </Col>

                  <Col xxl={8} lg={7}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader title="About" gradient={GRAD_PRIMARY} icon="ri-building-4-line" />
                        <p className="text-muted mb-3">
                          Welcome to <strong>{client.org_name}</strong>'s profile.
                          {client.industry && <> Operating in the <strong>{client.industry}</strong> sector</>}
                          {client.org_type && <> as a <strong>{client.org_type}</strong></>}.
                          Manage organization details, branches, users, permissions and billing from a single place.
                        </p>

                        <Row className="g-3">
                          <Col xs={12} md={4}>
                            <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))', border: '1px solid var(--vz-border-color)' }}>
                              <div className="flex-shrink-0 me-3">
                                <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_PRIMARY, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}>
                                  <i className="ri-user-2-fill" style={{ color: '#fff', fontSize: 18 }}></i>
                                </span>
                              </div>
                              <div className="flex-grow-1 overflow-hidden">
                                <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Designation</p>
                                <h6 className="text-truncate mb-0">{client.org_type || 'Organization'}</h6>
                              </div>
                            </div>
                          </Col>
                          <Col xs={12} md={4}>
                            <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(41,156,219,0.06), rgba(95,200,255,0.04))', border: '1px solid var(--vz-border-color)' }}>
                              <div className="flex-shrink-0 me-3">
                                <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_INFO, boxShadow: '0 4px 10px rgba(41,156,219,0.25)' }}>
                                  <i className="ri-global-line" style={{ color: '#fff', fontSize: 18 }}></i>
                                </span>
                              </div>
                              <div className="flex-grow-1 overflow-hidden">
                                <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Website</p>
                                <a href={client.website ? (client.website.startsWith('http') ? client.website : `https://${client.website}`) : '#'} target="_blank" rel="noreferrer" className="fw-semibold text-truncate d-block">
                                  {client.website || '—'}
                                </a>
                              </div>
                            </div>
                          </Col>
                          <Col xs={12} md={4}>
                            <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(247,184,75,0.08), rgba(255,212,122,0.04))', border: '1px solid var(--vz-border-color)' }}>
                              <div className="flex-shrink-0 me-3">
                                <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_WARNING, boxShadow: '0 4px 10px rgba(247,184,75,0.3)' }}>
                                  <i className="ri-vip-crown-line" style={{ color: '#fff', fontSize: 18 }}></i>
                                </span>
                              </div>
                              <div className="flex-grow-1 overflow-hidden">
                                <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Plan</p>
                                <h6 className="text-truncate mb-0">{client.plan?.name || 'Free'}</h6>
                              </div>
                            </div>
                          </Col>
                        </Row>
                      </CardBody>
                    </Card>
                  </Col>
                </Row>

                {/* ── ROW 2 — Info + Plan & Billing + Address ── */}
                <Row className="g-2 mt-2 align-items-stretch">
                  <Col xxl={4} lg={4} md={6}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader title="Info" gradient={GRAD_PRIMARY} icon="ri-information-line" />
                        <div className="table-responsive">
                          <table className="table table-borderless mb-0 cv-info-table">
                            <tbody>
                              <tr>
                                <th className="ps-0 text-nowrap" scope="row">Full Name :</th>
                                <td className="text-muted">{client.org_name}</td>
                              </tr>
                              {client.phone && (
                                <tr>
                                  <th className="ps-0 text-nowrap" scope="row">Mobile :</th>
                                  <td className="text-muted">{client.phone}</td>
                                </tr>
                              )}
                              {client.email && (
                                <tr>
                                  <th className="ps-0 text-nowrap" scope="row">E-mail :</th>
                                  <td className="text-muted">{client.email}</td>
                                </tr>
                              )}
                              {(client.industry || client.sports) && (
                                <tr>
                                  <th className="ps-0 text-nowrap" scope="row">Industry :</th>
                                  <td className="text-muted">{client.industry || client.sports}</td>
                                </tr>
                              )}
                               {location && (
                                <tr>
                                  <th className="ps-0 text-nowrap" scope="row">Location :</th>
                                  <td className="text-muted">{location}</td>
                                </tr>
                              )} 
                              <tr>
                                <th className="ps-0 text-nowrap" scope="row">Joining Date :</th>
                                <td className="text-muted">
                                  {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </td>
                              </tr>
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
                          title="Plan & Billing"
                          gradient={GRAD_SUCCESS}
                          icon="ri-money-rupee-circle-line"
                          action={(
                            <span className={`badge rounded-pill ${client.plan_type === 'paid' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
                              <i className={`ri-circle-fill me-1 ${client.plan_type === 'paid' ? 'text-success' : 'text-warning'}`} style={{ fontSize: 6 }}></i>
                              {client.plan_type === 'paid' ? 'Active' : 'Free'}
                            </span>
                          )}
                        />
                        <div className="table-responsive">
                          <table className="table table-borderless mb-0 cv-info-table">
                            <tbody>
                              <tr>
                                <th className="ps-0 text-nowrap" scope="row">Plan :</th>
                                <td className="text-muted">{client.plan?.name || 'Free'}</td>
                              </tr>
                              <tr>
                                <th className="ps-0 text-nowrap" scope="row">Billing :</th>
                                <td className="text-muted">{client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'N/A'}</td>
                              </tr>
                              {client.plan_expires_at && (
                                <tr>
                                  <th className="ps-0 text-nowrap" scope="row">Expires :</th>
                                  <td className="text-muted">
                                    {new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </td>
                                </tr>
                              )}
                              <tr>
                                <th className="ps-0 text-nowrap" scope="row">Joined :</th>
                                <td className="text-muted">
                                  {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </CardBody>
                    </Card>
                  </Col>

                  <Col xxl={4} lg={4} md={12}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader title="Address" gradient={GRAD_INFO} icon="ri-map-pin-line" />
                        {(client.address || client.city || client.state) ? (
                          <div className="table-responsive">
                            <table className="table table-borderless mb-0 cv-info-table">
                              <tbody>
                                {client.address && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">Street :</th>
                                    <td className="text-muted">{client.address}</td>
                                  </tr>
                                )}
                                {(client.city || client.district) && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">City :</th>
                                    <td className="text-muted">{[client.city, client.district].filter(Boolean).join(', ')}</td>
                                  </tr>
                                )}
                                {client.state && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">State :</th>
                                    <td className="text-muted">{client.state}</td>
                                  </tr>
                                )}
                                {client.country && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">Country :</th>
                                    <td className="text-muted">{client.country}</td>
                                  </tr>
                                )}
                                {client.pincode && (
                                  <tr>
                                    <th className="ps-0" scope="row">Pincode :</th>
                                    <td className="text-muted font-monospace">{client.pincode}</td>
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

                {/* ── ROW 3 — Brand Colors + Client Admin + Legal & Tax ── */}
                <Row className="mb-3 g-2 mt-2 align-items-stretch">
                  <Col xxl={4} lg={4} md={6}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader
                          title="Brand Colors"
                          gradient={GRAD_PURPLE}
                          icon="ri-palette-line"
                          action={(
                            <button
                              type="button"
                              className="btn btn-sm btn-soft-primary rounded-pill"
                              onClick={() => onNavigate('client-form', { editId: clientId })}
                            >
                              Manage
                            </button>
                          )}
                        />
                        <div className="d-flex gap-2 flex-wrap">
                          <div className="d-flex align-items-center gap-2 p-2 flex-grow-1" style={{ minWidth: 130, borderRadius: 14, border: '1px solid var(--vz-border-color)', background: 'var(--vz-secondary-bg)' }}>
                            <div style={{ width: 34, height: 34, backgroundColor: client.primary_color, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', boxShadow: `0 2px 6px ${client.primary_color}55` }} />
                            <div className="min-w-0">
                              <div className="fs-11 text-muted text-uppercase fw-semibold" style={{ letterSpacing: '0.05em' }}>Primary</div>
                              <div className="fs-12 fw-semibold font-monospace text-truncate">{client.primary_color}</div>
                            </div>
                          </div>
                          <div className="d-flex align-items-center gap-2 p-2 flex-grow-1" style={{ minWidth: 130, borderRadius: 14, border: '1px solid var(--vz-border-color)', background: 'var(--vz-secondary-bg)' }}>
                            <div style={{ width: 34, height: 34, backgroundColor: client.secondary_color, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', boxShadow: `0 2px 6px ${client.secondary_color}55` }} />
                            <div className="min-w-0">
                              <div className="fs-11 text-muted text-uppercase fw-semibold" style={{ letterSpacing: '0.05em' }}>Secondary</div>
                              <div className="fs-12 fw-semibold font-monospace text-truncate">{client.secondary_color}</div>
                            </div>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </Col>

                  <Col xxl={4} lg={4} md={6}>
                    <Card className="mb- h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader
                          title="Client Admin"
                          gradient={GRAD_PRIMARY}
                          icon="ri-user-3-line"
                          action={(
                            <button
                              type="button"
                              className="btn btn-sm btn-soft-primary rounded-pill"
                              onClick={() => onNavigate('client-permissions', { clientId, clientName: client.org_name })}
                            >
                              Manage
                            </button>
                          )}
                        />
                        {adminUser ? (
                          <div className="d-flex align-items-center p-3" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(64,81,137,0.05), rgba(102,145,231,0.03))', border: '1px solid var(--vz-border-color)' }}>
                            <div className="flex-shrink-0">
                              <span
                                className="d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-bold"
                                style={{ width: 42, height: 42, background: GRAD_PRIMARY, fontSize: 16, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}
                              >
                                {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
                              </span>
                            </div>
                            <div className="flex-grow-1 ms-3 overflow-hidden">
                              <h6 className="mb-1 text-truncate">{adminUser.name}</h6>
                              <p className="text-muted mb-0 text-truncate fs-12">{adminUser.email}</p>
                            </div>
                            <span className={`badge rounded-pill bg-${adminUser.status === 'active' ? 'success' : 'danger'}-subtle text-${adminUser.status === 'active' ? 'success' : 'danger'} text-uppercase`}>
                              {adminUser.status}
                            </span>
                          </div>
                        ) : (
                          <div className="text-center py-4">
                            <i className="ri-user-3-line text-muted" style={{ fontSize: 26 }}></i>
                            <p className="text-muted mb-0 mt-2">No admin assigned</p>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  </Col>

                  <Col xxl={4} lg={4} md={12}>
                    <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
                      <CardBody>
                        <SectionHeader title="Legal & Tax" gradient={GRAD_DANGER} icon="ri-file-text-line" />
                        {(client.gst_number || client.pan_number) ? (
                          <div className="table-responsive">
                            <table className="table table-borderless mb-0 cv-info-table">
                              <tbody>
                                {client.gst_number && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">GST :</th>
                                    <td className="text-muted font-monospace">{client.gst_number}</td>
                                  </tr>
                                )}
                                {client.pan_number && (
                                  <tr>
                                    <th className="ps-0 text-nowrap" scope="row">PAN :</th>
                                    <td className="text-muted font-monospace">{client.pan_number}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-4">
                            <i className="ri-file-text-line text-muted" style={{ fontSize: 26 }}></i>
                            <p className="text-muted mb-0 mt-2">No legal details added</p>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  </Col>
                </Row>
              </>
              );
            })()}
    </>
  );
}
