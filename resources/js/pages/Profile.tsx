import { useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Label, Spinner, Form } from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../api';

export default function Profile() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showAllPerms, setShowAllPerms] = useState(false);

  if (!user) return null;

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Administrator',
    client_admin: 'Client Administrator',
    branch_user: 'Branch User',
    client_user: 'Client User',
  };
  const roleShort: Record<string, string> = {
    super_admin: 'Super Admin',
    client_admin: 'Client Admin',
    branch_user: 'Branch User',
    client_user: 'Client User',
  };

  const isSuperAdmin = user.user_type === 'super_admin';
  const isBranchUser = user.user_type === 'branch_user';

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];
    if (password.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('One number');
    return errors;
  };

  const passwordStrength = () => {
    if (!newPw) return { level: 0, text: '', color: '', barColor: '' };
    const errors = validatePassword(newPw);
    const level = 4 - errors.length;
    const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const barColors = ['', '#ef4444', '#f97316', '#eab308', '#10b981'];
    const textColors = ['', 'text-danger', 'text-warning', 'text-warning', 'text-success'];
    return { level, text: levels[level], color: textColors[level], barColor: barColors[level] };
  };
  const strength = passwordStrength();

  const handleChangePassword = async () => {
    if (!currentPw) { toast.warning('Required', 'Enter your current password'); return; }
    const pwErrors = validatePassword(newPw);
    if (pwErrors.length > 0) {
      toast.warning('Weak Password', `Password must contain: ${pwErrors.join(', ')}`);
      return;
    }
    if (newPw !== confirmPw) { toast.warning('Mismatch', 'Passwords do not match'); return; }
    setChangingPw(true);
    try {
      await api.post('/change-password', { current_password: currentPw, password: newPw, password_confirmation: confirmPw });
      toast.success('Updated', 'Password changed successfully');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not change password');
    } finally { setChangingPw(false); }
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 20,
    border: '1px solid var(--vz-border-color)',
    boxShadow: '0 4px 24px rgba(64,81,137,0.08), 0 1px 2px rgba(64,81,137,0.04)',
    background: 'var(--vz-card-bg)',
    overflow: 'hidden',
  };

  const GRAD_PRIMARY = 'linear-gradient(135deg, #405189 0%, #6691e7 100%)';
  const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
  const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
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

  const infoItems = [
    { icon: 'ri-mail-line',      label: 'Email',        value: user.email,                                                                    color: 'primary' },
    { icon: 'ri-phone-line',     label: 'Phone',        value: user.phone || 'Not set',                                                       color: 'success' },
    { icon: 'ri-briefcase-line', label: 'Designation',  value: user.designation || (isSuperAdmin ? 'Platform Administrator' : 'Not set'),     color: 'warning' },
    ...(!isSuperAdmin ? [{ icon: 'ri-building-line',   label: 'Organization', value: user.client_name || 'N/A', color: 'info' }] : []),
    ...(isBranchUser  ? [{ icon: 'ri-git-branch-line', label: 'Branch',       value: user.branch_name || 'N/A', color: 'info' }] : []),
    { icon: 'ri-global-line',    label: 'Timezone',     value: 'Asia/Kolkata (IST)',                                                          color: 'secondary' },
  ];

  const plan = user.plan;

  return (
    <>
      {/* ── Page title ── */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Profile</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">IGC</a></li>
                <li className="breadcrumb-item active">Profile</li>
              </ol>
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
            padding: '24px 28px',
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 40%), radial-gradient(circle at 85% 80%, rgba(10,179,156,0.22) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <Row className="g-4 align-items-center position-relative">
            <Col xs="auto">
              <div
                className="rounded-circle fw-bold d-flex align-items-center justify-content-center"
                style={{
                  width: 96, height: 96, fontSize: 34,
                  background: 'linear-gradient(135deg,rgba(255,255,255,0.28),rgba(255,255,255,0.08))',
                  color: '#fff',
                  border: '3px solid rgba(255,255,255,0.3)',
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                }}
              >
                {user.initials}
              </div>
            </Col>

            <Col className="min-w-0">
              <h3 className="text-white mb-1 fw-semibold">{user.name}</h3>
              <p className="mb-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <i className="ri-shield-keyhole-line align-bottom me-1"></i>
                {roleLabels[user.user_type] || user.user_type}
              </p>
              <div className="d-flex gap-3 flex-wrap" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
                {user.email && (
                  <div>
                    <i className="ri-mail-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {user.email}
                  </div>
                )}
                {user.client_name && (
                  <div>
                    <i className="ri-building-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {user.client_name}
                  </div>
                )}
                {user.branch_name && (
                  <div>
                    <i className="ri-git-branch-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {user.branch_name}
                  </div>
                )}
              </div>
            </Col>

            {/* Hero stat pills */}
            <Col xs="12" lg="auto">
              <div className="d-flex gap-2 flex-wrap justify-content-lg-end">
                <div
                  className="text-center px-3 py-2"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 14,
                    backdropFilter: 'blur(6px)',
                    minWidth: 130,
                  }}
                >
                  <p className="fs-11 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em' }}>Role</p>
                  <h6 className="text-white mb-0 fw-bold lh-1">{roleShort[user.user_type] || user.user_type}</h6>
                </div>
                <div
                  className="text-center px-3 py-2 d-flex flex-column justify-content-center"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 14,
                    backdropFilter: 'blur(6px)',
                    minWidth: 110,
                  }}
                >
                  <p className="fs-11 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em' }}>Status</p>
                  <div className="d-inline-flex align-items-center justify-content-center gap-1">
                    <span
                      className="d-inline-block rounded-circle"
                      style={{ width: 8, height: 8, background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
                    />
                    <h6 className="text-white mb-0 fw-bold lh-1">Active</h6>
                  </div>
                </div>
                {plan && plan.has_plan && plan.plan_name && (
                  <div
                    className="text-center px-3 py-2 d-flex flex-column justify-content-center"
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 14,
                      backdropFilter: 'blur(6px)',
                      minWidth: 120,
                    }}
                  >
                    <p className="fs-11 mb-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em' }}>Plan</p>
                    <h6 className="text-white mb-0 fw-bold lh-1 d-inline-flex align-items-center justify-content-center gap-1">
                      <i className="ri-vip-crown-line" style={{ fontSize: 14 }} />
                      {plan.plan_name}
                    </h6>
                  </div>
                )}
              </div>
            </Col>
          </Row>
        </div>
      </Card>

      {/* ── Main grid ── */}
      <Row className="mt-1 g-3 align-items-stretch">
        {/* ── LEFT COLUMN ── */}
        <Col xl={4}>
          <Card className="mb-3" style={cardStyle}>
            <CardBody>
              <SectionHeader
                title="Account Info"
                gradient={GRAD_PRIMARY}
                icon="ri-information-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-danger rounded-pill d-inline-flex align-items-center gap-1"
                    onClick={logout}
                    title="Logout"
                  >
                    <i className="ri-logout-box-r-line"></i>
                    <span className="fs-12 fw-semibold">Logout</span>
                  </button>
                )}
              />
              <div className="vstack gap-0">
                {infoItems.map((item, i) => (
                  <div
                    key={item.label}
                    className="d-flex align-items-center py-2"
                    style={{ borderBottom: i < infoItems.length - 1 ? '1px dashed var(--vz-border-color)' : 'none' }}
                  >
                    <div className="flex-shrink-0 me-3">
                      <span
                        className={`d-inline-flex align-items-center justify-content-center rounded-circle bg-${item.color}-subtle text-${item.color}`}
                        style={{ width: 36, height: 36 }}
                      >
                        <i className={item.icon} style={{ fontSize: 16 }} />
                      </span>
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <p className="text-muted mb-0 fs-11 text-uppercase fw-semibold" style={{ letterSpacing: '0.05em' }}>{item.label}</p>
                      <h6 className="mb-0 fs-13 text-truncate" title={item.value}>{item.value}</h6>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {isSuperAdmin && (
            <Card className="mb-3" style={cardStyle}>
              <CardBody>
                <SectionHeader title="Platform Access" gradient={GRAD_PRIMARY} icon="ri-shield-star-line" />
                <div
                  className="d-flex align-items-center gap-3 p-3 mb-2"
                  style={{
                    borderRadius: 14,
                    background: 'linear-gradient(135deg, rgba(64,81,137,0.08), rgba(102,145,231,0.04))',
                    border: '1px solid var(--vz-border-color)',
                  }}
                >
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-circle text-white"
                    style={{ width: 42, height: 42, background: GRAD_PRIMARY, boxShadow: '0 4px 10px rgba(64,81,137,0.3)' }}
                  >
                    <i className="ri-shield-keyhole-fill" style={{ fontSize: 18 }}></i>
                  </span>
                  <div className="flex-grow-1 min-w-0">
                    <h6 className="mb-1 text-truncate">Super Administrator</h6>
                    <p className="text-muted mb-0 fs-12">Full platform-wide privileges</p>
                  </div>
                </div>
                <div className="vstack gap-2 mt-2">
                  {[
                    { label: 'Clients & Billing',     icon: 'ri-building-4-line' },
                    { label: 'Plans & Payments',      icon: 'ri-money-rupee-circle-line' },
                    { label: 'Permissions & Roles',   icon: 'ri-shield-check-line' },
                    { label: 'Master Data & Reports', icon: 'ri-database-2-line' },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="d-flex align-items-center gap-2 px-3 py-2"
                      style={{
                        borderRadius: 10,
                        background: 'var(--vz-secondary-bg)',
                        border: '1px solid var(--vz-border-color)',
                      }}
                    >
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-success-subtle text-success flex-shrink-0"
                        style={{ width: 24, height: 24 }}
                      >
                        <i className="ri-check-line" style={{ fontSize: 12 }} />
                      </span>
                      <i className={`${item.icon} text-muted`} style={{ fontSize: 14 }}></i>
                      <span className="fs-13 fw-medium flex-grow-1">{item.label}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {plan && plan.has_plan && (
            <Card className="mb-0" style={cardStyle}>
              <CardBody>
                <SectionHeader
                  title="Subscription"
                  gradient={GRAD_SUCCESS}
                  icon="ri-bank-card-line"
                  action={(
                    <span
                      className={`badge rounded-pill border border-${plan.expired ? 'danger' : 'success'} text-${plan.expired ? 'danger' : 'success'} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}
                    >
                      <span className={`bg-${plan.expired ? 'danger' : 'success'} rounded-circle`} style={{ width: 6, height: 6 }} />
                      {plan.expired ? 'Expired' : 'Active'}
                    </span>
                  )}
                />
                <div
                  className="d-flex align-items-center gap-3 p-3"
                  style={{
                    borderRadius: 14,
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.08), rgba(48,213,181,0.04))',
                    border: '1px solid var(--vz-border-color)',
                  }}
                >
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-circle text-white"
                    style={{ width: 42, height: 42, background: GRAD_SUCCESS, boxShadow: '0 4px 10px rgba(10,179,156,0.3)' }}
                  >
                    <i className="ri-vip-crown-line" style={{ fontSize: 18 }}></i>
                  </span>
                  <div className="flex-grow-1 min-w-0">
                    <h6 className="mb-1 text-truncate">{plan.plan_name || 'Active Plan'}</h6>
                    {plan.expires_at && (
                      <p className="text-muted mb-0 fs-12">
                        {plan.expired ? 'Plan expired' : `Expires on ${plan.expires_at}`}
                      </p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </Col>

        {/* ── RIGHT COLUMN ── */}
        <Col xl={8}>
          <Card className="mb-3" style={cardStyle}>
            <CardBody>
              <SectionHeader title="Personal Information" gradient={GRAD_PRIMARY} icon="ri-user-settings-line" />
              <Form>
                <Row className="g-3">
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">Full Name</Label>
                    <Input defaultValue={user.name} />
                  </Col>
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">Email</Label>
                    <Input type="email" defaultValue={user.email} disabled />
                  </Col>
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">Phone</Label>
                    <Input defaultValue={user.phone || ''} placeholder="+91 98765 43210" />
                  </Col>
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">Designation</Label>
                    <Input defaultValue={user.designation || ''} placeholder="e.g., Manager" />
                  </Col>
                </Row>
                <div className="text-end mt-4">
                  <Button color="success" className="btn-label waves-effect waves-light rounded-pill">
                    <i className="ri-save-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                    Save Changes
                  </Button>
                </div>
              </Form>
            </CardBody>
          </Card>

          <Card className="mb-3" style={cardStyle}>
            <CardBody>
              <SectionHeader title="Change Password" gradient={GRAD_DANGER} icon="ri-lock-password-line" />
              <div
                className="d-flex align-items-center gap-2 mb-3 px-3 py-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(41,156,219,0.08), rgba(95,200,255,0.04))',
                  border: '1px solid rgba(41,156,219,0.25)',
                  borderRadius: 12,
                  color: 'var(--vz-heading-color, var(--vz-body-color))',
                  fontSize: 13,
                }}
              >
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                  style={{ width: 26, height: 26, background: GRAD_INFO, boxShadow: '0 2px 6px rgba(41,156,219,0.35)' }}
                >
                  <i className="ri-shield-keyhole-line" style={{ color: '#fff', fontSize: 12 }}></i>
                </span>
                <div>Choose a strong password with at least 8 characters.</div>
              </div>
              <Form>
                <Row className="g-3">
                  <Col md={12}>
                    <Label className="fw-semibold fs-13">Current Password</Label>
                    <Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" />
                  </Col>
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">New Password</Label>
                    <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Minimum 8 characters" />
                    {newPw && (
                      <div className="mt-2">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <div
                            style={{
                              flex: 1,
                              height: 6,
                              background: 'var(--vz-secondary-bg)',
                              borderRadius: 999,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${(strength.level / 4) * 100}%`,
                                height: '100%',
                                background: strength.barColor,
                                transition: 'width .25s ease, background .25s ease',
                              }}
                            />
                          </div>
                          <span className={`fs-11 fw-bold ${strength.color}`} style={{ minWidth: 44, textAlign: 'right' }}>
                            {strength.text}
                          </span>
                        </div>
                        <ul className="list-unstyled mb-0 mt-2" style={{ fontSize: 11.5 }}>
                          {[
                            'At least 8 characters',
                            'One uppercase letter',
                            'One lowercase letter',
                            'One number',
                          ].map(rule => {
                            const passed = !validatePassword(newPw).includes(rule);
                            return (
                              <li
                                key={rule}
                                className={`d-inline-flex align-items-center gap-1 me-3 ${passed ? 'text-success fw-semibold' : 'text-muted'}`}
                              >
                                <i className={passed ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} style={{ fontSize: 12 }} />
                                {rule}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </Col>
                  <Col md={6}>
                    <Label className="fw-semibold fs-13">Confirm New Password</Label>
                    <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter password" />
                    {confirmPw && (
                      <div className="mt-2 d-inline-flex align-items-center gap-1 fs-11 fw-semibold">
                        {newPw === confirmPw ? (
                          <span className="text-success d-inline-flex align-items-center gap-1">
                            <i className="ri-checkbox-circle-fill" style={{ fontSize: 12 }}></i>
                            Passwords match
                          </span>
                        ) : (
                          <span className="text-danger d-inline-flex align-items-center gap-1">
                            <i className="ri-close-circle-fill" style={{ fontSize: 12 }}></i>
                            Passwords do not match
                          </span>
                        )}
                      </div>
                    )}
                  </Col>
                </Row>
                <div className="text-end mt-2">
                  <Button
                    color="primary"
                    className="btn-label waves-effect waves-light rounded-pill"
                    onClick={handleChangePassword}
                    disabled={changingPw}
                  >
                    {changingPw
                      ? <Spinner size="sm" className="me-2" />
                      : <i className="ri-lock-password-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                    {changingPw ? 'Updating...' : 'Change Password'}
                  </Button>
                </div>
              </Form>
            </CardBody>
          </Card>

        </Col>
      </Row>

      {/* ── Permissions — full width below the main grid ── */}
      {!isSuperAdmin && user.permissions && Object.keys(user.permissions).length > 0 && (
        <Row className="mt-1">
          <Col xs={12}>
            <Card className="mb-3" style={cardStyle}>
              <CardBody>
                <SectionHeader
                  title="Your Permissions"
                  gradient={GRAD_PURPLE}
                  icon="ri-shield-check-line"
                  action={(() => {
                    const totalModules = Object.keys(user.permissions).length;
                    return (
                      <div className="d-inline-flex align-items-center gap-2">
                        <span className="badge rounded-pill fw-semibold fs-11 px-2 py-1" style={{ background: 'rgba(106,90,205,0.12)', color: '#6a5acd' }}>
                          {totalModules} {totalModules === 1 ? 'module' : 'modules'}
                        </span>
                        {totalModules > 5 && (
                          <button
                            type="button"
                            onClick={() => setShowAllPerms(v => !v)}
                            className="btn btn-sm rounded-pill d-inline-flex align-items-center gap-1 fw-semibold fs-12"
                            style={{
                              background: showAllPerms ? 'rgba(106,90,205,0.12)' : 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)',
                              color: showAllPerms ? '#6a5acd' : '#fff',
                              border: 'none',
                              padding: '4px 12px',
                              boxShadow: showAllPerms ? 'none' : '0 4px 10px rgba(106,90,205,0.28)',
                            }}
                          >
                            <i className={showAllPerms ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></i>
                            {showAllPerms ? 'View Less' : 'View More'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                />
                <p className="text-muted fs-12 mb-3">Modules you have access to and the actions you can perform.</p>
                <style>{`
                  .perm-grid {
                    display: grid;
                    gap: 8px;
                    grid-template-columns: repeat(1, minmax(0, 1fr));
                  }
                  @media (min-width: 576px)  { .perm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
                  @media (min-width: 992px)  { .perm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
                  @media (min-width: 1200px) { .perm-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
                  @media (min-width: 1400px) { .perm-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
                `}</style>
                <div className="perm-grid">
                  {(showAllPerms
                    ? Object.entries(user.permissions as Record<string, Record<string, boolean>>)
                    : Object.entries(user.permissions as Record<string, Record<string, boolean>>).slice(0, 5)
                  ).map(([slug, perms]) => {
                    const entries = Object.entries(perms);
                    const enabled = entries.filter(([, v]) => v).length;
                    const total = entries.length;
                    const allOn = enabled === total && total > 0;
                    const someOn = enabled > 0 && enabled < total;
                    const avatarBg = allOn ? GRAD_SUCCESS : someOn ? GRAD_PURPLE : 'var(--vz-secondary-bg)';
                    const avatarColor = (allOn || someOn) ? '#fff' : 'var(--vz-secondary-color)';
                    const tileBorder = allOn ? '1px solid rgba(10,179,156,0.25)' : someOn ? '1px solid rgba(106,90,205,0.2)' : '1px solid var(--vz-border-color)';

                    const permMeta: Record<string, { icon: string; label: string; color: string }> = {
                      can_view:    { icon: 'ri-eye-line',          label: 'View',    color: 'success' },
                      can_add:     { icon: 'ri-add-line',          label: 'Add',     color: 'primary' },
                      can_edit:    { icon: 'ri-pencil-line',       label: 'Edit',    color: 'warning' },
                      can_delete:  { icon: 'ri-delete-bin-line',   label: 'Delete',  color: 'danger'  },
                      can_export:  { icon: 'ri-download-2-line',   label: 'Export',  color: 'info'    },
                      can_import:  { icon: 'ri-upload-2-line',     label: 'Import',  color: 'info'    },
                      can_approve: { icon: 'ri-check-double-line', label: 'Approve', color: 'success' },
                    };

                    return (
                      <div
                        key={slug}
                        className="p-3"
                        style={{
                          borderRadius: 14,
                          background: 'var(--vz-secondary-bg)',
                          border: tileBorder,
                        }}
                      >
                        <div className="d-flex align-items-center gap-2 mb-3">
                          <span
                            className="d-inline-flex align-items-center justify-content-center rounded-2 fw-bold flex-shrink-0"
                            style={{ width: 36, height: 36, background: avatarBg, color: avatarColor, fontSize: 14, boxShadow: (allOn || someOn) ? '0 3px 8px rgba(0,0,0,0.12)' : 'none' }}
                          >
                            {slug.charAt(0).toUpperCase()}
                          </span>
                          <div className="flex-grow-1 min-w-0">
                            <div className="fs-13 fw-bold text-capitalize text-truncate">{slug.replace(/-/g, ' ')}</div>
                            <div className="fs-11 d-inline-flex align-items-center gap-1">
                              <span className={allOn ? 'text-success fw-semibold' : someOn ? 'fw-semibold' : 'text-muted'} style={someOn ? { color: '#6a5acd' } : undefined}>
                                {enabled}
                              </span>
                              <span className="text-muted">of {total} enabled</span>
                            </div>
                          </div>
                        </div>
                        <div className="d-flex flex-wrap gap-1">
                          {entries.map(([key, val]) => {
                            const meta = permMeta[key];
                            if (!meta) return null;
                            return (
                              <span
                                key={key}
                                title={`${meta.label}${val ? '' : ' (off)'}`}
                                className={val
                                  ? `d-inline-flex align-items-center justify-content-center rounded-2 bg-${meta.color} text-white`
                                  : 'd-inline-flex align-items-center justify-content-center rounded-2 text-muted'}
                                style={{
                                  width: 28, height: 28,
                                  background: val ? undefined : 'var(--vz-border-color)',
                                  opacity: val ? 1 : 0.55,
                                }}
                              >
                                <i className={meta.icon} style={{ fontSize: 13 }}></i>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
}
