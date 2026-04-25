import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Spinner, Alert } from 'reactstrap';
import SearchableSelect from '../components/ui/SearchableSelect';
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
      // Strip flags the auth user cannot grant. Orphan perms (left over from a
      // previous client_admin who had broader access) would otherwise cause a
      // 422 even though their checkboxes are disabled in the UI. For client_admin
      // we mask each flag against `myPerms`; super_admin (myPerms === null)
      // sends the matrix as-is.
      const raw = extractLeafPermissions(modules, matrix);
      const moduleSlugById = new Map(modules.map(m => [m.id, m.slug]));
      const permissions = myPerms === null
        ? raw
        : raw.map(p => {
            const slug = moduleSlugById.get(p.module_id);
            const grantable = (slug && myPerms[slug]) || ({} as Record<PermKey, boolean>);
            return {
              module_id: p.module_id,
              can_view:    p.can_view    && !!grantable.can_view,
              can_add:     p.can_add     && !!grantable.can_add,
              can_edit:    p.can_edit    && !!grantable.can_edit,
              can_delete:  p.can_delete  && !!grantable.can_delete,
              can_export:  p.can_export  && !!grantable.can_export,
              can_import:  p.can_import  && !!grantable.can_import,
              can_approve: p.can_approve && !!grantable.can_approve,
            };
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

  const selectedUser = users.find(u => u.id === Number(selectedUserId));

  // Options for the searchable Select. Keep the original user record on `raw`
  // so the custom Option / SingleValue components can render rich rows.
  const userOptions = users.map(u => {
    // Super admin scans by organization; client admin scans by branch.
    const primary = isSuperAdmin
      ? (u.client?.org_name || 'No Organization')
      : (u.branch?.name   || 'No Branch');
    const context = isSuperAdmin
      ? (u.branch?.name     ? ` · ${u.branch.name}` : '')
      : (u.client?.org_name ? ` · ${u.client.org_name}` : '');
    return {
      value: String(u.id),
      label: `${primary} — ${u.name} (${u.email})${context}`,
      raw: u,
    };
  });

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
                  <SearchableSelect
                    value={selectedUserId || null}
                    onChange={v => setSelectedUserId(v || '')}
                    options={userOptions}
                    placeholder={isSuperAdmin ? 'Select client admin...' : 'Select branch user...'}
                    searchPlaceholder={isSuperAdmin
                      ? 'Search by organization, name or email...'
                      : 'Search branch user by name, email or branch...'}
                    emptyLabel="No match — try a different search"
                    getSearchText={(u: ManagedUser) =>
                      [u.client?.org_name, u.name, u.email, u.branch?.name, u.user_type]
                        .filter(Boolean)
                        .join(' ')
                    }
                    renderTrigger={(u: ManagedUser) => {
                      // Super admin picks client admins → show org name as title.
                      // Client admin picks branch users → show branch name as title.
                      const roleLabel = (u.user_type || '').replace(/_/g, ' ');
                      const title     = isSuperAdmin
                        ? (u.client?.org_name || 'No Organization')
                        : (u.branch?.name   || 'No Branch');
                      const titleIcon = isSuperAdmin ? 'ri-building-line' : 'ri-git-branch-line';
                      return (
                        <span className="d-inline-flex align-items-center gap-2 text-truncate">
                          <i className={`${titleIcon} text-primary`} />
                          <span className="fw-bold" style={{ fontSize: 13 }}>{title}</span>
                          <span className="badge bg-primary-subtle text-primary text-capitalize" style={{ fontSize: 10 }}>
                            {roleLabel}
                          </span>
                          <span className="text-muted" style={{ fontSize: 12 }}>{u.name}</span>
                        </span>
                      );
                    }}
                    renderOption={(u: ManagedUser, isSelected) => {
                      const roleLabel = (u.user_type || '').replace(/_/g, ' ');
                      const isActive  = u.status === 'active';
                      const muted     = isSelected ? 'rgba(255,255,255,0.82)' : 'var(--vz-secondary-color)';

                      // Super admin view → org-first; client admin view → branch-first.
                      const title    = isSuperAdmin
                        ? (u.client?.org_name || 'No Organization')
                        : (u.branch?.name   || 'No Branch');
                      const initials = (title.split(' ').map(w => w.charAt(0)).join('') || '?').slice(0, 2).toUpperCase();

                      // Second supporting line (after email): for super admin we show the branch,
                      // for client admin we show the parent org instead (useful context across multi-org setups).
                      const secondaryTag = isSuperAdmin
                        ? (u.branch?.name ? { icon: 'ri-git-branch-line', text: u.branch.name } : null)
                        : (u.client?.org_name ? { icon: 'ri-building-line',  text: u.client.org_name } : null);

                      return (
                        <div className="d-flex align-items-center gap-2">
                          <div
                            className="rounded d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                            style={{
                              width: 36, height: 36, fontSize: 12,
                              color: '#fff',
                              background: isSelected
                                ? 'rgba(255,255,255,0.18)'
                                : 'linear-gradient(135deg,#405189,#6691e7)',
                              boxShadow: isSelected ? 'none' : '0 2px 6px rgba(64,81,137,0.25)',
                            }}
                          >
                            {initials}
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="d-flex align-items-center gap-2">
                              <span className="fw-bold text-truncate" style={{ fontSize: 13.5 }}>
                                {title}
                              </span>
                              <span
                                className="badge rounded-pill border text-uppercase fw-semibold flex-shrink-0"
                                style={{
                                  fontSize: 8.5,
                                  padding: '1px 6px',
                                  borderColor: isSelected ? 'rgba(255,255,255,0.55)' : (isActive ? 'var(--vz-success)' : 'var(--vz-secondary)'),
                                  color:       isSelected ? '#fff' : (isActive ? 'var(--vz-success)' : 'var(--vz-secondary)'),
                                }}
                              >
                                <span
                                  className="d-inline-block rounded-circle me-1"
                                  style={{
                                    width: 5, height: 5, verticalAlign: 'middle',
                                    background: isSelected ? '#fff' : (isActive ? 'var(--vz-success)' : 'var(--vz-secondary)'),
                                  }}
                                />
                                {u.status}
                              </span>
                            </div>
                            <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: 11 }}>
                              <span
                                className="badge text-capitalize"
                                style={{
                                  fontSize: 9.5,
                                  padding: '2px 6px',
                                  background: isSelected ? 'rgba(255,255,255,0.22)' : 'var(--vz-primary-bg-subtle, rgba(64,81,137,0.1))',
                                  color:      isSelected ? '#fff' : 'var(--vz-primary)',
                                }}
                              >
                                <i className="ri-user-settings-line me-1" />{roleLabel}
                              </span>
                              <span className="fw-medium text-truncate">{u.name}</span>
                            </div>
                            <div className="d-flex align-items-center gap-2 text-truncate" style={{ fontSize: 10.5, marginTop: 1, color: muted }}>
                              <span className="d-inline-flex align-items-center gap-1 text-truncate">
                                <i className="ri-mail-line" style={{ fontSize: 10 }} />
                                {u.email}
                              </span>
                              {secondaryTag && (
                                <span className="d-inline-flex align-items-center gap-1 text-truncate">
                                  <i className={secondaryTag.icon} style={{ fontSize: 10 }} />
                                  {secondaryTag.text}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
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
                    fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))',
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
                      background: 'var(--vz-card-bg)',
                      border: '1px solid var(--vz-border-color)',
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
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{f.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', lineHeight: 1.4 }}>{f.desc}</div>
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
