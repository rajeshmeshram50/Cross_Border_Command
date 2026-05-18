import { useEffect, useRef, useState } from 'react';
import {
  Card, CardBody, Col, Row, Input, Label, TabContent, TabPane, Form, FormGroup, Button,
} from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTheme } from '../contexts/ThemeContext';
import Tooltip from '../components/ui/Tooltip';
import { ShimmerSettings } from '../components/ui/Shimmer';

/* ──────────────────────────────────────────────────────────────────
 * Section-shape types — mirror SettingsController::RULES on the API.
 * Keeping them strict here so the form bindings catch typos.
 * ────────────────────────────────────────────────────────────────── */

interface GeneralSection {
  platform_name: string; tagline: string; description: string;
  support_email: string; admin_email: string; contact_phone: string; website_url: string;
}
interface SecuritySection {
  tfa: boolean; pwReset: boolean; loginNotif: boolean;
  ipWhite: boolean; sessTimeout: boolean; bruteForce: boolean;
}
interface NotificationsSection {
  emailNotif: boolean; pushNotif: boolean; planExp: boolean;
  newUser: boolean; payAlerts: boolean; weeklyReports: boolean;
}
interface AppearanceSection {
  primary_color: string; secondary_color: string; dark_default: boolean;
  logo_path: string | null; favicon_path: string | null;
}
interface PrivacySection {
  encrypt: boolean; actLog: boolean; retention: boolean;
  cookie: boolean; privacy_policy_url: string;
}
interface HelpSection { faqs: { q: string; a: string }[]; }
interface ContactSection {
  support_email: string; support_phone: string;
  website: string; status_page: string; emergency_phone: string;
}

interface AllSettings {
  general:       GeneralSection;
  security:      SecuritySection;
  notifications: NotificationsSection;
  appearance:    AppearanceSection;
  privacy:       PrivacySection;
  help:          HelpSection;
  contact:       ContactSection;
}

const EMPTY_SETTINGS: AllSettings = {
  general:       { platform_name: '', tagline: '', description: '', support_email: '', admin_email: '', contact_phone: '', website_url: '' },
  security:      { tfa: false, pwReset: false, loginNotif: false, ipWhite: false, sessTimeout: false, bruteForce: false },
  notifications: { emailNotif: false, pushNotif: false, planExp: false, newUser: false, payAlerts: false, weeklyReports: false },
  appearance:    { primary_color: '#4F46E5', secondary_color: '#10B981', dark_default: false, logo_path: null, favicon_path: null },
  privacy:       { encrypt: false, actLog: false, retention: false, cookie: false, privacy_policy_url: '' },
  help:          { faqs: [] },
  contact:       { support_email: '', support_phone: '', website: '', status_page: '', emergency_phone: '' },
};

interface TabDef { id: keyof AllSettings | 'about'; icon: string; label: string; desc: string; color: string; }
const TABS: TabDef[] = [
  { id: 'general',       icon: 'ri-settings-3-line',     label: 'General',       desc: 'Platform configuration',  color: '#6366f1' },
  { id: 'security',      icon: 'ri-shield-keyhole-line', label: 'Security',      desc: 'Auth & access control',   color: '#ef4444' },
  { id: 'notifications', icon: 'ri-notification-3-line', label: 'Notifications', desc: 'Email & push alerts',     color: '#0ea5e9' },
  { id: 'appearance',    icon: 'ri-palette-line',        label: 'Appearance',    desc: 'Branding & themes',       color: '#8b5cf6' },
  { id: 'privacy',       icon: 'ri-lock-2-line',         label: 'Privacy',       desc: 'Data & compliance',       color: '#10b981' },
  { id: 'about',         icon: 'ri-information-line',    label: 'About',         desc: 'Platform info',           color: '#64748b' },
  { id: 'help',          icon: 'ri-question-line',       label: 'Help & FAQs',   desc: 'Support resources',       color: '#f59e0b' },
  { id: 'contact',       icon: 'ri-phone-line',          label: 'Contact Us',    desc: 'Support channels',        color: '#14b8a6' },
];

/* ── Reusable bits ────────────────────────────────────────────── */

