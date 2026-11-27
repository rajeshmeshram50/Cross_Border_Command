import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Spinner, Alert } from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import PermissionMatrix, {
  extractLeafPermissions,
  emptyPerms,
  type PermKey,
  type PermModule,
  type PermRow,
} from '../../components/PermissionMatrix';
import { ShimmerPermissions } from '../../components/ui/Shimmer';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

// Slugs hidden from the permission matrix (admin-only features)
const HIDDEN_SLUGS = new Set(['clients', 'plans', 'payments', 'settings', 'permissions', 'master.organization_types']);

// Temporarily hidden from this page — the modules still exist and keep any permissions already
// granted (they are carried through every save unchanged). To show one again, comment out its line.
const TEMP_HIDDEN_SLUGS = new Set<string>([
  'inventory',   // Inventory Management System
  'dev-tools',   // Dev Tools
]);

export default function ClientPermissions({ clientId, clientName, onBack }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [modules, setModules] = useState<PermModule[]>([]);
  const [matrix, setMatrix] = useState<Record<number, PermRow>>({});
  // TEMP_HIDDEN_SLUGS modules: not rendered or counted, but their loaded values are re-sent on save
  // (a user save replaces all of that user's rows, so leaving them out would revoke them).
  const [hiddenModules, setHiddenModules] = useState<PermModule[]>([]);
  const [hiddenMatrix, setHiddenMatrix] = useState<Record<number, PermRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Fallback display name so the breadcrumb is meaningful when the parent
  // wrapper navigates here without a clientName (deep links, refresh, etc.)
  const [fetchedClientName, setFetchedClientName] = useState('');
  const displayClientName = clientName || fetchedClientName;

  /* Hydrate from 2 parallel calls instead of the previous 3-step
   * waterfall. Previously the flow was:
   *   1. GET /clients/{id}        ← to learn the admin's user id
   *   2. GET /modules             ← parallel with step 1
   *   3. GET /permissions/user/{admin.id}  ← BLOCKED on step 1 finishing
   *
   * Step 3 is gone — ClientController::show() now embeds `admin_permissions`
   * in the same response as `admin_user`, so we get the permission matrix
   * without a separate round-trip. Both calls fire in parallel via
   * Promise.all. */
  useEffect(() => {
    Promise.all([
      api.get(`/clients/${clientId}`),
      api.get('/modules'),
    ]).then(([clientRes, modRes]) => {
      const clientData = clientRes.data?.client ?? clientRes.data ?? {};
      setFetchedClientName(clientData.org_name || '');
      const admin = clientRes.data.admin_user;
      setAdminUser(admin);
      const all: PermModule[] = (modRes.data as PermModule[]).filter(m => !HIDDEN_SLUGS.has(m.slug));
      const mods = all.filter(mod => !TEMP_HIDDEN_SLUGS.has(mod.slug));
      const hidMods = all.filter(mod => TEMP_HIDDEN_SLUGS.has(mod.slug));
      setModules(mods);
      setHiddenModules(hidMods);

      const m: Record<number, PermRow> = {};
      mods.forEach(mod => { m[mod.id] = emptyPerms(); });
      const hm: Record<number, PermRow> = {};
      hidMods.forEach(mod => { hm[mod.id] = emptyPerms(); });

      // admin_permissions arrives inline now — no extra fetch needed.
      const perms = Array.isArray(clientRes.data?.admin_permissions)
        ? clientRes.data.admin_permissions
        : [];
      perms.forEach((p: any) => {
        const target = m[p.module_id] ? m : hm[p.module_id] ? hm : null;
        if (target) {
          target[p.module_id] = {
            can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
            can_delete: !!p.can_delete, can_export: !!p.can_export,
            can_import: !!p.can_import, can_approve: !!p.can_approve,
            is_auto: !!p.is_auto,
          };
        }
      });
      setMatrix(m);
      setHiddenMatrix(hm);
    }).finally(() => setLoading(false));
  }, [clientId]);

  const handleSave = async () => {
    if (!adminUser) return;
    setSaving(true);
    try {
      // A user save replaces all of the admin's rows: the temporarily hidden modules ride along unchanged.
      const permissions = extractLeafPermissions([...modules, ...hiddenModules], { ...hiddenMatrix, ...matrix });
      const res = await api.post(`/permissions/user/${adminUser.id}`, { permissions });
      toast.success('Saved', `${res.data.saved_count || 0} permissions updated successfully`);
    } catch (err: any) {
      toast.error('Error', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ShimmerPermissions />;

  return (
    <>
      {!adminUser && (
        <Alert color="warning">
          <i className="ri-alert-line me-1"></i>
          No client admin found for this organization.
        </Alert>
      )}

      {adminUser && (
        <>
        {/* Navy identity hero — the same header the Employee Permissions page
            uses: identity leads, a square dismiss sits top-right, and Save
            lives at the foot. */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, marginBottom: 16, background: 'linear-gradient(120deg, #000066 0%, #00008b 100%)', boxShadow: '0 10px 30px rgba(0,0,40,0.25)' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />
          <button
            type="button" aria-label="Back to clients" onClick={onBack}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 3, width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.32)', background: 'rgba(255,255,255,0.16)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)' }}
          >
            <i className="ri-close-line" style={{ fontSize: 18, fontWeight: 700 }} />
          </button>
          <div className="d-flex gap-2 align-items-center" style={{ padding: '16px 20px', position: 'relative' }}>
            <div
              className="d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 44, height: 44, fontSize: 16, borderRadius: 12, background: 'linear-gradient(135deg,#a855f7,#7c3aed)', boxShadow: '0 8px 22px rgba(124,58,237,0.45), 0 0 0 2px rgba(255,255,255,0.14)' }}
            >
              {adminUser.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <h5 className="mb-0 fw-bold text-white" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>{adminUser.name}</h5>
                <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.18)', color: '#86efac', border: '1px solid rgba(34,197,94,0.40)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.85)' }} />
                  {(adminUser.status || 'active').toUpperCase()}
                </span>
                {adminUser.email && (
                  <a href={`mailto:${adminUser.email}`} className="text-decoration-none d-inline-flex align-items-center gap-1" style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
                    <i className="ri-mail-line" style={{ fontSize: 13 }} />{adminUser.email}
                  </a>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
                <i className="ri-building-line me-1" />Client · Grant or revoke module access
              </div>
            </div>
          </div>
        </div>

        {/* The matrix is its own card; the Save bar rides inside it via `footer`
            so it sits flush under the grid (same as the Employee page) — no
            second card, no dead gap. */}
        <PermissionMatrix
          modules={modules}
          matrix={matrix}
          onChange={setMatrix}
          grantableBy={null}
          footer={
            <div className="border-top bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2 px-3 py-3">
              <span className="text-muted fs-13">
                <i className="ri-edit-box-line me-1 text-primary"></i>
                Editing: <strong className="text-dark">{adminUser.name}</strong>
              </span>
              <Button
                color="primary"
                className="waves-effect waves-light rounded-pill d-inline-flex align-items-center gap-2"
                onClick={handleSave}
                disabled={saving}
                style={{ minWidth: 180, justifyContent: 'center' }}
              >
                {saving ? (
                  <>
                    <Spinner size="sm" type="border" className="text-white" style={{ width: '1rem', height: '1rem', borderWidth: 2 }} />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-shield-check-line align-middle fs-16"></i>
                    Save Permissions
                  </>
                )}
              </Button>
            </div>
          }
        />
        </>
      )}
    </>
  );
}
