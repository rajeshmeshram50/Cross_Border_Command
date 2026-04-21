import { useState } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Label, Alert, Spinner, Form } from 'reactstrap';
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

  if (!user) return null;

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Administrator',
    client_admin: 'Client Administrator',
    branch_user: 'Branch User',
    client_user: 'Client User',
  };

  const isSuperAdmin = user.user_type === 'super_admin';
  const isBranchUser = user.user_type === 'branch_user';

  const handleChangePassword = async () => {
    if (!currentPw) { toast.warning('Required', 'Enter your current password'); return; }
    if (newPw.length < 8) { toast.warning('Weak Password', 'Password must be at least 8 characters'); return; }
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

  const infoItems = [
    { icon: 'ri-mail-line', label: 'Email', value: user.email },
    { icon: 'ri-phone-line', label: 'Phone', value: user.phone || 'Not set' },
    { icon: 'ri-briefcase-line', label: 'Designation', value: user.designation || (isSuperAdmin ? 'Platform Administrator' : 'Not set') },
    ...(!isSuperAdmin ? [{ icon: 'ri-building-line', label: 'Organization', value: user.client_name || 'N/A' }] : []),
    ...(isBranchUser ? [{ icon: 'ri-git-branch-line', label: 'Branch', value: user.branch_name || 'N/A' }] : []),
    { icon: 'ri-global-line', label: 'Timezone', value: 'Asia/Kolkata (IST)' },
  ];

  const plan = user.plan;

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Profile</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Profile</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* Profile banner */}
      <div className="profile-foreground position-relative mx-n4 mt-n4" style={{ background: 'linear-gradient(135deg, var(--vz-primary), var(--vz-secondary))', height: 200 }}>
      </div>

      <div className="pt-4 mb-4 mb-lg-3 pb-lg-4 profile-wrapper">
        <Row className="g-4">
          <div className="col-auto">
            <div className="avatar-lg">
              <div className="avatar-title rounded-circle bg-primary text-white fs-2 fw-bold" style={{ width: 110, height: 110, fontSize: 36 }}>
                {user.initials}
              </div>
            </div>
          </div>
          <Col>
            <div className="p-2">
              <h3 className="text-white mb-1">{user.name}</h3>
              <p className="text-white-75 mb-0">
                <i className="ri-shield-keyhole-line me-1"></i>{roleLabels[user.user_type] || user.user_type}
              </p>
              {user.client_name && (
                <p className="text-white-75 mb-0 fs-14">
                  <i className="ri-building-line me-1"></i>{user.client_name}
                  {user.branch_name && <> · {user.branch_name}</>}
                </p>
              )}
            </div>
          </Col>
        </Row>
      </div>

      <Row>
        <Col xl={4}>
          <Card>
            <CardBody>
              <h5 className="card-title mb-4">Info</h5>
              <div className="vstack gap-3">
                {infoItems.map(item => (
                  <div key={item.label} className="d-flex align-items-center gap-3">
                    <div className="avatar-xs">
                      <span className="avatar-title rounded bg-primary-subtle text-primary fs-4">
                        <i className={item.icon}></i>
                      </span>
                    </div>
                    <div>
                      <p className="text-muted mb-0 fs-12 text-uppercase fw-semibold">{item.label}</p>
                      <h6 className="mb-0 fs-14">{item.value}</h6>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {plan && plan.has_plan && (
            <Card>
              <CardHeader><h5 className="card-title mb-0">Subscription Plan</h5></CardHeader>
              <CardBody>
                <div className="d-flex align-items-center gap-3 mb-3">
                  <div className="avatar-sm">
                    <span className="avatar-title rounded bg-success-subtle text-success fs-3">
                      <i className="ri-bank-card-line"></i>
                    </span>
                  </div>
                  <div>
                    <h6 className="mb-1">{plan.name || 'Active Plan'}</h6>
                    <Badge color={plan.expired ? 'danger' : 'success'} pill className="text-uppercase">
                      {plan.expired ? 'Expired' : 'Active'}
                    </Badge>
                  </div>
                </div>
                {plan.days_remaining !== null && plan.days_remaining !== undefined && (
                  <p className="text-muted mb-0 fs-13">
                    {plan.days_remaining > 0 ? `${plan.days_remaining} days remaining` : 'Plan expired'}
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <div className="d-grid mt-3">
            <Button color="danger" outline onClick={logout}>
              <i className="ri-logout-box-line me-1"></i> Logout
            </Button>
          </div>
        </Col>

        <Col xl={8}>
          <Card>
            <CardHeader>
              <h5 className="card-title mb-0">Personal Information</h5>
            </CardHeader>
            <CardBody>
              <Form>
                <Row className="g-3">
                  <Col md={6}>
                    <Label>Full Name</Label>
                    <Input defaultValue={user.name} />
                  </Col>
                  <Col md={6}>
                    <Label>Email</Label>
                    <Input type="email" defaultValue={user.email} disabled />
                  </Col>
                  <Col md={6}>
                    <Label>Phone</Label>
                    <Input defaultValue={user.phone || ''} placeholder="+91 98765 43210" />
                  </Col>
                  <Col md={6}>
                    <Label>Designation</Label>
                    <Input defaultValue={user.designation || ''} placeholder="e.g., Manager" />
                  </Col>
                </Row>
                <div className="text-end mt-4">
                  <Button color="success">
                    <i className="ri-save-line me-1"></i> Save Changes
                  </Button>
                </div>
              </Form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h5 className="card-title mb-0">Change Password</h5>
            </CardHeader>
            <CardBody>
              <Alert color="info" className="d-flex align-items-center">
                <i className="ri-shield-keyhole-line me-2"></i>
                <div className="fs-13">Choose a strong password with at least 8 characters.</div>
              </Alert>
              <Form>
                <Row className="g-3">
                  <Col md={12}>
                    <Label>Current Password</Label>
                    <Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" />
                  </Col>
                  <Col md={6}>
                    <Label>New Password</Label>
                    <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Minimum 8 characters" />
                  </Col>
                  <Col md={6}>
                    <Label>Confirm New Password</Label>
                    <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter password" />
                  </Col>
                </Row>
                <div className="text-end mt-4">
                  <Button color="primary" onClick={handleChangePassword} disabled={changingPw}>
                    {changingPw ? <Spinner size="sm" className="me-1" /> : <i className="ri-lock-password-line me-1"></i>}
                    {changingPw ? 'Updating...' : 'Change Password'}
                  </Button>
                </div>
              </Form>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