function ToggleRow({
  icon, label, desc, checked, onChange, id, color = '#405189',
}: { icon?: string; label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; id: string; color?: string }) {
  return (
    <div
      className="d-flex align-items-center justify-content-between gap-3 py-2 px-2 toggle-row-hover"
      style={{ borderBottom: '1px dashed var(--vz-border-color)', transition: 'background .18s ease', borderRadius: 6 }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = color + '0d'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {icon && <i className={icon} style={{ color, fontSize: 17, flexShrink: 0, marginLeft: 2, width: 22, textAlign: 'center' }} />}
      <div className="flex-grow-1 min-w-0">
        <h6 className="mb-0 fw-semibold" style={{ fontSize: 13 }}>{label}</h6>
        {desc && <p className="text-muted mb-0" style={{ fontSize: 11, marginTop: 1 }}>{desc}</p>}
      </div>
      <div className="form-check form-switch form-switch-md m-0 flex-shrink-0">
        <Input type="switch" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, desc, color, onSave, saving, canSave }: {
  icon: string; title: string; desc: string; color: string;
  onSave?: () => void; saving?: boolean; canSave?: boolean;
}) {
  return (
    <div
      className="position-relative overflow-hidden rounded-2 mb-3"
      style={{ background: `linear-gradient(135deg, ${color}14 0%, ${color}06 55%, transparent 100%)`, border: `1px solid ${color}22`, padding: '10px 14px' }}
    >
      <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: `radial-gradient(circle, ${color}1c 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <div className="d-flex align-items-center justify-content-between gap-2 position-relative">
        <div className="d-flex align-items-center gap-2 min-w-0">
          <div className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
            style={{ width: 32, height: 32, background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 3px 10px ${color}45` }}>
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
            disabled={saving || !canSave}
            onClick={onSave}
            className="btn rounded-pill fw-semibold d-inline-flex align-items-center gap-1 flex-shrink-0"
            style={{
              padding: '5px 12px', fontSize: 11.5,
              background: canSave ? `linear-gradient(135deg, ${color}, ${color}dd)` : 'var(--vz-secondary-bg)',
              color: canSave ? '#fff' : 'var(--vz-secondary-color)',
              border: 'none',
              opacity: saving ? 0.6 : 1,
              cursor: !canSave || saving ? 'not-allowed' : 'pointer',
              boxShadow: canSave ? `0 4px 12px ${color}4a, inset 0 1px 0 rgba(255,255,255,0.22)` : 'none',
              transition: 'all .18s ease',
            }}
            title={!canSave ? 'Only super admin can save platform settings' : undefined}
          >
            {saving ? <><i className="ri-loader-4-line" style={{ fontSize: 12, animation: 'spin 1s linear infinite' }} /> Saving…</> : <><i className="ri-save-line" style={{ fontSize: 12 }} /> Save Changes</>}
          </button>
        )}
      </div>
    </div>
  );
}

