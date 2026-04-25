import { useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input } from 'reactstrap';

interface Employee {
  name: string; dept: string; role: string; join: string;
  salary: string; perf: number; status: 'active' | 'inactive';
  initials: string; accent: string; email?: string;
}

const employees: Employee[] = [
  { name: 'Durgesh Urkude',  dept: 'Sales',     role: 'Sales Manager',     join: '2022-03-15', salary: '₹68,000', perf: 88, status: 'active',   initials: 'DU', accent: '#7c5cfc', email: 'durgesh@igc.com' },
  { name: 'Ankit Bhosale',   dept: 'Purchase',  role: 'Purchase Manager',  join: '2021-07-20', salary: '₹62,000', perf: 82, status: 'active',   initials: 'AB', accent: '#0ab39c', email: 'ankit@igc.com' },
  { name: 'Priti Shende',    dept: 'Accounts',  role: 'Accounts Manager',  join: '2020-11-01', salary: '₹58,000', perf: 91, status: 'active',   initials: 'PS', accent: '#0ea5e9', email: 'priti@igc.com' },
  { name: 'Sandeep Kadu',    dept: 'Logistics', role: 'Logistics Manager', join: '2023-01-10', salary: '₹55,000', perf: 79, status: 'active',   initials: 'SK', accent: '#f59e0b', email: 'sandeep@igc.com' },
  { name: 'Rohit Nagpure',   dept: 'Sales',     role: 'Sales Executive',   join: '2023-06-05', salary: '₹38,000', perf: 74, status: 'active',   initials: 'RN', accent: '#8b5cf6', email: 'rohit@igc.com' },
  { name: 'Pooja Lokhande',  dept: 'HR',        role: 'Intern',            join: '2024-02-01', salary: '₹18,000', perf: 65, status: 'inactive', initials: 'PL', accent: '#f06548', email: 'pooja@igc.com' },
];

