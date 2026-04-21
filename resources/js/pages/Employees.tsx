import { Card, CardBody, CardHeader, Col, Row, Badge, Button } from 'reactstrap';

const employees = [
  { name: 'Durgesh Urkude',  dept: 'Sales',     role: 'Sales Manager',     join: '2022-03-15', salary: '₹68,000', perf: 88, status: 'active',   initials: 'DU', color: 'primary' },
  { name: 'Ankit Bhosale',   dept: 'Purchase',  role: 'Purchase Manager',  join: '2021-07-20', salary: '₹62,000', perf: 82, status: 'active',   initials: 'AB', color: 'success' },
  { name: 'Priti Shende',    dept: 'Accounts',  role: 'Accounts Manager',  join: '2020-11-01', salary: '₹58,000', perf: 91, status: 'active',   initials: 'PS', color: 'info' },
  { name: 'Sandeep Kadu',    dept: 'Logistics', role: 'Logistics Manager', join: '2023-01-10', salary: '₹55,000', perf: 79, status: 'active',   initials: 'SK', color: 'warning' },
  { name: 'Rohit Nagpure',   dept: 'Sales',     role: 'Sales Executive',   join: '2023-06-05', salary: '₹38,000', perf: 74, status: 'active',   initials: 'RN', color: 'primary' },
  { name: 'Pooja Lokhande',  dept: 'HR',        role: 'Intern',            join: '2024-02-01', salary: '₹18,000', perf: 65, status: 'inactive', initials: 'PL', color: 'danger' },
];

export default function Employees() {
  const active = employees.filter(e => e.status === 'active').length;

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Employees</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Employees</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col md={4} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Total</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">{employees.length}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-primary-subtle text-primary fs-3"><i className="ri-team-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={4} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Active</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">{active}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-success-subtle text-success fs-3"><i className="ri-user-follow-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={4} sm={6}>
          <Card className="card-animate">
            <CardBody>
              <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">Inactive</p>
              <div className="d-flex align-items-end justify-content-between mt-3">
                <h4 className="fs-22 fw-semibold mb-0">{employees.length - active}</h4>
                <div className="avatar-sm"><span className="avatar-title rounded bg-danger-subtle text-danger fs-3"><i className="ri-user-unfollow-line"></i></span></div>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Card>
        <CardHeader className="d-flex align-items-center justify-content-between">
          <h5 className="card-title mb-0">Employee Directory</h5>
          <div className="d-flex gap-2">
            <Button color="light"><i className="ri-download-2-line me-1"></i>Export</Button>
            <Button color="success"><i className="ri-add-line me-1"></i>Add Employee</Button>
          </div>
        </CardHeader>
        <CardBody>
          <div className="table-responsive table-card">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>Employee</th><th>Department</th><th>Role</th>
                  <th>Joining</th><th>Salary</th><th>Performance</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(e => {
                  const perfColor = e.perf >= 85 ? 'success' : e.perf >= 75 ? 'warning' : 'danger';
                  return (
                    <tr key={e.name}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className={`avatar-xs rounded-circle bg-${e.color} text-white d-flex align-items-center justify-content-center fw-bold`} style={{ fontSize: 10 }}>
                            {e.initials}
                          </div>
                          <span className="fw-semibold">{e.name}</span>
                        </div>
                      </td>
                      <td>{e.dept}</td>
                      <td>{e.role}</td>
                      <td className="text-muted">{e.join}</td>
                      <td className="fw-bold">{e.salary}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="progress" style={{ width: 80, height: 6 }}>
                            <div className={`progress-bar bg-${perfColor}`} style={{ width: `${e.perf}%` }} />
                          </div>
                          <span className={`fw-bold fs-12 text-${perfColor}`}>{e.perf}%</span>
                        </div>
                      </td>
                      <td><Badge color={e.status === 'active' ? 'success' : 'secondary'} pill className="text-uppercase">{e.status}</Badge></td>
                      <td>
                        <div className="d-flex gap-1">
                          <button className="btn btn-sm btn-soft-info"><i className="ri-eye-fill"></i></button>
                          <button className="btn btn-sm btn-soft-primary"><i className="ri-pencil-fill"></i></button>
                          <button className="btn btn-sm btn-soft-success"><i className="ri-file-text-fill"></i></button>
                          <button className="btn btn-sm btn-soft-danger"><i className="ri-delete-bin-5-fill"></i></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
