import { useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';

// Shared option lists for the master-style dropdowns used in the onboarding /
// employee modals. Kept module-scoped so they're created once.
const COUNTRY_OPTIONS = [
  { value: 'India',          label: 'India' },
  { value: 'United States',  label: 'United States' },
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'Singapore',      label: 'Singapore' },
  { value: 'UAE',            label: 'UAE' },
];
const NATIONALITY_OPTIONS = [
  { value: 'Indian',      label: 'Indian' },
  { value: 'American',    label: 'American' },
  { value: 'British',     label: 'British' },
  { value: 'Singaporean', label: 'Singaporean' },
  { value: 'Emirati',     label: 'Emirati' },
  { value: 'Other',       label: 'Other' },
];
const GENDER_OPTIONS = [
  { value: 'Male',              label: 'Male' },
  { value: 'Female',            label: 'Female' },
  { value: 'Other',             label: 'Other' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];
const STATE_OPTIONS = [
  { value: 'Maharashtra', label: 'Maharashtra' },
  { value: 'Karnataka',   label: 'Karnataka' },
  { value: 'Delhi',       label: 'Delhi' },
  { value: 'Tamil Nadu',  label: 'Tamil Nadu' },
  { value: 'Gujarat',     label: 'Gujarat' },
];
const NUMBER_SERIES_OPTIONS = [
  { value: 'Default Number Series', label: 'Default Number Series' },
  { value: 'Contractor Series',     label: 'Contractor Series' },
  { value: 'Intern Series',         label: 'Intern Series' },
];
const EMP_STATUS_OPTIONS = [
  { value: 'Active',    label: 'Active' },
  { value: 'On Leave',  label: 'On Leave' },
  { value: 'Probation', label: 'Probation' },
  { value: 'Inactive',  label: 'Inactive' },
];

// HR → Employee directory page. KPI tiles, tabs, filter row and table follow
// the same surface/card pattern used on Clients.tsx so the look stays
// consistent across modules.

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string | null;
  manager: string;
  profile: number;
  onboarding: 'Completed' | 'In Progress' | 'Pending';
  status: 'active' | 'on_leave' | 'high_attention' | 'probation' | 'inactive';
  enabled: boolean;
}

