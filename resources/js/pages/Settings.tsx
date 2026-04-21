import { useState } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Nav, NavItem, NavLink, TabContent, TabPane, Alert, Form, FormGroup,
} from 'reactstrap';
import classnames from 'classnames';

const tabs = [
  { id: 'general',       icon: 'ri-settings-3-line',        label: 'General',       desc: 'Platform configuration' },
  { id: 'security',      icon: 'ri-shield-keyhole-line',    label: 'Security',      desc: 'Auth & access control' },
  { id: 'notifications', icon: 'ri-notification-3-line',    label: 'Notifications', desc: 'Email & push alerts' },
  { id: 'appearance',    icon: 'ri-palette-line',           label: 'Appearance',    desc: 'Branding & themes' },
  { id: 'privacy',       icon: 'ri-lock-2-line',            label: 'Privacy',       desc: 'Data & compliance' },
  { id: 'about',         icon: 'ri-information-line',       label: 'About',         desc: 'Platform info' },
  { id: 'help',          icon: 'ri-question-line',          label: 'Help & FAQs',   desc: 'Support resources' },
  { id: 'contact',       icon: 'ri-phone-line',             label: 'Contact Us',    desc: 'Support channels' },
];

function ToggleRow({ label, desc, defaultChecked = false, id }: { label: string; desc?: string; defaultChecked?: boolean; id: string }) {
  return (
    <div className="d-flex align-items-center justify-content-between py-3 border-bottom">
      <div className="flex-grow-1 me-3">
        <h6 className="mb-1 fw-semibold">{label}</h6>
        {desc && <p className="text-muted mb-0 fs-13">{desc}</p>}
      </div>
      <div className="form-check form-switch form-switch-lg">
        <Input type="switch" id={id} defaultChecked={defaultChecked} />
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Settings</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Settings</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xl={3}>
          <Card>
            <CardBody className="p-3">
              <Nav className="nav nav-pills flex-column text-muted bg-transparent" role="tablist">
                {tabs.map(t => (
                  <NavItem key={t.id}>
                    <NavLink
                      className={classnames('cursor-pointer py-2 px-3 mb-1', { active: tab === t.id })}
                      onClick={() => setTab(t.id)}
                    >
                      <i className={`${t.icon} me-2 fs-16 align-middle`}></i>
                      {t.label}
                    </NavLink>
                  </NavItem>
                ))}
              </Nav>
            </CardBody>
          </Card>
        </Col>

        <Col xl={9}>
          <Card>
            <CardHeader>
              <h5 className="card-title mb-0 d-flex align-items-center gap-2">
                <i className={tabs.find(t => t.id === tab)?.icon}></i>
                {tabs.find(t => t.id === tab)?.label}
              </h5>
              <p className="text-muted mb-0 fs-13 mt-1">{tabs.find(t => t.id === tab)?.desc}</p>
            </CardHeader>
            <CardBody>
              <TabContent activeTab={tab}>
                {/* GENERAL */}
                <TabPane tabId="general">
                  <Form>
                    <Row className="g-3">
                      <Col md={6}><Label>Platform Name</Label><Input defaultValue="Cross Border Command" /></Col>
                      <Col md={6}><Label>Tagline</Label><Input defaultValue="Multi-Tenant SaaS Platform" /></Col>
                      <Col md={6}><Label>Support Email</Label><Input type="email" defaultValue="support@cbc.com" /></Col>
                      <Col md={6}><Label>Admin Email</Label><Input type="email" defaultValue="admin@cbc.com" /></Col>
                      <Col md={6}><Label>Contact Phone</Label><Input defaultValue="+91 9876543210" /></Col>
                      <Col md={6}><Label>Website URL</Label><Input defaultValue="https://cbc.com" /></Col>
                      <Col xs={12}>
                        <Label>Platform Description</Label>
                        <Input type="textarea" rows={3} defaultValue="Cross Border Command is a comprehensive multi-tenant platform for managing organizations, branches, and teams." />
                      </Col>
                    </Row>
                    <div className="text-end mt-4">
                      <Button color="success"><i className="ri-save-line me-1"></i> Save Changes</Button>
                    </div>
                  </Form>
                </TabPane>

                {/* SECURITY */}
                <TabPane tabId="security">
                  <ToggleRow id="tfa" label="Two-Factor Authentication" desc="Require 2FA for all admin users" defaultChecked />
                  <ToggleRow id="pwReset" label="Force Password Reset (90 days)" desc="Users must change password every 90 days" />
                  <ToggleRow id="loginNotif" label="Login Notifications" desc="Send email on new device login" defaultChecked />
                  <ToggleRow id="ipWhite" label="IP Whitelisting" desc="Restrict access to specific IP addresses" />
                  <ToggleRow id="sessTimeout" label="Session Timeout (30 min)" desc="Auto logout after 30 minutes of inactivity" defaultChecked />
                  <ToggleRow id="bruteForce" label="Brute Force Protection" desc="Lock account after 5 failed login attempts" defaultChecked />
                  <div className="text-end mt-4">
                    <Button color="success"><i className="ri-save-line me-1"></i> Save Security Settings</Button>
                  </div>
                </TabPane>

                {/* NOTIFICATIONS */}
                <TabPane tabId="notifications">
                  <ToggleRow id="emailNotif" label="Email Notifications" desc="Send email for important events" defaultChecked />
                  <ToggleRow id="pushNotif" label="Push Notifications" desc="Browser push notifications" defaultChecked />
                  <ToggleRow id="planExp" label="Plan Expiry Alerts" desc="Notify 7 days before plan expires" defaultChecked />
                  <ToggleRow id="newUser" label="New User Registration" desc="Notify admin on new user signup" defaultChecked />
                  <ToggleRow id="payAlerts" label="Payment Alerts" desc="Notify on successful/failed payments" defaultChecked />
                  <ToggleRow id="weeklyReports" label="Weekly Reports" desc="Send weekly summary to admins" />
                  <div className="text-end mt-4">
                    <Button color="success"><i className="ri-save-line me-1"></i> Save Notification Settings</Button>
                  </div>
                </TabPane>

                {/* APPEARANCE */}
                <TabPane tabId="appearance">
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <Label>Primary Color</Label>
                      <div className="d-flex gap-2">
                        <Input type="color" defaultValue="#4F46E5" style={{ width: 48, height: 38 }} />
                        <Input defaultValue="#4F46E5" />
                      </div>
                    </Col>
                    <Col md={6}>
                      <Label>Secondary Color</Label>
                      <div className="d-flex gap-2">
                        <Input type="color" defaultValue="#10B981" style={{ width: 48, height: 38 }} />
                        <Input defaultValue="#10B981" />
                      </div>
                    </Col>
                    <Col md={6}>
                      <Label>Platform Logo</Label>
                      <div className="border border-dashed rounded p-4 text-center bg-light cursor-pointer">
                        <i className="ri-upload-cloud-2-line display-6 text-muted"></i>
                        <p className="text-muted mb-0 fs-13 mt-2">Click to upload logo</p>
                      </div>
                    </Col>
                    <Col md={6}>
                      <Label>Favicon</Label>
                      <div className="border border-dashed rounded p-4 text-center bg-light cursor-pointer">
                        <i className="ri-upload-cloud-2-line display-6 text-muted"></i>
                        <p className="text-muted mb-0 fs-13 mt-2">Click to upload favicon</p>
                      </div>
                    </Col>
                  </Row>
                  <ToggleRow id="darkDefault" label="Dark Mode Default" desc="Set dark mode as default for new users" />
                  <div className="text-end mt-4">
                    <Button color="success"><i className="ri-save-line me-1"></i> Save Appearance</Button>
                  </div>
                </TabPane>

                {/* PRIVACY */}
                <TabPane tabId="privacy">
                  <Alert color="success" className="d-flex align-items-center">
                    <i className="ri-checkbox-circle-line me-2 fs-4"></i>
                    <div>
                      <strong>Data Compliance</strong>
                      <div className="fs-13">Your platform meets basic data protection requirements</div>
                    </div>
                  </Alert>
                  <ToggleRow id="encrypt" label="Data Encryption at Rest" desc="Encrypt all stored data using AES-256" defaultChecked />
                  <ToggleRow id="actLog" label="Activity Logging" desc="Log all user actions for audit trail" defaultChecked />
                  <ToggleRow id="retention" label="Data Retention (90 days)" desc="Auto-delete inactive data after 90 days" />
                  <ToggleRow id="cookie" label="Cookie Consent Banner" desc="Show cookie consent to users" defaultChecked />
                  <FormGroup className="mt-3">
                    <Label>Privacy Policy URL</Label>
                    <Input defaultValue="https://cbc.com/privacy" />
                  </FormGroup>
                  <div className="text-end mt-4">
                    <Button color="success"><i className="ri-save-line me-1"></i> Save Privacy Settings</Button>
                  </div>
                </TabPane>

                {/* ABOUT */}
                <TabPane tabId="about">
                  <Card className="bg-primary bg-gradient text-white mb-3">
                    <CardBody>
                      <h3 className="text-white mb-1">Cross Border Command</h3>
                      <p className="text-white-50 mb-3">Multi-Tenant SaaS Platform</p>
                      <div className="d-flex flex-wrap gap-2">
                        {['v1.0.0', 'Laravel 12', 'React + TypeScript', 'PostgreSQL'].map(t => (
                          <span key={t} className="badge bg-white bg-opacity-25 fs-12">{t}</span>
                        ))}
                      </div>
                    </CardBody>
                  </Card>
                  <Row className="g-3">
                    {[
                      { label: 'Framework', value: 'Laravel 12.x', icon: 'ri-server-line' },
                      { label: 'Frontend',  value: 'React 19 + Vite', icon: 'ri-reactjs-line' },
                      { label: 'Database',  value: 'PostgreSQL', icon: 'ri-database-2-line' },
                      { label: 'Auth',      value: 'Laravel Sanctum', icon: 'ri-shield-keyhole-line' },
                    ].map(d => (
                      <Col md={6} key={d.label}>
                        <Card className="mb-0">
                          <CardBody className="d-flex align-items-center gap-3">
                            <div className="avatar-sm">
                              <span className="avatar-title rounded bg-primary-subtle text-primary fs-3">
                                <i className={d.icon}></i>
                              </span>
                            </div>
                            <div>
                              <p className="text-muted mb-1 fs-12 text-uppercase fw-semibold">{d.label}</p>
                              <h6 className="mb-0">{d.value}</h6>
                            </div>
                          </CardBody>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </TabPane>

                {/* HELP */}
                <TabPane tabId="help">
                  <div className="accordion" id="faqAccordion">
                    {[
                      { q: 'How to add a new client?', a: 'Go to Clients and click Add Client. Fill in the organization details and admin credentials. The client admin will receive a welcome email with login credentials.' },
                      { q: 'How to manage branches?', a: 'Client admins can add branches from the Branches page. Set one branch as "Main" (Head Office) to give its users visibility across all branches.' },
                      { q: 'How do permissions work?', a: 'Super admins assign permissions to client admins. Client admins can then assign permissions to their branch users. Each module has View, Add, Edit, Delete, Export, Import, and Approve permissions.' },
                      { q: 'How to subscribe to a plan?', a: 'Client admins can go to My Plan page to view available plans and subscribe. Plans determine which modules and features are available.' },
                      { q: 'What happens when a plan expires?', a: 'Branch users will be blocked from accessing the platform. Client admins will only see the plan selection page until they renew.' },
                    ].map((faq, i) => (
                      <div className="accordion-item" key={i}>
                        <h2 className="accordion-header">
                          <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target={`#faq-${i}`}>
                            <i className="ri-question-line text-primary me-2"></i>{faq.q}
                          </button>
                        </h2>
                        <div id={`faq-${i}`} className="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                          <div className="accordion-body text-muted">{faq.a}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabPane>

                {/* CONTACT */}
                <TabPane tabId="contact">
                  <Row className="g-3 mb-3">
                    {[
                      { label: 'Email Support', value: 'support@cbc.com',   icon: 'ri-mail-line',   desc: 'Response within 24 hours' },
                      { label: 'Phone Support', value: '+91 9876543210',    icon: 'ri-phone-line',  desc: 'Mon-Fri, 9 AM - 6 PM IST' },
                      { label: 'Website',       value: 'https://cbc.com',   icon: 'ri-global-line', desc: 'Documentation & resources' },
                      { label: 'Status Page',   value: 'status.cbc.com',    icon: 'ri-eye-line',    desc: 'System uptime & incidents' },
                    ].map(c => (
                      <Col md={6} key={c.label}>
                        <Card className="mb-0">
                          <CardBody className="d-flex align-items-start gap-3">
                            <div className="avatar-sm">
                              <span className="avatar-title rounded bg-primary-subtle text-primary fs-3">
                                <i className={c.icon}></i>
                              </span>
                            </div>
                            <div>
                              <p className="text-muted mb-1 fs-12 text-uppercase fw-semibold">{c.label}</p>
                              <h6 className="mb-1">{c.value}</h6>
                              <p className="text-muted mb-0 fs-12">{c.desc}</p>
                            </div>
                          </CardBody>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Alert color="warning" className="d-flex align-items-center">
                    <i className="ri-alert-line me-2 fs-4"></i>
                    <div>
                      <strong>Emergency Support</strong>
                      <div className="fs-13">For critical issues: <strong>+91 98765 00000</strong></div>
                    </div>
                  </Alert>
                </TabPane>
              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
