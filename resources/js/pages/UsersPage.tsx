import { Card, CardBody, Col, Row } from 'reactstrap';

export default function UsersPage() {
  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Users</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Users</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Card>
        <CardBody className="text-center py-5">
          <div className="avatar-lg mx-auto mb-3">
            <div className="avatar-title rounded-circle bg-primary-subtle text-primary fs-1">
              <i className="ri-team-line"></i>
            </div>
          </div>
          <h5 className="mb-2">User Management</h5>
          <p className="text-muted mb-0">User management coming soon.</p>
        </CardBody>
      </Card>
    </>
  );
}
