import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Progress } from 'reactstrap';
import api from '../../api';
import { ShimmerProfile } from '../../components/ui/Shimmer';

interface Props {
  branchId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

export default function BranchView({ branchId, onBack, onNavigate }: Props) {
  const [branch, setBranch] = useState<any>(null);
  const [branchUser, setBranchUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/branches/${branchId}`)
      .then(res => {
        setBranch(res.data.branch);
        setBranchUser(res.data.branch_user);
      })
      .finally(() => setLoading(false));
  }, [branchId]);

  if (loading) return <ShimmerProfile />;
  if (!branch) return (
    <div className="text-center py-5">
      <p className="text-muted">Branch not found.</p>
      <Button color="light" onClick={onBack}><i className="ri-arrow-left-line me-1"></i> Back</Button>
    </div>
  );

  // Profile completeness
  const completionFields = [
    branch.name, branch.branch_type, branch.code, branch.industry,
    branch.contact_person, branch.email, branch.phone,
    branch.address, branch.city, branch.state, branch.country, branch.pincode,
    branch.description, branchUser,
  ];
  const filled = completionFields.filter(Boolean).length;
  const completionPct = Math.round((filled / completionFields.length) * 100);
  /* The meter was fixed on danger, so a 93%-complete branch was painted the
     same red as a 10% one — the colour said "something is wrong" about a
     profile that is nearly finished. Tiered like the Profile % meter on the HR
     Employees list, so the colour and the number agree. */
  const completionTone: 'success' | 'info' | 'warning' | 'danger' =
    completionPct >= 90 ? 'success'
      : completionPct >= 75 ? 'info'
        : completionPct >= 60 ? 'warning'
          : 'danger';
  // Resolved after the GRAD_* constants below are declared — see completionGrad
  // where the meter is rendered.

  const location = [branch.city, branch.state, branch.country].filter(Boolean).join(', ');
  const initials = `${branch.name.charAt(0)}${branch.name.split(' ')[1]?.charAt(0) || ''}`.toUpperCase();

  // ── Shared style tokens (mirrors ClientView / Profile palette) ──
  // Background uses var(--vz-card-bg) so the surface flips automatically
  // when the user switches between light and dark themes.
  const cardStyle: React.CSSProperties = {
    borderRadius: 20,
    border: '1px solid var(--vz-border-color)',
    // Blur must stay UNDER the 8px gutter. At the old `0 4px 24px` each card
    // threw a 24px haze into an 8px channel, so both shadows covered the whole
    // gap and met in the middle — the background never showed through and the
    // cards read as one joined slab however exactly the 8px was measured.
    // 6px of blur leaves clean page colour down the centre of every channel.
    boxShadow: '0 4px 14px rgba(64,81,137,0.10), 0 1px 3px rgba(64,81,137,0.06)',
    background: 'var(--vz-card-bg)',
    overflow: 'hidden',
    transition: 'transform .18s ease, box-shadow .18s ease',
  };
  const onCardEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    el.style.transform = 'translateY(-2px)';
    el.style.boxShadow = '0 10px 26px rgba(64,81,137,0.16), 0 2px 6px rgba(64,81,137,0.08)';
  };
  const onCardLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    el.style.transform = 'translateY(0)';
    el.style.boxShadow = '0 4px 14px rgba(64,81,137,0.10), 0 1px 3px rgba(64,81,137,0.06)';
  };

  // Violet: the app's accent, and now the hero's. Navy here left the two
  // largest surfaces on the page disagreeing about what colour this product is.
  const GRAD_PRIMARY = 'linear-gradient(135deg, #5a3fd1 0%, #7c5cfc 100%)';
  const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
  const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
  const GRAD_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
  const GRAD_INFO    = 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)';
  const GRAD_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';

  const completionGrad =
    completionTone === 'success' ? GRAD_SUCCESS
      : completionTone === 'info' ? GRAD_INFO
        : completionTone === 'warning' ? GRAD_WARNING
          : GRAD_DANGER;

  const SectionHeader = ({ title, gradient, icon, action }: { title: string; gradient: string; icon: string; action?: React.ReactNode }) => (
    <div className="d-flex align-items-center gap-2 mb-2">
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

  return (
    <>
      {/* Compact info-table — mirrors ClientView so card spacing & label/value
          density stay consistent across both profile views. */}
      <style>{`
        .bv-info-table { font-size: 13px; line-height: 1.4; }
        .bv-info-table th,
        .bv-info-table td {
          padding: 6px 0;
          vertical-align: baseline;
          border: none;
          background: transparent !important;
        }
        .bv-info-table th {
          width: 1%;
          white-space: nowrap;
          padding-right: 14px !important;
          font-weight: 600;
          color: var(--vz-heading-color, var(--vz-body-color)) !important;
        }
        .bv-info-table td {
          padding-left: 0 !important;
          word-break: break-word;
          color: var(--vz-secondary-color);
        }
        [data-bs-theme="dark"] .bv-info-table td,
        [data-layout-mode="dark"] .bv-info-table td {
          color: rgba(255, 255, 255, 0.78);
        }
        [data-bs-theme="dark"] .bv-info-table th,
        [data-layout-mode="dark"] .bv-info-table th {
          color: rgba(255, 255, 255, 0.94) !important;
        }

        /* ── Card grid ────────────────────────────────────────────────────
           TWO things were fighting the gap here, which is why raising the
           number from 8 to 12 to 20 changed nothing visible.

           1. Three separate .row elements. The space between two rows is not a
              gutter at all — Bootstrap gives a .row margin-top of -(gutter-y)
              and each column +(gutter-y), so stacked rows cancel to ZERO.
              All six cards are now columns of ONE wrapping row, so the gap
              between the Profile/About line and the Info/Contact/Address line
              is the same gutter that separates cards side by side.

           2. app.css zeroes the gutters on any .row that is a DIRECT child of
              .container-fluid, to let full-width list pages sit flush:
                .page-content > .container-fluid > .row { margin: 0 !important }
                .page-content > .container-fluid > .row > [class*=col]
                                                   { padding: 0 !important }
              This page's row IS such a direct child, so the column padding —
              the thing that actually MAKES a horizontal gutter — was being
              deleted, whatever --bs-gutter-x said. Those selectors are (0,3,0)
              and (0,4,0) with !important, so a bare .bv-grid could never win.
              Adding .bv-grid onto the same chain outranks them.

           Row is pulled out by half the gutter and the padding put back on the
           columns, so the OUTER card edges line up exactly with the header
           strip and the hero above — Bootstrap's own arrangement, restored.
           Change the 8px pair (and the two 4px halves, which must stay at
           half the gutter) to move every gap on the page together; nothing
           else here sets spacing. */
        .page-content > .container-fluid > .row.bv-grid {
          --bs-gutter-x: 8px;
          --bs-gutter-y: 8px;
          margin: 0 -4px !important;
        }
        .page-content > .container-fluid > .row.bv-grid > [class*="col"] {
          padding-left: 4px !important;
          padding-right: 4px !important;
          margin-top: 8px !important;
        }

        /* The three tiles inside the About card. Nested, so app.css's
           direct-child rule never reached them and plain gutters work. */
        .bv-grid {
          --bs-gutter-x: 8px;
          --bs-gutter-y: 8px;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
        }
      `}</style>

      {/* ── Page title + back + Edit ── */}
      {/* The house header strip (.frm-cstrip, app.css) — the same opening the
          Branches, Employees and Customers screens use. This page had a plain
          page-title-box, which is why it read as a different product from the
          list it is reached from. */}
      <div className="frm-cstrip mb-2">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-git-branch-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">Branch Profile</div>
            <div className="frm-cstrip-sub">Contact details, address, users and operations for this branch</div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-shrink-0">
          <Button
            color="secondary"
            className="btn-label waves-effect waves-light rounded-pill"
            onClick={() => onNavigate('branch-form', { editId: branchId })}
          >
            <i className="ri-pencil-line label-icon align-middle rounded-pill fs-16 me-2"></i>
            Edit Profile
          </Button>
          <button type="button" className="frm-cstrip-back" onClick={onBack}>
            <i className="ri-arrow-left-line" />
            Back
          </button>
        </div>
      </div>

      {/* ── Hero banner ── */}
      <Card className="overflow-hidden mb-0 border-0" style={{ borderRadius: 20 }}>
        <div
          className="position-relative overflow-hidden"
          style={{
            // Violet, not navy — the app's accent runs through the topbar, the table
            // headers and every primary button, and this banner was the one
            // large surface still on the old blue.
            background: 'linear-gradient(135deg, #5a3fd1 0%, #7c5cfc 55%, #a78bfa 100%)',
            padding: '32px 32px 28px',
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 40%),' +
                'radial-gradient(circle at 85% 80%, rgba(10,179,156,0.22) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <Row className="g-4 align-items-center position-relative flex-nowrap">
            <Col xs="auto">
              {(() => {
                // Profile photo > logo > initials, same priority as ClientView.
                const heroSrc = (branch as any).profile_photo_url || (branch as any).profile_photo || (branch as any).logo;
                return heroSrc ? (
                  <img
                    src={heroSrc}
                    alt=""
                    className="rounded-circle"
                    style={{
                      width: 120, height: 120, objectFit: 'cover',
                      background: '#fff',
                      padding: 4,
                      border: '1px solid rgba(255,255,255,0.3)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                    }}
                  />
                ) : (
                  <div
                    className="rounded-circle fw-bold d-flex align-items-center justify-content-center"
                    style={{
                      width: 110, height: 110, fontSize: 40,
                      background: 'linear-gradient(135deg,rgba(255,255,255,0.28),rgba(255,255,255,0.08))',
                      color: '#fff',
                      border: '3px solid rgba(255,255,255,0.3)',
                      backdropFilter: 'blur(6px)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                    }}
                  >
                    {initials}
                  </div>
                );
              })()}
            </Col>

            <Col className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                <h3 className="text-white mb-0 fw-semibold">{branch.name}</h3>
                <span
                  className="badge rounded-pill text-uppercase fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: branch.status === 'active' ? 'rgba(10,179,156,0.85)' : 'rgba(240,101,72,0.85)',
                    color: '#fff',
                    fontSize: 10,
                    padding: '3px 10px',
                  }}
                >
                  <span className="rounded-circle bg-white" style={{ width: 5, height: 5 }} />
                  {branch.status}
                </span>
              </div>
              <p className="mb-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <i className="ri-git-branch-line align-bottom me-1"></i>
                {branch.branch_type || 'Branch'}
                {branch.industry && <> &middot; {branch.industry}</>}
                {branch.code && <> &middot; <code className="text-white">{branch.code}</code></>}
              </p>
              <div className="d-flex gap-3 flex-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {location && (
                  <div>
                    <i className="ri-map-pin-user-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {location}
                  </div>
                )}
                {branch.phone && (
                  <div>
                    <i className="ri-phone-line me-1 fs-16 align-middle" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                    {branch.phone}
                  </div>
                )}
              </div>
            </Col>

            <Col xs="auto">
              <div className="d-flex align-items-center gap-3">
                <div
                  className="text-center px-3 py-2"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 14,
                    backdropFilter: 'blur(6px)',
                    minWidth: 92,
                  }}
                >
                  <h3 className="text-white mb-0 fw-bold lh-1">{branch.users_count ?? 0}</h3>
                  <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>Users</p>
                </div>
                {/* Departments stat tile removed per request — the
                    branch hero now shows only the Users count. */}
              </div>
            </Col>
          </Row>
        </div>
      </Card>

      {/* ── ROW 1 — Complete Profile (narrow) + About (wide) ── */}
      <Row className="bv-grid align-items-stretch pb-2">
        <Col xxl={4} lg={5}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Complete Branch Profile"
                gradient={completionGrad}
                icon="ri-git-branch-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-secondary rounded-circle"
                    onClick={() => onNavigate('branch-form', { editId: branchId })}
                  >
                    <i className="ri-edit-box-line align-bottom"></i>
                  </button>
                )}
              />
              <Progress
                value={completionPct}
                color={completionTone}
                className="animated-progess custom-progress progress-label"
              >
                <div className="label">{completionPct}%</div>
              </Progress>
              <p className="text-muted fs-12 mb-0 mt-3">
                {completionPct < 100
                  ? `Add the missing details to complete this branch profile.`
                  : `All branch details are filled in.`}
              </p>
            </CardBody>
          </Card>
        </Col>

        <Col xxl={8} lg={7}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="About" gradient={GRAD_PRIMARY} icon="ri-information-line" />
              <p className="text-muted mb-0">
                <strong>{branch.name}</strong> is a {branch.branch_type || 'branch'}
                {branch.industry && <> operating in the <strong>{branch.industry}</strong> sector</>}
                {location && <> based in <strong>{location}</strong></>}.
                Manage contact details, branch user, address and operations from this page.
              </p>

              <Row className="bv-grid">
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_PRIMARY, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}>
                        <i className="ri-git-branch-line" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Branch Type</p>
                      <h6 className="text-truncate mb-0">{branch.branch_type || '—'}</h6>
                    </div>
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(41,156,219,0.06), rgba(95,200,255,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_INFO, boxShadow: '0 4px 10px rgba(41,156,219,0.25)' }}>
                        <i className="ri-hashtag" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Branch Code</p>
                      <h6 className="text-truncate mb-0 font-monospace">{branch.code || '—'}</h6>
                    </div>
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="d-flex align-items-center p-3 h-100" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(247,184,75,0.08), rgba(255,212,122,0.04))', border: '1px solid var(--vz-border-color)' }}>
                    <div className="flex-shrink-0 me-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-circle" style={{ width: 40, height: 40, background: GRAD_WARNING, boxShadow: '0 4px 10px rgba(247,184,75,0.3)' }}>
                        <i className="ri-briefcase-line" style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                    </div>
                    <div className="flex-grow-1 overflow-hidden">
                      <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>Industry</p>
                      <h6 className="text-truncate mb-0">{branch.industry || '—'}</h6>
                    </div>
                  </div>
                </Col>
              </Row>
            </CardBody>
          </Card>
        </Col>



      {/* ── Info + Contact + Address ── */}
        <Col xxl={4} lg={4} md={6}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Info" gradient={GRAD_PRIMARY} icon="ri-information-line" />
              <div className="table-responsive">
                <table className="table table-borderless mb-0 bv-info-table">
                  <tbody>
                    <tr>
                      <th className="ps-0 text-nowrap" scope="row">Name :</th>
                      <td className="text-muted">{branch.name}</td>
                    </tr>
                    {branch.branch_type && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Type :</th>
                        <td className="text-muted">{branch.branch_type}</td>
                      </tr>
                    )}
                    {branch.code && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Code :</th>
                        <td className="text-muted font-monospace">{branch.code}</td>
                      </tr>
                    )}
                    {branch.industry && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Industry :</th>
                        <td className="text-muted">{branch.industry}</td>
                      </tr>
                    )}
                    {location && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Location :</th>
                        <td className="text-muted">{location}</td>
                      </tr>
                    )}
                    {branch.created_at && (
                      <tr>
                        <th className="ps-0 text-nowrap" scope="row">Created :</th>
                        <td className="text-muted">
                          {new Date(branch.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </Col>

        <Col xxl={4} lg={4} md={6}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Contact"
                gradient={GRAD_SUCCESS}
                icon="ri-contacts-book-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-primary rounded-pill"
                    onClick={() => onNavigate('branch-form', { editId: branchId })}
                  >
                    Manage
                  </button>
                )}
              />
              {(branch.contact_person || branch.email || branch.phone) ? (
                <div className="table-responsive">
                  <table className="table table-borderless mb-0 bv-info-table">
                    <tbody>
                      {branch.contact_person && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Contact :</th>
                          <td className="text-muted">{branch.contact_person}</td>
                        </tr>
                      )}
                      {branch.email && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">E-mail :</th>
                          <td className="text-muted">
                            <a href={`mailto:${branch.email}`} className="text-muted text-decoration-none">{branch.email}</a>
                          </td>
                        </tr>
                      )}
                      {branch.phone && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Phone :</th>
                          <td className="text-muted font-monospace">
                            <a href={`tel:${branch.phone}`} className="text-muted text-decoration-none">{branch.phone}</a>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-contacts-book-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No contact info</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xxl={4} lg={4} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Address" gradient={GRAD_INFO} icon="ri-map-pin-line" />
              {(branch.address || branch.city || branch.state) ? (
                <div className="table-responsive">
                  <table className="table table-borderless mb-0 bv-info-table">
                    <tbody>
                      {branch.address && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Street :</th>
                          <td className="text-muted">{branch.address}</td>
                        </tr>
                      )}
                      {branch.city && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">City :</th>
                          <td className="text-muted">{branch.city}</td>
                        </tr>
                      )}
                      {branch.state && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">State :</th>
                          <td className="text-muted">{branch.state}</td>
                        </tr>
                      )}
                      {branch.country && (
                        <tr>
                          <th className="ps-0 text-nowrap" scope="row">Country :</th>
                          <td className="text-muted">{branch.country}</td>
                        </tr>
                      )}
                      {branch.pincode && (
                        <tr>
                          <th className="ps-0" scope="row">Pincode :</th>
                          <td className="text-muted font-monospace">{branch.pincode}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-map-pin-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No address added</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>



      {/* ── Branch User + Description ── */}
        <Col xxl={4} lg={5} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader
                title="Branch User"
                gradient={GRAD_PURPLE}
                icon="ri-user-3-line"
                action={(
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-primary rounded-pill"
                    onClick={() => onNavigate('branch-users', { branchId, branchName: branch.name })}
                  >
                    Manage
                  </button>
                )}
              />
              {branchUser ? (
                <div className="d-flex align-items-center p-3" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(106,90,205,0.05), rgba(167,139,250,0.03))', border: '1px solid var(--vz-border-color)' }}>
                  <div className="flex-shrink-0">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-bold"
                      style={{ width: 42, height: 42, background: GRAD_PURPLE, fontSize: 16, boxShadow: '0 4px 10px rgba(106,90,205,0.25)' }}
                    >
                      {branchUser.name?.charAt(0)?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="flex-grow-1 ms-3 overflow-hidden">
                    <h6 className="mb-1 text-truncate">{branchUser.name}</h6>
                    <p className="text-muted mb-0 text-truncate fs-12">{branchUser.email}</p>
                  </div>
                  <span className={`badge rounded-pill bg-${branchUser.status === 'active' ? 'success' : 'danger'}-subtle text-${branchUser.status === 'active' ? 'success' : 'danger'} text-uppercase`}>
                    {branchUser.status}
                  </span>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-user-3-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No branch user assigned</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xxl={8} lg={7} md={12}>
          <Card className="mb-0 h-100" style={cardStyle} onMouseEnter={onCardEnter} onMouseLeave={onCardLeave}>
            <CardBody>
              <SectionHeader title="Description" gradient={GRAD_WARNING} icon="ri-file-text-line" />
              {branch.description ? (
                <p className="mb-0" style={{ color: 'var(--vz-body-color)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {branch.description}
                </p>
              ) : (
                <div className="text-center py-4">
                  <i className="ri-file-text-line text-muted" style={{ fontSize: 26 }}></i>
                  <p className="text-muted mb-0 mt-2">No description added</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}
