import { useState } from 'react';
import {
  Card, CardBody, Col, Row, Input, Label, TabContent, TabPane, Form, FormGroup,
} from 'reactstrap';

interface TabDef {
  id: string;
  icon: string;
  label: string;
  desc: string;
  color: string;
}

// Premium, cohesive palette — inspired by Linear, Stripe, Vercel, Notion.
// Uses a single refined violet as the signature + muted semantic colors
// for meaning (red=security, emerald=privacy, amber=help, etc.)
const TABS: TabDef[] = [
  { id: 'general',       icon: 'ri-settings-3-line',     label: 'General',       desc: 'Platform configuration',  color: '#6366f1' }, // indigo
  { id: 'security',      icon: 'ri-shield-keyhole-line', label: 'Security',      desc: 'Auth & access control',   color: '#ef4444' }, // red
  { id: 'notifications', icon: 'ri-notification-3-line', label: 'Notifications', desc: 'Email & push alerts',     color: '#0ea5e9' }, // sky blue
  { id: 'appearance',    icon: 'ri-palette-line',        label: 'Appearance',    desc: 'Branding & themes',       color: '#8b5cf6' }, // violet
  { id: 'privacy',       icon: 'ri-lock-2-line',         label: 'Privacy',       desc: 'Data & compliance',       color: '#10b981' }, // emerald
  { id: 'about',         icon: 'ri-information-line',    label: 'About',         desc: 'Platform info',           color: '#64748b' }, // slate
  { id: 'help',          icon: 'ri-question-line',       label: 'Help & FAQs',   desc: 'Support resources',       color: '#f59e0b' }, // amber
  { id: 'contact',       icon: 'ri-phone-line',          label: 'Contact Us',    desc: 'Support channels',        color: '#14b8a6' }, // teal
];

