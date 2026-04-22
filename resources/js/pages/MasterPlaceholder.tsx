import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, InputGroup, InputGroupText } from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import { MASTER_GROUPS } from '../constants';

// Remix icon lookup for lucide names used in constants.ts
const ICONS: Record<string, string> = {
  Building: 'ri-building-4-line', Landmark: 'ri-bank-line', Building2: 'ri-building-line',
  UserCog: 'ri-user-settings-line', BadgeCheck: 'ri-verified-badge-line',
  Globe2: 'ri-earth-line', Map: 'ri-map-2-line', Hash: 'ri-hashtag',
  Home: 'ri-home-line', Anchor: 'ri-anchor-line', Ship: 'ri-ship-line',
  Target: 'ri-focus-3-line', Binary: 'ri-file-code-line', Percent: 'ri-percent-line',
  DollarSign: 'ri-money-dollar-circle-line', Ruler: 'ri-ruler-line', Package: 'ri-box-3-line',
  Leaf: 'ri-leaf-line', Handshake: 'ri-handshake-line',
  UserSquare: 'ri-user-3-line', Award: 'ri-award-line', Store: 'ri-store-2-line',
  Activity: 'ri-pulse-line', Users2: 'ri-team-fill',
  FileBadge: 'ri-file-shield-2-line', Zap: 'ri-flashlight-line',
  FileText: 'ri-file-text-line', AlertTriangle: 'ri-alert-line', Scale: 'ri-scales-3-line',
  Briefcase: 'ri-briefcase-4-line', Tags: 'ri-price-tag-3-line',
  CalendarDays: 'ri-calendar-line', ShieldCheck: 'ri-shield-check-line', Boxes: 'ri-stack-line',
  Tag: 'ri-price-tag-line', AlertOctagon: 'ri-error-warning-line',
  GitCompare: 'ri-git-commit-line', CreditCard: 'ri-bank-card-line',
  Repeat: 'ri-refresh-line', ToggleRight: 'ri-toggle-line', BookUser: 'ri-contacts-book-line',
  Warehouse: 'ri-building-2-line', Grid3x3: 'ri-grid-line', Layers: 'ri-stack-line',
  Thermometer: 'ri-temp-cold-line', Rows3: 'ri-layout-row-line', Rows4: 'ri-layout-grid-line',
  Monitor: 'ri-computer-line', Snowflake: 'ri-snowy-line',
  IdCard: 'ri-profile-line', Globe: 'ri-global-line', TrendingUp: 'ri-line-chart-line',
  Users: 'ri-team-line', Wrench: 'ri-tools-line',
};
const resolve = (name?: string) => (name && ICONS[name]) || 'ri-file-list-3-line';

