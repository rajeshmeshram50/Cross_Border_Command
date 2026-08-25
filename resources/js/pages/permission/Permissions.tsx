import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Spinner, Alert } from 'reactstrap';
import SearchableSelect from '../../components/ui/SearchableSelect';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import PermissionMatrix, {
  extractLeafPermissions,
  emptyPerms,
  type PermKey,
  type PermModule,
  type PermRow,
} from '../../components/PermissionMatrix';
import { ShimmerPermissions } from '../../components/ui/Shimmer';

interface ManagedUser {
  id: number; name: string; email: string; user_type: string;
  client_id?: number; branch_id?: number;
  client?: { id: number; org_name: string };
  branch?: { id: number; name: string };
  /* Department of the paired employee record, from the API. Only populated for
     employee targets (branch-user and employee granters) — it's what
     identifies a person once the branch column becomes redundant. */
  department?: string | null;
  status: string;
}

// Slugs hidden from grant UI (admin-only or not permissionable per-user)
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions', 'master.organization_types']);

export default function Permissions() {
  const { user: authUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [modules, setModules] = useState<PermModule[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  // Employee vs Department granting mode.
  const [mode, setMode] = useState<'employee' | 'department'>('employee');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [matrix, setMatrix] = useState<Record<number, PermRow>>({});
  const [myPerms, setMyPerms] = useState<Record<string, Record<PermKey, boolean>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingPerms, setLoadingPerms] = useState(false);

  const isSuperAdmin  = authUser?.user_type === 'super_admin';
  const isClientAdmin = authUser?.user_type === 'client_admin';
  const isBranchUser  = authUser?.user_type === 'branch_user';
  // An employee granter manages their own reporting sub-tree. The picker is
  // already narrowed to that sub-tree server-side; nothing here has to know
  // the tree, only that the targets are employees.
  const isEmployee    = authUser?.user_type === 'employee';

  const manageableType: 'client_admin' | 'branch_user' | 'employee' | null =
    isSuperAdmin  ? 'client_admin' :
    isClientAdmin ? 'branch_user'  :
    isBranchUser  ? 'employee'     :
    isEmployee    ? 'employee'     : null;
  const targetLabel = manageableType === 'client_admin' ? 'Client Admin'
    : manageableType === 'branch_user' ? 'Branch User'
    : manageableType === 'employee' ? 'Employee'
    : 'User';

  useEffect(() => {
    Promise.all([
      api.get('/modules'),
      api.get('/permissions/users'),
    ]).then(([modRes, usersRes]) => {
      const mods: PermModule[] = (modRes.data as PermModule[]).filter(m => !HIDDEN_SLUGS.has(m.slug));
      setModules(mods);
      setUsers(usersRes.data);
      const pre = searchParams.get('user');
      if (pre && (usersRes.data as ManagedUser[]).some(u => String(u.id) === pre)) {
        setSelectedUserId(pre);
      }
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

    if (isBranchUser || isClientAdmin) {
      api.get('/master/departments')
        .then(r => setDepartments((Array.isArray(r.data) ? r.data : []).map((d: any) => ({ id: d.id, name: d.name }))))
        .catch(() => setDepartments([]));
    }
  }, []);

  const loadUserPermissions = (userId: string) => {
    if (!userId || modules.length === 0) { setMatrix({}); return; }
    setLoadingPerms(true);
    const freshMatrix: Record<number, PermRow> = {};
    modules.forEach(mod => { freshMatrix[mod.id] = emptyPerms(); });

    api.get(`/permissions/user/${userId}`).then(res => {
      (res.data.permissions || []).forEach((p: any) => {
        if (freshMatrix[p.module_id]) {
          freshMatrix[p.module_id] = {
            can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
            can_delete: !!p.can_delete, can_export: !!p.can_export,
            can_import: !!p.can_import, can_approve: !!p.can_approve,
            is_auto: !!p.is_auto,
          };
        }
      });
      setMatrix({ ...freshMatrix });
    }).catch(() => setMatrix({ ...freshMatrix }))
      .finally(() => setLoadingPerms(false));
  };

  const loadDepartmentPermissions = (deptId: string) => {
    if (!deptId || modules.length === 0) { setMatrix({}); return; }
    setLoadingPerms(true);
    const freshMatrix: Record<number, PermRow> = {};
    modules.forEach(mod => { freshMatrix[mod.id] = emptyPerms(); });

    api.get(`/permissions/department/${deptId}`).then(res => {
      (res.data.permissions || []).forEach((p: any) => {
        if (freshMatrix[p.module_id]) {
          freshMatrix[p.module_id] = {
            can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
            can_delete: !!p.can_delete, can_export: !!p.can_export,
            can_import: !!p.can_import, can_approve: !!p.can_approve,
            is_auto: !!p.is_auto,
          };
        }
      });
      setMatrix({ ...freshMatrix });
    }).catch(() => setMatrix({ ...freshMatrix }))
      .finally(() => setLoadingPerms(false));
  };

  useEffect(() => {
    if (mode === 'employee' && selectedUserId && modules.length > 0) loadUserPermissions(selectedUserId);
    if (mode === 'department' && selectedDeptId && modules.length > 0) loadDepartmentPermissions(selectedDeptId);
    if (mode === 'employee' && !selectedUserId) setMatrix({});
    if (mode === 'department' && !selectedDeptId) setMatrix({});
  }, [mode, selectedUserId, selectedDeptId, modules.length]);

  const handleSave = async () => {
    const isDept = mode === 'department';
    const targetId = isDept ? selectedDeptId : selectedUserId;
    if (!targetId) {
      toast.warning(isDept ? 'Select Department' : 'Select User', `Please select a ${isDept ? 'department' : 'user'} first`);
      return;
    }
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
      const url = isDept ? `/permissions/department/${targetId}` : `/permissions/user/${targetId}`;
      const res = await api.post(url, { permissions });
      toast.success('Permissions Saved', `${res.data.saved_count} module permissions saved successfully`);
      if (isDept) {
        loadDepartmentPermissions(targetId);
      } else {
        loadUserPermissions(targetId);
        // Refetch the manageable users list too — branch/status may have changed
        // since the page mounted, and the picker would otherwise show stale data
        // (e.g. a branch user whose branch was just deactivated).
        api.get('/permissions/users').then(r => setUsers(r.data || [])).catch(() => {});
      }
    } catch (err: any) {
      toast.error('Save Failed', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  // Filter users by the role's manageable scope (client-side guard — the
  // backend returns the broader pool used by the legacy super-admin view).
  const visibleUsers = manageableType
    ? users.filter(u => u.user_type === manageableType)
    : users;

  const selectedUser = visibleUsers.find(u => u.id === Number(selectedUserId));
  const selectedDept = departments.find(d => String(d.id) === String(selectedDeptId));
  // The active selection for the current mode — gates the matrix, save button
  // and empty state uniformly.
  const activeId = mode === 'department' ? selectedDeptId : selectedUserId;
  const showDeptTab = isBranchUser || isClientAdmin;
  const departmentOptions = departments.map(d => ({ value: String(d.id), raw: d }));

  /* Nobody this granter can configure. Distinct from "nobody picked yet": the
     picker and Save button are meaningless here, so the header controls come
     off and the card carries a real empty state instead of a stub card with a
     one-line alert floating above an empty page. */
  const noTargets = mode === 'employee' && visibleUsers.length === 0;

  // Copy for that state, per granter role — what's missing and what fixes it.
  const noTargetsCopy = isSuperAdmin
    ? { icon: 'ri-building-line', title: 'No Client Admins Yet',
        body: 'Create a client organization first — its admin account is what you grant platform access to.' }
    : isClientAdmin
    ? { icon: 'ri-git-branch-line', title: 'No Branch Users Yet',
        body: 'Create a branch first. Each branch gets an admin login, and those logins are what you configure here.' }
    : isBranchUser
    ? { icon: 'ri-user-search-line', title: 'No Employees In Your Branch',
        body: 'Once employees are added to your branch and given a login, they will appear here for you to configure.' }
    : { icon: 'ri-organization-chart', title: 'No One Reports To You Yet',
        body: 'Access is granted down the reporting line, so this page lists only the people who report to you. Ask HR to set you as the reporting manager on their employee record — then they will appear here.' };

  /* Whose name leads the row.
     Branch users and employees both pick EMPLOYEES, and for them the branch is
     noise: a branch user only ever sees their own branch, and an employee only
     their own reports — so every row would repeat the same branch name while
     the person's name sat on the second line. For those two, the person leads
     and their DEPARTMENT is the distinguishing tag. Admins keep the
     organisation / branch heading, where it genuinely separates rows. */
  const personFirst = isBranchUser || isEmployee;

  // Options for the searchable Select. Keep the original user record on `raw`
  // so the custom Option / SingleValue components can render rich rows.
  const userOptions = visibleUsers.map(u => {
    // Super admin scans by organization; client admin scans by branch.
    const primary = personFirst
      ? u.name
      : isSuperAdmin
        ? (u.client?.org_name || 'No Organization')
        : (u.branch?.name   || 'No Branch');
    const context = personFirst
      ? (u.department ? ` · ${u.department}` : '')
      : isSuperAdmin
        ? (u.branch?.name     ? ` · ${u.branch.name}` : '')
        : (u.client?.org_name ? ` · ${u.client.org_name}` : '');
    return {
      value: String(u.id),
      label: personFirst
        ? `${primary} (${u.email})${context}`
        : `${primary} — ${u.name} (${u.email})${context}`,
      raw: u,
    };
  });

  if (loading) return <ShimmerPermissions />;

  return (
    <div className="perm-page">
      <style>{`
        /* Force the page's theme-primary accents to violet (instead of the
           Velzon / brand blue) so the whole Permission screen is one shade. */
        .perm-page .text-primary { color: #7c3aed !important; }
        .perm-page .bg-primary-subtle { background-color: rgba(124,58,237,0.12) !important; }
        /* Header strip — same shape/parts as the Customers (.smc-cstrip)
           header (rounded container, left accent strip, violet icon) on a
           plain white surface. Back pill on the right (sub-page). */
        .pm-cstrip {
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
          min-height: 70px; padding: 12px 18px;
          background: #ffffff;
          /* 1px violet border on all sides (the left accent strip stays). */
          border: 1px solid #c4b5fd;
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.05);
          font-family: var(--font-sans);
        }
        .pm-cstrip-accent {
          position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
          background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
          border-radius: 16px 0 0 16px;
        }
        .pm-cstrip-left { display: flex; align-items: center; gap: 16px; position: relative; z-index: 1; min-width: 0; flex: 1; }
        .pm-cstrip-icon {
          position: relative; width: 46px; height: 46px; border-radius: 12px;
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-size: 22px; flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(91,33,182,0.40), 0 0 0 3px rgba(124,58,237,0.10);
        }
        .pm-cstrip-title { font-size: 18px; font-weight: 800; color: var(--vz-heading-color, #2e1065); letter-spacing: -.3px; line-height: 1.2; }
        .pm-cstrip-sub { font-size: 12px; color: var(--vz-secondary-color, #6b7280); font-weight: 400; margin-top: 4px; line-height: 1.5; max-width: 760px; }
        .pm-cstrip-back {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 0 18px; height: 44px; border-radius: 14px;
          border: 1px solid color-mix(in srgb, #7c3aed 30%, var(--vz-border-color));
          background: #fff; color: #6d28d9;
          font-family: inherit; font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer; flex-shrink: 0;
          transition: background .15s, border-color .15s, transform .15s;
        }
        .pm-cstrip-back:hover { background: #f5f3ff; border-color: #c4b5fd; transform: translateY(-1px); }
        .pm-cstrip-back i { font-size: 16px; }
        /* Shared by BOTH empty states (nobody-to-configure and nobody-picked-
           yet). Lives here, at page level, because the two blocks render
           exclusively — keeping it inside one of them left the other with an
           undefined animation name. */
        @keyframes perm-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        [data-bs-theme="dark"] .pm-cstrip { background: var(--vz-card-bg); border-color: rgba(167,139,250,0.40); box-shadow: 0 6px 18px rgba(0,0,0,0.30); }
        [data-bs-theme="dark"] .pm-cstrip-back { background: transparent; color: #c4b5fd; }
        [data-bs-theme="dark"] .pm-cstrip-back:hover { background: rgba(124,58,237,.14); }
      `}</style>
      <Row>
        <Col xs={12}>
          {/* Header strip — matches the Clients / Branches module headers. */}
          <div className="pm-cstrip mb-2">
            <span className="pm-cstrip-accent" />
            <div className="pm-cstrip-left">
              <div className="pm-cstrip-icon"><i className="ri-shield-keyhole-line" /></div>
              <div className="min-w-0">
                <div className="pm-cstrip-title">Permission Management</div>
                <div className="pm-cstrip-sub">
                  Grant or restrict module access for branch users and employees.
                </div>
              </div>
            </div>
            <button type="button" className="pm-cstrip-back" onClick={() => navigate(-1)}>
              <i className="ri-arrow-left-line" />
              Back
            </button>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card className="shadow-sm mb-2">
            <CardHeader className="bg-light-subtle border-bottom">
              {showDeptTab && (
                <div className="d-inline-flex mb-2 p-1 rounded-pill" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.20)' }}>
                  {(['employee', 'department'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className="btn btn-sm rounded-pill px-3 fw-semibold border-0"
                      style={{ background: mode === m ? 'linear-gradient(135deg,#8b5cf6,#7c3aed)' : 'transparent', color: mode === m ? '#fff' : '#6d28d9' }}>
                      <i className={`${m === 'employee' ? 'ri-user-3-line' : 'ri-building-line'} me-1`} />
                      {m === 'employee' ? 'Employee' : 'Department'}
                    </button>
                  ))}
                </div>
              )}
              {/* Picker + Save come off entirely when there is nobody to
                  configure — an empty dropdown next to a dead button reads as
                  a broken page. The empty state below explains it instead. */}
              {/* align-items-end, not -center: the left column is a label
                  stacked on a select, so centring floated Save halfway up the
                  label. Bottom-aligned it sits on the select's own line. */}
              {!noTargets && (
              <Row className="align-items-end gy-2">
                {mode === 'employee' && (
                <Col md={7}>
                  <label className="form-label text-muted fs-11 fw-bold text-uppercase mb-2">
                    <i className="ri-user-settings-line me-1"></i>
                    {targetLabel}
                  </label>
                  <SearchableSelect
                    value={selectedUserId || null}
                    onChange={v => setSelectedUserId(v || '')}
                    options={userOptions}
                    placeholder={`Select ${targetLabel.toLowerCase()}...`}
                    searchPlaceholder={isSuperAdmin
                      ? 'Search by organization, name or email...'
                      : `Search ${targetLabel.toLowerCase()} by name, email or branch...`}
                    emptyLabel="No match — try a different search"
                    getSearchText={(u: ManagedUser) =>
                      // Department is searchable too — it's now the visible tag,
                      // so "logistics" has to find the Logistics people.
                      [u.client?.org_name, u.name, u.email, u.department, u.branch?.name, u.user_type]
                        .filter(Boolean)
                        .join(' ')
                    }
                    renderTrigger={(u: ManagedUser) => {
                      // Branch user / employee → the PERSON leads, tagged with
                      // their department. Super admin picks client admins → org
                      // name; client admin picks branch users → branch name.
                      const roleLabel = (u.user_type || '').replace(/_/g, ' ');
                      const title     = personFirst
                        ? u.name
                        : isSuperAdmin
                          ? (u.client?.org_name || 'No Organization')
                          : (u.branch?.name   || 'No Branch');
                      const titleIcon = personFirst
                        ? 'ri-user-3-line'
                        : isSuperAdmin ? 'ri-building-line' : 'ri-git-branch-line';
                      return (
                        <span className="d-inline-flex align-items-center gap-2 text-truncate">
                          <i className={`${titleIcon} text-primary`} />
                          <span className="fw-bold" style={{ fontSize: 13 }}>{title}</span>
                          <span className="badge bg-primary-subtle text-primary text-capitalize" style={{ fontSize: 10 }}>
                            {roleLabel}
                          </span>
                          <span className="text-muted" style={{ fontSize: 12 }}>
                            {personFirst ? (u.department || 'No Department') : u.name}
                          </span>
                        </span>
                      );
                    }}
                    renderOption={(u: ManagedUser, isSelected) => {
                      const roleLabel = (u.user_type || '').replace(/_/g, ' ');
                      const isActive  = u.status === 'active';
                      const muted     = isSelected ? 'rgba(255,255,255,0.82)' : 'var(--vz-secondary-color)';

                      /* Branch user / employee view → the PERSON heads the row;
                         admin views keep org-first / branch-first. */
                      const title    = personFirst
                        ? u.name
                        : isSuperAdmin
                          ? (u.client?.org_name || 'No Organization')
                          : (u.branch?.name   || 'No Branch');
                      // Initials follow the heading, so they read as the
                      // person's monogram instead of one repeated branch letter.
                      const initials = (title.split(' ').map(w => w.charAt(0)).join('') || '?').slice(0, 2).toUpperCase();

                      // Second supporting line (after email): for super admin we show the branch,
                      // for client admin we show the parent org instead (useful context across multi-org setups).
                      // Person-first rows drop it — department is already on the
                      // heading line and the branch is the same for every row.
                      const secondaryTag = personFirst
                        ? null
                        : isSuperAdmin
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
                                : 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                              boxShadow: isSelected ? 'none' : '0 2px 6px rgba(124,58,237,0.25)',
                            }}
                          >
                            {initials}
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="d-flex align-items-center gap-2">
                              <span className="fw-bold text-truncate" style={{ fontSize: 13.5 }}>
                                {title}
                              </span>
                              {/* Person-first rows carry the DEPARTMENT here.
                                  The status badge it replaces said ACTIVE on
                                  every row — the picker only ever returns
                                  active users — so it distinguished nothing.
                                  Admin views keep it: their pools can contain
                                  differing statuses. */}
                              {personFirst ? (
                                <span
                                  className="badge rounded-pill border fw-semibold flex-shrink-0"
                                  style={{
                                    fontSize: 8.5,
                                    padding: '1px 6px',
                                    borderColor: isSelected ? 'rgba(255,255,255,0.55)' : 'rgba(124,58,237,0.45)',
                                    color:       isSelected ? '#fff' : '#7c3aed',
                                    background:  isSelected ? 'rgba(255,255,255,0.16)' : 'rgba(124,58,237,0.10)',
                                  }}
                                >
                                  <i className="ri-building-2-line me-1" style={{ fontSize: 9 }} />
                                  {u.department || 'No Department'}
                                </span>
                              ) : (
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
                              )}
                            </div>
                            <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: 11 }}>
                              <span
                                className="badge text-capitalize"
                                style={{
                                  fontSize: 9.5,
                                  padding: '2px 6px',
                                  background: isSelected ? 'rgba(255,255,255,0.22)' : 'rgba(124,58,237,0.12)',
                                  color:      isSelected ? '#fff' : '#7c3aed',
                                }}
                              >
                                <i className="ri-user-settings-line me-1" />{roleLabel}
                              </span>
                              {/* Name omitted on person-first rows — it's the
                                  heading above, and repeating it just crowds
                                  the badge. Admin views still need it here. */}
                              {!personFirst && <span className="fw-medium text-truncate">{u.name}</span>}
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
                )}
                {mode === 'department' && (
                <Col md={7}>
                  <label className="form-label text-muted fs-11 fw-bold text-uppercase mb-2">
                    <i className="ri-building-line me-1"></i>
                    Department
                  </label>
                  <SearchableSelect
                    value={selectedDeptId || null}
                    onChange={v => setSelectedDeptId(v || '')}
                    options={departmentOptions}
                    placeholder="Select department..."
                    searchPlaceholder="Search department..."
                    emptyLabel="No match — try a different search"
                    getSearchText={(d: any) => d.name}
                    renderTrigger={(d: any) => (
                      <span className="d-inline-flex align-items-center gap-2 text-truncate">
                        <i className="ri-building-line text-primary" />
                        <span className="fw-bold" style={{ fontSize: 13 }}>{d.name}</span>
                      </span>
                    )}
                    renderOption={(d: any) => (
                      <span className="d-inline-flex align-items-center gap-2">
                        <i className="ri-building-line text-primary" />
                        <span className="fw-semibold" style={{ fontSize: 13 }}>{d.name}</span>
                      </span>
                    )}
                  />
                </Col>
                )}
                <Col md={5} className="text-md-end">
                  {/* One line, ending flush with the select opposite it: the
                      note reads as a small pill sitting beside Save rather than
                      a banner stacked on top of it, which is what made this
                      corner twice as tall as the control it belongs to.
                      flex-wrap keeps the pill dropping under the button on a
                      narrow viewport instead of squeezing it. */}
                  <div className="d-flex flex-wrap align-items-center justify-content-start justify-content-md-end gap-2">
                  {/* Delegation note — sits directly above Save, in both
                      Employee and Department modes, so the limit is read at the
                      moment of saving rather than skimmed past at the top of
                      the page. Amber because it's a constraint on what the save
                      will actually store, not neutral information. */}
                  {!isSuperAdmin && (
                    <div
                      className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded-pill text-start flex-shrink-0"
                      /* Long form on hover — the visible line stays one row. */
                      title={isEmployee
                        ? 'This list shows only the employees who report to you. You can grant them any access you hold yourself — disabled checkboxes are permissions you don\'t have.'
                        : 'You can only grant permissions that you have. Disabled checkboxes indicate permissions you don\'t have.'}
                      style={{
                        background: 'rgba(245,158,11,0.10)',
                        border: '1px solid rgba(245,158,11,0.40)',
                        color: '#92400e',
                        fontSize: 10.5,
                        fontWeight: 600,
                        lineHeight: 1.4,
                        /* One row: the copy below is trimmed to fit, and nowrap
                           keeps a narrow viewport from folding it into three
                           lines the way the full sentence did. */
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <i className="ri-alert-line flex-shrink-0" style={{ fontSize: 11 }} />
                      <span>
                        {isEmployee
                          ? 'You can grant only access you hold, and only to your reports.'
                          : 'You can grant only permissions you already hold.'}
                      </span>
                    </div>
                  )}
                  <Button
                    color="primary"
                    className={`waves-effect waves-light rounded-pill d-inline-flex align-items-center gap-2 ${saving ? '' : 'btn-label'}`}
                    disabled={saving || !activeId}
                    onClick={handleSave}
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(30,64,175,0.30)',
                      minWidth: 168,
                      flexShrink: 0,
                      justifyContent: 'center',
                    }}
                  >
                    {saving ? (
                      <>
                        <Spinner size="sm" type="border" className="text-white" style={{ width: '1rem', height: '1rem', borderWidth: 2 }} />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                        Save Permissions
                      </>
                    )}
                  </Button>
                  </div>
                </Col>
              </Row>
              )}
            </CardHeader>

            {/* ── Nobody to configure ──
                Same visual shell as the "Select a … to Begin" state below
                (floating gradient badge, gradient heading, one paragraph) so
                the two empty states read as one design rather than a styled
                page and a bare warning strip. */}
            {noTargets && (
              <CardBody className="py-5 text-center position-relative" style={{ overflow: 'hidden', minHeight: 420 }}>
                <div style={{
                  position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)',
                  width: 380, height: 380, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }} />

                <div style={{
                  position: 'relative',
                  width: 60, height: 60, margin: '0 auto',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 18px 40px rgba(124,58,237,0.35)',
                }}>
                  <i className={noTargetsCopy.icon} style={{ fontSize: 30, color: '#fff' }} />
                </div>

                <div style={{ animation: 'perm-fade .5s ease-out .1s both' }}>
                  <h4 style={{
                    marginTop: 22, marginBottom: 6, fontWeight: 700,
                    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text', display: 'inline-block',
                  }}>
                    {noTargetsCopy.title}
                  </h4>
                  <p style={{ color: '#6b7280', fontSize: 13.5, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
                    {noTargetsCopy.body}
                  </p>
                </div>

                {/* The delegation rule itself — the one thing that makes an
                    empty picker make sense at a glance. */}
                <div
                  className="d-inline-flex align-items-center gap-2 mt-4 px-3 py-2"
                  style={{
                    background: 'rgba(124,58,237,0.08)',
                    border: '1px solid rgba(124,58,237,0.20)',
                    borderRadius: 999, color: '#6d28d9',
                    fontSize: 12, fontWeight: 600,
                    animation: 'perm-fade .5s ease-out .25s both',
                  }}
                >
                  <i className="ri-shield-check-line" style={{ fontSize: 14 }} />
                  You can only grant access you already hold, and only to your own team
                </div>
              </CardBody>
            )}

            {/* The delegation note used to live here, as a full-width violet
                strip under the header. It now sits directly above the Save
                button (see the header Row) so it's read where it matters. */}

            {/* ── Animated empty state when no user is selected ── */}
            {!activeId && (mode === 'department' || visibleUsers.length > 0) && (
              <CardBody className="py-5 text-center position-relative" style={{ overflow: 'hidden' }}>
                {/* perm-fade now lives in the page-level <style> — shared with
                    the nobody-to-configure state above. */}

                {/* Decorative background glow */}
                <div style={{
                  position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)',
                  width: 380, height: 380, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }} />

                <div style={{ position: 'relative', display: 'inline-block' }}>
                  {/* Pulsing rings */}
                 
                 
                  {/* Floating gradient shield */}
                  <div style={{
                    position: 'relative',
                    width: 60, height: 60,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 18px 40px rgba(124,58,237,0.35)',
                    zIndex: 1,
                  }}>
                    <i className="ri-shield-user-line" style={{ fontSize: 30, color: '#fff' }} />
                  </div>
                </div>

                <div style={{ animation: 'perm-fade .5s ease-out .1s both' }}>
                  <h4 style={{
                    marginTop: 22, marginBottom: 6,
                    fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))',
                    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    display: 'inline-block',
                  }}>
                    {/* targetLabel, not a hardcoded "Branch User" — a branch
                        admin and an employee both pick employees here. */}
                    Select a {mode === 'department' ? 'Department' : targetLabel} to Begin
                  </h4>
                  <p style={{ color: '#6b7280', fontSize: 13.5, maxWidth: 480, margin: '0 auto 24px', lineHeight: 1.6 }}>
                    Choose a {mode === 'department' ? 'department' : 'user'} from the dropdown above to view and configure which modules {mode === 'department' ? 'that department' : 'they'} can access — from viewing records to approving workflows.
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
                        background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
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

            {activeId && (
              <>
                <PermissionMatrix
                  modules={modules}
                  matrix={matrix}
                  onChange={setMatrix}
                  grantableBy={isSuperAdmin ? null : myPerms}
                  loading={loadingPerms}
                  autoExpandMasterCategories={false}
                />

                <CardBody className="border-top bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
                  <span className="text-muted fs-13">
                    {mode === 'department' ? (
                      selectedDept ? (
                        <>
                          <i className="ri-edit-box-line me-1 text-primary"></i>
                          Editing department: <strong className="text-dark">{selectedDept.name}</strong>
                          <Badge color="info-subtle" className="text-info ms-2 text-uppercase fs-10 rounded-pill">Department</Badge>
                        </>
                      ) : 'Select a department to configure permissions'
                    ) : selectedUser ? (
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
                    className={`waves-effect waves-light rounded-pill d-inline-flex align-items-center gap-2 ${saving ? '' : 'btn-label'}`}
                    disabled={saving || !activeId}
                    onClick={handleSave}
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(30,64,175,0.30)',
                      minWidth: 180,
                      justifyContent: 'center',
                    }}
                  >
                    {saving ? (
                      <>
                        <Spinner size="sm" type="border" className="text-white" style={{ width: '1rem', height: '1rem', borderWidth: 2 }} />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                        Save Permissions
                      </>
                    )}
                  </Button>
                </CardBody>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
