import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner, Alert } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface Module { id: number; name: string; slug: string; icon: string; is_default: boolean; }
interface ManagedUser { id: number; name: string; email: string; user_type: string; client_id?: number; branch_id?: number; client?: { id: number; org_name: string }; branch?: { id: number; name: string }; status: string; }
type PermKey = 'can_view' | 'can_add' | 'can_edit' | 'can_delete' | 'can_export' | 'can_import' | 'can_approve';

const PERMS: { key: PermKey; label: string; icon: string; color: string }[] = [
  { key: 'can_view',    label: 'View',    icon: 'ri-eye-line',           color: 'info' },
  { key: 'can_add',     label: 'Add',     icon: 'ri-add-line',           color: 'success' },
  { key: 'can_edit',    label: 'Edit',    icon: 'ri-pencil-line',        color: 'warning' },
  { key: 'can_delete',  label: 'Delete',  icon: 'ri-delete-bin-line',    color: 'danger' },
  { key: 'can_export',  label: 'Export',  icon: 'ri-download-2-line',    color: 'primary' },
  { key: 'can_import',  label: 'Import',  icon: 'ri-upload-2-line',      color: 'secondary' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line',  color: 'primary' },
];

const emptyPerms = (): Record<PermKey, boolean> => ({
  can_view: false, can_add: false, can_edit: false, can_delete: false,
  can_export: false, can_import: false, can_approve: false,
});

export default function Permissions() {
  const { user: authUser } = useAuth();
  const toast = useToast();
  const [modules, setModules] = useState<Module[]>([]);
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
      let mods: Module[] = modRes.data;
      mods = mods.filter(m => !['clients', 'plans', 'payments', 'settings', 'permissions'].includes(m.slug));
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

  const toggle = (modId: number, key: PermKey) => {
    if (!isSuperAdmin && myPerms) {
      const mod = modules.find(m => m.id === modId);
      if (mod && myPerms[mod.slug] && !myPerms[mod.slug][key]) {
        toast.warning('Cannot Grant', `You don't have "${key.replace('can_', '')}" permission for this module`);
        return;
      }
    }
    setMatrix(prev => ({
      ...prev,
      [modId]: { ...(prev[modId] || emptyPerms()), [key]: !(prev[modId]?.[key]) },
    }));
  };

  const toggleColumn = (key: PermKey) => {
    const allOn = modules.every(m => matrix[m.id]?.[key]);
    const next = { ...matrix };
    modules.forEach(m => {
      if (!isSuperAdmin && myPerms) {
        const mod = modules.find(mm => mm.id === m.id);
        if (mod && myPerms[mod.slug] && !myPerms[mod.slug][key]) return;
      }
      next[m.id] = { ...(next[m.id] || emptyPerms()), [key]: !allOn };
    });
    setMatrix(next);
  };

  const selectAll = (val: boolean) => {
    const next: Record<number, Record<PermKey, boolean>> = {};
    modules.forEach(m => {
      next[m.id] = {} as Record<PermKey, boolean>;
      PERMS.forEach(p => {
        if (!val) { next[m.id][p.key] = false; return; }
        if (!isSuperAdmin && myPerms) {
          const mod = modules.find(mm => mm.id === m.id);
          next[m.id][p.key] = mod && myPerms[mod.slug] ? myPerms[mod.slug][p.key] : false;
        } else {
          next[m.id][p.key] = true;
        }
      });
    });
    setMatrix(next);
  };

  const handleSave = async () => {
    if (!selectedUserId) { toast.warning('Select User', 'Please select a user first'); return; }
    setSaving(true);
    try {
      const permissions = modules.map(m => {
        const p = matrix[m.id] || emptyPerms();
        return { module_id: m.id, ...p };
      });
      const res = await api.post(`/permissions/user/${selectedUserId}`, { permissions });
      toast.success('Permissions Saved', `${res.data.saved_count} module permissions saved successfully`);
      loadUserPermissions(selectedUserId);
    } catch (err: any) {
      toast.error('Save Failed', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const totalChecks = Object.values(matrix).reduce((s, m) => s + PERMS.filter(p => m[p.key]).length, 0);
  const maxChecks = modules.length * PERMS.length;
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
                <CardBody className="border-top bg-light-subtle">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="badge bg-dark-subtle text-dark fs-11 fw-bold text-uppercase rounded-pill px-3 py-2">
                      <i className="ri-flashlight-line me-1"></i> Quick
                    </span>
                    <Button color="soft-primary" size="sm" className="rounded-pill px-3" onClick={() => selectAll(true)}>
                      <i className="ri-checkbox-multiple-line me-1 align-bottom"></i> Select All
                    </Button>
                    <Button color="soft-dark" size="sm" className="rounded-pill px-3" onClick={() => selectAll(false)}>
                      <i className="ri-checkbox-multiple-blank-line me-1 align-bottom"></i> Deselect All
                    </Button>
                    <span className="vr mx-1"></span>
                    {PERMS.map(p => (
                      <Button
                        key={p.key}
                        color={`soft-${p.color}`}
                        size="sm"
                        className="rounded-pill px-3"
                        onClick={() => toggleColumn(p.key)}
                      >
                        <i className={`${p.icon} me-1 align-bottom`}></i> {p.label}
                      </Button>
                    ))}
                    <span className="ms-auto text-muted fs-12">
                      <strong className="text-primary fs-14">{totalChecks}</strong>
                      <span className="text-muted"> / {maxChecks} enabled</span>
                    </span>
                  </div>
                </CardBody>

                <div className="table-responsive table-card px-3">
                  {loadingPerms ? (
                    <div className="text-center py-5"><Spinner color="primary" /> <span className="ms-2 text-muted">Loading permissions...</span></div>
                  ) : (
                    <table className="table align-middle table-nowrap table-hover table-sm mb-0">
                      <thead className="table-light">
                        <tr>
                          <th className="ps-3 py-2" style={{ width: '30%' }}>Module</th>
                          {PERMS.map(p => (
                            <th key={p.key} className="text-center py-2" style={{ width: `${70 / PERMS.length}%` }}>
                              <div className="d-flex flex-column align-items-center gap-1">
                                <span className={`d-inline-flex align-items-center justify-content-center rounded-circle bg-${p.color}-subtle text-${p.color}`} style={{ width: '22px', height: '22px' }}>
                                  <i className={`${p.icon} fs-12`}></i>
                                </span>
                                <span className="fs-11 fw-semibold text-uppercase">{p.label}</span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {modules.map(mod => {
                          const rowPerms = matrix[mod.id] || emptyPerms();
                          return (
                            <tr key={mod.id} style={{ lineHeight: 1.1 }}>
                              <td className="ps-3 py-2">
                                <div className="d-flex align-items-center gap-2">
                               
                                  <span className="fw-semibold text-dark">{mod.name}</span>
                                  {mod.is_default && <Badge color="success-subtle" className="text-success fs-10 rounded-pill">DEFAULT</Badge>}
                                </div>
                              </td>
                              {PERMS.map(p => {
                                const disabled = !isSuperAdmin && myPerms && myPerms[mod.slug] !== undefined && !myPerms[mod.slug][p.key];
                                return (
                                  <td key={p.key} className="text-center py-2">
                                    <div className="form-check d-flex justify-content-center m-0">
                                      <Input
                                        type="checkbox"
                                        className="form-check-input"
                                        style={{ width: '0.95rem', height: '0.95rem', cursor: disabled ? 'not-allowed' : 'pointer' }}
                                        checked={!!rowPerms[p.key]}
                                        onChange={() => toggle(mod.id, p.key)}
                                        disabled={!!disabled}
                                      />
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

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
                    {totalChecks > 0 && <> · <span className="fw-bold text-primary">{totalChecks}</span> enabled</>}
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
