import { useState, useEffect } from 'react';
import { Card, CardBody, Button, Spinner, Alert } from 'reactstrap';
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
  id: string;          // EMP-1063 — display identifier; not used to address the backend.
  name: string;
  email: string;
  initials?: string;
  accent?: string;
  department?: string;
  designation?: string;
  primaryRole?: string;
  ancillaryRole?: string | string[] | null;
  manager?: string;
  // Backend identifiers — required for permission save to target the correct
  // user. `user_id` is the FK to the login account; `_raw` is the original
  // ApiEmployee shape smuggled through by HrEmployees apiToRow().
  user_id?: number;
  _raw?: { user_id?: number | null } & Record<string, any>;
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

  // The backend permission API targets the LOGIN user id (users.id), not
  // the employee row id. Source priority:
  //   1) employee.user_id            — explicit field if caller set it
  //   2) employee._raw.user_id       — what HrEmployees.apiToRow() smuggles
  //   3) digit-strip of the URL slug — last-resort fallback for legacy
  //      mock pages that pass numeric ids in the URL.
  // Without (1) or (2) the save call hits the wrong user and the backend
  // rejects with "You can only assign permissions to users you manage".
  const numericId = Number(
    employee?.user_id
      ?? employee?._raw?.user_id
      ?? String(employeeId).replace(/\D/g, '')
  );

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

      {/* Compact employee + permissions header.
          Slim hero on top (title + breadcrumb + save).
          One identity row below: avatar dominates left; on the right are name/ID/status,
          email, and inline meta chips (Dept · Desig · Primary · Ancillary · Manager). */}
      <Card
        className="shadow-sm mb-3 overflow-hidden ep-perm-card"
        style={{ borderRadius: 14, border: 'none' }}
      >
        <style>{`
          /* Whole header card uses the same deep-navy hero gradient as
             EmployeeProfile, with a subtle dotted overlay for texture. */
          .ep-perm-card {
            position: relative;
            color: #fff;
            background: linear-gradient(120deg,#08112b 0%,#0c1740 40%,#0f1e55 70%,#0d1848 100%);
            box-shadow: 0 8px 26px rgba(8,17,43,0.30);
          }
          .ep-perm-card::before {
            content: ''; position: absolute; inset: 0;
            background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
            background-size: 16px 16px;
            opacity: 0.30; pointer-events: none;
          }
          .ep-perm-card > * { position: relative; z-index: 1; }

          /* Translucent chip — colour driven by per-chip CSS vars below. */
          .ep-chip {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 999px;
            background: var(--chip-bg, rgba(255,255,255,0.06));
            border: 1px solid var(--chip-border, rgba(255,255,255,0.14));
            font-size: 12px; line-height: 1.3; max-width: 100%; min-width: 0;
          }
          .ep-chip i { font-size: 13px; color: var(--chip-fg, rgba(255,255,255,0.80)); flex-shrink: 0; }
          .ep-chip-label { color: rgba(255,255,255,0.60); font-weight: 500; flex-shrink: 0; }
          .ep-chip-value { color: var(--chip-fg, #fff); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .ep-chip-value-pill {
            display: inline-flex; align-items: center;
            padding: 1px 8px; border-radius: 999px;
            background: var(--chip-pill-bg, rgba(255,255,255,0.12));
            color: var(--chip-fg, #fff);
            border: 1px solid var(--chip-border, rgba(255,255,255,0.25));
            font-weight: 600; font-size: 11.5px; margin-right: 4px;
          }
          .ep-chip-value-pill:last-child { margin-right: 0; }
          .ep-chip-empty { color: rgba(255,255,255,0.40); font-weight: 500; }
        `}</style>

        {/* Slim hero strip */}
        <div style={{ padding: '12px 18px' }}>
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="btn p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                aria-label="Back"
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(255,255,255,0.10)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  color: '#fff',
                }}
              >
                <i className="ri-arrow-left-line" style={{ fontSize: 16 }} />
              </button>
              <div className="min-w-0">
                <h5 className="mb-0 fw-bold text-white d-flex align-items-center gap-2" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
                  Manage Permissions
                </h5>
                <div className="d-flex align-items-center flex-wrap gap-1 mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)' }}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onBack(); }}
                    className="text-decoration-none"
                    style={{ color: 'rgba(255,255,255,0.78)' }}
                  >
                    Employees
                  </a>
                  <i className="ri-arrow-right-s-line" />
                  <span>{employee?.name || employeeId}</span>
                  <i className="ri-arrow-right-s-line" />
                  <span className="fw-semibold" style={{ color: '#fff' }}>Permissions</span>
                </div>
              </div>
            </div>
            <Button
              className="btn-label waves-effect waves-light rounded-pill flex-shrink-0 btn-sm"
              onClick={handleSave}
              disabled={saving}
              style={{
                background: '#fff',
                color: '#0c1740',
                border: 'none',
                boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {saving
                ? <Spinner size="sm" className="label-icon align-middle me-2" />
                : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-15 me-2" style={{ color: '#0c1740' }}></i>}
              {saving ? 'Saving...' : 'Save Permissions'}
            </Button>
          </div>
        </div>

        {/* Identity row — avatar leads, name/email/chips on the right.
            Sits on the same navy background, separated by a subtle 1px line. */}
        <div
          className="d-flex gap-3 align-items-start"
          style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div
            className="d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
            style={{
              width: 56, height: 56, fontSize: 18,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
              boxShadow: `0 8px 22px ${accent}55, 0 0 0 2px rgba(255,255,255,0.14)`,
            }}
          >
            {initials}
          </div>

          <div className="flex-grow-1 min-w-0">
            {/* Name + ID + Active + email — inline */}
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h5 className="mb-0 fw-bold text-white" style={{ letterSpacing: '-0.01em', fontSize: 16 }}>
                {employee?.name || employeeId}
              </h5>
              <span
                className="d-inline-flex align-items-center fw-semibold font-monospace"
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(99,102,241,0.20)',
                  color: '#c7d2fe',
                  border: '1px solid rgba(99,102,241,0.40)',
                }}
              >
                {employeeId}
              </span>
              <span
                className="d-inline-flex align-items-center gap-1 fw-semibold"
                style={{
                  fontSize: 10.5,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(34,197,94,0.18)',
                  color: '#86efac',
                  border: '1px solid rgba(34,197,94,0.40)',
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.85)' }} />
                Active
              </span>
              {employee?.email && (
                <a
                  href={`mailto:${employee.email}`}
                  className="text-decoration-none d-inline-flex align-items-center gap-1"
                  style={{ fontSize: 12, color: 'rgba(255,255,255,0.70)' }}
                >
                  <i className="ri-mail-line" style={{ fontSize: 13 }} />
                  {employee.email}
                </a>
              )}
            </div>

            {/* Meta chips — Department · Designation · Primary Role · Ancillary Role · Manager.
                Each chip uses a translucent accent matching the EmployeeProfile pill style. */}
            {(() => {
              const ancillaryList = Array.isArray(employee?.ancillaryRole)
                ? (employee?.ancillaryRole as string[]).filter(Boolean)
                : (employee?.ancillaryRole ? [employee.ancillaryRole as string] : []);
              const chips = [
                { label: 'Department',     value: employee?.department,                       icon: 'ri-building-2-line',  fg: '#93c5fd', bg: 'rgba(59,130,246,0.14)',  border: 'rgba(59,130,246,0.40)',  pillBg: 'rgba(59,130,246,0.22)' },
                { label: 'Designation',    value: employee?.designation,                      icon: 'ri-briefcase-line',   fg: '#fcd34d', bg: 'rgba(245,158,11,0.14)',  border: 'rgba(245,158,11,0.40)',  pillBg: 'rgba(245,158,11,0.22)' },
                { label: 'Primary Role',   value: employee?.primaryRole,                      icon: 'ri-user-star-line',   fg: '#99f6e4', bg: 'rgba(20,184,166,0.14)',  border: 'rgba(20,184,166,0.40)',  pillBg: 'rgba(20,184,166,0.22)' },
                { label: 'Ancillary Role', value: ancillaryList.length ? ancillaryList : null, icon: 'ri-team-line',        fg: '#e9d5ff', bg: 'rgba(168,85,247,0.14)',  border: 'rgba(168,85,247,0.40)',  pillBg: 'rgba(168,85,247,0.22)' },
                { label: 'Manager',        value: employee?.manager,                          icon: 'ri-user-shared-line', fg: '#fbcfe8', bg: 'rgba(244,114,182,0.14)', border: 'rgba(244,114,182,0.40)', pillBg: 'rgba(244,114,182,0.22)' },
              ];
              return (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {chips.map(c => (
                    <span
                      key={c.label}
                      className="ep-chip"
                      style={{
                        ['--chip-fg' as any]: c.fg,
                        ['--chip-bg' as any]: c.bg,
                        ['--chip-border' as any]: c.border,
                        ['--chip-pill-bg' as any]: c.pillBg,
                      }}
                    >
                      <i className={c.icon} />
                      <span className="ep-chip-label">{c.label}:</span>
                      {Array.isArray(c.value) ? (
                        c.value.length === 0
                          ? <span className="ep-chip-empty">—</span>
                          : c.value.map(v => (
                              <span key={v} className="ep-chip-value-pill">{v}</span>
                            ))
                      ) : (
                        <span className="ep-chip-value">{c.value || <span className="ep-chip-empty">—</span>}</span>
                      )}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
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
        </CardBody>
      </Card>
    </>
  );
}
