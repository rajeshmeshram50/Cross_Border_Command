import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Spinner, Alert } from 'reactstrap';
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
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Manage Permissions
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Employees</a></li>
                <li className="breadcrumb-item">{employee?.name || employeeId}</li>
                <li className="breadcrumb-item active">Permissions</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {!employee && (
        <Alert color="warning">
          <i className="ri-alert-line me-1"></i>
          Employee details not provided — only the ID ({employeeId}) is available. Some surface info may be missing.
        </Alert>
      )}

      <Card className="shadow-sm">
        <CardHeader className="bg-light-subtle border-bottom">
          <Row className="align-items-center g-3">
            <Col sm="auto">
              <div className="d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                  style={{
                    width: 40, height: 40, fontSize: 13,
                    background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                    boxShadow: `0 2px 6px ${accent}40`,
                  }}
                >
                  {initials}
                </div>
                <div>
                  <h6 className="mb-0 fs-14">{employee?.name || employeeId}</h6>
                  <p className="text-muted mb-0 fs-12">
                    {employee?.email && <span>{employee.email}</span>}
                    {employee?.email && (employee.department || employee.designation) && <span className="mx-1">·</span>}
                    {employee?.department}
                    {employee?.department && employee?.designation && <span className="mx-1">·</span>}
                    {employee?.designation}
                  </p>
                </div>
                <Badge color="primary" pill className="text-uppercase">
                  {employeeId}
                </Badge>
              </div>
            </Col>
            <Col className="text-end">
              <Button
                color="primary"
                className="btn-label waves-effect waves-light rounded-pill"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? <Spinner size="sm" className="label-icon align-middle me-2" />
                  : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                {saving ? 'Saving...' : 'Save Permissions'}
              </Button>
            </Col>
          </Row>
        </CardHeader>

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