function ToggleRow({
  icon, label, desc, defaultChecked = false, id, color = '#405189',
}: { icon?: string; label: string; desc?: string; defaultChecked?: boolean; id: string; color?: string }) {
  return (
    <div
      className="d-flex align-items-center justify-content-between gap-3 py-2 px-2 toggle-row-hover"
      style={{
        borderBottom: '1px dashed var(--vz-border-color)',
        transition: 'background .18s ease',
        borderRadius: 6,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = color + '0d'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {icon && (
        <i
          className={icon}
          style={{ color, fontSize: 17, flexShrink: 0, marginLeft: 2, width: 22, textAlign: 'center' }}
        />
      )}
      <div className="flex-grow-1 min-w-0">
        <h6 className="mb-0 fw-semibold" style={{ fontSize: 13 }}>{label}</h6>
        {desc && <p className="text-muted mb-0" style={{ fontSize: 11, marginTop: 1 }}>{desc}</p>}
      </div>
      <div className="form-check form-switch form-switch-md m-0 flex-shrink-0">
        <Input type="switch" id={id} defaultChecked={defaultChecked} />
      </div>
    </div>
  );
}

const SectionHeader = ({ icon, title, desc, color, onSave }: { icon: string; title: string; desc: string; color: string; onSave?: () => void }) => (
  <div
    className="position-relative overflow-hidden rounded-2 mb-3"
    style={{
      background: `linear-gradient(135deg, ${color}14 0%, ${color}06 55%, transparent 100%)`,
      border: `1px solid ${color}22`,
      padding: '10px 14px',
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: -30, right: -30,
        width: 100, height: 100,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}1c 0%, transparent 70%)`,
        pointerEvents: 'none',
      }}
    />
    <div className="d-flex align-items-center justify-content-between gap-2 position-relative">
      <div className="d-flex align-items-center gap-2 min-w-0">
        <div
          className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
          style={{
            width: 32, height: 32,
            background: `linear-gradient(135deg, ${color}, ${color}cc)`,
            boxShadow: `0 3px 10px ${color}45`,
          }}
        >
          <i className={icon} style={{ color: '#fff', fontSize: 14 }} />
        </div>
        <div className="min-w-0">
          <h6 className="mb-0 fw-bold" style={{ fontSize: 13, letterSpacing: '-0.01em', color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.2 }}>{title}</h6>
          <p className="mb-0" style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', lineHeight: 1.3, marginTop: 1 }}>{desc}</p>
        </div>
      </div>
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          className="btn rounded-pill fw-semibold d-inline-flex align-items-center gap-1 flex-shrink-0"
          style={{
            padding: '5px 12px',
            fontSize: 11.5,
            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
            color: '#fff',
            border: 'none',
            boxShadow: `0 4px 12px ${color}4a, inset 0 1px 0 rgba(255,255,255,0.22)`,
            transition: 'all .18s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 6px 16px ${color}60, inset 0 1px 0 rgba(255,255,255,0.28)`; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 12px ${color}4a, inset 0 1px 0 rgba(255,255,255,0.22)`; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
        >
          <i className="ri-save-line" style={{ fontSize: 12 }} /> Save Changes
        </button>
      )}
    </div>
  </div>
);

const SubSection = ({ icon, title, desc, color, children, first = false }: { icon: string; title: string; desc?: string; color: string; children: React.ReactNode; first?: boolean }) => (
  <div className={first ? 'mb-3' : 'mt-4 mb-3'}>
    <div className="d-flex align-items-center gap-2 mb-2">
      <i className={icon} style={{ color, fontSize: 15, flexShrink: 0 }} />
      <span className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
        {title}
      </span>
      {desc && (
        <>
          <span style={{ color: 'var(--vz-secondary-color)', fontSize: 10, fontWeight: 400 }}>·</span>
          <span style={{ color: 'var(--vz-secondary-color)', fontSize: 10.5 }}>{desc}</span>
        </>
      )}
    </div>
    <div
      style={{
        height: 1,
        background: `linear-gradient(90deg, ${color}55 0%, var(--vz-border-color) 35%, transparent 100%)`,
        marginBottom: 10,
      }}
    />
    {children}
  </div>
);

export default function Settings() {
  const [tab, setTab] = useState('general');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const currentTab = TABS.find(t => t.id === tab)!;

  return (
    <>
      <style>{`
        @keyframes settings-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .settings-tab-btn {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 10px;
          cursor: pointer;
          user-select: none;
          border: 1px solid transparent;
          background: transparent;
          transition: background .18s ease, border-color .18s ease, transform .18s ease;
          width: 100%;
          text-align: left;
        }
        .settings-tab-btn:hover {
          background: var(--vz-secondary-bg);
        }
        .settings-tab-btn.active {
          background: var(--accent-col, #40518912);
          border-color: var(--accent-col-border, #40518828);
        }
        .settings-tab-btn.active::before {
          content: '';
          position: absolute;
          left: 0; top: 15%; bottom: 15%;
          width: 3px;
          border-radius: 3px;
          background: var(--accent-col-strong, #405189);
          box-shadow: 0 0 8px var(--accent-col-strong, #405189);
        }
        .settings-pane { animation: settings-fade-up .25s ease; }
        /* Remove hanging bottom border on last toggle in each group */
        .toggle-row-hover:last-child { border-bottom: none !important; }

        /* ── Custom tooltip for compact (icon-only) mode ── */
        .settings-tab-btn .settings-tip {
          position: absolute;
          left: calc(100% + 10px);
          top: 50%;
          transform: translateY(-50%) translateX(-4px);
          background: #1f2937;
          color: #fff;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 5px 10px;
          border-radius: 6px;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity .15s ease, transform .15s ease;
          z-index: 50;
          box-shadow: 0 6px 18px rgba(0,0,0,0.18);
        }
        .settings-tab-btn .settings-tip::before {
          content: '';
          position: absolute;
          left: -4px;
          top: 50%;
          transform: translateY(-50%) rotate(45deg);
          width: 8px; height: 8px;
          background: #1f2937;
        }
        .settings-tab-btn:hover .settings-tip,
        .settings-tab-btn:focus-visible .settings-tip {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }

        /* ── Compact (icon-only) mode on laptop-width screens ── */
        @media (max-width: 1399.98px) {
          .settings-sidebar-label,
          .settings-sidebar-header-text,
          .settings-sidebar-active-arrow {
            display: none !important;
          }
          .settings-tab-btn {
            justify-content: center;
            padding: 8px;
          }
          .settings-sidebar-header {
            justify-content: center !important;
          }
        }
        @media (min-width: 1400px) {
          .settings-tab-btn .settings-tip { display: none; }
        }

        /* On very small phones, switch to a horizontal scrollable strip */
        @media (max-width: 575.98px) {
          .settings-tab-list { flex-direction: row !important; overflow-x: auto; gap: 6px !important; }
          .settings-tab-list .settings-tab-btn { flex: 0 0 auto; width: auto; padding: 8px 10px; }
          .settings-tab-btn .settings-tip { display: none; }
        }
      `}</style>

      {/* ── Compact Page Header ── */}
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <div
            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
            style={{ width: 36, height: 36, background: '#40518918', border: '1px solid #40518928' }}
          >
            <i className="ri-settings-5-line" style={{ color: '#405189', fontSize: 17 }} />
          </div>
          <div>
            <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>Settings</h5>
            <p className="mb-0 text-muted" style={{ fontSize: 11.5 }}>Configure your platform preferences and options</p>
          </div>
        </div>
        <ol className="breadcrumb m-0" style={{ fontSize: 11.5 }}>
          <li className="breadcrumb-item"><a href="#">Admin</a></li>
          <li className="breadcrumb-item active">Settings</li>
        </ol>
      </div>

      <Row className="g-3 align-items-start pb-3">
        {/* ── Left: Sidebar Nav ── */}
        <Col xxl={3} xl={3} lg="auto" md="auto" xs={12}>
          <Card className="mb-0" style={{ borderRadius: 14 }}>
            <CardBody className="p-2">
              <div className="settings-sidebar-header px-2 py-2 mb-1 d-flex align-items-center gap-2">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-1"
                  style={{ width: 26, height: 26, background: '#7c5cfc18', border: '1px solid #7c5cfc28' }}
                >
                  <i className="ri-apps-2-line" style={{ color: '#7c5cfc', fontSize: 13 }} />
                </div>
                <span className="settings-sidebar-header-text text-uppercase fw-bold" style={{ fontSize: 10, letterSpacing: '0.07em', color: 'var(--vz-secondary-color)' }}>
                  Categories
                </span>
                <span
                  className="settings-sidebar-header-text ms-auto rounded-pill px-2 fw-bold"
                  style={{
                    fontSize: 9.5,
                    background: '#7c5cfc20',
                    color: '#7c5cfc',
                    border: '1px solid #7c5cfc45',
                  }}
                >
                  {TABS.length}
                </span>
              </div>
              <div className="settings-tab-list vstack gap-1">
                {TABS.map(t => {
                  const isActive = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-label={t.label}
                      title={t.label}
                      className={`settings-tab-btn ${isActive ? 'active' : ''}`}
                      style={{
                        ['--accent-col' as any]: t.color + '14',
                        ['--accent-col-border' as any]: t.color + '28',
                        ['--accent-col-strong' as any]: t.color,
                      }}
                    >
                      <div
                        className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                        style={{
                          width: 32, height: 32,
                          background: isActive ? t.color + '22' : 'var(--vz-secondary-bg)',
                          border: `1px solid ${isActive ? t.color + '40' : 'var(--vz-border-color)'}`,
                          transition: 'all .18s ease',
                        }}
                      >
                        <i className={t.icon} style={{ color: t.color, fontSize: 15 }} />
                      </div>
                      <div className="settings-sidebar-label flex-grow-1 min-w-0">
                        <div
                          className="fw-semibold text-truncate"
                          style={{
                            fontSize: 13,
                            color: isActive ? t.color : 'var(--vz-heading-color, var(--vz-body-color))',
                            transition: 'color .18s ease',
                          }}
                        >
                          {t.label}
                        </div>
                        <div className="text-muted text-truncate" style={{ fontSize: 10.5 }}>{t.desc}</div>
                      </div>
                      {isActive && <i className="settings-sidebar-active-arrow ri-arrow-right-s-line" style={{ color: t.color, fontSize: 16 }} />}
                      {/* Tooltip shown only in compact mode via CSS */}
                      <span className="settings-tip">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </Col>

        {/* ── Right: Content ── */}
        <Col xxl={9} xl={9} lg={true} md={true} xs={12}>
          <Card className="mb-0" style={{ borderRadius: 14 }}>
            <CardBody className="p-3">
              <TabContent activeTab={tab}>
                {/* GENERAL */}
                <TabPane tabId="general" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} onSave={() => {}} />
                  <Form>
                    <SubSection icon="ri-building-4-line" title="Platform Info" desc="Branding and public identity" color={currentTab.color} first>
                      <Row className="g-3">
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-building-4-line me-1" style={{ color: currentTab.color }} />Platform Name
                          </Label>
                          <Input defaultValue="Cross Border Command" style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-quill-pen-line me-1" style={{ color: currentTab.color }} />Tagline
                          </Label>
                          <Input defaultValue="Multi-Tenant SaaS Platform" style={{ fontSize: 13 }} />
                        </Col>
                        <Col xs={12}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-file-text-line me-1" style={{ color: currentTab.color }} />Platform Description
                          </Label>
                          <Input
                            type="textarea"
                            rows={3}
                            defaultValue="Cross Border Command is a comprehensive multi-tenant platform for managing organizations, branches, and teams."
                            style={{ fontSize: 13 }}
                          />
                        </Col>
                      </Row>
                    </SubSection>

                    <SubSection icon="ri-customer-service-2-line" title="Contact Info" desc="Channels customers use to reach you" color="#299cdb">
                      <Row className="g-3">
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-mail-send-line me-1" style={{ color: '#299cdb' }} />Support Email
                          </Label>
                          <Input type="email" defaultValue="support@cbc.com" style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-mail-star-line me-1" style={{ color: '#299cdb' }} />Admin Email
                          </Label>
                          <Input type="email" defaultValue="admin@cbc.com" style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-phone-line me-1" style={{ color: '#0ab39c' }} />Contact Phone
                          </Label>
                          <Input defaultValue="+91 9876543210" style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                            <i className="ri-global-line me-1" style={{ color: '#7c5cfc' }} />Website URL
                          </Label>
                          <Input defaultValue="https://cbc.com" style={{ fontSize: 13 }} />
                        </Col>
                      </Row>
                    </SubSection>
                  </Form>
                </TabPane>

                {/* SECURITY */}
                <TabPane tabId="security" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} onSave={() => {}} />
                  <SubSection icon="ri-shield-keyhole-line" title="Authentication" desc="How users sign in and verify identity" color={currentTab.color} first>
                    <ToggleRow icon="ri-key-2-line"        id="tfa"         label="Two-Factor Authentication"      desc="Require 2FA for all admin users"            color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-restart-line"      id="pwReset"     label="Force Password Reset (90 days)" desc="Users must change password every 90 days"   color={currentTab.color} />
                    <ToggleRow icon="ri-notification-line" id="loginNotif"  label="Login Notifications"            desc="Send email on new device login"             color={currentTab.color} defaultChecked />
                  </SubSection>
                  <SubSection icon="ri-lock-2-line" title="Access Control" desc="Protect accounts and sessions" color={currentTab.color}>
                    <ToggleRow icon="ri-shield-user-line"    id="ipWhite"     label="IP Whitelisting"          desc="Restrict access to specific IP addresses"   color={currentTab.color} />
                    <ToggleRow icon="ri-timer-line"          id="sessTimeout" label="Session Timeout (30 min)" desc="Auto logout after 30 minutes of inactivity" color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-lock-password-line"  id="bruteForce"  label="Brute Force Protection"   desc="Lock account after 5 failed login attempts" color={currentTab.color} defaultChecked />
                  </SubSection>
                </TabPane>

                {/* NOTIFICATIONS */}
                <TabPane tabId="notifications" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} onSave={() => {}} />
                  <SubSection icon="ri-broadcast-line" title="Channels" desc="How notifications are delivered" color={currentTab.color} first>
                    <ToggleRow icon="ri-mail-line"           id="emailNotif" label="Email Notifications" desc="Send email for important events" color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-notification-3-line" id="pushNotif"  label="Push Notifications"  desc="Browser push notifications"      color={currentTab.color} defaultChecked />
                  </SubSection>
                  <SubSection icon="ri-alarm-line" title="Alerts" desc="What triggers a notification" color={currentTab.color}>
                    <ToggleRow icon="ri-calendar-schedule-line" id="planExp"       label="Plan Expiry Alerts"      desc="Notify 7 days before plan expires"    color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-user-add-line"          id="newUser"       label="New User Registration"   desc="Notify admin on new user signup"      color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-bank-card-line"         id="payAlerts"     label="Payment Alerts"          desc="Notify on successful/failed payments" color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-bar-chart-box-line"     id="weeklyReports" label="Weekly Reports"          desc="Send weekly summary to admins"        color={currentTab.color} />
                  </SubSection>
                </TabPane>

                {/* APPEARANCE */}
                <TabPane tabId="appearance" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} onSave={() => {}} />
                  <SubSection icon="ri-palette-line" title="Brand Colors" desc="Primary and secondary accent colors" color={currentTab.color} first>
                    <Row className="g-3">
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                          <i className="ri-drop-line me-1" style={{ color: currentTab.color }} />Primary Color
                        </Label>
                        <div className="d-flex gap-2 align-items-center">
                          <Input type="color" defaultValue="#4F46E5" style={{ width: 44, height: 36, padding: '2px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }} />
                          <Input defaultValue="#4F46E5" style={{ fontSize: 13, fontFamily: 'monospace' }} />
                        </div>
                      </Col>
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                          <i className="ri-drop-fill me-1" style={{ color: '#10B981' }} />Secondary Color
                        </Label>
                        <div className="d-flex gap-2 align-items-center">
                          <Input type="color" defaultValue="#10B981" style={{ width: 44, height: 36, padding: '2px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }} />
                          <Input defaultValue="#10B981" style={{ fontSize: 13, fontFamily: 'monospace' }} />
                        </div>
                      </Col>
                    </Row>
                  </SubSection>
                  <SubSection icon="ri-image-line" title="Brand Assets" desc="Logo and favicon uploads" color={currentTab.color}>
                    <Row className="g-3">
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                          <i className="ri-image-add-line me-1" style={{ color: currentTab.color }} />Platform Logo
                        </Label>
                        <div
                          className="rounded-2 p-3 text-center"
                          style={{
                            border: `2px dashed ${currentTab.color}55`,
                            background: currentTab.color + '08',
                            cursor: 'pointer',
                            transition: 'all .18s ease',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = currentTab.color + '12'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = currentTab.color + '08'; }}
                        >
                          <i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: currentTab.color }} />
                          <p className="mb-0 fw-semibold mt-1" style={{ fontSize: 12, color: currentTab.color }}>Click to upload logo</p>
                          <p className="text-muted mb-0" style={{ fontSize: 10.5 }}>PNG, JPG · Max 2MB</p>
                        </div>
                      </Col>
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                          <i className="ri-shield-star-line me-1" style={{ color: currentTab.color }} />Favicon
                        </Label>
                        <div
                          className="rounded-2 p-3 text-center"
                          style={{
                            border: `2px dashed ${currentTab.color}55`,
                            background: currentTab.color + '08',
                            cursor: 'pointer',
                            transition: 'all .18s ease',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = currentTab.color + '12'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = currentTab.color + '08'; }}
                        >
                          <i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: currentTab.color }} />
                          <p className="mb-0 fw-semibold mt-1" style={{ fontSize: 12, color: currentTab.color }}>Click to upload favicon</p>
                          <p className="text-muted mb-0" style={{ fontSize: 10.5 }}>ICO, PNG · Max 512KB</p>
                        </div>
                      </Col>
                    </Row>
                  </SubSection>
                  <SubSection icon="ri-contrast-2-line" title="Theme" desc="Default appearance for new users" color={currentTab.color}>
                    <ToggleRow icon="ri-moon-line" id="darkDefault" label="Dark Mode Default" desc="Set dark mode as default for new users" color={currentTab.color} />
                  </SubSection>
                </TabPane>

                {/* PRIVACY */}
                <TabPane tabId="privacy" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} onSave={() => {}} />
                  <div
                    className="d-flex align-items-center gap-2 px-3 py-2 rounded-2 mb-3"
                    style={{
                      background: `${currentTab.color}10`,
                      border: `1px solid ${currentTab.color}30`,
                      borderLeft: `3px solid ${currentTab.color}`,
                    }}
                  >
                    <i className="ri-checkbox-circle-line" style={{ color: currentTab.color, fontSize: 18 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--vz-body-color)' }}>
                      <strong style={{ color: currentTab.color }}>Data Compliance</strong>
                      <span className="text-muted"> · Your platform meets basic data protection requirements</span>
                    </span>
                  </div>
                  <SubSection icon="ri-database-2-line" title="Data Handling" desc="How we store and manage user data" color={currentTab.color} first>
                    <ToggleRow icon="ri-fingerprint-line" id="encrypt"   label="Data Encryption at Rest"  desc="Encrypt all stored data using AES-256"   color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-history-line"     id="actLog"    label="Activity Logging"         desc="Log all user actions for audit trail"    color={currentTab.color} defaultChecked />
                    <ToggleRow icon="ri-delete-bin-line"  id="retention" label="Data Retention (90 days)" desc="Auto-delete inactive data after 90 days" color={currentTab.color} />
                  </SubSection>
                  <SubSection icon="ri-file-shield-2-line" title="Compliance" desc="Consent and policy settings" color={currentTab.color}>
                    <ToggleRow icon="ri-cookie-line" id="cookie" label="Cookie Consent Banner" desc="Show cookie consent to users" color={currentTab.color} defaultChecked />
                    <FormGroup className="mt-3 mb-0">
                      <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                        <i className="ri-external-link-line me-1" style={{ color: currentTab.color }} />Privacy Policy URL
                      </Label>
                      <Input defaultValue="https://cbc.com/privacy" style={{ fontSize: 13 }} />
                    </FormGroup>
                  </SubSection>
                </TabPane>

                {/* ABOUT */}
                <TabPane tabId="about" className="settings-pane">
                  {/* ── Compact horizontal hero ── */}
                  <div className="d-flex align-items-center gap-3 flex-wrap mb-3 pb-3 border-bottom">
                    <div
                      className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                      style={{
                        width: 44, height: 44,
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        boxShadow: '0 6px 18px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                      }}
                    >
                      <i className="ri-shield-star-fill" style={{ color: '#fff', fontSize: 20 }} />
                    </div>
                    <div className="min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em', color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          Cross Border Command
                        </h5>
                        <span
                          className="rounded-pill px-2 fw-bold d-inline-flex align-items-center gap-1"
                          style={{
                            background: 'linear-gradient(135deg, #10b981, #14c9b1)',
                            color: '#fff',
                            fontSize: 9,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            padding: '2px 7px',
                            boxShadow: '0 2px 6px rgba(16,185,129,0.40)',
                          }}
                        >
                          <span className="rounded-circle" style={{ width: 4, height: 4, background: '#fff' }} />
                          Online
                        </span>
                      </div>
                      <p className="mb-0 text-muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                        Multi-Tenant SaaS Platform · Enterprise Grade
                      </p>
                    </div>
                    <div className="d-flex flex-wrap gap-1 ms-auto">
                      {[
                        { label: 'v1.0.0',     icon: 'ri-git-branch-line',  color: '#6366f1' },
                        { label: 'Laravel 12', icon: 'ri-server-line',      color: '#ef4444' },
                        { label: 'React 19',   icon: 'ri-reactjs-line',     color: '#0ea5e9' },
                        { label: 'PostgreSQL', icon: 'ri-database-2-line',  color: '#10b981' },
                      ].map(t => (
                        <span
                          key={t.label}
                          className="rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                          style={{
                            background: t.color + '15',
                            color: t.color,
                            border: `1px solid ${t.color}30`,
                            fontSize: 9.5,
                            letterSpacing: '0.04em',
                            padding: '2px 7px',
                          }}
                        >
                          <i className={t.icon} style={{ fontSize: 10 }} />{t.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* ── Key stats row ── */}
                  <Row className="g-2 mb-3">
                    {[
                      { label: 'Uptime',       value: '99.98',  suffix: '%',  icon: 'ri-pulse-line',          color: '#10b981' },
                      { label: 'API Latency',  value: '48',     suffix: 'ms', icon: 'ri-flashlight-line',     color: '#0ea5e9' },
                      { label: 'Active Users', value: '1,284',                icon: 'ri-team-line',           color: '#8b5cf6' },
                      { label: 'Version',      value: '1.0.0',                icon: 'ri-git-branch-line',     color: '#f59e0b' },
                    ].map(s => (
                      <Col md={3} sm={6} key={s.label}>
                        <div
                          className="position-relative overflow-hidden rounded-2 text-center py-2 px-2"
                          style={{
                            background: `linear-gradient(135deg, ${s.color}10 0%, transparent 70%), var(--vz-card-bg)`,
                            border: '1px solid var(--vz-border-color)',
                            borderTop: `2px solid ${s.color}`,
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: -25, right: -25,
                              width: 70, height: 70,
                              borderRadius: '50%',
                              background: `radial-gradient(circle, ${s.color}18 0%, transparent 70%)`,
                              pointerEvents: 'none',
                            }}
                          />
                          <div className="position-relative">
                            <i className={s.icon} style={{ color: s.color, fontSize: 16, marginBottom: 4, display: 'block' }} />
                            <div className="fw-bold" style={{ fontSize: 17, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.1 }}>
                              {s.value}{s.suffix && <small style={{ fontSize: 12, opacity: 0.6, fontWeight: 500, marginLeft: 1 }}>{s.suffix}</small>}
                            </div>
                            <div className="text-uppercase fw-semibold mt-1" style={{ fontSize: 9, letterSpacing: '0.07em', color: 'var(--vz-secondary-color)' }}>
                              {s.label}
                            </div>
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>

                  {/* ── Tech stack ── */}
                  <SubSection icon="ri-stack-line" title="Technology Stack" desc="Built on modern, reliable frameworks" color={currentTab.color} first>
                    <Row className="g-2">
                      {[
                        { label: 'Backend',   value: 'Laravel 12',       icon: 'ri-server-line',         color: '#ef4444', version: 'PHP 8.3' },
                        { label: 'Frontend',  value: 'React 19 + Vite',  icon: 'ri-reactjs-line',        color: '#0ea5e9', version: 'TypeScript 5' },
                        { label: 'Database',  value: 'PostgreSQL 16',    icon: 'ri-database-2-line',     color: '#10b981', version: 'Relational' },
                        { label: 'Auth',      value: 'Laravel Sanctum',  icon: 'ri-shield-keyhole-line', color: '#8b5cf6', version: 'Token-based' },
                      ].map(d => (
                        <Col md={6} key={d.label}>
                          <div
                            className="d-flex align-items-center gap-2 rounded-2 px-3 py-2"
                            style={{
                              background: 'var(--vz-card-bg)',
                              border: '1px solid var(--vz-border-color)',
                              transition: 'all .18s ease',
                              cursor: 'default',
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget as HTMLDivElement;
                              el.style.borderColor = d.color + '55';
                              el.style.background = d.color + '06';
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget as HTMLDivElement;
                              el.style.borderColor = 'var(--vz-border-color)';
                              el.style.background = 'var(--vz-card-bg)';
                            }}
                          >
                            <i className={d.icon} style={{ color: d.color, fontSize: 20, flexShrink: 0, width: 24, textAlign: 'center' }} />
                            <div className="min-w-0 flex-grow-1">
                              <div className="d-flex align-items-center gap-2">
                                <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>{d.value}</h6>
                                <span
                                  className="rounded-pill px-1 fw-semibold"
                                  style={{
                                    background: d.color + '20',
                                    color: d.color,
                                    fontSize: 9,
                                    padding: '1px 6px',
                                    letterSpacing: '0.04em',
                                  }}
                                >
                                  {d.version}
                                </span>
                              </div>
                              <p className="text-muted mb-0" style={{ fontSize: 10.5, marginTop: 1 }}>{d.label}</p>
                            </div>
                            <i className="ri-checkbox-circle-fill" style={{ color: '#10b981', fontSize: 14 }} />
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </SubSection>

                  {/* ── Quick resources ── */}
                  <SubSection icon="ri-links-line" title="Resources" desc="Documentation and quick links" color={currentTab.color}>
                    <Row className="g-2">
                      {[
                        { label: 'Documentation', desc: 'User guides',    icon: 'ri-book-read-line', color: '#0ea5e9', url: 'https://cbc.com/docs' },
                        { label: 'Changelog',     desc: 'Release notes',  icon: 'ri-history-line',   color: '#8b5cf6', url: 'https://cbc.com/changelog' },
                        { label: 'API Reference', desc: 'REST endpoints', icon: 'ri-code-box-line',  color: '#f59e0b', url: 'https://cbc.com/api' },
                        { label: 'Status Page',   desc: 'System health',  icon: 'ri-pulse-line',     color: '#10b981', url: 'https://status.cbc.com' },
                      ].map(r => (
                        <Col md={6} lg={3} key={r.label}>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="d-flex align-items-center gap-2 px-2 py-2 rounded-2 text-decoration-none h-100"
                            style={{
                              background: 'var(--vz-card-bg)',
                              border: '1px solid var(--vz-border-color)',
                              color: 'var(--vz-body-color)',
                              transition: 'all .18s ease',
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget as HTMLAnchorElement;
                              el.style.borderColor = r.color + '55';
                              el.style.background = r.color + '08';
                              el.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget as HTMLAnchorElement;
                              el.style.borderColor = 'var(--vz-border-color)';
                              el.style.background = 'var(--vz-card-bg)';
                              el.style.transform = 'translateY(0)';
                            }}
                          >
                            <i className={r.icon} style={{ color: r.color, fontSize: 17, flexShrink: 0, width: 22, textAlign: 'center' }} />
                            <div className="flex-grow-1 min-w-0">
                              <div className="fw-semibold" style={{ fontSize: 12 }}>{r.label}</div>
                              <div className="text-muted" style={{ fontSize: 10 }}>{r.desc}</div>
                            </div>
                            <i className="ri-arrow-right-up-line" style={{ color: r.color, fontSize: 13 }} />
                          </a>
                        </Col>
                      ))}
                    </Row>
                  </SubSection>

                  {/* ── Footer strip ── */}
                  <div
                    className="d-flex align-items-center justify-content-between gap-2 mt-3 pt-3 flex-wrap"
                    style={{ borderTop: '1px dashed var(--vz-border-color)' }}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <i className="ri-copyright-line text-muted" style={{ fontSize: 13 }} />
                      <span style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                        © 2026 <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>IGC Group</strong> · All rights reserved
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span
                        className="rounded-pill px-2 py-1 fw-semibold"
                        style={{
                          background: '#64748b15',
                          color: '#64748b',
                          border: '1px solid #64748b30',
                          fontSize: 9.5,
                          letterSpacing: '0.05em',
                        }}
                      >
                        PROPRIETARY
                      </span>
                      
                    </div>
                  </div>
                </TabPane>

                {/* HELP */}
                <TabPane tabId="help" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} />
                  <div className="vstack gap-2">
                    {[
                      { q: 'How to add a new client?', a: 'Go to Clients and click Add Client. Fill in the organization details and admin credentials. The client admin will receive a welcome email with login credentials.' },
                      { q: 'How to manage branches?', a: 'Client admins can add branches from the Branches page. Set one branch as "Main" (Head Office) to give its users visibility across all branches.' },
                      { q: 'How do permissions work?', a: 'Super admins assign permissions to client admins. Client admins can then assign permissions to their branch users. Each module has View, Add, Edit, Delete, Export, Import, and Approve permissions.' },
                      { q: 'How to subscribe to a plan?', a: 'Client admins can go to My Plan page to view available plans and subscribe. Plans determine which modules and features are available.' },
                      { q: 'What happens when a plan expires?', a: 'Branch users will be blocked from accessing the platform. Client admins will only see the plan selection page until they renew.' },
                    ].map((faq, i) => {
                      const open = openFaq === i;
                      return (
                        <div
                          key={i}
                          className="rounded-2 overflow-hidden"
                          style={{
                            background: 'var(--vz-card-bg)',
                            border: `1px solid ${open ? currentTab.color + '55' : 'var(--vz-border-color)'}`,
                            transition: 'border-color .18s ease',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setOpenFaq(open ? null : i)}
                            className="btn w-100 d-flex align-items-center gap-2 border-0 text-start px-3 py-2"
                            style={{ background: open ? currentTab.color + '0a' : 'transparent', fontSize: 13, transition: 'background .18s ease' }}
                          >
                            <div
                              className="d-inline-flex align-items-center justify-content-center rounded-1 flex-shrink-0"
                              style={{
                                width: 26, height: 26,
                                background: currentTab.color + (open ? '22' : '15'),
                                border: `1px solid ${currentTab.color}${open ? '45' : '28'}`,
                                transition: 'all .18s ease',
                              }}
                            >
                              <i className="ri-question-line" style={{ color: currentTab.color, fontSize: 13 }} />
                            </div>
                            <span className="flex-grow-1 fw-semibold" style={{ color: open ? currentTab.color : 'var(--vz-body-color)' }}>
                              {faq.q}
                            </span>
                            <i
                              className={open ? 'ri-subtract-line' : 'ri-add-line'}
                              style={{ color: currentTab.color, fontSize: 16, transition: 'transform .18s ease', transform: open ? 'rotate(0deg)' : 'rotate(0deg)' }}
                            />
                          </button>
                          {open && (
                            <div
                              className="px-3 py-2"
                              style={{
                                borderTop: `1px solid ${currentTab.color}25`,
                                background: currentTab.color + '06',
                                fontSize: 12.5,
                                color: 'var(--vz-body-color)',
                                lineHeight: 1.6,
                                paddingLeft: '3.1rem',
                              }}
                            >
                              {faq.a}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </TabPane>

                {/* CONTACT */}
                <TabPane tabId="contact" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color} />
                  <Row className="g-2 mb-3">
                    {[
                      { label: 'Email Support', value: 'support@cbc.com', icon: 'ri-mail-line',   desc: 'Response within 24 hours',   color: '#299cdb' },
                      { label: 'Phone Support', value: '+91 9876543210',  icon: 'ri-phone-line',  desc: 'Mon-Fri, 9 AM - 6 PM IST',   color: '#0ab39c' },
                      { label: 'Website',       value: 'https://cbc.com', icon: 'ri-global-line', desc: 'Documentation & resources',  color: '#7c5cfc' },
                      { label: 'Status Page',   value: 'status.cbc.com',  icon: 'ri-pulse-line',  desc: 'System uptime & incidents',  color: '#f7b84b' },
                    ].map(c => (
                      <Col md={6} key={c.label}>
                        <div
                          className="d-flex align-items-start gap-2 px-3 py-3 rounded-2 h-100"
                          style={{
                            background: 'var(--vz-card-bg)',
                            border: '1px solid var(--vz-border-color)',
                            borderLeft: `3px solid ${c.color}`,
                            transition: 'all .18s ease',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLDivElement;
                            el.style.borderColor = c.color + '55';
                            el.style.borderLeftColor = c.color;
                            el.style.boxShadow = `0 4px 12px ${c.color}22`;
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLDivElement;
                            el.style.borderColor = 'var(--vz-border-color)';
                            el.style.borderLeftColor = c.color;
                            el.style.boxShadow = 'none';
                          }}
                        >
                          <div
                            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                            style={{ width: 36, height: 36, background: c.color + '15', border: `1px solid ${c.color}28` }}
                          >
                            <i className={c.icon} style={{ color: c.color, fontSize: 16 }} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-uppercase fw-semibold mb-0" style={{ fontSize: 9.5, letterSpacing: '0.05em', color: 'var(--vz-secondary-color)' }}>{c.label}</p>
                            <h6 className="mb-1 fw-semibold" style={{ fontSize: 13 }}>{c.value}</h6>
                            <p className="text-muted mb-0" style={{ fontSize: 10.5 }}>{c.desc}</p>
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                  <div
                    className="d-flex align-items-center gap-2 px-3 py-2 rounded-2"
                    style={{
                      background: '#f0654810',
                      border: '1px solid #f0654830',
                      borderLeft: '3px solid #f06548',
                    }}
                  >
                    <i className="ri-alarm-warning-line" style={{ color: '#f06548', fontSize: 18 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--vz-body-color)' }}>
                      <strong style={{ color: '#f06548' }}>Emergency Support:</strong>
                      <span className="text-muted"> For critical issues, call </span>
                      <strong style={{ color: 'var(--vz-body-color)' }}>+91 98765 00000</strong>
                    </span>
                  </div>
                </TabPane>
              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
