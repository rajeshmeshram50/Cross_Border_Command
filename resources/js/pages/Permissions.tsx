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
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions', 'master.organization_types']);

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
                        {u.name} ({u.email}){u.client ? `  ${u.client.org_name}` : ''}
                      </option>
                    ))}
                  </Input>
                </Col>
                <Col md={5} className="text-md-end">
                  <Button
                    color="primary"
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

            {/* ── Animated empty state when no user is selected ── */}
            {!selectedUserId && users.length > 0 && (
              <CardBody className="py-5 text-center position-relative" style={{ overflow: 'hidden' }}>
                <style>{`
                  @keyframes perm-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
                  @keyframes perm-ring-1 { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(2.1); opacity: 0; } }
                  @keyframes perm-ring-2 { 0% { transform: scale(1); opacity: .4; } 100% { transform: scale(2.6); opacity: 0; } }
                  @keyframes perm-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
                `}</style>

                {/* Decorative background glow */}
                <div style={{
                  position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)',
                  width: 380, height: 380, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(64,81,137,0.08) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }} />

                <div style={{ position: 'relative', display: 'inline-block' }}>
                  {/* Pulsing rings */}
                 
                 
                  {/* Floating gradient shield */}
                  <div style={{
                    position: 'relative',
                    width: 60, height: 60,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg,#405189,#6691e7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 18px 40px rgba(64,81,137,0.35)',
                    zIndex: 1,
                  }}>
                    <i className="ri-shield-user-line" style={{ fontSize: 30, color: '#fff' }} />
                  </div>
                </div>

                <div style={{ animation: 'perm-fade .5s ease-out .1s both' }}>
                  <h4 style={{
                    marginTop: 22, marginBottom: 6,
                    fontWeight: 700, color: '#1f2937',
                    background: 'linear-gradient(135deg,#405189,#6691e7)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    display: 'inline-block',
                  }}>
                    Select a {isSuperAdmin ? 'Client Admin' : 'Branch User'} to Begin
                  </h4>
                  <p style={{ color: '#6b7280', fontSize: 13.5, maxWidth: 480, margin: '0 auto 24px', lineHeight: 1.6 }}>
                    Choose a user from the dropdown above to view and configure which modules they can access — from viewing records to approving workflows.
                  </p>
                </div>

                {/* Feature highlights */}
                <div
                  className="d-flex flex-wrap justify-content-center gap-3"
                  style={{ animation: 'perm-fade .5s ease-out .25s both' }}
                >
                  {[
                    { icon: 'ri-eye-line',        title: 'View Access',     desc: 'Read-only access to modules' },
                    { icon: 'ri-edit-box-line',   title: 'Modify Records',  desc: 'Add, edit, and delete entries' },
                    { icon: 'ri-check-double-line', title: 'Approve & Save', desc: 'Apply permissions instantly' },
                  ].map(f => (
                    <div key={f.title} style={{
                      background: '#fff',
                      border: '1px solid #eef0f3',
                      borderRadius: 12,
                      padding: '12px 16px',
                      minWidth: 180, maxWidth: 220,
                      display: 'flex', alignItems: 'center', gap: 12,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}>
                      <span style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'linear-gradient(135deg,#405189,#6691e7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <i className={f.icon} style={{ color: '#fff', fontSize: 16 }} />
                      </span>
                      <div className="text-start">
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1f2937' }}>{f.title}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>{f.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Hint arrow */}
                <div style={{ marginTop: 28, color: '#9ca3af', fontSize: 11.5, fontWeight: 600, animation: 'perm-fade .5s ease-out .4s both' }}>
                  <i className="ri-arrow-up-line me-1" style={{ fontSize: 13 }} />
                  Pick a user above to load their permissions
                </div>
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
                    color="primary"
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