const EMPLOYEES: EmployeeRow[] = [
  { id: 'EMP-1063', name: 'Aarav Kale',       email: 'aarav.kale@enterprise.com',       initials: 'AK', accent: '#0ab39c', department: 'Accounts',              designation: 'Associate Engineer',    primaryRole: 'Associate',         ancillaryRole: 'Training Coordinator', manager: 'Deepa Kulkarni',  profile: 83, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1068', name: 'Aditi Singh',      email: 'aditi.singh@enterprise.com',      initials: 'AS', accent: '#7c5cfc', department: 'Mobile Application D…', designation: 'Sr. Business Analyst',  primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Priya Kapoor',    profile: 95, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1064', name: 'Ananya Deshmukh',  email: 'ananya.deshmukh@enterprise.com',  initials: 'AD', accent: '#f7b84b', department: 'Accounts',              designation: 'Data Analyst',          primaryRole: 'Analyst',           ancillaryRole: null,                    manager: 'Deepa Kulkarni',  profile: 96, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1070', name: 'Anjali Joshi',     email: 'anjali.joshi@enterprise.com',     initials: 'AJ', accent: '#0ea5e9', department: 'Software Testing',      designation: 'Platform Engineer',     primaryRole: 'DevOps Engineer',   ancillaryRole: 'Security Analyst',     manager: 'Atharv Patekar',  profile: 89, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1029', name: 'Atharv Patekar',   email: 'atharv.patekar@enterprise.com',   initials: 'AP', accent: '#e83e8c', department: 'Software Testing',      designation: 'QA Testing Lead II',    primaryRole: 'QA Testing Lead',   ancillaryRole: null,                    manager: 'Rahul Verma',     profile: 86, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1035', name: 'Bhavna Mehta',     email: 'bhavna.mehta@enterprise.com',     initials: 'BM', accent: '#299cdb', department: 'Recruiter',             designation: 'Lead Business Analyst', primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Priya Kapoor',    profile: 86, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1036', name: 'Chirag Reddy',     email: 'chirag.reddy@enterprise.com',     initials: 'CR', accent: '#f06548', department: 'International Sales',   designation: 'Quality Engineer',      primaryRole: 'QA Engineer',       ancillaryRole: null,                    manager: 'Gaurav Jagtap',   profile: 97, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1083', name: 'Dhruv Verma',      email: 'dhruv.verma@enterprise.com',      initials: 'DV', accent: '#405189', department: 'UI/UX Designing',       designation: 'Team Lead II',          primaryRole: 'Team Lead',         ancillaryRole: null,                    manager: 'Parth Lakare',    profile: 91, onboarding: 'Completed', status: 'active',  enabled: true },
  { id: 'EMP-1046', name: 'Divya Desai',      email: 'divya.desai@enterprise.com',      initials: 'DD', accent: '#d63384', department: 'CNS',                   designation: 'Lead Business Analyst', primaryRole: 'Business Analyst',  ancillaryRole: 'Project Coordinator',  manager: 'Atharv Patekar',  profile: 95, onboarding: 'Completed', status: 'active',  enabled: true },
];

// Soft tonal palette for the role pills.
const ROLE_TONES: Record<string, { bg: string; fg: string }> = {
  'Associate':            { bg: '#fdf3d6', fg: '#a06f00' },
  'Training Coordinator': { bg: '#dceefe', fg: '#0c63b0' },
  'Business Analyst':     { bg: '#fde8c4', fg: '#a4661c' },
  'Project Coordinator':  { bg: '#d6f4e3', fg: '#108548' },
  'Analyst':              { bg: '#fde8c4', fg: '#a4661c' },
  'DevOps Engineer':      { bg: '#d3f0ee', fg: '#0a716a' },
  'Security Analyst':     { bg: '#fdd9ea', fg: '#a02960' },
  'QA Testing Lead':      { bg: '#fde8c4', fg: '#a4661c' },
  'QA Engineer':          { bg: '#fde8c4', fg: '#a4661c' },
  'Team Lead':            { bg: '#fdf3d6', fg: '#a06f00' },
};
const tone = (role: string) => ROLE_TONES[role] || { bg: '#eef2f6', fg: '#475569' };

// Reuse the Clients KPI card recipe — gradient strip on top + 44×44 icon box,
// 11px uppercase label, 26px value. Keep gradients distinct per status so the
// 6 tiles read at a glance.
const KPI_CARDS = [
  { key: 'total',          label: 'Total Employees', icon: 'ri-team-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { key: 'active',         label: 'Active',          icon: 'ri-checkbox-circle-fill',gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { key: 'on_leave',       label: 'On Leave',        icon: 'ri-time-line',           gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)' },
  { key: 'high_attention', label: 'High Attention',  icon: 'ri-error-warning-fill',  gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { key: 'probation',      label: 'Probation',       icon: 'ri-shield-check-fill',   gradient: 'linear-gradient(135deg,#0c63b0,#299cdb)' },
  { key: 'inactive',       label: 'Inactive',        icon: 'ri-close-circle-fill',   gradient: 'linear-gradient(135deg,#878a99,#b9bbc6)' },
] as const;

type ExpiryDays = 3 | 7 | 15;

export default function HrEmployees() {
  const [tab, setTab] = useState<'active' | 'disabled'>('active');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'All'>('Active');
  const [deptFilter, setDeptFilter] = useState<string>('All Depts');

  // Onboarding link modal state
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onbName, setOnbName] = useState('');
  const [onbEmail, setOnbEmail] = useState('');
  const [onbDept, setOnbDept] = useState('');
  const [onbDate, setOnbDate] = useState('');
  const [onbExpiry, setOnbExpiry] = useState<ExpiryDays>(15);

  const closeOnboard = () => {
    setOnboardOpen(false);
    setOnbName('');
    setOnbEmail('');
    setOnbDept('');
    setOnbDate('');
    setOnbExpiry(15);
  };

  // Add / Edit employee modal state
  const [empOpen, setEmpOpen] = useState(false);
  const [empMode, setEmpMode] = useState<'add' | 'edit'>('add');
  const [empEditingName, setEmpEditingName] = useState<string>('');
  const [empStep, setEmpStep] = useState<1 | 2 | 3 | 4>(1);
  // Step 1 — Employee Details
  const [eWorkCountry, setEWorkCountry]   = useState('India');
  const [eFirstName, setEFirstName]       = useState('');
  const [eMiddleName, setEMiddleName]     = useState('');
  const [eLastName, setELastName]         = useState('');
  const [eDisplayName, setEDisplayName]   = useState('');
  const [eActualName, setEActualName]     = useState('');
  const [eGender, setEGender]             = useState('');
  const [eDob, setEDob]                   = useState('');
  const [eNationality, setENationality]   = useState('Indian');
  // Step 1 — Contact & Identity
  const [eWorkEmail, setEWorkEmail]       = useState('');
  const [eMobile, setEMobile]             = useState('');
  const [eNumberSeries, setENumberSeries] = useState('Default Number Series');
  const [eEmpId, setEEmpId]               = useState('');
  const [eStatus, setEStatus]             = useState('Active');
  // Step 1 — Address (current + permanent)
  const [eCurAddr1, setECurAddr1]   = useState('');
  const [eCurAddr2, setECurAddr2]   = useState('');
  const [eCurCity, setECurCity]     = useState('');
  const [eCurState, setECurState]   = useState('');
  const [eCurCountry, setECurCountry] = useState('India');
  const [eCurPin, setECurPin]       = useState('');
  const [eSameAsCurrent, setESameAsCurrent] = useState(false);
  const [ePermAddr1, setEPermAddr1] = useState('');
  const [ePermAddr2, setEPermAddr2] = useState('');
  const [ePermCity, setEPermCity]   = useState('');
  const [ePermState, setEPermState] = useState('');
  const [ePermCountry, setEPermCountry] = useState('India');
  const [ePermPin, setEPermPin]     = useState('');

  const resetEmpForm = () => {
    setEmpStep(1);
    setEWorkCountry('India');
    setEFirstName(''); setEMiddleName(''); setELastName('');
    setEDisplayName(''); setEActualName('');
    setEGender(''); setEDob(''); setENationality('Indian');
    setEWorkEmail(''); setEMobile('');
    setENumberSeries('Default Number Series');
    setEEmpId(''); setEStatus('Active');
    setECurAddr1(''); setECurAddr2(''); setECurCity(''); setECurState(''); setECurCountry('India'); setECurPin('');
    setESameAsCurrent(false);
    setEPermAddr1(''); setEPermAddr2(''); setEPermCity(''); setEPermState(''); setEPermCountry('India'); setEPermPin('');
  };

  const closeEmp = () => { setEmpOpen(false); resetEmpForm(); };

  const openAddEmployee = () => {
    resetEmpForm();
    setEmpMode('add');
    setEmpEditingName('');
    setEmpOpen(true);
  };

  const openEditEmployee = (row: EmployeeRow) => {
    resetEmpForm();
    setEmpMode('edit');
    setEmpEditingName(row.name);
    const parts = row.name.split(' ');
    setEFirstName(parts[0] || '');
    setELastName(parts.slice(1).join(' ') || '');
    setEDisplayName(row.name);
    setEActualName(row.name);
    setEWorkEmail(row.email);
    setEEmpId(row.id);
    setEStatus(row.enabled ? 'Active' : 'Inactive');
    setEmpOpen(true);
  };

  // When "Same as Current Address" is checked, mirror the current address.
  const onToggleSameAsCurrent = (checked: boolean) => {
    setESameAsCurrent(checked);
    if (checked) {
      setEPermAddr1(eCurAddr1);
      setEPermAddr2(eCurAddr2);
      setEPermCity(eCurCity);
      setEPermState(eCurState);
      setEPermCountry(eCurCountry);
      setEPermPin(eCurPin);
    }
  };

  const departments = useMemo(
    () => ['All Depts', ...Array.from(new Set(EMPLOYEES.map(e => e.department)))],
    []
  );

  const counts = useMemo(() => ({
    total: EMPLOYEES.length + 72,
    active: EMPLOYEES.filter(e => e.enabled).length + 38,
    on_leave: 2,
    high_attention: 2,
    probation: 3,
    inactive: 6,
    activeTab: 47,
    disabledTab: 34,
  }), []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return EMPLOYEES.filter(e => {
      if (tab === 'active' && !e.enabled) return false;
      if (tab === 'disabled' && e.enabled) return false;
      if (deptFilter !== 'All Depts' && e.department !== deptFilter) return false;
      if (!s) return true;
      return [e.name, e.id, e.department, e.designation, e.primaryRole, e.email]
        .some(v => v.toLowerCase().includes(s));
    });
  }, [q, tab, deptFilter]);

  return (
    <>
      <style>{`
        .hr-employees-surface { background: #ffffff; }
        [data-bs-theme="dark"] .hr-employees-surface { background: #1c2531; }
      `}</style>
      <MasterFormStyles />

      

      <Row>
        <Col xs={12}>
          <div
            className="hr-employees-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── Header row ── */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
              <div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Employee Directory</h5>
                  <span
                    className="badge rounded-pill border border-success text-success text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1"
                  >
                    <span className="bg-success rounded-circle" style={{ width: 6, height: 6 }} />
                    {counts.total} employees · {counts.active} active
                  </span>
                </div>
                <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                  Employee directory, profiles, and employment records
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button
                  onClick={() => setOnboardOpen(true)}
                  className="rounded-pill px-3"
                  style={{
                    background: '#fff',
                    color: 'var(--vz-secondary)',
                    border: '1px solid var(--vz-secondary)',
                    fontWeight: 600,
                  }}
                >
                  <i className="ri-user-add-line align-bottom me-1"></i>Onboarding
                </Button>
                <Button
                  onClick={openAddEmployee}
                  color="secondary"
                  className="btn-label waves-effect waves-light rounded-pill"
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Employee
                </Button>
              </div>
            </div>

            {/* ── KPI cards (Clients-style: gradient strip + icon box) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
                  <div
                    className="hr-employees-surface"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div className="min-w-0">
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          {(counts as any)[k.key].toLocaleString()}
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Tabs (Active / Disabled) ── */}
            <Row className="g-2 mb-3">
              <Col xs={12}>
                <div
                  className="d-flex"
                  style={{
                    background: 'var(--vz-secondary-bg)',
                    border: '1px solid var(--vz-border-color)',
                    borderRadius: 10,
                    padding: 4,
                    gap: 4,
                  }}
                >
                  {[
                    { key: 'active'   as const, label: 'Active Employees',   count: counts.activeTab,   icon: 'ri-user-follow-line' },
                    { key: 'disabled' as const, label: 'Disabled Employees', count: counts.disabledTab, icon: 'ri-user-unfollow-line' },
                  ].map(t => {
                    const on = tab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setTab(t.key)}
                        className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                        style={{
                          borderRadius: 8,
                          padding: '8px 14px',
                          fontSize: 13,
                          background: on ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          border: 'none',
                          boxShadow: on ? '0 4px 12px rgba(124,92,252,0.25)' : 'none',
                        }}
                      >
                        <i className={t.icon} style={{ fontSize: 14 }} />
                        {t.label}
                        <span
                          className="badge rounded-pill"
                          style={{
                            fontSize: 11,
                            background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                            color: on ? '#fff' : 'var(--vz-secondary-color)',
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Col>
            </Row>

            {/* ── Search + Filters (Clients-style row) ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search name, ID, department, role…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
              <Col md={6} sm={12} className="d-flex justify-content-md-end gap-2 flex-wrap align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Status</span>
                  <select
                    className="form-select form-select-sm"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as 'Active' | 'All')}
                    style={{ minWidth: 110, fontSize: 13 }}
                  >
                    <option>Active</option>
                    <option>All</option>
                  </select>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Dept</span>
                  <select
                    className="form-select form-select-sm"
                    value={deptFilter}
                    onChange={e => setDeptFilter(e.target.value)}
                    style={{ minWidth: 150, fontSize: 13 }}
                  >
                    {departments.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </Col>
            </Row>

            {/* ── Table (Clients-style: table-card border rounded + table-light thead) ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <div className="table-responsive table-card border rounded">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col" className="ps-3">Employee</th>
                        <th scope="col">Employee ID</th>
                        <th scope="col">Department</th>
                        <th scope="col">Designation</th>
                        <th scope="col">Primary Role</th>
                        <th scope="col">Ancillary Role</th>
                        <th scope="col">Manager</th>
                        <th scope="col">Profile %</th>
                        <th scope="col">Onboarding</th>
                        <th scope="col" className="text-center pe-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No employees match your filters
                          </td>
                        </tr>
                      ) : filtered.map(e => {
                        const primary = tone(e.primaryRole);
                        const ancillary = e.ancillaryRole ? tone(e.ancillaryRole) : null;
                        return (
                          <tr key={e.id}>
                            <td className="ps-3">
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{
                                    width: 34, height: 34, fontSize: 12,
                                    background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)`,
                                    boxShadow: `0 2px 6px ${e.accent}40`,
                                  }}
                                >
                                  {e.initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="fw-semibold fs-13">{e.name}</div>
                                  <a
                                    href={`mailto:${e.email}`}
                                    className="text-muted text-decoration-none d-inline-flex align-items-center gap-1"
                                    style={{ fontSize: 11.5 }}
                                  >
                                    <i className="ri-mail-line" style={{ fontSize: 12 }} />
                                    <span>{e.email}</span>
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="fw-medium text-primary font-monospace fs-13">{e.id}</span>
                            </td>
                            <td className="fs-13">{e.department}</td>
                            <td className="fs-13">{e.designation}</td>
                            <td>
                              <span
                                className="d-inline-flex align-items-center fw-semibold"
                                style={{
                                  fontSize: 11,
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                  background: primary.bg,
                                  color: primary.fg,
                                }}
                              >
                                {e.primaryRole}
                              </span>
                            </td>
                            <td>
                              {ancillary ? (
                                <span
                                  className="d-inline-flex align-items-center fw-semibold"
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 10px',
                                    borderRadius: 999,
                                    background: ancillary.bg,
                                    color: ancillary.fg,
                                  }}
                                >
                                  {e.ancillaryRole}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="fs-13">{e.manager}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div className="progress flex-grow-1" style={{ height: 5, minWidth: 80, maxWidth: 110, background: 'var(--vz-secondary-bg)', borderRadius: 999 }}>
                                  <div
                                    className="progress-bar bg-success"
                                    style={{ width: `${e.profile}%`, borderRadius: 999 }}
                                  />
                                </div>
                                <span className="fw-bold text-success" style={{ fontSize: 12, minWidth: 32 }}>{e.profile}%</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge rounded-pill border border-success text-success text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1">
                                <span className="bg-success rounded-circle" style={{ width: 6, height: 6 }} />
                                {e.onboarding}
                              </span>
                            </td>
                            <td className="pe-3">
                              <div className="d-flex gap-1 justify-content-center align-items-center">
                                <ActionBtn title="Edit"        icon="ri-pencil-line"      color="info"      onClick={() => openEditEmployee(e)} />
                                <ActionBtn title="Workstation" icon="ri-computer-line"    color="primary"   onClick={() => {}} />
                                <ActionBtn title="Permissions" icon="ri-lock-2-line"      color="warning"   onClick={() => {}} />
                                <ActionBtn title="Documents"   icon="ri-file-text-line"   color="success"   onClick={() => {}} />
                                <ToggleSwitch initial={e.enabled} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer count — matches the rhythm of the Clients table */}
                <div className="d-flex align-items-center justify-content-between mt-3 pt-2 border-top">
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Showing <span className="fw-bold text-body">{filtered.length}</span> of <span className="fw-bold text-body">{EMPLOYEES.length}</span> Results
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {/* ── Generate Onboarding Link modal ── */}
      <Modal
        isOpen={onboardOpen}
        toggle={closeOnboard}
        centered
        size="lg"
        contentClassName="border-0"
      >
        <style>{`
          .onb-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; font-size: 13.5px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; width: 100%; }
          .onb-input::placeholder { color: #9ca3af; }
          .onb-input:focus { outline: none; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
          [data-bs-theme="dark"] .onb-input { background: #1c2531; border-color: var(--vz-border-color); color: var(--vz-body-color); }
          [data-bs-theme="dark"] .onb-input::placeholder { color: var(--vz-secondary-color); }
          .onb-label { font-size: 11px; font-weight: 700; color: #6b7280; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; display: block; }
          [data-bs-theme="dark"] .onb-label { color: var(--vz-secondary-color); }
          .onb-expiry-pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 999px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all .15s ease; background: #fff; border: 1px solid #e5e7eb; color: #6b7280; }
          .onb-expiry-pill:hover { border-color: #c4b5fd; color: #7c5cfc; }
          .onb-expiry-pill.is-active { background: #f5f1ff; border-color: #a78bfa; color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.10); }
          [data-bs-theme="dark"] .onb-expiry-pill { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); color: var(--vz-secondary-color); }
          [data-bs-theme="dark"] .onb-expiry-pill.is-active { background: rgba(124,92,252,0.12); border-color: #a78bfa; color: #c4b5fd; }
        `}</style>

        <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg, #fff)', borderRadius: 'var(--bs-modal-border-radius, 12px)', overflow: 'hidden' }}>
          {/* Header */}
          <div className="d-flex align-items-start justify-content-between" style={{ padding: '22px 24px 16px' }}>
            <div className="d-flex align-items-center gap-3">
              <div
                className="d-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'linear-gradient(135deg,#ede5ff,#dccff8)',
                  boxShadow: '0 4px 12px rgba(124,92,252,0.18)',
                }}
              >
                <i className="ri-link" style={{ fontSize: 20, color: '#7c5cfc' }} />
              </div>
              <div>
                <h5 className="fw-bold mb-1" style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
                  Generate Onboarding Link
                </h5>
                <div className="text-muted" style={{ fontSize: 12.5 }}>
                  Create a secure link for new employee onboarding
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeOnboard}
              aria-label="Close"
              className="btn p-0 d-inline-flex align-items-center justify-content-center"
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--vz-secondary-color)',
              }}
            >
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--vz-border-color)', margin: '0 24px' }} />

          {/* Form body */}
          <div style={{ padding: '20px 24px 8px' }}>
            <Row className="g-3">
              <Col md={6}>
                <label className="onb-label" htmlFor="onb-name">Employee Name <span style={{ color: '#f06548' }}>*</span></label>
                <input
                  id="onb-name"
                  type="text"
                  className="onb-input"
                  placeholder="Full name"
                  value={onbName}
                  onChange={e => setOnbName(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="onb-label" htmlFor="onb-email">Email Address <span style={{ color: '#f06548' }}>*</span></label>
                <input
                  id="onb-email"
                  type="email"
                  className="onb-input"
                  placeholder="name@company.com"
                  value={onbEmail}
                  onChange={e => setOnbEmail(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="onb-label">Department <span style={{ color: '#f06548' }}>*</span></label>
                <MasterSelect
                  value={onbDept}
                  onChange={setOnbDept}
                  placeholder="Select department"
                  options={departments
                    .filter(d => d !== 'All Depts')
                    .map(d => ({ value: d, label: d }))}
                />
              </Col>
              <Col md={6}>
                <label className="onb-label">Expected Joining Date <span style={{ color: '#f06548' }}>*</span></label>
                <MasterDatePicker
                  value={onbDate}
                  onChange={setOnbDate}
                  placeholder="dd-mm-yyyy"
                />
              </Col>
            </Row>

            {/* Link expiry */}
            <div className="mt-3">
              <label className="onb-label">Link Expiry</label>
              <div className="d-flex flex-wrap gap-2">
                {([3, 7, 15] as ExpiryDays[]).map(days => {
                  const active = onbExpiry === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setOnbExpiry(days)}
                      className={`onb-expiry-pill${active ? ' is-active' : ''}`}
                    >
                      <i className="ri-time-line" style={{ fontSize: 13 }} />
                      {days} Days
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer / submit */}
          <div style={{ padding: '16px 24px 22px' }}>
            <button
              type="button"
              className="btn w-100 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
              style={{
                padding: '12px 18px',
                borderRadius: 12,
                fontSize: 14,
                color: '#fff',
                border: 'none',
                background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                boxShadow: '0 8px 20px rgba(124,92,252,0.30)',
              }}
              onClick={() => {
                // TODO: wire to backend — generate signed onboarding link
                closeOnboard();
              }}
            >
              <i className="ri-link" style={{ fontSize: 16 }} />
              Generate Onboarding Link
            </button>
          </div>
        </ModalBody>
      </Modal>

      {/* ── Add / Edit Employee modal (4-step wizard) ── */}
      <Modal
        isOpen={empOpen}
        toggle={closeEmp}
        centered
        size="lg"
        contentClassName="border-0"
        scrollable
      >
        <style>{`
          .emp-input { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; width: 100%; }
          .emp-input::placeholder { color: #9ca3af; }
          .emp-input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
          .emp-input.is-readonly { background: #f5f1ff; border-color: #d6c9ff; color: #5a3fd1; font-weight: 600; }
          [data-bs-theme="dark"] .emp-input { background: #1c2531; border-color: var(--vz-border-color); color: var(--vz-body-color); }
          [data-bs-theme="dark"] .emp-input::placeholder { color: var(--vz-secondary-color); }
          .emp-label { font-size: 10.5px; font-weight: 700; color: #5a3fd1; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 5px; display: block; }
          [data-bs-theme="dark"] .emp-label { color: #c4b5fd; }
          .emp-label .req { color: #f06548; margin-left: 2px; }
          .emp-label .hint { color: #9ca3af; font-weight: 600; text-transform: none; letter-spacing: 0; margin-left: 4px; font-size: 10px; }
          .emp-section {
            background: #fff;
            border: 1px solid #eef0f4;
            border-radius: 12px;
            padding: 16px 18px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.03);
          }
          [data-bs-theme="dark"] .emp-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
          .emp-section + .emp-section { margin-top: 14px; }
          .emp-section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; color: var(--vz-heading-color, var(--vz-body-color)); margin-bottom: 14px; }
          .emp-section-title i { color: #7c5cfc; font-size: 16px; }
          .emp-subsection-title { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #0ab39c; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
          .emp-subsection-title i { font-size: 13px; }
          .emp-stepper-circle {
            width: 32px; height: 32px; border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 13px;
            background: #f1f3f7; color: #9ca3af; border: 2px solid #e5e7eb;
            transition: all .2s ease;
          }
          .emp-stepper-circle.is-active { background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,92,252,0.30); }
          .emp-stepper-circle.is-done { background: #0ab39c; color: #fff; border-color: transparent; }
          .emp-stepper-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #9ca3af; margin-top: 6px; text-align: center; }
          .emp-stepper-label.is-active { color: #5a3fd1; }
          .emp-stepper-label.is-done { color: #0ab39c; }
          .emp-stepper-line { flex: 1; height: 2px; background: #e5e7eb; margin: 0 6px; align-self: flex-start; margin-top: 16px; transition: background .2s ease; }
          .emp-stepper-line.is-done { background: #0ab39c; }
          .emp-select-arrow {
            appearance: none; -webkit-appearance: none; -moz-appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 11px center;
            padding-right: 32px;
          }
        `}</style>

        <ModalBody className="p-0" style={{ background: 'var(--vz-secondary-bg, #f7f8fc)', borderRadius: 'var(--bs-modal-border-radius, 12px)', overflow: 'hidden' }}>
          {/* Gradient header */}
          <div
            style={{
              padding: '18px 22px',
              background: 'linear-gradient(120deg,#5a3fd1 0%,#7c5cfc 55%,#a78bfa 100%)',
              color: '#fff',
              position: 'relative',
            }}
          >
            <div className="d-flex align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
                <div
                  className="d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'rgba(255,255,255,0.18)',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <i className="ri-user-3-line" style={{ fontSize: 20 }} />
                </div>
                <div>
                  <h5 className="fw-bold mb-1 text-white" style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
                    {empMode === 'edit' ? 'Edit Employee' : 'Add Employee'}
                  </h5>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                    {empMode === 'edit'
                      ? `Update details for ${empEditingName || 'this employee'}`
                      : 'Create a new employee record'}
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <span
                  className="badge rounded-pill"
                  style={{
                    background: 'rgba(255,255,255,0.22)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 11,
                    padding: '6px 12px',
                  }}
                >
                  Step {empStep} of 4
                </span>
                <button
                  type="button"
                  onClick={closeEmp}
                  aria-label="Close"
                  className="btn p-0 d-inline-flex align-items-center justify-content-center"
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: 'rgba(255,255,255,0.18)',
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  <i className="ri-close-line" style={{ fontSize: 18 }} />
                </button>
              </div>
            </div>
          </div>

          {/* Stepper */}
          <div style={{ background: '#fff', padding: '16px 28px', borderBottom: '1px solid var(--vz-border-color)' }}>
            <div className="d-flex align-items-start">
              {[
                { n: 1, label: 'Basic Details' },
                { n: 2, label: 'Job Details' },
                { n: 3, label: 'Work Details' },
                { n: 4, label: 'Compensation' },
              ].map((s, idx, arr) => {
                const active = empStep === s.n;
                const done = empStep > s.n;
                return (
                  <div key={s.n} className="d-flex align-items-start" style={{ flex: idx === arr.length - 1 ? '0 0 auto' : '1 1 0' }}>
                    <div className="d-flex flex-column align-items-center" style={{ minWidth: 92 }}>
                      <div className={`emp-stepper-circle${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {done ? <i className="ri-check-line" style={{ fontSize: 16 }} /> : s.n}
                      </div>
                      <div className={`emp-stepper-label${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                        {s.label}
                      </div>
                    </div>
                    {idx < arr.length - 1 && <div className={`emp-stepper-line${done ? ' is-done' : ''}`} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body — scrollable */}
          <div style={{ padding: '18px 22px', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            {empStep === 1 && (
              <>
                {/* Employee Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-user-line" /> Employee Details
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Work Country</label>
                      <MasterSelect value={eWorkCountry} onChange={setEWorkCountry} options={COUNTRY_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">First Name<span className="req">*</span></label>
                      <input className="emp-input" type="text" value={eFirstName} onChange={e => setEFirstName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Middle Name</label>
                      <input className="emp-input" type="text" placeholder="Middle name (optional)" value={eMiddleName} onChange={e => setEMiddleName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Last Name<span className="req">*</span></label>
                      <input className="emp-input" type="text" value={eLastName} onChange={e => setELastName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Display Name<span className="req">*</span></label>
                      <input className="emp-input" type="text" value={eDisplayName} onChange={e => setEDisplayName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Employee Actual Name<span className="req">*</span></label>
                      <input className="emp-input" type="text" value={eActualName} onChange={e => setEActualName(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Gender</label>
                      <MasterSelect value={eGender} onChange={setEGender} placeholder="Select gender" options={GENDER_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Date of Birth<span className="req">*</span></label>
                      <MasterDatePicker value={eDob} onChange={setEDob} placeholder="dd-mm-yyyy" />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Nationality<span className="req">*</span></label>
                      <MasterSelect value={eNationality} onChange={setENationality} options={NATIONALITY_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Contact & Identity */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-mail-line" /> Contact &amp; Identity
                  </div>
                  <Row className="g-3">
                    <Col md={4}>
                      <label className="emp-label">Work Email<span className="req">*</span></label>
                      <input className="emp-input" type="email" value={eWorkEmail} onChange={e => setEWorkEmail(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Mobile Number<span className="req">*</span></label>
                      <input className="emp-input" type="tel" value={eMobile} onChange={e => setEMobile(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Number Series</label>
                      <MasterSelect value={eNumberSeries} onChange={setENumberSeries} options={NUMBER_SERIES_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">
                        Employee ID<span className="hint">(auto-assigned)</span>
                      </label>
                      <input className="emp-input is-readonly" type="text" value={eEmpId} readOnly placeholder="Auto-assigned on save" />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Employee Status</label>
                      <MasterSelect value={eStatus} onChange={setEStatus} options={EMP_STATUS_OPTIONS} />
                    </Col>
                  </Row>
                </div>

                {/* Address Details */}
                <div className="emp-section">
                  <div className="emp-section-title">
                    <i className="ri-map-pin-line" /> Address Details
                  </div>

                  {/* Current address */}
                  <div className="emp-subsection-title">
                    <i className="ri-checkbox-circle-fill" /> Current Address
                  </div>
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <label className="emp-label">Address Line 1<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="House / Flat No., Building, Street" value={eCurAddr1} onChange={e => setECurAddr1(e.target.value)} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Address Line 2</label>
                      <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={eCurAddr2} onChange={e => setECurAddr2(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">City<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="e.g. Pune" value={eCurCity} onChange={e => setECurCity(e.target.value)} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">State<span className="req">*</span></label>
                      <MasterSelect value={eCurState} onChange={setECurState} placeholder="Select state" options={STATE_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Country<span className="req">*</span></label>
                      <MasterSelect value={eCurCountry} onChange={setECurCountry} options={COUNTRY_OPTIONS} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Pincode<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="6-digit pincode" value={eCurPin} onChange={e => setECurPin(e.target.value)} />
                    </Col>
                  </Row>

                  {/* Permanent address */}
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2 mt-2 pt-3" style={{ borderTop: '1px dashed var(--vz-border-color)' }}>
                    <div className="emp-subsection-title mb-0">
                      <i className="ri-checkbox-circle-fill" /> Permanent Address
                    </div>
                    <label className="d-inline-flex align-items-center gap-2 mb-0" style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        className="form-check-input m-0"
                        checked={eSameAsCurrent}
                        onChange={e => onToggleSameAsCurrent(e.target.checked)}
                      />
                      Same as Current Address
                    </label>
                  </div>
                  <Row className="g-3">
                    <Col md={6}>
                      <label className="emp-label">Address Line 1<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="House / Flat No., Building, Street" value={ePermAddr1} onChange={e => setEPermAddr1(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={6}>
                      <label className="emp-label">Address Line 2</label>
                      <input className="emp-input" type="text" placeholder="Area, Locality (optional)" value={ePermAddr2} onChange={e => setEPermAddr2(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">City<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="e.g. Pune" value={ePermCity} onChange={e => setEPermCity(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">State<span className="req">*</span></label>
                      <select className="emp-input emp-select-arrow" value={ePermState} onChange={e => setEPermState(e.target.value)} disabled={eSameAsCurrent}>
                        <option value="">Select state</option>
                        <option>Maharashtra</option>
                        <option>Karnataka</option>
                        <option>Delhi</option>
                        <option>Tamil Nadu</option>
                        <option>Gujarat</option>
                      </select>
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Country<span className="req">*</span></label>
                      <select className="emp-input emp-select-arrow" value={ePermCountry} onChange={e => setEPermCountry(e.target.value)} disabled={eSameAsCurrent}>
                        <option>India</option>
                        <option>United States</option>
                        <option>United Kingdom</option>
                      </select>
                    </Col>
                    <Col md={4}>
                      <label className="emp-label">Pincode<span className="req">*</span></label>
                      <input className="emp-input" type="text" placeholder="6-digit pincode" value={ePermPin} onChange={e => setEPermPin(e.target.value)} disabled={eSameAsCurrent} />
                    </Col>
                  </Row>
                </div>
              </>
            )}

            {empStep > 1 && (
              <div className="emp-section text-center" style={{ padding: '40px 24px' }}>
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                  style={{ width: 56, height: 56, background: 'linear-gradient(135deg,#ede5ff,#dccff8)' }}
                >
                  <i className={
                    empStep === 2 ? 'ri-briefcase-line'
                    : empStep === 3 ? 'ri-building-line'
                    : 'ri-money-dollar-circle-line'
                  } style={{ fontSize: 26, color: '#7c5cfc' }} />
                </div>
                <h6 className="fw-bold mb-1">
                  {empStep === 2 ? 'Job Details' : empStep === 3 ? 'Work Details' : 'Compensation'}
                </h6>
                <p className="text-muted mb-0" style={{ fontSize: 12.5 }}>
                  This step's form will go here. Share the design and I'll wire it up.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="d-flex align-items-center justify-content-between gap-2 flex-wrap"
            style={{
              padding: '14px 22px',
              background: '#fff',
              borderTop: '1px solid var(--vz-border-color)',
            }}
          >
            <button
              type="button"
              onClick={() => setEmpStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
              disabled={empStep === 1}
              className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
              style={{
                fontSize: 13,
                background: '#fff',
                color: empStep === 1 ? '#c4c7d0' : 'var(--vz-secondary-color)',
                border: '1px solid var(--vz-border-color)',
                opacity: empStep === 1 ? 0.6 : 1,
                cursor: empStep === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              <i className="ri-arrow-left-line" /> Previous
            </button>

            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={closeEmp}
                className="btn fw-semibold rounded-pill px-3"
                style={{
                  fontSize: 13,
                  background: '#fff',
                  color: 'var(--vz-secondary-color)',
                  border: '1px solid var(--vz-border-color)',
                }}
              >
                Cancel
              </button>
              {empStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setEmpStep((s) => ((s + 1) as 1 | 2 | 3 | 4))}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                  style={{
                    fontSize: 13,
                    color: '#fff',
                    border: 'none',
                    background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                    boxShadow: '0 6px 16px rgba(124,92,252,0.30)',
                  }}
                >
                  Next <i className="ri-arrow-right-line" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    // TODO: wire to backend — create / update employee
                    closeEmp();
                  }}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                  style={{
                    fontSize: 13,
                    color: '#fff',
                    border: 'none',
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
                    boxShadow: '0 6px 16px rgba(10,179,156,0.30)',
                  }}
                >
                  <i className="ri-check-line" /> {empMode === 'edit' ? 'Save Changes' : 'Create Employee'}
                </button>
              )}
            </div>
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}

// Outline icon-pill action button — same recipe as Clients.tsx ActionBtn so
// the table actions read identically across both pages.
function ActionBtn({
  title, icon, color, onClick, disabled,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        transition: 'all .15s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );
}

// Local toggle — simple, controlled per row. Bound only to mock state for now.
function ToggleSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button
      type="button"
      onClick={() => setOn(v => !v)}
      aria-pressed={on}
      className="btn p-0 border-0 d-inline-flex align-items-center"
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? 'var(--vz-success)' : 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        position: 'relative',
        marginLeft: 4,
      }}
    >
      <span
        style={{
          width: 14, height: 14,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          position: 'absolute',
          top: 2,
          left: on ? 19 : 2,
          transition: 'left .15s ease',
        }}
      />
    </button>
  );
}