export default function MasterPlaceholder() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const fullSlug = slug ? `master.${slug}` : '';

  let leafLabel = slug || 'Master';
  let leafIcon: string | undefined;
  let groupLabel = '';
  let groupIcon: string | undefined;
  let groupId = '';

  for (const g of MASTER_GROUPS) {
    const found = g.children.find(c => c.id === fullSlug);
    if (found) {
      leafLabel = found.label;
      leafIcon = found.icon;
      groupLabel = g.label;
      groupIcon = g.icon;
      groupId = g.id;
      break;
    }
  }

  const isSuperAdmin = user?.user_type === 'super_admin';
  const p = user?.permissions?.[fullSlug];
  const caps = {
    view: isSuperAdmin || !!p?.can_view,
    add: isSuperAdmin || !!p?.can_add,
    edit: isSuperAdmin || !!p?.can_edit,
    delete: isSuperAdmin || !!p?.can_delete,
    export: isSuperAdmin || !!p?.can_export,
    import: isSuperAdmin || !!p?.can_import,
    approve: isSuperAdmin || !!p?.can_approve,
  };

  return (
    <>
      {/* Breadcrumb */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <div>
              <h4 className="mb-sm-0 d-flex align-items-center gap-2">
                <i className={`${resolve(leafIcon)} text-primary`}></i>
                {leafLabel}
              </h4>
              <div className="text-muted mt-1 fs-12 d-flex align-items-center gap-1">
                <i className={resolve(groupIcon)} style={{ fontSize: 11 }}></i>
                <span>{groupLabel}</span>
              </div>
            </div>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#" onClick={(e) => { e.preventDefault(); navigate('/master'); }}>Master</a></li>
                {groupLabel && <li className="breadcrumb-item">{groupLabel}</li>}
                <li className="breadcrumb-item active">{leafLabel}</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card className="shadow-sm">
            {/* Toolbar */}
            <CardHeader className="bg-light-subtle border-bottom">
              <Row className="g-2 align-items-center">
                <Col md={5}>
                  <InputGroup>
                    <InputGroupText className="bg-body"><i className="ri-search-line"></i></InputGroupText>
                    <Input placeholder={`Search in ${leafLabel}…`} disabled />
                  </InputGroup>
                </Col>
                <Col md={3}>
                  <Input type="select" disabled>
                    <option>All status</option>
                    <option>Active</option>
                    <option>Inactive</option>
                  </Input>
                </Col>
                <Col md={4} className="text-md-end d-flex gap-2 justify-content-md-end">
                  {caps.import && (
                    <Button color="soft-secondary" size="sm" disabled>
                      <i className="ri-upload-2-line me-1"></i>Import
                    </Button>
                  )}
                  {caps.export && (
                    <Button color="soft-primary" size="sm" disabled>
                      <i className="ri-download-2-line me-1"></i>Export
                    </Button>
                  )}
                  {caps.add && (
                    <Button color="primary" size="sm" disabled>
                      <i className="ri-add-line me-1"></i>Add {leafLabel}
                    </Button>
                  )}
                </Col>
              </Row>
            </CardHeader>

            {/* Quick stats */}
            <CardBody className="border-bottom bg-light-subtle py-3">
              <Row className="g-3">
                <Col sm={3} xs={6}>
                  <div className="d-flex align-items-center gap-2">
                    <div className="avatar-xs flex-shrink-0">
                      <span className="avatar-title rounded bg-primary-subtle text-primary">
                        <i className="ri-stack-line"></i>
                      </span>
                    </div>
                    <div>
                      <div className="fs-10 fw-bold text-muted text-uppercase">Total</div>
                      <div className="fs-16 fw-bold">0</div>
                    </div>
                  </div>
                </Col>
                <Col sm={3} xs={6}>
                  <div className="d-flex align-items-center gap-2">
                    <div className="avatar-xs flex-shrink-0">
                      <span className="avatar-title rounded bg-success-subtle text-success">
                        <i className="ri-checkbox-circle-line"></i>
                      </span>
                    </div>
                    <div>
                      <div className="fs-10 fw-bold text-muted text-uppercase">Active</div>
                      <div className="fs-16 fw-bold text-success">0</div>
                    </div>
                  </div>
                </Col>
                <Col sm={3} xs={6}>
                  <div className="d-flex align-items-center gap-2">
                    <div className="avatar-xs flex-shrink-0">
                      <span className="avatar-title rounded bg-danger-subtle text-danger">
                        <i className="ri-pause-circle-line"></i>
                      </span>
                    </div>
                    <div>
                      <div className="fs-10 fw-bold text-muted text-uppercase">Inactive</div>
                      <div className="fs-16 fw-bold text-danger">0</div>
                    </div>
                  </div>
                </Col>
                <Col sm={3} xs={6}>
                  <div className="d-flex align-items-center gap-2">
                    <div className="avatar-xs flex-shrink-0">
                      <span className="avatar-title rounded bg-warning-subtle text-warning">
                        <i className="ri-time-line"></i>
                      </span>
                    </div>
                    <div>
                      <div className="fs-10 fw-bold text-muted text-uppercase">Pending</div>
                      <div className="fs-16 fw-bold text-warning">0</div>
                    </div>
                  </div>
                </Col>
              </Row>
            </CardBody>

            {/* Empty state */}
            <CardBody className="text-center py-5">
              <div className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary"
                   style={{ width: 88, height: 88 }}>
                <i className={`${resolve(leafIcon)} fs-36`}></i>
              </div>
              <h4 className="fw-bold mb-2">{leafLabel}</h4>
              <Badge color="info-subtle" className="text-info fs-11 rounded-pill px-3 py-2 mb-3">
                <i className="ri-time-line me-1"></i> Coming Soon — Phase 2
              </Badge>
              <p className="text-muted mx-auto mb-4" style={{ maxWidth: 520, lineHeight: 1.7 }}>
                This master is wired up in the permission system and ready to be activated.
                The full CRUD sheet (add, edit, delete, import/export, audit log, approvals)
                rolls out in the next phase.
              </p>

              <Row className="justify-content-center">
                <Col md={6} lg={5}>
                  <div className="bg-light rounded p-3 text-start">
                    <div className="fs-11 fw-bold text-uppercase text-muted mb-2">
                      <i className="ri-information-line me-1"></i>Module Info
                    </div>
                    <div className="d-flex gap-2 align-items-center mb-2">
                      <i className="ri-file-code-line text-muted"></i>
                      <span className="fs-12">Slug: <code className="text-primary">{fullSlug}</code></span>
                    </div>
                    <div className="d-flex gap-2 align-items-center mb-2">
                      <i className="ri-folder-2-line text-muted"></i>
                      <span className="fs-12">Category: <strong>{groupLabel}</strong></span>
                    </div>
                    <div className="d-flex gap-2 align-items-center mb-2">
                      <i className="ri-shield-user-line text-muted"></i>
                      <span className="fs-12">
                        Access:{' '}
                        {isSuperAdmin ? (
                          <Badge color="success-subtle" className="text-success">Super Admin (full)</Badge>
                        ) : p ? (
                          <Badge color="primary-subtle" className="text-primary">Granted</Badge>
                        ) : (
                          <Badge color="secondary-subtle" className="text-secondary">Default</Badge>
                        )}
                      </span>
                    </div>

                    <div className="mt-2">
                      <div className="fs-10 fw-bold text-uppercase text-muted mb-1">Your Capabilities</div>
                      <div className="d-flex flex-wrap gap-1">
                        {Object.entries(caps).map(([k, v]) => (
                          <Badge
                            key={k}
                            color={v ? 'success-subtle' : 'light'}
                            className={`${v ? 'text-success' : 'text-muted'} fs-10 rounded-pill text-uppercase`}
                          >
                            <i className={`${v ? 'ri-check-line' : 'ri-close-line'} me-1`}></i>
                            {k}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </Col>
              </Row>

              <div className="mt-4 d-flex gap-2 justify-content-center">
                <Button color="light" onClick={() => navigate('/master')}>
                  <i className="ri-arrow-left-line me-1"></i>Back to Master
                </Button>
                {groupId && (
                  <Button color="soft-primary" onClick={() => navigate('/master')}>
                    <i className={`${resolve(groupIcon)} me-1`}></i>Browse {groupLabel}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
