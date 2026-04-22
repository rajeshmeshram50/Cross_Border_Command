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

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

// Slugs hidden from the permission matrix (admin-only features)
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions']);

export default function ClientPermissions({ clientId, clientName, onBack }: Props) {
  const toast = useToast();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [modules, setModules] = useState<PermModule[]>([]);
  const [matrix, setMatrix] = useState<Record<number, Record<PermKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${clientId}`),
      api.get('/modules'),
    ]).then(async ([clientRes, modRes]) => {
      const admin = clientRes.data.admin_user;
      setAdminUser(admin);
      const mods: PermModule[] = (modRes.data as PermModule[]).filter(m => !HIDDEN_SLUGS.has(m.slug));
      setModules(mods);

      const m: Record<number, Record<PermKey, boolean>> = {};
      mods.forEach(mod => { m[mod.id] = emptyPerms(); });

      if (admin) {
        try {
          const permRes = await api.get(`/permissions/user/${admin.id}`);
          const perms = permRes.data.permissions || [];
          perms.forEach((p: any) => {
            if (m[p.module_id]) {
              m[p.module_id] = {
                can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
                can_delete: !!p.can_delete, can_export: !!p.can_export,
                can_import: !!p.can_import, can_approve: !!p.can_approve,
              };
            }
          });
        } catch { /* ignore */ }
      }
      setMatrix(m);
    }).finally(() => setLoading(false));
  }, [clientId]);

  const handleSave = async () => {
    if (!adminUser) return;
    setSaving(true);
    try {
      const permissions = extractLeafPermissions(modules, matrix);
      const res = await api.post(`/permissions/user/${adminUser.id}`, { permissions });
      toast.success('Saved', `${res.data.saved_count || 0} permissions updated successfully`);
    } catch (err: any) {
      toast.error('Error', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Permissions
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Clients</a></li>
                <li className="breadcrumb-item"><a href="#">{clientName}</a></li>
                <li className="breadcrumb-item active">Permissions</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {!adminUser && (
        <Alert color="warning">
          <i className="ri-alert-line me-1"></i>
          No client admin found for this organization.
        </Alert>
      )}

      {adminUser && (
        <Card className="shadow-sm">
          <CardHeader>
            <Row className="align-items-center g-3">
              <Col sm="auto">
                <div className="d-flex align-items-center gap-3">
                  <div className="avatar-sm">
                    <div className="avatar-title rounded bg-primary text-white fw-bold">
                      {adminUser.name?.charAt(0)?.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <h6 className="mb-0 fs-14">{adminUser.name}</h6>
                    <p className="text-muted mb-0 fs-12">{adminUser.email}</p>
                  </div>
                  <Badge color={adminUser.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">
                    {adminUser.status}
                  </Badge>
                </div>
              </Col>
              <Col className="text-end">
                <Button color="success" onClick={handleSave} disabled={saving}>
                  {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-check-line me-1"></i>}
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

          <CardBody className="border-top d-flex justify-content-between align-items-center">
            <span className="text-muted fs-13">
              <strong>{adminUser.name}</strong>
            </span>
            <Button color="success" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-check-line me-1"></i>}
              Save Permissions
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
