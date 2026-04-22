import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner, Alert } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import PermissionMatrix, {
  extractLeafPermissions,
  emptyPerms,
  type PermKey,
  type PermModule,
} from '../components/PermissionMatrix';

interface ManagedUser {
  id: number; name: string; email: string; user_type: string;
  client_id?: number; branch_id?: number;
  client?: { id: number; org_name: string };
  branch?: { id: number; name: string };
  status: string;
}

// Slugs hidden from grant UI (admin-only or not permissionable per-user)
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions']);

export default function Permissions() {
  const { user: authUser } = useAuth();
  const toast = useToast();
  const [modules, setModules] = useState<PermModule[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [matrix, setMatrix] = useState<Record<number, Record<PermKey, boolean>>>({});
  const [myPerms, setMyPerms] = useState<Record<string, Record<PermKey, boolean>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingPerms, setLoadingPerms] = useState(false);

  const isSuperAdmin = authUser?.user_type === 'super_admin';

  useEffect(() => {
    Promise.all([
      api.get('/modules'),
      api.get('/permissions/users'),
    ]).then(([modRes, usersRes]) => {
      const mods: PermModule[] = (modRes.data as PermModule[]).filter(m => !HIDDEN_SLUGS.has(m.slug));
      setModules(mods);
      setUsers(usersRes.data);
    }).finally(() => setLoading(false));

    if (!isSuperAdmin && authUser) {
      api.get(`/permissions/user/${authUser.id}`).then(res => {
        const p: Record<string, Record<PermKey, boolean>> = {};
        res.data.permissions.forEach((perm: any) => {
          if (perm.module) {
            p[perm.module.slug] = {
              can_view: perm.can_view, can_add: perm.can_add, can_edit: perm.can_edit,
              can_delete: perm.can_delete, can_export: perm.can_export,
              can_import: perm.can_import, can_approve: perm.can_approve,
            };
          }
        });
        setMyPerms(p);
      });
    }
  }, []);

  const loadUserPermissions = (userId: string) => {
    if (!userId || modules.length === 0) { setMatrix({}); return; }
    setLoadingPerms(true);
    const freshMatrix: Record<number, Record<PermKey, boolean>> = {};
    modules.forEach(mod => { freshMatrix[mod.id] = emptyPerms(); });

    api.get(`/permissions/user/${userId}`).then(res => {
      (res.data.permissions || []).forEach((p: any) => {
        if (freshMatrix[p.module_id]) {
          freshMatrix[p.module_id] = {
            can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
            can_delete: !!p.can_delete, can_export: !!p.can_export,
            can_import: !!p.can_import, can_approve: !!p.can_approve,
          };
        }
      });
      setMatrix({ ...freshMatrix });
    }).catch(() => setMatrix({ ...freshMatrix }))
      .finally(() => setLoadingPerms(false));
  };

  useEffect(() => {
    if (selectedUserId && modules.length > 0) loadUserPermissions(selectedUserId);
  }, [selectedUserId, modules.length]);

  const handleSave = async () => {
    if (!selectedUserId) { toast.warning('Select User', 'Please select a user first'); return; }
    setSaving(true);
    try {
      const permissions = extractLeafPermissions(modules, matrix);
      const res = await api.post(`/permissions/user/${selectedUserId}`, { permissions });
      toast.success('Permissions Saved', `${res.data.saved_count} module permissions saved successfully`);
      loadUserPermissions(selectedUserId);
    } catch (err: any) {
      toast.error('Save Failed', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const selectedUser = users.find(u => u.id === Number(selectedUserId));

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Permission Management</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Admin</a></li>
                <li className="breadcrumb-item active">Permissions</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card className="shadow-sm">
            <CardHeader className="bg-light-subtle border-bottom">
              <Row className="align-items-center gy-3">
                <Col md={7}>
                  <label className="form-label text-muted fs-11 fw-bold text-uppercase mb-1">
                    <i className="ri-user-settings-line me-1"></i>
                    {isSuperAdmin ? 'Client Admin' : 'Branch User'}
                  </label>
                  <Input
                    type="select"
                    className="form-select-lg rounded-pill"
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                  >
                    <option value="">— {isSuperAdmin ? 'Select client admin...' : 'Select branch user...'} —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email}){u.client ? ` · ${u.client.org_name}` : ''}
                      </option>
                    ))}
                  </Input>
                </Col>
                <Col md={5} className="text-md-end">
                  <Button
                    color="success"
                    className="btn-label waves-effect waves-light rounded-pill"
                    disabled={saving || !selectedUserId}
                    onClick={handleSave}
                  >
                    {saving
                      ? <Spinner size="sm" className="label-icon align-middle me-2" />
                      : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </Button>
                </Col>
              </Row>
            </CardHeader>

            {users.length === 0 && (
              <CardBody>
                <Alert color="warning" className="mb-0">
                  <i className="ri-alert-line me-1"></i>
                  {isSuperAdmin ? 'No client admins found. Create a client first to assign permissions.' : 'No branch users found. Create a branch first to assign permissions.'}
                </Alert>
              </CardBody>
            )}

            {!isSuperAdmin && users.length > 0 && (
              <CardBody className="pt-0">
                <Alert color="info" className="mb-0">
                  <i className="ri-shield-check-line me-1"></i>
                  You can only grant permissions that you have. Disabled checkboxes indicate permissions you don't have.
                </Alert>
              </CardBody>
            )}

            {selectedUserId && (
              <>
                <PermissionMatrix
                  modules={modules}
                  matrix={matrix}
                  onChange={setMatrix}
                  grantableBy={isSuperAdmin ? null : myPerms}
                  loading={loadingPerms}
                />

                <CardBody className="border-top bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
                  <span className="text-muted fs-13">
                    {selectedUser ? (
                      <>
                        <i className="ri-edit-box-line me-1 text-primary"></i>
                        Editing: <strong className="text-dark">{selectedUser.name}</strong>
                        <Badge color="info-subtle" className="text-info ms-2 text-uppercase fs-10 rounded-pill">
                          {selectedUser.user_type.replace('_', ' ')}
                        </Badge>
                      </>
                    ) : 'Select a user to configure permissions'}
                  </span>
                  <Button
                    color="success"
                    className="btn-label waves-effect waves-light rounded-pill"
                    disabled={saving || !selectedUserId}
                    onClick={handleSave}
                  >
                    {saving
                      ? <Spinner size="sm" className="label-icon align-middle me-2" />
                      : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </Button>
                </CardBody>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
