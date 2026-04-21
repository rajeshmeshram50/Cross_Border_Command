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

  const InfoRow = ({ icon, label, value, mono }: { icon: string; label: string; value: any; mono?: boolean }) => {
    if (!value) return null;
    return (
      <div className="d-flex align-items-center gap-3 py-2 border-bottom">
        <div className="avatar-xs">
          <span className="avatar-title rounded bg-primary-subtle text-primary fs-4"><i className={icon}></i></span>
        </div>
        <div className="flex-grow-1">
          <p className="text-muted mb-0 fs-11 text-uppercase fw-semibold">{label}</p>
          <h6 className={`mb-0 fs-14 ${mono ? 'font-monospace' : ''}`}>{value}</h6>
        </div>
      </div>
    );
  };

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
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Client Details
            </h4>
            <div className="page-title-right">
              <Button color="primary" size="sm" onClick={() => onNavigate('client-form', { editId: clientId })}>
                <i className="ri-pencil-line me-1"></i> Edit
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Client hero banner */}
      <Card>
        <div className="bg-primary bg-gradient p-4 text-white d-flex align-items-center gap-3 flex-wrap">
          {client.logo ? (
            <img src={client.logo} alt="" className="rounded bg-white p-1" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          ) : (
            <div className="avatar rounded bg-white bg-opacity-25 text-white fw-bold d-flex align-items-center justify-content-center" style={{ width: 56, height: 56, fontSize: 20 }}>
              {client.org_name.charAt(0)}{client.org_name.split(' ')[1]?.charAt(0) || ''}
            </div>
          )}
          <div className="flex-grow-1">
            <h3 className="text-white mb-1">{client.org_name}</h3>
            <div className="d-flex gap-2 flex-wrap">
              <Badge color="light" className="text-dark">{client.plan?.name || 'Free'}</Badge>
              <Badge color="info-subtle" className="text-info">{client.org_type}</Badge>
              <span className="text-white-50 fs-13">{client.plan_type === 'paid' ? 'Active subscription' : 'Free plan'}</span>
            </div>
          </div>
          <div className="d-flex gap-4">
            <div className="text-center">
              <h3 className="text-white mb-0">{client.branches_count ?? 0}</h3>
              <small className="text-white-50 text-uppercase">Branches</small>
            </div>
            <div className="text-center">
              <h3 className="text-white mb-0">{client.users_count ?? 0}</h3>
              <small className="text-white-50 text-uppercase">Users</small>
            </div>
          </div>
        </div>

        <Nav tabs className="nav-tabs-custom nav-success">
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
                <i className={`${t.icon} me-1`}></i>{t.label}
              </NavLink>
            </NavItem>
          ))}
        </Nav>

        <CardBody>
          {activeTab === 'overview' && (
            <Row className="g-4">
              <Col lg={6}>
                <h6 className="text-uppercase fw-bold text-muted mb-3 fs-12">
                  <i className="ri-building-line text-primary me-1"></i> Organization
                </h6>
                <InfoRow icon="ri-mail-line" label="Email" value={client.email} />
                <InfoRow icon="ri-phone-line" label="Phone" value={client.phone} />
                <InfoRow icon="ri-global-line" label="Website" value={client.website} />
                <InfoRow icon="ri-building-line" label="Industry" value={client.industry || client.sports} />
              </Col>
              <Col lg={6}>
                <h6 className="text-uppercase fw-bold text-muted mb-3 fs-12">
                  <i className="ri-map-pin-line text-primary me-1"></i> Address
                </h6>
                {(client.address || client.city || client.state) ? (
                  <>
                    <InfoRow icon="ri-map-pin-line" label="Address" value={client.address} />
                    <InfoRow icon="ri-map-pin-2-line" label="City / District" value={[client.city, client.district].filter(Boolean).join(', ') || null} />
                    <InfoRow icon="ri-map-pin-2-line" label="State / Country" value={[client.state, client.country].filter(Boolean).join(', ') || null} />
                    {client.pincode && <InfoRow icon="ri-hashtag" label="Pincode" value={client.pincode} mono />}
                  </>
                ) : <p className="text-muted fs-13 text-center py-3">No address added</p>}
              </Col>

              <Col lg={6}>
                <h6 className="text-uppercase fw-bold text-muted mb-3 fs-12">
                  <i className="ri-file-text-line text-primary me-1"></i> Legal & Tax
                </h6>
                {(client.gst_number || client.pan_number) ? (
                  <>
                    {client.gst_number && <InfoRow icon="ri-file-list-2-line" label="GST Number" value={client.gst_number} mono />}
                    {client.pan_number && <InfoRow icon="ri-bank-card-line" label="PAN Number" value={client.pan_number} mono />}
                  </>
                ) : <p className="text-muted fs-13 text-center py-3">No legal details added</p>}
              </Col>
              <Col lg={6}>
                <h6 className="text-uppercase fw-bold text-muted mb-3 fs-12">
                  <i className="ri-money-rupee-circle-line text-primary me-1"></i> Plan & Billing
                </h6>
                <InfoRow icon="ri-shield-check-line" label="Plan" value={client.plan?.name || 'Free'} />
                <InfoRow icon="ri-money-rupee-circle-line" label="Billing" value={client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'N/A'} />
                {client.plan_expires_at && <InfoRow icon="ri-calendar-line" label="Expires" value={new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} />}
              </Col>

              <Col lg={6}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="text-uppercase fw-bold text-muted mb-0 fs-12">
                    <i className="ri-user-3-line text-info me-1"></i> Client Admin
                  </h6>
                  <button className="btn btn-sm btn-link text-primary p-0"
                    onClick={() => onNavigate('client-permissions', { clientId, clientName: client.org_name })}>
                    Manage →
                  </button>
                </div>
                {adminUser ? (
                  <div className="d-flex align-items-center gap-3 p-3 bg-light rounded">
                    <div className="avatar-sm">
                      <div className="avatar-title rounded bg-primary text-white fw-bold">
                        {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
                      </div>
                    </div>
                    <div className="flex-grow-1">
                      <h6 className="mb-0 fs-14">{adminUser.name}</h6>
                      <p className="text-muted mb-0 fs-12">{adminUser.email}</p>
                    </div>
                    <Badge color={adminUser.status === 'active' ? 'success' : 'danger'} pill>{adminUser.status}</Badge>
                  </div>
                ) : <p className="text-muted fs-13 text-center py-3">No admin assigned</p>}
              </Col>

              <Col lg={6}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="text-uppercase fw-bold text-muted mb-0 fs-12">
                    <i className="ri-palette-line text-primary me-1"></i> Branding
                  </h6>
                  <button className="btn btn-sm btn-link text-primary p-0"
                    onClick={() => onNavigate('client-form', { editId: clientId })}>
                    Manage →
                  </button>
                </div>
                <div className="d-flex gap-3">
                  <div className="d-flex align-items-center gap-2">
                    <div className="rounded border" style={{ width: 36, height: 36, backgroundColor: client.primary_color }} />
                    <div>
                      <div className="text-muted fs-11 text-uppercase fw-semibold">Primary</div>
                      <div className="font-monospace fs-12">{client.primary_color}</div>
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <div className="rounded border" style={{ width: 36, height: 36, backgroundColor: client.secondary_color }} />
                    <div>
                      <div className="text-muted fs-11 text-uppercase fw-semibold">Secondary</div>
                      <div className="font-monospace fs-12">{client.secondary_color}</div>
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          )}
        </CardBody>
        <CardBody className="border-top text-center text-muted fs-13">
          <i className="ri-time-line me-1"></i>
          Created on {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </CardBody>
      </Card>
    </>
  );
}