export default function Employees() {
  const [q, setQ] = useState('');

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter(e => e.status === 'active').length;
    return { total, active, inactive: total - active };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter(e =>
      [e.name, e.dept, e.role, e.email].filter(Boolean).some(v => v!.toLowerCase().includes(s))
    );
  }, [q]);

  const KPI_CARDS = [
    { label: 'Total Employees',    value: stats.total,    icon: 'ri-team-line',          gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active Employees',   value: stats.active,   icon: 'ri-user-follow-line',   gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Inactive Employees', value: stats.inactive, icon: 'ri-user-unfollow-line', gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  ];

  return (
    <>
      {/* Page title row — matches Branches */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Employees</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Admin</a></li>
                <li className="breadcrumb-item active">Employees</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          {/* Outer surface card — same as Branches */}
          <div
            className="branches-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── KPI cards ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={4} sm={6} xs={12}>
                  <div
                    className="branches-surface"
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
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          {k.value.toLocaleString()}
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

            {/* ── Search + Export + Add Employee ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={6} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by name, role, department, email..."
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
              <Col md={6} sm={12} className="d-flex justify-content-md-end gap-2 flex-wrap">
                <Button
                  className="rounded-pill px-3"
                  style={{
                    background: '#fff',
                    color: 'var(--vz-secondary)',
                    border: '1px solid var(--vz-secondary)',
                    fontWeight: 600,
                  }}
                >
                  <i className="ri-download-2-line align-bottom me-1"></i>Export
                </Button>
                <Button
                  color="secondary"
                  className="btn-label waves-effect waves-light rounded-pill"
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Employee
                </Button>
              </Col>
            </Row>

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <div className="table-responsive">
                  <table className="table align-middle table-hover mb-0" style={{ fontSize: 13 }}>
                    <thead style={{ background: 'var(--vz-secondary-bg)' }}>
                      <tr style={{ fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        <th className="ps-3" style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>#</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Employee</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Role &amp; Department</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Joining</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Salary</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Performance</th>
                        <th style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Status</th>
                        <th className="text-end pe-3" style={{ fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No employees match "{q}"
                          </td>
                        </tr>
                      ) : filtered.map((e, idx) => {
                        const perfColor = e.perf >= 85 ? '#0ab39c' : e.perf >= 75 ? '#f59e0b' : '#f06548';
                        const isActive = e.status === 'active';
                        return (
                          <tr key={e.name}>
                            <td className="ps-3 text-muted" style={{ fontSize: 12, fontWeight: 500 }}>
                              {idx + 1}
                            </td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                                  style={{
                                    width: 36, height: 36,
                                    background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)`,
                                    color: '#fff',
                                    fontSize: 11.5,
                                    boxShadow: `0 4px 10px ${e.accent}55, inset 0 1px 0 rgba(255,255,255,0.22)`,
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  {e.initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="fw-semibold text-truncate" style={{ fontSize: 13.5 }}>{e.name}</div>
                                  {e.email && (
                                    <a
                                      href={`mailto:${e.email}`}
                                      className="text-muted text-decoration-none d-inline-flex align-items-center gap-1 text-truncate"
                                      style={{ fontSize: 11.5, maxWidth: 220 }}
                                      title={e.email}
                                    >
                                      <i className="ri-mail-line" style={{ fontSize: 12 }} />
                                      <span className="text-truncate">{e.email}</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="fw-semibold" style={{ fontSize: 13 }}>{e.role}</div>
                              <div className="text-muted" style={{ fontSize: 11.5 }}>{e.dept}</div>
                            </td>
                            <td className="text-muted" style={{ fontSize: 12.5 }}>
                              <i className="ri-calendar-line me-1" style={{ fontSize: 13 }} />
                              {e.join}
                            </td>
                            <td className="fw-bold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 13.5 }}>
                              {e.salary}
                            </td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div className="progress" style={{ width: 90, height: 6, background: `${perfColor}22`, borderRadius: 999 }}>
                                  <div
                                    className="progress-bar"
                                    style={{ width: `${e.perf}%`, background: perfColor, borderRadius: 999 }}
                                  />
                                </div>
                                <span className="fw-bold" style={{ fontSize: 12, color: perfColor, minWidth: 32 }}>{e.perf}%</span>
                              </div>
                            </td>
                            <td>
                              {/* Plain span instead of <Badge> so Bootstrap's .badge styling
                                  can't override the inline colors (was rendering violet). */}
                              <span
                                className="d-inline-flex align-items-center gap-1 fw-bold text-uppercase"
                                style={{
                                  fontSize: 9.5,
                                  padding: '4px 10px',
                                  letterSpacing: '0.07em',
                                  borderRadius: 999,
                                  background: isActive ? 'rgba(10,179,156,0.16)' : 'rgba(240,101,72,0.14)',
                                  color: isActive ? '#0ab39c' : '#f06548',
                                  border: `1px solid ${isActive ? 'rgba(10,179,156,0.32)' : 'rgba(240,101,72,0.30)'}`,
                                }}
                              >
                                <span
                                  className="rounded-circle"
                                  style={{
                                    width: 5, height: 5,
                                    background: isActive ? '#0ab39c' : '#f06548',
                                    display: 'inline-block',
                                  }}
                                />
                                {e.status}
                              </span>
                            </td>
                            <td className="pe-3">
                              <div className="d-flex gap-1 justify-content-end">
                                {[
                                  { icon: 'ri-eye-line',          color: '#0ea5e9', label: 'View' },
                                  { icon: 'ri-pencil-line',       color: '#7c5cfc', label: 'Edit' },
                                  { icon: 'ri-file-text-line',    color: '#0ab39c', label: 'Documents' },
                                  { icon: 'ri-delete-bin-5-line', color: '#f06548', label: 'Delete' },
                                ].map(b => (
                                  <button
                                    key={b.label}
                                    type="button"
                                    title={b.label}
                                    className="btn p-0 d-inline-flex align-items-center justify-content-center"
                                    style={{
                                      width: 28, height: 28,
                                      borderRadius: 7,
                                      background: `${b.color}14`,
                                      border: `1px solid ${b.color}26`,
                                      color: b.color,
                                      fontSize: 14,
                                      transition: 'all .15s ease',
                                    }}
                                    onMouseEnter={ev => {
                                      const el = ev.currentTarget;
                                      el.style.background = b.color;
                                      el.style.color = '#fff';
                                      el.style.borderColor = b.color;
                                    }}
                                    onMouseLeave={ev => {
                                      const el = ev.currentTarget;
                                      el.style.background = `${b.color}14`;
                                      el.style.color = b.color;
                                      el.style.borderColor = `${b.color}26`;
                                    }}
                                  >
                                    <i className={b.icon} />
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer count */}
                <div className="d-flex align-items-center justify-content-between mt-3 pt-2 border-top">
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Showing <span className="fw-bold text-body">{filtered.length}</span> of <span className="fw-bold text-body">{employees.length}</span> Results
                  </div>
                  <div className="d-flex gap-1">
                    <button className="btn btn-light btn-sm" disabled style={{ fontSize: 12 }}>
                      <i className="ri-arrow-left-s-line" />
                    </button>
                    <button className="btn btn-primary btn-sm fw-bold" style={{ fontSize: 12, minWidth: 32 }}>1</button>
                    <button className="btn btn-light btn-sm" disabled style={{ fontSize: 12 }}>
                      <i className="ri-arrow-right-s-line" />
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>
    </>
  );
}