function SubSection({ icon, title, desc, color, children, first = false }: { icon: string; title: string; desc?: string; color: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={first ? 'mb-3' : 'mt-4 mb-3'}>
      <div className="d-flex align-items-center gap-2 mb-2">
        <i className={icon} style={{ color, fontSize: 15, flexShrink: 0 }} />
        <span className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{title}</span>
        {desc && (<><span style={{ color: 'var(--vz-secondary-color)', fontSize: 10, fontWeight: 400 }}>·</span><span style={{ color: 'var(--vz-secondary-color)', fontSize: 10.5 }}>{desc}</span></>)}
      </div>
      <div style={{ height: 1, background: `linear-gradient(90deg, ${color}55 0%, var(--vz-border-color) 35%, transparent 100%)`, marginBottom: 10 }} />
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const settingsCtx = useSettings();
  const { theme, toggle: toggleTheme } = useTheme();
  const isSuper = user?.user_type === 'super_admin';

  const [tab, setTab] = useState<string>('general');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [data, setData] = useState<AllSettings>(EMPTY_SETTINGS);
  const fileLogoRef = useRef<HTMLInputElement>(null);
  const fileFavRef  = useRef<HTMLInputElement>(null);

  const currentTab = TABS.find(t => t.id === tab)!;

  // Initial load — every section in one round-trip.
  // We race the API against an 800ms floor so the shimmer is visible
  // long enough to register as a real loading state. Without the floor
  // the API returns in ~40-80ms locally and the shimmer flashes by so
  // fast it looks like a glitch. The floor only kicks in when the API
  // is faster than it; slow responses still resolve when they arrive.
  useEffect(() => {
    const minDelay = new Promise(r => setTimeout(r, 800));
    const fetchSettings = api.get('/settings').then(res => {
      const merged: AllSettings = { ...EMPTY_SETTINGS };
      for (const k of Object.keys(EMPTY_SETTINGS) as (keyof AllSettings)[]) {
        if (res.data[k] && typeof res.data[k] === 'object') {
          (merged as any)[k] = { ...(EMPTY_SETTINGS as any)[k], ...res.data[k] };
        }
      }
      return merged;
    });
    Promise.all([fetchSettings, minDelay])
      .then(([merged]) => setData(merged as AllSettings))
      .catch(err => {
        toast.error('Settings', err.response?.data?.message || 'Failed to load settings');
      })
      .finally(() => setLoading(false));
  }, []);

  // Tiny helper for shallow-merging into one section's state
  const patch = <K extends keyof AllSettings>(section: K, partial: Partial<AllSettings[K]>) => {
    setData(prev => ({ ...prev, [section]: { ...prev[section], ...partial } as AllSettings[K] }));
  };

  // Generic save dispatcher — called by every tab's Save button
  const saveSection = async <K extends Exclude<keyof AllSettings, 'about'>>(section: K) => {
    if (!isSuper) {
      toast.error('Permission denied', 'Only super admin can change platform settings');
      return;
    }
    setSavingSection(section);
    try {
      const res = await api.put(`/settings/${section}`, data[section]);
      patch(section, res.data.value);
      // Refresh the global SettingsContext so dependent UI (document.title,
      // favicon, theme colors, cookie banner, etc.) reflects the change
      // immediately — no page reload required.
      settingsCtx.refresh();
      toast.success('Saved', `${currentTab.label} settings updated`);
    } catch (err: any) {
      const msg = err.response?.data?.message
                || (err.response?.data?.errors ? Object.values(err.response.data.errors).flat().join('; ') : 'Save failed');
      toast.error('Save failed', msg);
    } finally {
      setSavingSection(null);
    }
  };

  const uploadAsset = async (kind: 'logo' | 'favicon', file: File) => {
    if (!isSuper) { toast.error('Permission denied', 'Only super admin can upload platform assets'); return; }
    setSavingSection('appearance');
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const res = await api.post('/settings/appearance/asset', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      patch('appearance', res.data.value);
      settingsCtx.refresh();  // pick up new logo/favicon globally
      toast.success('Uploaded', `${kind} updated`);
    } catch (err: any) {
      toast.error('Upload failed', err.response?.data?.message || 'Could not upload file');
    } finally { setSavingSection(null); }
  };

  // FAQ list handlers
  const addFaq    = () => patch('help', { faqs: [...data.help.faqs, { q: '', a: '' }] });
  const removeFaq = (i: number) => patch('help', { faqs: data.help.faqs.filter((_, idx) => idx !== i) });
  const editFaq   = (i: number, field: 'q'|'a', value: string) => {
    const next = [...data.help.faqs];
    next[i] = { ...next[i], [field]: value };
    patch('help', { faqs: next });
  };

  if (loading) {
    // Layout-matched shimmer (hero + 280px sidebar + content card grid) —
    // reads as the real page filling in rather than a generic spinner.
    return <div style={{ padding: 16 }}><ShimmerSettings /></div>;
  }

  return (
    <>
      <style>{`
        @keyframes settings-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .settings-tab-btn { position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; cursor: pointer; user-select: none; border: 1px solid transparent; background: transparent; transition: background .18s ease, border-color .18s ease, transform .18s ease; width: 100%; text-align: left; }
        .settings-tab-btn:hover { background: var(--vz-secondary-bg); }
        .settings-tab-btn.active { background: var(--accent-col, #40518912); border-color: var(--accent-col-border, #40518828); }
        .settings-tab-btn.active::before { content: ''; position: absolute; left: 0; top: 15%; bottom: 15%; width: 3px; border-radius: 3px; background: var(--accent-col-strong, #405189); box-shadow: 0 0 8px var(--accent-col-strong, #405189); }
        .settings-pane { animation: settings-fade-up .25s ease; }
        .toggle-row-hover:last-child { border-bottom: none !important; }

        /* ─── Form-control polish — mirrors the ClientForm (.cf-wrap)
              styling so inputs / selects / textarea / dropdowns share a
              single 38px-tall, 10px-corner indigo-focus look across both
              surfaces. Without this the Settings inputs rendered as
              default reactstrap controls (31px, 4px corners, no focus
              halo) which felt visually inconsistent with the rest of
              the admin area. */
        .settings-form .form-control,
        .settings-form .form-select,
        .settings-form .dropdown-toggle.btn-light,
        .settings-form .input-group-sm > .form-control,
        .settings-form .input-group-sm > .input-group-text,
        .settings-form .input-group > .input-group-text {
          height: 38px;
          min-height: 38px;
          padding-top: 7px;
          padding-bottom: 7px;
          font-size: 13px;
          line-height: 1.4;
          border-radius: 10px;
          border: 1px solid var(--vz-border-color);
          background: var(--vz-card-bg);
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
        }
        .settings-form textarea.form-control {
          height: auto;
          min-height: 56px;
          border-radius: 10px;
          padding-top: 9px;
        }
        .settings-form .input-group > .input-group-text:first-child {
          border-top-left-radius: 10px;
          border-bottom-left-radius: 10px;
        }
        .settings-form .input-group > .form-control:last-child {
          border-top-right-radius: 10px;
          border-bottom-right-radius: 10px;
        }
        .settings-form .form-control:hover,
        .settings-form .form-select:hover,
        .settings-form .dropdown-toggle.btn-light:hover {
          border-color: rgba(99,102,241,0.45);
        }
        .settings-form .form-control:focus,
        .settings-form .form-select:focus,
        .settings-form .dropdown-toggle.btn-light:focus,
        .settings-form .show > .dropdown-toggle.btn-light {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }
        .settings-form .form-control.is-invalid,
        .settings-form .form-control.is-invalid:focus {
          border-color: #f06548;
          box-shadow: 0 0 0 3px rgba(240,101,72,0.15);
        }
        /* Match the master-form dropdown popup look — same indigo focus
           ring and 10px corners as the input itself. */
        .settings-form .master-select-toggle {
          border: 1px solid var(--vz-border-color) !important;
          border-radius: 10px !important;
          height: 38px !important;
          font-size: 13px !important;
          background: var(--vz-card-bg) !important;
        }
        .settings-form .master-select-toggle:hover:not(:disabled) {
          border-color: rgba(99,102,241,0.45) !important;
        }
        .settings-form .master-select-wrap.show .master-select-toggle {
          border-color: #6366f1 !important;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
        }
        /* Form labels — tighter, weighted to match ClientForm's .cf-label. */
        .settings-form .form-label,
        .settings-form label.col-form-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--vz-secondary-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
        }
        @media (max-width: 1399.98px) {
          .settings-sidebar-label, .settings-sidebar-header-text, .settings-sidebar-active-arrow { display: none !important; }
          .settings-tab-btn { justify-content: center; padding: 8px; }
          .settings-sidebar-header { justify-content: center !important; }
        }
        @media (max-width: 575.98px) {
          .settings-tab-list { flex-direction: row !important; overflow-x: auto; gap: 6px !important; }
          .settings-tab-list .settings-tab-btn { flex: 0 0 auto; width: auto; padding: 8px 10px; }
        }
      `}</style>

      {/* Header */}
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <div className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0" style={{ width: 36, height: 36, background: '#40518918', border: '1px solid #40518928' }}>
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
        {/* Sidebar */}
        <Col xxl={3} xl={3} lg="auto" md="auto" xs={12}>
          <Card className="mb-0" style={{ borderRadius: 14 }}>
            <CardBody className="p-2">
              <div className="settings-sidebar-header px-2 py-2 mb-1 d-flex align-items-center gap-2">
                <div className="d-inline-flex align-items-center justify-content-center rounded-1" style={{ width: 26, height: 26, background: '#7c5cfc18', border: '1px solid #7c5cfc28' }}>
                  <i className="ri-apps-2-line" style={{ color: '#7c5cfc', fontSize: 13 }} />
                </div>
                <span className="settings-sidebar-header-text text-uppercase fw-bold" style={{ fontSize: 10, letterSpacing: '0.07em', color: 'var(--vz-secondary-color)' }}>Categories</span>
                <span className="settings-sidebar-header-text ms-auto rounded-pill px-2 fw-bold" style={{ fontSize: 9.5, background: '#7c5cfc20', color: '#7c5cfc', border: '1px solid #7c5cfc45' }}>{TABS.length}</span>
              </div>
              <div className="settings-tab-list vstack gap-1">
                {TABS.map(t => {
                  const isActive = tab === t.id;
                  return (
                    <Tooltip key={t.id} label={t.label} position="right">
                      <button type="button" onClick={() => setTab(t.id)} aria-label={t.label}
                        className={`settings-tab-btn ${isActive ? 'active' : ''}`}
                        style={{ ['--accent-col' as any]: t.color + '14', ['--accent-col-border' as any]: t.color + '28', ['--accent-col-strong' as any]: t.color }}>
                        <div className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0" style={{ width: 32, height: 32, background: isActive ? t.color + '22' : 'var(--vz-secondary-bg)', border: `1px solid ${isActive ? t.color + '40' : 'var(--vz-border-color)'}`, transition: 'all .18s ease' }}>
                          <i className={t.icon} style={{ color: t.color, fontSize: 15 }} />
                        </div>
                        <div className="settings-sidebar-label flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate" style={{ fontSize: 13, color: isActive ? t.color : 'var(--vz-heading-color, var(--vz-body-color))', transition: 'color .18s ease' }}>{t.label}</div>
                          <div className="text-muted text-truncate" style={{ fontSize: 10.5 }}>{t.desc}</div>
                        </div>
                        {isActive && <i className="settings-sidebar-active-arrow ri-arrow-right-s-line" style={{ color: t.color, fontSize: 16 }} />}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </Col>

        {/* Content */}
        <Col xxl={9} xl={9} lg={true} md={true} xs={12}>
          <Card className="mb-0" style={{ borderRadius: 14 }}>
            <CardBody className="p-3">
              <TabContent activeTab={tab} className="settings-form">

                {/* GENERAL */}
                <TabPane tabId="general" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('general')} saving={savingSection === 'general'} canSave={isSuper} />
                  <Form onSubmit={e => { e.preventDefault(); saveSection('general'); }}>
                    <SubSection icon="ri-building-4-line" title="Platform Info" desc="Branding and public identity" color={currentTab.color} first>
                      <Row className="g-3">
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-building-4-line me-1" style={{ color: currentTab.color }} />Platform Name</Label>
                          <Input value={data.general.platform_name} onChange={e => patch('general', { platform_name: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-quill-pen-line me-1" style={{ color: currentTab.color }} />Tagline</Label>
                          <Input value={data.general.tagline} onChange={e => patch('general', { tagline: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                        <Col xs={12}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-file-text-line me-1" style={{ color: currentTab.color }} />Platform Description</Label>
                          <Input type="textarea" rows={3} value={data.general.description} onChange={e => patch('general', { description: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                      </Row>
                    </SubSection>
                    <SubSection icon="ri-customer-service-2-line" title="Contact Info" desc="Channels customers use to reach you" color="#299cdb">
                      <Row className="g-3">
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-mail-send-line me-1" style={{ color: '#299cdb' }} />Support Email</Label>
                          <Input type="email" value={data.general.support_email} onChange={e => patch('general', { support_email: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-mail-star-line me-1" style={{ color: '#299cdb' }} />Admin Email</Label>
                          <Input type="email" value={data.general.admin_email} onChange={e => patch('general', { admin_email: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-phone-line me-1" style={{ color: '#0ab39c' }} />Contact Phone</Label>
                          <Input value={data.general.contact_phone} onChange={e => patch('general', { contact_phone: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                        <Col md={6}>
                          <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-global-line me-1" style={{ color: '#7c5cfc' }} />Website URL</Label>
                          <Input value={data.general.website_url} onChange={e => patch('general', { website_url: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                        </Col>
                      </Row>
                    </SubSection>
                  </Form>
                </TabPane>

                {/* SECURITY */}
                <TabPane tabId="security" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('security')} saving={savingSection === 'security'} canSave={isSuper} />
                  <SubSection icon="ri-shield-keyhole-line" title="Authentication" desc="How users sign in and verify identity" color={currentTab.color} first>
                    <ToggleRow icon="ri-key-2-line"        id="tfa"        label="Two-Factor Authentication"      desc="Require 2FA for all admin users"            color={currentTab.color} checked={data.security.tfa}        onChange={v => patch('security', { tfa: v })} />
                    <ToggleRow icon="ri-restart-line"      id="pwReset"    label="Force Password Reset (90 days)" desc="Users must change password every 90 days"   color={currentTab.color} checked={data.security.pwReset}    onChange={v => patch('security', { pwReset: v })} />
                    <ToggleRow icon="ri-notification-line" id="loginNotif" label="Login Notifications"            desc="Send email on new device login"             color={currentTab.color} checked={data.security.loginNotif} onChange={v => patch('security', { loginNotif: v })} />
                  </SubSection>
                  <SubSection icon="ri-lock-2-line" title="Access Control" desc="Protect accounts and sessions" color={currentTab.color}>
                    <ToggleRow icon="ri-shield-user-line"   id="ipWhite"     label="IP Whitelisting"          desc="Restrict access to specific IP addresses"   color={currentTab.color} checked={data.security.ipWhite}     onChange={v => patch('security', { ipWhite: v })} />
                    <ToggleRow icon="ri-timer-line"         id="sessTimeout" label="Session Timeout (30 min)" desc="Auto logout after 30 minutes of inactivity" color={currentTab.color} checked={data.security.sessTimeout} onChange={v => patch('security', { sessTimeout: v })} />
                    <ToggleRow icon="ri-lock-password-line" id="bruteForce"  label="Brute Force Protection"   desc="Lock account after 5 failed login attempts" color={currentTab.color} checked={data.security.bruteForce}  onChange={v => patch('security', { bruteForce: v })} />
                  </SubSection>
                </TabPane>

                {/* NOTIFICATIONS */}
                <TabPane tabId="notifications" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('notifications')} saving={savingSection === 'notifications'} canSave={isSuper} />
                  <SubSection icon="ri-broadcast-line" title="Channels" desc="How notifications are delivered" color={currentTab.color} first>
                    <ToggleRow icon="ri-mail-line"           id="emailNotif" label="Email Notifications" desc="Send email for important events" color={currentTab.color} checked={data.notifications.emailNotif} onChange={v => patch('notifications', { emailNotif: v })} />
                    <ToggleRow icon="ri-notification-3-line" id="pushNotif"  label="Push Notifications"  desc="Browser push notifications"      color={currentTab.color} checked={data.notifications.pushNotif}  onChange={v => patch('notifications', { pushNotif: v })} />
                  </SubSection>
                  <SubSection icon="ri-alarm-line" title="Alerts" desc="What triggers a notification" color={currentTab.color}>
                    <ToggleRow icon="ri-calendar-schedule-line" id="planExp"       label="Plan Expiry Alerts"      desc="Notify 7 days before plan expires"    color={currentTab.color} checked={data.notifications.planExp}       onChange={v => patch('notifications', { planExp: v })} />
                    <ToggleRow icon="ri-user-add-line"          id="newUser"       label="New User Registration"   desc="Notify admin on new user signup"      color={currentTab.color} checked={data.notifications.newUser}       onChange={v => patch('notifications', { newUser: v })} />
                    <ToggleRow icon="ri-bank-card-line"         id="payAlerts"     label="Payment Alerts"          desc="Notify on successful/failed payments" color={currentTab.color} checked={data.notifications.payAlerts}     onChange={v => patch('notifications', { payAlerts: v })} />
                    <ToggleRow icon="ri-bar-chart-box-line"     id="weeklyReports" label="Weekly Reports"          desc="Send weekly summary to admins"        color={currentTab.color} checked={data.notifications.weeklyReports} onChange={v => patch('notifications', { weeklyReports: v })} />
                  </SubSection>
                </TabPane>

                {/* APPEARANCE */}
                <TabPane tabId="appearance" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('appearance')} saving={savingSection === 'appearance'} canSave={isSuper} />
                  <SubSection icon="ri-palette-line" title="Brand Colors" desc="Primary and secondary accent colors" color={currentTab.color} first>
                    <Row className="g-3">
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-drop-line me-1" style={{ color: currentTab.color }} />Primary Color</Label>
                        <div className="d-flex gap-2 align-items-center">
                          <Input type="color" value={data.appearance.primary_color} onChange={e => patch('appearance', { primary_color: e.target.value })} disabled={!isSuper} style={{ width: 44, height: 36, padding: '2px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }} />
                          <Input value={data.appearance.primary_color} onChange={e => patch('appearance', { primary_color: e.target.value })} disabled={!isSuper} style={{ fontSize: 13, fontFamily: 'monospace' }} />
                        </div>
                      </Col>
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-drop-fill me-1" style={{ color: '#10B981' }} />Secondary Color</Label>
                        <div className="d-flex gap-2 align-items-center">
                          <Input type="color" value={data.appearance.secondary_color} onChange={e => patch('appearance', { secondary_color: e.target.value })} disabled={!isSuper} style={{ width: 44, height: 36, padding: '2px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }} />
                          <Input value={data.appearance.secondary_color} onChange={e => patch('appearance', { secondary_color: e.target.value })} disabled={!isSuper} style={{ fontSize: 13, fontFamily: 'monospace' }} />
                        </div>
                      </Col>
                    </Row>
                  </SubSection>
                  <SubSection icon="ri-image-line" title="Brand Assets" desc="Logo and favicon uploads" color={currentTab.color}>
                    <Row className="g-3">
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-image-add-line me-1" style={{ color: currentTab.color }} />Platform Logo</Label>
                        <input ref={fileLogoRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadAsset('logo', f); e.target.value = ''; }} />
                        <div className="rounded-2 p-3 text-center" style={{ border: `2px dashed ${currentTab.color}55`, background: currentTab.color + '08', cursor: isSuper ? 'pointer' : 'not-allowed' }} onClick={() => isSuper && fileLogoRef.current?.click()}>
                          {data.appearance.logo_path
                            ? <img src={`/storage/${data.appearance.logo_path}`} alt="logo" style={{ maxHeight: 60, maxWidth: '100%', objectFit: 'contain' }} />
                            : <><i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: currentTab.color }} /><p className="mb-0 fw-semibold mt-1" style={{ fontSize: 12, color: currentTab.color }}>Click to upload logo</p><p className="text-muted mb-0" style={{ fontSize: 10.5 }}>PNG, JPG, SVG, WEBP · Max 2MB</p></>}
                        </div>
                      </Col>
                      <Col md={6}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-shield-star-line me-1" style={{ color: currentTab.color }} />Favicon</Label>
                        <input ref={fileFavRef} type="file" accept="image/png,image/x-icon,image/svg+xml,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadAsset('favicon', f); e.target.value = ''; }} />
                        <div className="rounded-2 p-3 text-center" style={{ border: `2px dashed ${currentTab.color}55`, background: currentTab.color + '08', cursor: isSuper ? 'pointer' : 'not-allowed' }} onClick={() => isSuper && fileFavRef.current?.click()}>
                          {data.appearance.favicon_path
                            ? <img src={`/storage/${data.appearance.favicon_path}`} alt="favicon" style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }} />
                            : <><i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: currentTab.color }} /><p className="mb-0 fw-semibold mt-1" style={{ fontSize: 12, color: currentTab.color }}>Click to upload favicon</p><p className="text-muted mb-0" style={{ fontSize: 10.5 }}>ICO, PNG, SVG · Max 2MB</p></>}
                        </div>
                      </Col>
                    </Row>
                  </SubSection>
                  <SubSection icon="ri-contrast-2-line" title="Theme" desc="Switch the current view between light and dark, and pick the default for new users" color={currentTab.color}>
                    {/* Live theme switch — flips the current view's
                        theme immediately by calling the global
                        ThemeContext toggle. The checkbox state is
                        bound to the live theme (not the saved default)
                        so toggling it has visible effect. The saved
                        "default for new users" preference is mirrored
                        alongside whenever a super-admin flips it. */}
                    <ToggleRow
                      icon="ri-moon-line"
                      id="darkMode"
                      label="Dark Mode"
                      desc={isSuper
                        ? 'Toggle the current view + set the default for new users'
                        : 'Toggle the current view'}
                      color={currentTab.color}
                      checked={theme === 'dark'}
                      onChange={(v) => {
                        // Always flip the live theme so the user gets
                        // immediate feedback when they click. Calling
                        // toggle() is sufficient — the context flips
                        // light ↔ dark and persists to localStorage.
                        if ((theme === 'dark') !== v) toggleTheme();
                        // Super admins additionally update the saved
                        // server-side default so freshly-onboarded users
                        // land on this preference.
                        if (isSuper) patch('appearance', { dark_default: v });
                      }}
                    />
                  </SubSection>
                </TabPane>

                {/* PRIVACY */}
                <TabPane tabId="privacy" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('privacy')} saving={savingSection === 'privacy'} canSave={isSuper} />
                  <div className="d-flex align-items-center gap-2 px-3 py-2 rounded-2 mb-3" style={{ background: `${currentTab.color}10`, border: `1px solid ${currentTab.color}30`, borderLeft: `3px solid ${currentTab.color}` }}>
                    <i className="ri-checkbox-circle-line" style={{ color: currentTab.color, fontSize: 18 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--vz-body-color)' }}>
                      <strong style={{ color: currentTab.color }}>Data Compliance</strong>
                      <span className="text-muted"> · Your platform meets basic data protection requirements</span>
                    </span>
                  </div>
                  <SubSection icon="ri-database-2-line" title="Data Handling" desc="How we store and manage user data" color={currentTab.color} first>
                    <ToggleRow icon="ri-fingerprint-line" id="encrypt"   label="Data Encryption at Rest"  desc="Encrypt all stored data using AES-256"   color={currentTab.color} checked={data.privacy.encrypt}   onChange={v => patch('privacy', { encrypt: v })} />
                    <ToggleRow icon="ri-history-line"     id="actLog"    label="Activity Logging"         desc="Log all user actions for audit trail"    color={currentTab.color} checked={data.privacy.actLog}    onChange={v => patch('privacy', { actLog: v })} />
                    <ToggleRow icon="ri-delete-bin-line"  id="retention" label="Data Retention (90 days)" desc="Auto-delete inactive data after 90 days" color={currentTab.color} checked={data.privacy.retention} onChange={v => patch('privacy', { retention: v })} />
                  </SubSection>
                  <SubSection icon="ri-file-shield-2-line" title="Compliance" desc="Consent and policy settings" color={currentTab.color}>
                    <ToggleRow icon="ri-cookie-line" id="cookie" label="Cookie Consent Banner" desc="Show cookie consent to users" color={currentTab.color} checked={data.privacy.cookie} onChange={v => patch('privacy', { cookie: v })} />
                    <FormGroup className="mt-3 mb-0">
                      <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}><i className="ri-external-link-line me-1" style={{ color: currentTab.color }} />Privacy Policy URL</Label>
                      <Input value={data.privacy.privacy_policy_url} onChange={e => patch('privacy', { privacy_policy_url: e.target.value })} disabled={!isSuper} style={{ fontSize: 13 }} />
                    </FormGroup>
                  </SubSection>
                </TabPane>

                {/* ABOUT — read-only display, sourced from General settings */}
                <TabPane tabId="about" className="settings-pane">
                  <div className="d-flex align-items-center gap-3 flex-wrap mb-3 pb-3 border-bottom">
                    <div className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0" style={{ width: 44, height: 44, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 6px 18px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.25)' }}>
                      <i className="ri-shield-star-fill" style={{ color: '#fff', fontSize: 20 }} />
                    </div>
                    <div className="min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em', color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{data.general.platform_name || 'Cross Border Command'}</h5>
                        <span className="rounded-pill px-2 fw-bold d-inline-flex align-items-center gap-1" style={{ background: 'linear-gradient(135deg, #10b981, #14c9b1)', color: '#fff', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', boxShadow: '0 2px 6px rgba(16,185,129,0.40)' }}>
                          <span className="rounded-circle" style={{ width: 4, height: 4, background: '#fff' }} /> Online
                        </span>
                      </div>
                      <p className="mb-0 text-muted" style={{ fontSize: 11.5, marginTop: 1 }}>{data.general.tagline || 'Multi-Tenant SaaS Platform'} · Enterprise Grade</p>
                    </div>
                    <div className="d-flex flex-wrap gap-1 ms-auto">
                      {[
                        { label: 'v1.0.0',     icon: 'ri-git-branch-line',  color: '#6366f1' },
                        { label: 'Laravel 12', icon: 'ri-server-line',      color: '#ef4444' },
                        { label: 'React 19',   icon: 'ri-reactjs-line',     color: '#0ea5e9' },
                        { label: 'PostgreSQL', icon: 'ri-database-2-line',  color: '#10b981' },
                      ].map(t => (
                        <span key={t.label} className="rounded-pill fw-semibold d-inline-flex align-items-center gap-1" style={{ background: t.color + '15', color: t.color, border: `1px solid ${t.color}30`, fontSize: 9.5, letterSpacing: '0.04em', padding: '2px 7px' }}>
                          <i className={t.icon} style={{ fontSize: 10 }} />{t.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <SubSection icon="ri-stack-line" title="Technology Stack" desc="Built on modern, reliable frameworks" color={currentTab.color} first>
                    <Row className="g-2">
                      {[
                        { label: 'Backend',  value: 'Laravel 12',      icon: 'ri-server-line',         color: '#ef4444', version: 'PHP 8.3' },
                        { label: 'Frontend', value: 'React 19 + Vite', icon: 'ri-reactjs-line',        color: '#0ea5e9', version: 'TypeScript 5' },
                        { label: 'Database', value: 'PostgreSQL 16',   icon: 'ri-database-2-line',     color: '#10b981', version: 'Relational' },
                        { label: 'Auth',     value: 'Laravel Sanctum', icon: 'ri-shield-keyhole-line', color: '#8b5cf6', version: 'Token-based' },
                      ].map(d => (
                        <Col md={6} key={d.label}>
                          <div className="d-flex align-items-center gap-2 rounded-2 px-3 py-2" style={{ background: 'var(--vz-card-bg)', border: '1px solid var(--vz-border-color)' }}>
                            <i className={d.icon} style={{ color: d.color, fontSize: 20, flexShrink: 0, width: 24, textAlign: 'center' }} />
                            <div className="min-w-0 flex-grow-1">
                              <div className="d-flex align-items-center gap-2">
                                <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>{d.value}</h6>
                                <span className="rounded-pill px-1 fw-semibold" style={{ background: d.color + '20', color: d.color, fontSize: 9, padding: '1px 6px', letterSpacing: '0.04em' }}>{d.version}</span>
                              </div>
                              <p className="text-muted mb-0" style={{ fontSize: 10.5, marginTop: 1 }}>{d.label}</p>
                            </div>
                            <i className="ri-checkbox-circle-fill" style={{ color: '#10b981', fontSize: 14 }} />
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </SubSection>
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px dashed var(--vz-border-color)' }}>
                    <div className="d-flex align-items-center gap-2">
                      <i className="ri-copyright-line text-muted" style={{ fontSize: 13 }} />
                      <span style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>© {new Date().getFullYear()} <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{data.general.platform_name || 'Cross Border Command'}</strong> · All rights reserved</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="rounded-pill px-2 py-1 fw-semibold" style={{ background: '#64748b15', color: '#64748b', border: '1px solid #64748b30', fontSize: 9.5, letterSpacing: '0.05em' }}>PROPRIETARY</span>
                    </div>
                  </div>
                </TabPane>

                {/* HELP & FAQs — editable */}
                <TabPane tabId="help" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('help')} saving={savingSection === 'help'} canSave={isSuper} />
                  {isSuper && (
                    <div className="d-flex justify-content-end mb-2">
                      <Button size="sm" color="warning" outline onClick={addFaq}><i className="ri-add-line me-1" />Add FAQ</Button>
                    </div>
                  )}
                  <div className="vstack gap-2">
                    {data.help.faqs.length === 0 && <div className="text-center text-muted py-4" style={{ fontSize: 13 }}>No FAQs yet. Click "Add FAQ" to create one.</div>}
                    {data.help.faqs.map((faq, i) => {
                      const open = openFaq === i;
                      return (
                        <div key={i} className="rounded-2 overflow-hidden" style={{ background: 'var(--vz-card-bg)', border: `1px solid ${open ? currentTab.color + '55' : 'var(--vz-border-color)'}`, transition: 'border-color .18s ease' }}>
                          <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: open ? currentTab.color + '0a' : 'transparent' }}>
                            <button type="button" onClick={() => setOpenFaq(open ? null : i)} className="btn btn-link p-0 d-flex align-items-center gap-2 text-decoration-none flex-grow-1" style={{ fontSize: 13 }}>
                              <div className="d-inline-flex align-items-center justify-content-center rounded-1 flex-shrink-0" style={{ width: 26, height: 26, background: currentTab.color + (open ? '22' : '15'), border: `1px solid ${currentTab.color}${open ? '45' : '28'}` }}>
                                <i className="ri-question-line" style={{ color: currentTab.color, fontSize: 13 }} />
                              </div>
                              {isSuper
                                ? <Input value={faq.q} onChange={e => editFaq(i, 'q', e.target.value)} placeholder="Question" className="flex-grow-1" style={{ fontSize: 13, fontWeight: 600 }} />
                                : <span className="flex-grow-1 fw-semibold text-start" style={{ color: open ? currentTab.color : 'var(--vz-body-color)' }}>{faq.q}</span>}
                              <i className={open ? 'ri-subtract-line' : 'ri-add-line'} style={{ color: currentTab.color, fontSize: 16 }} />
                            </button>
                            {isSuper && (
                              <Button size="sm" color="danger" outline onClick={() => removeFaq(i)} title="Delete FAQ"><i className="ri-delete-bin-line" /></Button>
                            )}
                          </div>
                          {open && (
                            <div className="px-3 py-2" style={{ borderTop: `1px solid ${currentTab.color}25`, background: currentTab.color + '06', fontSize: 12.5, color: 'var(--vz-body-color)', lineHeight: 1.6 }}>
                              {isSuper
                                ? <Input type="textarea" rows={3} value={faq.a} onChange={e => editFaq(i, 'a', e.target.value)} placeholder="Answer" style={{ fontSize: 12.5 }} />
                                : <div style={{ paddingLeft: '2.2rem' }}>{faq.a}</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </TabPane>

                {/* CONTACT — editable */}
                <TabPane tabId="contact" className="settings-pane">
                  <SectionHeader icon={currentTab.icon} title={currentTab.label} desc={currentTab.desc} color={currentTab.color}
                    onSave={() => saveSection('contact')} saving={savingSection === 'contact'} canSave={isSuper} />
                  <Row className="g-3">
                    {[
                      { key: 'support_email',   label: 'Email Support', icon: 'ri-mail-line',   desc: 'Response within 24 hours',   color: '#299cdb', type: 'email' },
                      { key: 'support_phone',   label: 'Phone Support', icon: 'ri-phone-line',  desc: 'Mon-Fri, 9 AM - 6 PM IST',   color: '#0ab39c', type: 'tel' },
                      { key: 'website',         label: 'Website',       icon: 'ri-global-line', desc: 'Documentation & resources',  color: '#7c5cfc', type: 'url' },
                      { key: 'status_page',     label: 'Status Page',   icon: 'ri-pulse-line',  desc: 'System uptime & incidents',  color: '#f7b84b', type: 'text' },
                      { key: 'emergency_phone', label: 'Emergency Phone', icon: 'ri-alarm-warning-line', desc: 'Critical incidents',  color: '#f06548', type: 'tel' },
                    ].map(c => (
                      <Col md={6} key={c.key}>
                        <Label className="fw-semibold mb-1" style={{ fontSize: 12 }}>
                          <i className={c.icon + ' me-1'} style={{ color: c.color }} />{c.label}
                          <span className="text-muted ms-1" style={{ fontSize: 10.5, fontWeight: 400 }}>· {c.desc}</span>
                        </Label>
                        <Input
                          type={c.type as any}
                          value={(data.contact as any)[c.key] || ''}
                          onChange={e => patch('contact', { [c.key]: e.target.value } as any)}
                          disabled={!isSuper}
                          style={{ fontSize: 13 }}
                        />
                      </Col>
                    ))}
                  </Row>
                </TabPane>

              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
