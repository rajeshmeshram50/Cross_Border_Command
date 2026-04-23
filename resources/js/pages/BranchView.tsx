import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner } from 'reactstrap';
import api from '../api';

interface Props {
  branchId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

/**
 * BranchView — single-view page for a branch, designed to mirror ClientView.
 *   - Back pill + page title + Edit Profile action
 *   - Hero banner (gradient) with branch avatar, name, status, key stats
 *   - Detail cards: Overview (contact), Address, Location tags
 */
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

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;
  if (!branch) return (
    <div className="text-center py-5">
      <p className="text-muted">Branch not found.</p>
      <Button color="light" onClick={onBack}><i className="ri-arrow-left-line me-1"></i> Back</Button>
    </div>
  );

  const location = [branch.city, branch.state, branch.country].filter(Boolean).join(', ');
  const initials = `${branch.name.charAt(0)}${branch.name.split(' ')[1]?.charAt(0) || ''}`.toUpperCase();

  return (
    <>
      {/* ── Page title + back + Edit ── */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0 d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-soft-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
                style={{ width: 32, height: 32 }}
                onClick={onBack}
              >
                <i className="ri-arrow-left-line"></i>
              </button>
              Branch Profile
            </h4>
            <div className="page-title-right">
              <Button
                color="secondary"
                className="btn-label waves-effect waves-light rounded-pill"
                onClick={() => onNavigate('branch-form', { editId: branchId })}
              >
                <i className="ri-pencil-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Edit Profile
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── Hero banner (gradient cover) ── */}
      <Card className="overflow-hidden mb-3 border-0" style={{ borderRadius: 20 }}>
        <div
          className="position-relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #405189 0%, #4a63a8 45%, #6691e7 100%)',
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
            </Col>

            <Col className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                <h3 className="text-white mb-0 fw-semibold">{branch.name}</h3>
                {branch.is_main && (
                  <span
                    className="badge rounded-pill text-uppercase fw-semibold d-inline-flex align-items-center gap-1"
                    style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 10, padding: '3px 10px' }}
                  >
                    <i className="ri-star-fill" style={{ color: '#ffd47a' }} />
                    Main Branch
                  </span>
                )}
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
                <HeroStat label="Users"       value={branch.users_count ?? 0} />
                <HeroStat label="Departments" value={branch.departments_count ?? 0} />
              </div>
            </Col>
          </Row>
        </div>
      </Card>

      {/* ── Detail cards ── */}
      <Row className="g-3">
        {/* Contact card */}
        <Col lg={6}>
          <SectionCard
            icon="ri-contacts-book-line"
            label="Contact"
            color="#405189"
            manageLabel="Manage"
            onManage={() => onNavigate('branch-form', { editId: branchId })}
          >
            {(branch.contact_person || branch.email || branch.phone) ? (
              <div className="d-flex flex-column gap-1" style={{ fontSize: 13 }}>
                {branch.contact_person && (
                  <div className="d-flex align-items-center gap-2">
                    <i className="ri-user-3-line text-muted" />
                    <span className="fw-medium" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                      {branch.contact_person}
                    </span>
                  </div>
                )}
                {branch.email && (
                  <div className="d-flex align-items-center gap-2">
                    <i className="ri-mail-line text-muted" />
                    <a href={`mailto:${branch.email}`} className="text-body text-decoration-none">{branch.email}</a>
                  </div>
                )}
                {branch.phone && (
                  <div className="d-flex align-items-center gap-2">
                    <i className="ri-phone-line text-muted" />
                    <a href={`tel:${branch.phone}`} className="text-body text-decoration-none font-monospace">{branch.phone}</a>
                  </div>
                )}
              </div>
            ) : <EmptyState icon="ri-contacts-book-line" text="No contact info" />}
          </SectionCard>
        </Col>

        {/* Branch User card */}
        <Col lg={6}>
          <SectionCard
            icon="ri-user-3-line"
            label="Branch User"
            color="#405189"
            manageLabel="Manage"
            onManage={() => onNavigate('branch-users', { branchId, branchName: branch.name })}
          >
            {branchUser ? (
              <div
                className="d-flex align-items-center gap-2 p-2 rounded-2"
                style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
              >
                <div
                  className="rounded-2 d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                  style={{ width: 32, height: 32, fontSize: 12, background: 'linear-gradient(135deg,#405189,#6691e7)' }}
                >
                  {branchUser.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div className="flex-grow-1 min-w-0">
                  <div className="text-truncate fw-semibold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 12 }}>{branchUser.name}</div>
                  <div className="text-truncate" style={{ color: 'var(--vz-secondary-color)', fontSize: 10.5 }}>{branchUser.email}</div>
                </div>
                <span
                  className={`badge rounded-pill border text-uppercase fw-semibold px-2 py-1 d-inline-flex align-items-center gap-1 border-${branchUser.status === 'active' ? 'success' : 'danger'} text-${branchUser.status === 'active' ? 'success' : 'danger'}`}
                  style={{ fontSize: 9 }}
                >
                  <span className={`bg-${branchUser.status === 'active' ? 'success' : 'danger'} rounded-circle`} style={{ width: 5, height: 5 }} />
                  {branchUser.status}
                </span>
              </div>
            ) : <EmptyState icon="ri-user-3-line" text="No branch user assigned" />}
          </SectionCard>
        </Col>

        {/* Address card */}
        <Col lg={12}>
          <SectionCard icon="ri-map-pin-2-line" label="Address" color="#405189">
            {(branch.address || branch.city || branch.state || branch.country || branch.pincode) ? (
              <div className="d-flex flex-column gap-1" style={{ fontSize: 13, color: 'var(--vz-body-color)' }}>
                {branch.address && <div>{branch.address}</div>}
                <div className="d-flex gap-2 flex-wrap">
                  {branch.city    && <Chip icon="ri-building-line"   text={branch.city} />}
                  {branch.state   && <Chip icon="ri-map-2-line"      text={branch.state} />}
                  {branch.country && <Chip icon="ri-earth-line"      text={branch.country} />}
                  {branch.pincode && <Chip icon="ri-hashtag"         text={branch.pincode} mono />}
                </div>
              </div>
            ) : <EmptyState icon="ri-map-pin-2-line" text="No address on file" />}
          </SectionCard>
        </Col>

        {/* Description */}
        {branch.description && (
          <Col lg={12}>
            <SectionCard icon="ri-file-text-line" label="Description" color="#405189">
              <p className="mb-0" style={{ color: 'var(--vz-body-color)', fontSize: 13, lineHeight: 1.55 }}>
                {branch.description}
              </p>
            </SectionCard>
          </Col>
        )}
      </Row>
    </>
  );
}

