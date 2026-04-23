import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Nav, NavItem, NavLink } from 'reactstrap';
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

  const InfoRow = ({ icon, label, value, mono, color = '#405189' }: { icon: string; label: string; value: any; mono?: boolean; color?: string }) => {
    if (!value) return null;
    return (
      <div className="d-flex align-items-center gap-2 py-1">
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-1 flex-shrink-0"
          style={{ width: 26, height: 26, background: color + '18', border: `1px solid ${color}22` }}
        >
          <i className={`${icon}`} style={{ color, fontSize: 12 }} />
        </span>
        <div className="flex-grow-1 min-w-0">
          <p className="mb-0 fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', fontSize: 10, textTransform: 'uppercase' }}>{label}</p>
          <div className={`text-truncate fw-semibold ${mono ? 'font-monospace' : ''}`} style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 12, lineHeight: 1.35 }}>{value}</div>
        </div>
      </div>
    );
  };

  // Section card — colored left accent + header
  const SectionCard = ({
    icon, label, color, manageLabel, onManage, children,
  }: {
    icon: string; label: string; color: string;
    manageLabel?: string; onManage?: () => void;
    children: React.ReactNode;
  }) => (
    <div
      className="h-100"
      style={{
        background: 'var(--vz-card-bg)',
        borderRadius: 10,
        border: '1px solid var(--vz-border-color)',
        borderLeft: `3px solid ${color}`,
        overflow: 'hidden',
      }}
    >
      <div
        className="d-flex align-items-center justify-content-between px-2 py-2"
        style={{ background: `linear-gradient(90deg, ${color}0f 0%, var(--vz-card-bg) 70%)`, borderBottom: '1px solid var(--vz-border-color)' }}
      >
        <div className="d-flex align-items-center gap-2">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-1"
            style={{ width: 22, height: 22, background: color + '18', border: `1px solid ${color}22` }}
          >
            <i className={`${icon}`} style={{ color, fontSize: 11 }} />
          </span>
          <h6 className="mb-0 fw-bold text-uppercase" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', letterSpacing: '0.05em', fontSize: 10.5 }}>{label}</h6>
        </div>
        {onManage && (
          <button
            className="btn btn-sm p-0 d-inline-flex align-items-center gap-1"
            style={{ color, fontSize: 10.5, fontWeight: 600 }}
            onClick={onManage}
          >
            {manageLabel || 'Manage'} <i className="ri-arrow-right-line" />
          </button>
        )}
      </div>
      <div className="px-2 py-2">{children}</div>
    </div>
  );

  const EmptyState = ({ icon, text }: { icon: string; text: string }) => (
    <div className="text-center py-3">
      <i className={icon} style={{ fontSize: 22, color: 'var(--vz-secondary-color)', opacity: 0.5 }} />
      <p className="mb-0 fs-12 mt-1" style={{ color: 'var(--vz-secondary-color)' }}>{text}</p>
    </div>
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
              <button className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: 32, height: 32 }} onClick={onBack}>
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

      {/* ── Hero banner — premium dark navy gradient ── */}
      <Card className="overflow-hidden shadow-sm mb-0">
        <div
          className="px-3 py-3 text-white position-relative"
          style={{
            background: 'linear-gradient(135deg, #0b1324 0%, #1e2a4a 45%, #2d4373 100%)',
          }}
        >
          {/* Subtle grid overlay for premium feel */}
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage: 'radial-gradient(circle at 25% 10%, rgba(102,145,231,0.18) 0%, transparent 40%), radial-gradient(circle at 85% 90%, rgba(10,179,156,0.12) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <div className="d-flex align-items-center gap-3 flex-wrap position-relative">
            {client.logo ? (
              <img
                src={client.logo}
                alt=""
                className="rounded-3 p-1"
                style={{ width: 48, height: 48, objectFit: 'contain', background: 'rgba(255,255,255,0.95)', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}
              />
            ) : (
              <div
                className="rounded-3 fw-bold d-flex align-items-center justify-content-center"
                style={{
                  width: 48, height: 48, fontSize: 17,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                }}
              >
                {client.org_name.charAt(0)}{client.org_name.split(' ')[1]?.charAt(0) || ''}
              </div>
            )}
            <div className="flex-grow-1 min-w-0">
              <h5 className="text-white mb-1 fw-semibold" style={{ fontSize: 17 }}>{client.org_name}</h5>
              <div className="d-flex gap-2 flex-wrap align-items-center">
                <span
                  className="rounded-pill px-2 py-1 fw-semibold d-inline-flex align-items-center gap-1"
                  style={{ background: 'rgba(255,255,255,0.96)', color: '#0b1324', fontSize: 10.5 }}
                >
                  <i className="ri-vip-crown-line" style={{ fontSize: 11 }} />{client.plan?.name || 'Free'}
                </span>
                <span
                  className="rounded-pill px-2 py-1 fw-medium text-uppercase"
                  style={{ background: 'rgba(255,255,255,0.10)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)', fontSize: 10, letterSpacing: '0.04em' }}
                >
                  {client.org_type}
                </span>
                <span className="d-inline-flex align-items-center gap-1" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 11 }}>
                  <span
                    className="d-inline-block rounded-circle"
                    style={{
                      width: 6, height: 6,
                      background: client.plan_type === 'paid' ? '#22c55e' : '#fbbf24',
                      boxShadow: client.plan_type === 'paid' ? '0 0 6px #22c55e' : '0 0 6px #fbbf24',
                    }}
                  />
                  {client.plan_type === 'paid' ? 'Active subscription' : 'Free plan'}
                </span>
              </div>
            </div>
            <div className="d-flex gap-2">
              <div
                className="text-center px-2 py-2 rounded-3"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', minWidth: 64 }}
              >
                <div className="text-white fw-bold lh-1" style={{ fontSize: 18 }}>{client.branches_count ?? 0}</div>
                <div className="text-uppercase fw-semibold mt-1" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9, letterSpacing: '0.06em' }}>Branches</div>
              </div>
              <div
                className="text-center px-2 py-2 rounded-3"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', minWidth: 64 }}
              >
                <div className="text-white fw-bold lh-1" style={{ fontSize: 18 }}>{client.users_count ?? 0}</div>
                <div className="text-uppercase fw-semibold mt-1" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9, letterSpacing: '0.06em' }}>Users</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
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

        <CardBody className="p-3">
          {activeTab === 'overview' && (
            <Row className="g-3">
              <Col lg={6}>
                <SectionCard icon="ri-building-line" label="Organization" color="#405189">
                  <InfoRow icon="ri-mail-line"      label="Email"    value={client.email}                              color="#405189" />
                  <InfoRow icon="ri-phone-line"     label="Phone"    value={client.phone}                              color="#405189" />
                  <InfoRow icon="ri-global-line"    label="Website"  value={client.website}                            color="#405189" />
                  <InfoRow icon="ri-briefcase-line" label="Industry" value={client.industry || client.sports}          color="#405189" />
                </SectionCard>
              </Col>
              <Col lg={6}>
                <SectionCard icon="ri-map-pin-line" label="Address" color="#405189">
                  {(client.address || client.city || client.state) ? (
                    <>
                      <InfoRow icon="ri-map-pin-line"    label="Address"         value={client.address}                                                                   color="#405189" />
                      <InfoRow icon="ri-community-line"  label="City / District" value={[client.city, client.district].filter(Boolean).join(', ') || null}              color="#405189" />
                      <InfoRow icon="ri-flag-line"       label="State / Country" value={[client.state, client.country].filter(Boolean).join(', ') || null}              color="#405189" />
                      {client.pincode && <InfoRow icon="ri-hashtag" label="Pincode" value={client.pincode} mono color="#405189" />}
                    </>
                  ) : <EmptyState icon="ri-map-pin-line" text="No address added" />}
                </SectionCard>
              </Col>

              <Col lg={6}>
                <SectionCard icon="ri-file-text-line" label="Legal & Tax" color="#405189">
                  {(client.gst_number || client.pan_number) ? (
                    <>
                      {client.gst_number && <InfoRow icon="ri-file-list-2-line" label="GST Number" value={client.gst_number} mono color="#405189" />}
                      {client.pan_number && <InfoRow icon="ri-bank-card-line"   label="PAN Number" value={client.pan_number} mono color="#405189" />}
                    </>
                  ) : <EmptyState icon="ri-file-text-line" text="No legal details added" />}
                </SectionCard>
              </Col>
              <Col lg={6}>
                <SectionCard icon="ri-shield-check-line" label="Plan & Billing" color="#0ab39c">
                  <InfoRow icon="ri-shield-check-line"       label="Plan"    value={client.plan?.name || 'Free'}                                                        color="#0ab39c" />
                  <InfoRow icon="ri-money-rupee-circle-line" label="Billing" value={client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'N/A'}             color="#0ab39c" />
                  {client.plan_expires_at && (
                    <InfoRow
                      icon="ri-calendar-line"
                      label="Expires"
                      value={new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      color="#0ab39c"
                    />
                  )}
                </SectionCard>
              </Col>

              <Col lg={6}>
                <SectionCard
                  icon="ri-user-3-line"
                  label="Client Admin"
                  color="#405189"
                  manageLabel="Manage"
                  onManage={() => onNavigate('client-permissions', { clientId, clientName: client.org_name })}
                >
                  {adminUser ? (
                    <div
                      className="d-flex align-items-center gap-2 p-2 rounded-2"
                      style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
                    >
                      <div
                        className="rounded-2 d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                        style={{ width: 32, height: 32, fontSize: 12, background: 'linear-gradient(135deg,#405189,#6691e7)' }}
                      >
                        {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
                      </div>
                      <div className="flex-grow-1 min-w-0">
                        <div className="text-truncate fw-semibold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 12 }}>{adminUser.name}</div>
                        <div className="text-truncate" style={{ color: 'var(--vz-secondary-color)', fontSize: 10.5 }}>{adminUser.email}</div>
                      </div>
                      <span
                        className={`badge rounded-pill border text-uppercase fw-semibold px-2 py-1 d-inline-flex align-items-center gap-1 border-${adminUser.status === 'active' ? 'success' : 'danger'} text-${adminUser.status === 'active' ? 'success' : 'danger'}`}
                        style={{ fontSize: 9 }}
                      >
                        <span className={`bg-${adminUser.status === 'active' ? 'success' : 'danger'} rounded-circle`} style={{ width: 5, height: 5 }} />
                        {adminUser.status}
                      </span>
                    </div>
                  ) : <EmptyState icon="ri-user-3-line" text="No admin assigned" />}
                </SectionCard>
              </Col>

              <Col lg={6}>
                <SectionCard
                  icon="ri-palette-line"
                  label="Branding"
                  color="#405189"
                  manageLabel="Manage"
                  onManage={() => onNavigate('client-form', { editId: clientId })}
                >
                  <div className="d-flex gap-2 flex-wrap">
                    <div
                      className="d-flex align-items-center gap-2 p-2 rounded-2 flex-grow-1"
                      style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', minWidth: 140 }}
                    >
                      <div className="rounded-2 shadow-sm flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: client.primary_color, border: '1px solid var(--vz-border-color)' }} />
                      <div className="min-w-0">
                        <div className="fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', fontSize: 10, textTransform: 'uppercase' }}>Primary</div>
                        <div className="font-monospace fw-semibold text-truncate" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 11 }}>{client.primary_color}</div>
                      </div>
                    </div>
                    <div
                      className="d-flex align-items-center gap-2 p-2 rounded-2 flex-grow-1"
                      style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', minWidth: 140 }}
                    >
                      <div className="rounded-2 shadow-sm flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: client.secondary_color, border: '1px solid var(--vz-border-color)' }} />
                      <div className="min-w-0">
                        <div className="fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', fontSize: 10, textTransform: 'uppercase' }}>Secondary</div>
                        <div className="font-monospace fw-semibold text-truncate" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 11 }}>{client.secondary_color}</div>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </Col>
            </Row>
          )}
        </CardBody>

        <div
          className="text-center fs-12 py-2 border-top"
          style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-secondary-color)' }}
        >
          <i className="ri-time-line me-1"></i>
          Created on <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        </div>
      </Card>
    </>
  );
}
