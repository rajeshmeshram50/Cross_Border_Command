import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Spinner, Alert } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import PermissionMatrix, {
  extractLeafPermissions,
  emptyPerms,
  type PermKey,
  type PermModule,
} from '../components/PermissionMatrix';

// Same hidden slugs ClientPermissions hides — these are tenant/admin-level
// modules that don't apply to a single employee.
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions', 'master.organization_types']);

// EmployeeRow is duplicated here so this page has zero hard dependency on the
// HR module's internal types — keeps it usable from any caller.
export interface EmployeePermsTarget {
  id: string;          // EMP-1063 — string for mock parity; numeric portion is what hits the backend
  name: string;
  email: string;
  initials?: string;
  accent?: string;
  department?: string;
  designation?: string;
  primaryRole?: string;
  ancillaryRole?: string | string[] | null;
  manager?: string;
}

interface Props {
  employeeId: string;
  employee?: EmployeePermsTarget;
  onBack: () => void;
}

export default function EmployeePermissions({ employeeId, employee, onBack }: Props) {
  const toast = useToast();
  const [modules, setModules] = useState<PermModule[]>([]);
  const [matrix, setMatrix] = useState<Record<number, Record<PermKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // EMP-1063 → 1063. If the id has no digits, the backend call is skipped.
  const numericId = Number(String(employeeId).replace(/\D/g, ''));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const modRes = await api.get('/modules');
        const mods: PermModule[] = (modRes.data as PermModule[]).filter(m => !HIDDEN_SLUGS.has(m.slug));
        const m: Record<number, Record<PermKey, boolean>> = {};
        mods.forEach(mod => { m[mod.id] = emptyPerms(); });

        if (numericId > 0) {
          try {
            const permRes = await api.get(`/permissions/user/${numericId}`);
            const perms = permRes.data?.permissions || [];
            perms.forEach((p: any) => {
              if (m[p.module_id]) {
                m[p.module_id] = {
                  can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
                  can_delete: !!p.can_delete, can_export: !!p.can_export,
                  can_import: !!p.can_import, can_approve: !!p.can_approve,
                };
              }
            });
          } catch { /* employee may not yet be a real backend user */ }
        }

        if (!cancelled) {
          setModules(mods);
          setMatrix(m);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [numericId]);

  const handleSave = async () => {
    if (!numericId) {
      toast.error('Cannot save', `${employee?.name || employeeId} is not linked to a backend user yet.`);
      return;
    }
    setSaving(true);
    try {
      const permissions = extractLeafPermissions(modules, matrix);
      const res = await api.post(`/permissions/user/${numericId}`, { permissions });
      toast.success('Saved', `${res.data?.saved_count || permissions.length} permissions updated for ${employee?.name || employeeId}`);
    } catch (err: any) {
      toast.error('Error', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  const initials = employee?.initials
    || (employee?.name ? employee.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : 'EM');
  const accent = employee?.accent || '#7c5cfc';

  return (
    <>
      {!employee && (
        <Alert color="warning">
          <i className="ri-alert-line me-1"></i>
          Employee details not provided — only the ID ({employeeId}) is available. Some surface info may be missing.
        </Alert>
      )}

      {/* Unified employee + permissions summary card.
          Top: indigo gradient hero with back arrow, "Manage Permissions" title,
          breadcrumb, and the Save button.
          Middle: white identity row (avatar / name / ID / email).
          Bottom: meta grid (Dept · Desig · Primary · Ancillary · Manager). */}
      <Card
        className="shadow-sm mb-3 overflow-hidden"
        style={{ borderRadius: 18, border: '1px solid var(--vz-border-color)' }}
      >
        {/* Hero strip */}
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(120deg, #405189 0%, #4a63a8 50%, #6691e7 100%)',
            color: '#fff',
            padding: '18px 22px',
          }}
        >
          {/* Decorative bubbles */}
          <div style={{
            position: 'absolute', top: -40, right: -30, width: 180, height: 180,
            borderRadius: '50%', background: 'rgba(255,255,255,0.10)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -30, right: 120, width: 110, height: 110,
            borderRadius: '50%', background: 'rgba(10,179,156,0.18)', pointerEvents: 'none',
          }} />

          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap" style={{ position: 'relative' }}>
            <div className="d-flex align-items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="btn p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                aria-label="Back"
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.28)',
                  color: '#fff',
                }}
              >
                <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
              </button>
              <span
                className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
                style={{
                  width: 42, height: 42, borderRadius: 12,
                  background: 'rgba(255,255,255,0.22)',
                  border: '1px solid rgba(255,255,255,0.30)',
                }}
              >
                <i className="ri-shield-keyhole-line" style={{ fontSize: 20 }} />
              </span>
              <div className="min-w-0">
                <h4 className="mb-0 fw-bold text-white" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>
                  Manage Permissions
                </h4>
                <div className="d-flex align-items-center flex-wrap gap-1 mt-1" style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onBack(); }}
                    className="text-decoration-none"
                    style={{ color: 'rgba(255,255,255,0.92)' }}
                  >
                    Employees
                  </a>
                  <i className="ri-arrow-right-s-line" />
                  <span style={{ color: 'rgba(255,255,255,0.92)' }}>{employee?.name || employeeId}</span>
                  <i className="ri-arrow-right-s-line" />
                  <span className="fw-semibold" style={{ color: '#fff' }}>Permissions</span>
                </div>
              </div>
            </div>
            <Button
              color="light"
              className="btn-label waves-effect waves-light rounded-pill flex-shrink-0"
              onClick={handleSave}
              disabled={saving}
              style={{
                background: '#fff',
                color: '#405189',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                fontWeight: 600,
              }}
            >
              {saving
                ? <Spinner size="sm" className="label-icon align-middle me-2" />
                : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2" style={{ color: '#405189' }}></i>}
              {saving ? 'Saving...' : 'Save Permissions'}
            </Button>
          </div>
        </div>

        {/* Identity row */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(64,81,137,0.04) 0%, rgba(64,81,137,0) 100%)',
            padding: '18px 22px',
            borderBottom: '1px solid var(--vz-border-color)',
          }}
        >
          <Row className="align-items-center g-3">
            <Col xs="auto">
              <div
                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                style={{
                  width: 60, height: 60, fontSize: 20,
                  background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                  boxShadow: `0 6px 18px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.18)`,
                  border: '3px solid #fff',
                }}
              >
                {initials}
              </div>
            </Col>
            <Col className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <h5 className="mb-0 fw-bold" style={{ letterSpacing: '-0.01em', fontSize: 18 }}>
                  {employee?.name || employeeId}
                </h5>
                <span
                  className="d-inline-flex align-items-center fw-semibold font-monospace"
                  style={{
                    fontSize: 11.5,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: '#ece6ff',
                    color: '#5a3fd1',
                    letterSpacing: '0.02em',
                  }}
                >
                  {employeeId}
                </span>
                <span
                  className="d-inline-flex align-items-center gap-1 fw-semibold"
                  style={{
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: '#d6f4e3',
                    color: '#108548',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  Active
                </span>
              </div>
              {employee?.email && (
                <a
                  href={`mailto:${employee.email}`}
                  className="text-muted text-decoration-none d-inline-flex align-items-center gap-1 mt-1"
                  style={{ fontSize: 12.5 }}
                >
                  <i className="ri-mail-line" style={{ fontSize: 13 }} />
                  {employee.email}
                </a>
              )}
            </Col>
          </Row>
        </div>

        {/* Meta grid — Department · Designation · Primary Role · Ancillary Role · Manager */}
        <div style={{ padding: '14px 20px' }}>
          <style>{`
            .ep-meta { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 12px; }
            @media (min-width: 576px)  { .ep-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            @media (min-width: 992px)  { .ep-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            @media (min-width: 1200px) { .ep-meta { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
            .ep-meta-cell { padding: 10px 12px; border-radius: 10px; background: var(--vz-secondary-bg); border: 1px solid var(--vz-border-color); min-width: 0; }
            .ep-meta-icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
            .ep-meta-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vz-secondary-color); margin: 0 0 2px; }
            .ep-meta-value { font-size: 13px; font-weight: 600; color: var(--vz-heading-color, var(--vz-body-color)); line-height: 1.25; word-break: break-word; }
            .ep-meta-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; margin: 1px 4px 1px 0; }
          `}</style>
          {(() => {
            const ancillaryList = Array.isArray(employee?.ancillaryRole)
              ? (employee?.ancillaryRole as string[]).filter(Boolean)
              : (employee?.ancillaryRole ? [employee.ancillaryRole as string] : []);
            const cells = [
              { label: 'Department',     value: employee?.department,                       icon: 'ri-building-2-line',   bg: '#dceefe', fg: '#0c63b0' },
              { label: 'Designation',    value: employee?.designation,                      icon: 'ri-briefcase-line',    bg: '#fde8c4', fg: '#a4661c' },
              { label: 'Primary Role',   value: employee?.primaryRole,                      icon: 'ri-user-star-line',    bg: '#d6f4e3', fg: '#108548' },
              { label: 'Ancillary Role', value: ancillaryList.length ? ancillaryList : null, icon: 'ri-team-line',         bg: '#ece6ff', fg: '#5a3fd1' },
              { label: 'Manager',        value: employee?.manager,                          icon: 'ri-user-shared-line',  bg: '#fdd9ea', fg: '#a02960' },
            ];
            return (
              <div className="ep-meta">
                {cells.map(c => (
                  <div key={c.label} className="ep-meta-cell d-flex align-items-center gap-2">
                    <span className="ep-meta-icon" style={{ background: c.bg, color: c.fg }}>
                      <i className={c.icon} />
                    </span>
                    <div className="min-w-0 flex-grow-1">
                      <p className="ep-meta-label">{c.label}</p>
                      {Array.isArray(c.value) ? (
                        c.value.length === 0
                          ? <div className="text-muted fs-12">—</div>
                          : <div>
                              {c.value.map(v => (
                                <span key={v} className="ep-meta-pill" style={{ background: c.bg, color: c.fg }}>
                                  {v}
                                </span>
                              ))}
                            </div>
                      ) : (
                        <div className="ep-meta-value">{c.value || <span className="text-muted fw-normal">—</span>}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Card>

      <Card className="shadow-sm">
        <PermissionMatrix
          modules={modules}
          matrix={matrix}
          onChange={setMatrix}
          grantableBy={null}
        />

        <CardBody className="border-top bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
          <span className="text-muted fs-13">
            <i className="ri-edit-box-line me-1 text-primary"></i>
            Editing: <strong className="text-dark">{employee?.name || employeeId}</strong>
          </span>
          <Button
            color="success"
            className="btn-label waves-effect waves-light rounded-pill"
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? <Spinner size="sm" className="label-icon align-middle me-2" />
              : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
            {saving ? 'Saving...' : 'Save Permissions'}
          </Button>
        </CardBody>
      </Card>
    </>
  );
}
