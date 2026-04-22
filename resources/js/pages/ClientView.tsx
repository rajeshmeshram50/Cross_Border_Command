import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Badge, Button, Spinner, Nav, NavItem, NavLink } from 'reactstrap';
import api from '../api';
import classnames from 'classnames';

interface Props {
  clientId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

export default function ClientView({ clientId, onBack, onNavigate }: Props) {
  const [client, setClient] = useState<any>(null);
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

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

  const InfoRow = ({ icon, label, value, mono, color = 'primary' }: { icon: string; label: string; value: any; mono?: boolean; color?: string }) => {
    if (!value) return null;
    return (
      <div className="d-flex align-items-center gap-3 py-2">
        <span className={`d-inline-flex align-items-center justify-content-center rounded bg-${color}-subtle text-${color}`} style={{ width: 34, height: 34, flexShrink: 0 }}>
          <i className={`${icon} fs-15`}></i>
        </span>
        <div className="flex-grow-1 min-w-0">
          <p className="text-muted mb-0 fs-11 text-uppercase fw-semibold">{label}</p>
          <h6 className={`mb-0 fs-14 text-truncate ${mono ? 'font-monospace' : ''}`}>{value}</h6>
        </div>
      </div>
    );
  };

  const SectionTitle = ({ icon, label, color = 'primary' }: { icon: string; label: string; color?: string }) => (
    <h6 className="text-uppercase fw-bold text-muted mb-3 fs-12 d-flex align-items-center gap-2">
      <span className={`d-inline-flex align-items-center justify-content-center rounded bg-${color}-subtle text-${color}`} style={{ width: 26, height: 26 }}>
        <i className={`${icon} fs-13`}></i>
      </span>
      {label}
    </h6>
  );

  const handleTabClick = (tabId: string) => {
    if (tabId === 'overview') { setActiveTab('overview'); return; }
    const pageMap: Record<string, string> = {
      branches: 'client-branches',
      permissions: 'client-permissions',
      payments: 'client-payments',
      settings: 'client-settings',
    };
    onNavigate(pageMap[tabId], { clientId, clientName: client.org_name });
  };

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-soft-primary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: 32, height: 32 }} onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Client Details
            </h4>
            <div className="page-title-right">
              <Button
                color="primary"
                className="btn-label waves-effect waves-light rounded-pill"
                onClick={() => onNavigate('client-form', { editId: clientId })}
              >
                <i className="ri-pencil-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Edit
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Client hero banner */}
      <Card className="overflow-hidden shadow-sm">
        <div
          className="p-4 text-white position-relative"
          style={{
            background: 'linear-gradient(135deg, var(--vz-primary) 0%, #6a7cc9 100%)',
          }}
        >
          <div
            className="position-absolute top-0 end-0 opacity-25"
            style={{
              width: 240,
              height: 240,
              background: 'radial-gradient(circle at top right, rgba(255,255,255,0.35), transparent 60%)',
              pointerEvents: 'none',
            }}
          />
          <div className="d-flex align-items-center gap-3 flex-wrap position-relative">
            {client.logo ? (
              <img src={client.logo} alt="" className="rounded-3 bg-white p-1 shadow-sm" style={{ width: 64, height: 64, objectFit: 'contain' }} />
            ) : (
              <div className="rounded-3 bg-white bg-opacity-25 text-white fw-bold d-flex align-items-center justify-content-center border border-white border-opacity-25 shadow-sm" style={{ width: 64, height: 64, fontSize: 22, backdropFilter: 'blur(4px)' }}>
                {client.org_name.charAt(0)}{client.org_name.split(' ')[1]?.charAt(0) || ''}
              </div>
            )}
            <div className="flex-grow-1 min-w-0">
              <h3 className="text-white mb-1 fw-semibold">{client.org_name}</h3>
              <div className="d-flex gap-2 flex-wrap align-items-center">
                <Badge color="light" className="text-dark rounded-pill px-3 py-1 fw-semibold">
                  <i className="ri-vip-crown-line me-1"></i>{client.plan?.name || 'Free'}
                </Badge>
                <Badge color="light" className="text-dark bg-white bg-opacity-25 text-white rounded-pill px-3 py-1">
                  {client.org_type}
                </Badge>
                <span className="text-white-50 fs-13 d-inline-flex align-items-center gap-1">
                  <span className="d-inline-block rounded-circle bg-success" style={{ width: 8, height: 8 }} />
                  {client.plan_type === 'paid' ? 'Active subscription' : 'Free plan'}
                </span>
              </div>
            </div>
            <div className="d-flex gap-3">
              <div className="text-center px-3 py-2 rounded-3 bg-white bg-opacity-10 border border-white border-opacity-25">
                <h3 className="text-white mb-0 fw-bold">{client.branches_count ?? 0}</h3>
                <small className="text-white-50 text-uppercase fs-10 fw-semibold">Branches</small>
              </div>
              <div className="text-center px-3 py-2 rounded-3 bg-white bg-opacity-10 border border-white border-opacity-25">
                <h3 className="text-white mb-0 fw-bold">{client.users_count ?? 0}</h3>
                <small className="text-white-50 text-uppercase fs-10 fw-semibold">Users</small>
              </div>
            </div>
          </div>
        </div>

        <Nav tabs className="nav-tabs-custom nav-success px-3 pt-2">
          {[
            { id: 'overview',    label: 'Overview',    icon: 'ri-building-line' },
            { id: 'branches',    label: 'Branches',    icon: 'ri-git-branch-line' },
            { id: 'permissions', label: 'Permissions', icon: 'ri-shield-check-line' },
            { id: 'payments',    label: 'Payments',    icon: 'ri-money-rupee-circle-line' },
            { id: 'settings',    label: 'Settings',    icon: 'ri-settings-3-line' },
          ].map(t => (
            <NavItem key={t.id}>
              <NavLink
                className={classnames({ active: activeTab === t.id, 'cursor-pointer': true })}
                onClick={() => handleTabClick(t.id)}
              >
                <i className={`${t.icon} me-1 align-bottom`}></i>{t.label}
              </NavLink>
            </NavItem>
          ))}
        </Nav>

        <CardBody className="p-4">
          {activeTab === 'overview' && (
            <Row className="g-3">
              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <SectionTitle icon="ri-building-line" label="Organization" color="primary" />
                  <InfoRow icon="ri-mail-line" label="Email" value={client.email} color="info" />
                  <InfoRow icon="ri-phone-line" label="Phone" value={client.phone} color="success" />
                  <InfoRow icon="ri-global-line" label="Website" value={client.website} color="primary" />
                  <InfoRow icon="ri-building-line" label="Industry" value={client.industry || client.sports} color="warning" />
                </div>
              </Col>
              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <SectionTitle icon="ri-map-pin-line" label="Address" color="danger" />
                  {(client.address || client.city || client.state) ? (
                    <>
                      <InfoRow icon="ri-map-pin-line" label="Address" value={client.address} color="danger" />
                      <InfoRow icon="ri-map-pin-2-line" label="City / District" value={[client.city, client.district].filter(Boolean).join(', ') || null} color="danger" />
                      <InfoRow icon="ri-map-pin-2-line" label="State / Country" value={[client.state, client.country].filter(Boolean).join(', ') || null} color="danger" />
                      {client.pincode && <InfoRow icon="ri-hashtag" label="Pincode" value={client.pincode} mono color="secondary" />}
                    </>
                  ) : <p className="text-muted fs-13 text-center py-3 mb-0">No address added</p>}
                </div>
              </Col>

              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <SectionTitle icon="ri-file-text-line" label="Legal & Tax" color="info" />
                  {(client.gst_number || client.pan_number) ? (
                    <>
                      {client.gst_number && <InfoRow icon="ri-file-list-2-line" label="GST Number" value={client.gst_number} mono color="info" />}
                      {client.pan_number && <InfoRow icon="ri-bank-card-line" label="PAN Number" value={client.pan_number} mono color="info" />}
                    </>
                  ) : <p className="text-muted fs-13 text-center py-3 mb-0">No legal details added</p>}
                </div>
              </Col>
              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <SectionTitle icon="ri-money-rupee-circle-line" label="Plan & Billing" color="success" />
                  <InfoRow icon="ri-shield-check-line" label="Plan" value={client.plan?.name || 'Free'} color="success" />
                  <InfoRow icon="ri-money-rupee-circle-line" label="Billing" value={client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'N/A'} color="success" />
                  {client.plan_expires_at && <InfoRow icon="ri-calendar-line" label="Expires" value={new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} color="warning" />}
                </div>
              </Col>

              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <SectionTitle icon="ri-user-3-line" label="Client Admin" color="info" />
                    <button className="btn btn-sm btn-link text-primary p-0 text-decoration-none"
                      onClick={() => onNavigate('client-permissions', { clientId, clientName: client.org_name })}>
                      Manage <i className="ri-arrow-right-line align-bottom"></i>
                    </button>
                  </div>
                  {adminUser ? (
                    <div className="d-flex align-items-center gap-3 p-3 bg-white rounded-3 border">
                      <div className="avatar-sm">
                        <div className="avatar-title rounded-3 bg-primary text-white fw-bold">
                          {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
                        </div>
                      </div>
                      <div className="flex-grow-1 min-w-0">
                        <h6 className="mb-0 fs-14 text-truncate">{adminUser.name}</h6>
                        <p className="text-muted mb-0 fs-12 text-truncate">{adminUser.email}</p>
                      </div>
                      <Badge color={adminUser.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase fs-10">{adminUser.status}</Badge>
                    </div>
                  ) : <p className="text-muted fs-13 text-center py-3 mb-0">No admin assigned</p>}
                </div>
              </Col>

              <Col lg={6}>
                <div className="border rounded-3 p-3 h-100 bg-light-subtle">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <SectionTitle icon="ri-palette-line" label="Branding" color="warning" />
                    <button className="btn btn-sm btn-link text-primary p-0 text-decoration-none"
                      onClick={() => onNavigate('client-form', { editId: clientId })}>
                      Manage <i className="ri-arrow-right-line align-bottom"></i>
                    </button>
                  </div>
                  <div className="d-flex gap-3 flex-wrap">
                    <div className="d-flex align-items-center gap-2 p-2 bg-white rounded-3 border flex-grow-1">
                      <div className="rounded-3 shadow-sm" style={{ width: 40, height: 40, backgroundColor: client.primary_color }} />
                      <div>
                        <div className="text-muted fs-11 text-uppercase fw-semibold">Primary</div>
                        <div className="font-monospace fs-12 fw-semibold">{client.primary_color}</div>
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2 p-2 bg-white rounded-3 border flex-grow-1">
                      <div className="rounded-3 shadow-sm" style={{ width: 40, height: 40, backgroundColor: client.secondary_color }} />
                      <div>
                        <div className="text-muted fs-11 text-uppercase fw-semibold">Secondary</div>
                        <div className="font-monospace fs-12 fw-semibold">{client.secondary_color}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          )}
        </CardBody>
        <CardBody className="border-top bg-light-subtle text-center text-muted fs-13 py-2">
          <i className="ri-time-line me-1"></i>
          Created on <strong className="text-dark">{new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        </CardBody>
      </Card>
    </>
  );
}