/* ──────────────── Helpers ──────────────── */

function HeroStat({ label, value }: { label: string; value: number | string }) {
  return (
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
      <h3 className="text-white mb-0 fw-bold lh-1">{value}</h3>
      <p className="fs-12 mb-0 mt-1 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.05em' }}>
        {label}
      </p>
    </div>
  );
}

function SectionCard({
  icon, label, color, manageLabel, onManage, children,
}: {
  icon: string;
  label: string;
  color: string;
  manageLabel?: string;
  onManage?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-100 border-0 shadow-sm" style={{ borderRadius: 14 }}>
      <CardBody>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
              style={{ width: 32, height: 32, background: `${color}18`, color }}
            >
              <i className={icon} style={{ fontSize: 15 }} />
            </span>
            <span className="fw-bold text-uppercase" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 12, letterSpacing: '0.04em' }}>
              {label}
            </span>
          </div>
          {manageLabel && onManage && (
            <button
              type="button"
              onClick={onManage}
              className="btn btn-sm btn-link text-primary p-0 text-decoration-none fw-semibold"
              style={{ fontSize: 12 }}
            >
              {manageLabel} <i className="ri-arrow-right-line align-bottom" />
            </button>
          )}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function Chip({ icon, text, mono }: { icon: string; text: string; mono?: boolean }) {
  return (
    <span
      className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded-2"
      style={{
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-body-color)',
        fontSize: 12,
        fontFamily: mono ? 'monospace' : undefined,
      }}
    >
      <i className={icon} style={{ color: 'var(--vz-secondary-color)' }} />
      {text}
    </span>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-3">
      <i className={icon} style={{ fontSize: 24, color: 'var(--vz-secondary-color)' }} />
      <div className="text-muted mt-2 fs-12">{text}</div>
    </div>
  );
}
