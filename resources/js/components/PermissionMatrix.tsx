import { useEffect, useMemo, useState, useRef, type ReactElement } from 'react';
import { Badge, Button, CardBody, Input, Spinner } from 'reactstrap';

export interface PermModule {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  icon: string;
  is_default: boolean;
  sort_order: number;
  description?: string;
}

export type PermKey = 'can_view' | 'can_add' | 'can_edit' | 'can_delete' | 'can_export' | 'can_import' | 'can_approve';

// Every action below requires being able to see the module, so granting any of
// them implies can_view. Mirrors the backend rule in
// PermissionController::savePermissions — keep the two in sync.
const ACTION_KEYS: PermKey[] = ['can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

/** Force can_view on for any leaf row that has at least one action flag set. */
function withImpliedView(
  next: Record<number, Record<PermKey, boolean>>
): Record<number, Record<PermKey, boolean>> {
  const out: Record<number, Record<PermKey, boolean>> = {};
  for (const [id, row] of Object.entries(next)) {
    const merged = { ...row };
    if (ACTION_KEYS.some((k) => merged[k])) merged.can_view = true;
    out[Number(id)] = merged;
  }
  return out;
}

export const PERMS: { key: PermKey; label: string; icon: string; color: string }[] = [
  { key: 'can_view', label: 'View', icon: 'ri-eye-line', color: 'info' },
  { key: 'can_add', label: 'Add', icon: 'ri-add-line', color: 'success' },
  { key: 'can_edit', label: 'Edit', icon: 'ri-pencil-line', color: 'warning' },
  { key: 'can_delete', label: 'Delete', icon: 'ri-delete-bin-line', color: 'danger' },
  { key: 'can_export', label: 'Export', icon: 'ri-download-2-line', color: 'primary' },
  { key: 'can_import', label: 'Import', icon: 'ri-upload-2-line', color: 'secondary' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line', color: 'primary' },
];

// Unified navy accent for every leaf — icons still vary per module for identity,
// but colors are single-hue so the table isn't visually noisy.
const ACCENT = 'rgb(64, 81, 137)';

const LEAF_ICON: Record<string, string> = {
  'dashboard':   'ri-dashboard-2-fill',
  'clients':     'ri-building-fill',
  'branches':    'ri-git-branch-fill',
  'employees':   'ri-user-settings-fill',
  'plans':       'ri-bank-card-fill',
  'payments':    'ri-money-rupee-circle-fill',
  'permissions': 'ri-shield-check-fill',
  'profile':     'ri-account-circle-fill',
  'settings':    'ri-settings-3-fill',
  'my-plan':     'ri-calendar-schedule-fill',
};

const getLeafStyle = (slug: string): { color: string; icon: string } => {
  if (LEAF_ICON[slug]) return { color: ACCENT, icon: LEAF_ICON[slug] };
  if (slug.startsWith('master.')) return { color: ACCENT, icon: 'ri-folder-user-fill' };
  return { color: ACCENT, icon: 'ri-file-list-3-fill' };
};

export const emptyPerms = (): Record<PermKey, boolean> => ({
  can_view: false, can_add: false, can_edit: false, can_delete: false,
  can_export: false, can_import: false, can_approve: false,
});

/** Tri-state checkbox — shows indeterminate when 0 < on < total. */
function TriStateCheckbox({
  on, total, disabled, onToggle, title,
}: {
  on: number; total: number; disabled: boolean;
  onToggle: () => void; title: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = on > 0 && on < total;
  }, [on, total]);
  return (
    <div className="form-check d-flex justify-content-center m-0">
      <input
        ref={ref}
        type="checkbox"
        className="form-check-input"
        style={{ width: '0.95rem', height: '0.95rem', cursor: disabled ? 'not-allowed' : 'pointer' }}
        checked={total > 0 && on === total}
        onChange={onToggle}
        disabled={disabled}
        title={title}
      />
    </div>
  );
}

interface Props {
  modules: PermModule[];
  matrix: Record<number, Record<PermKey, boolean>>;
  onChange: (next: Record<number, Record<PermKey, boolean>>) => void;
  /** If provided, disables checkboxes user can't grant (keyed by module slug). Pass null for super admin. */
  grantableBy?: Record<string, Record<PermKey, boolean>> | null;
  loading?: boolean;
  /** Auto-expand all Master category parents by default */
  autoExpandMasterCategories?: boolean;
}

export default function PermissionMatrix({
  modules,
  matrix,
  onChange,
  grantableBy = null,
  loading = false,
  autoExpandMasterCategories = true,
}: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Build tree
  const tree = useMemo(() => {
    const byId = new Map<number, PermModule>();
    const children = new Map<number | null, PermModule[]>();
    modules.forEach(m => byId.set(m.id, m));
    modules.forEach(m => {
      const key = m.parent_id ?? null;
      if (!children.has(key)) children.set(key, []);
      children.get(key)!.push(m);
    });
    children.forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order));
    const roots = modules
      .filter(m => !m.parent_id || !byId.has(m.parent_id))
      .sort((a, b) => a.sort_order - b.sort_order);
    return { byId, children, roots };
  }, [modules]);

  // Auto-expand
  useEffect(() => {
    if (modules.length === 0) return;
    const next: Record<number, boolean> = {};
    // Master root auto-expands only when category auto-expand is on; pages
    // that want a fully-collapsed matrix pass autoExpandMasterCategories={false}.
    tree.roots.forEach(r => { next[r.id] = autoExpandMasterCategories && r.slug === 'master'; });
    if (autoExpandMasterCategories) {
      modules.forEach(m => {
        if (m.slug.startsWith('master.') && tree.children.has(m.id)) next[m.id] = true;
      });
    }
    setExpanded(prev => ({ ...next, ...prev }));
  }, [modules, tree, autoExpandMasterCategories]);

  const isLeaf = (m: PermModule) => !tree.children.has(m.id);
  const leaves = useMemo(() => modules.filter(isLeaf), [modules, tree]);

  const isPermAllowed = (slug: string, key: PermKey) => {
    if (!grantableBy) return true;
    if (grantableBy[slug] === undefined) return false;
    return !!grantableBy[slug][key];
  };

  const getDescendantLeaves = (parentId: number): PermModule[] => {
    const out: PermModule[] = [];
    const stack: number[] = [parentId];
    while (stack.length) {
      const id = stack.pop()!;
      const kids = tree.children.get(id) || [];
      kids.forEach(k => {
        if (isLeaf(k)) out.push(k);
        else stack.push(k.id);
      });
    }
    return out;
  };

  // All matrix mutations funnel through emit() so the "action implies view"
  // invariant is enforced no matter which control changed (single cell, row,
  // column, branch, or Select-All).
  const emit = (next: Record<number, Record<PermKey, boolean>>) => onChange(withImpliedView(next));

  const toggle = (modId: number, key: PermKey) => {
    const mod = tree.byId.get(modId);
    if (!mod || !isPermAllowed(mod.slug, key)) return;
    emit({
      ...matrix,
      [modId]: { ...(matrix[modId] || emptyPerms()), [key]: !(matrix[modId]?.[key]) },
    });
  };

  /** Toggle all 7 permissions on/off for a single leaf row. */
  const toggleRow = (modId: number) => {
    const mod = tree.byId.get(modId);
    if (!mod) return;
    const current = matrix[modId] || emptyPerms();
    const allowedKeys = PERMS.filter(p => isPermAllowed(mod.slug, p.key)).map(p => p.key);
    if (allowedKeys.length === 0) return;
    const allOn = allowedKeys.every(k => current[k]);
    const nextRow: Record<PermKey, boolean> = { ...current };
    allowedKeys.forEach(k => { nextRow[k] = !allOn; });
    emit({ ...matrix, [modId]: nextRow });
  };

  /** Row state — how many of 7 perms are granted for this leaf. */
  const rowSummary = (modId: number) => {
    const row = matrix[modId] || emptyPerms();
    const on = PERMS.filter(p => row[p.key]).length;
    return { on, total: PERMS.length };
  };

  const toggleBranch = (parentId: number, key: PermKey) => {
    const desc = getDescendantLeaves(parentId);
    if (desc.length === 0) return;
    const allOn = desc.every(m => matrix[m.id]?.[key]);
    const next = { ...matrix };
    desc.forEach(m => {
      if (!isPermAllowed(m.slug, key)) return;
      next[m.id] = { ...(next[m.id] || emptyPerms()), [key]: !allOn };
    });
    emit(next);
  };

  /** Toggle ALL perms × ALL descendant leaves under a parent. */
  const toggleBranchAll = (parentId: number) => {
    const desc = getDescendantLeaves(parentId);
    if (desc.length === 0) return;
    const totalSlots: [PermModule, PermKey][] = [];
    desc.forEach(m => PERMS.forEach(p => {
      if (isPermAllowed(m.slug, p.key)) totalSlots.push([m, p.key]);
    }));
    if (totalSlots.length === 0) return;
    const allOn = totalSlots.every(([m, k]) => matrix[m.id]?.[k]);
    const next = { ...matrix };
    totalSlots.forEach(([m, k]) => {
      next[m.id] = { ...(next[m.id] || emptyPerms()), [k]: !allOn };
    });
    emit(next);
  };

  const branchAllSummary = (parentId: number) => {
    const desc = getDescendantLeaves(parentId);
    let on = 0, total = 0;
    desc.forEach(m => PERMS.forEach(p => {
      if (!isPermAllowed(m.slug, p.key)) return;
      total++;
      if (matrix[m.id]?.[p.key]) on++;
    }));
    return { on, total };
  };

  const toggleColumn = (key: PermKey) => {
    const allOn = leaves.every(m => matrix[m.id]?.[key]);
    const next = { ...matrix };
    leaves.forEach(m => {
      if (!isPermAllowed(m.slug, key)) return;
      next[m.id] = { ...(next[m.id] || emptyPerms()), [key]: !allOn };
    });
    emit(next);
  };

  const selectAll = (val: boolean) => {
    const next: Record<number, Record<PermKey, boolean>> = {};
    leaves.forEach(m => {
      next[m.id] = {} as Record<PermKey, boolean>;
      PERMS.forEach(p => {
        next[m.id][p.key] = val && isPermAllowed(m.slug, p.key);
      });
    });
    emit(next);
  };

  const totalChecks = leaves.reduce((s, m) => s + PERMS.filter(p => matrix[m.id]?.[p.key]).length, 0);
  const maxChecks = leaves.length * PERMS.length;

  const branchSummary = (parentId: number, key: PermKey) => {
    const desc = getDescendantLeaves(parentId);
    const on = desc.filter(m => matrix[m.id]?.[key]).length;
    return { on, total: desc.length };
  };

  const toggleExpand = (id: number) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const renderRow = (mod: PermModule, depth: number): ReactElement[] => {
    const rows: ReactElement[] = [];
    const hasChildren = tree.children.has(mod.id);
    const rowPerms = matrix[mod.id] || emptyPerms();
    const isOpen = !!expanded[mod.id];

    if (hasChildren) {
      const { on: branchOn, total: branchTotal } = branchAllSummary(mod.id);
      const branchAllOn = branchTotal > 0 && branchOn === branchTotal;
      rows.push(
        <tr key={mod.id}>
          <td className="py-2" style={{ paddingLeft: `${0.75 + depth * 1.75}rem` }}>
            <div className="d-flex align-items-center gap-2">








              <button
                type="button"
                className="btn btn-sm p-0 border-0 bg-transparent"
                onClick={() => toggleExpand(mod.id)}
                style={{ width: 20, height: 20 }}
              >
                <i className={`ri-arrow-${isOpen ? 'down' : 'right'}-s-line fs-16 text-muted`}></i>
              </button>
              <div className="avatar-xs">
                <span
                  className="avatar-title rounded fs-4"
                  style={{ background: 'rgba(64,81,137,0.12)', color: ACCENT }}
                >
                  <i className={`ri-folder${isOpen ? '-open' : ''}-fill`}></i>
                </span>
              </div>
              <div>
                <strong>{mod.name}</strong>
                {mod.description && <div className="text-muted fs-11">{mod.description}</div>}
              </div>
              <Badge
                pill
                className="ms-2"
                style={{ background: ACCENT, color: '#fff' }}
              >
                {(tree.children.get(mod.id) || []).length}
              </Badge>
            </div>
          </td>
          <td className="text-center py-2">
            <TriStateCheckbox
              on={branchOn}
              total={branchTotal}
              disabled={branchTotal === 0}
              onToggle={() => toggleBranchAll(mod.id)}
              title={branchAllOn ? `Clear all perms for ${mod.name}` : `Grant all perms for ${mod.name}`}
            />
          </td>
          {PERMS.map(p => {
            const { on, total } = branchSummary(mod.id, p.key);
            const allOn = total > 0 && on === total;
            const partial = on > 0 && on < total;
            return (
              <td key={p.key} className="text-center py-2">
                <button
                  type="button"
                  onClick={() => toggleBranch(mod.id, p.key)}
                  title={`${on} / ${total} on`}
                  className={`btn btn-sm rounded-pill px-2 py-0 fw-semibold ${allOn ? 'btn-soft-success'
                      : partial ? 'btn-soft-warning'
                        : 'btn-soft-secondary'
                    }`}
                  style={{ fontSize: 10, minWidth: 40 }}
                >
                  {on}/{total}
                </button>
              </td>
            );
          })}
        </tr>
      );
      if (isOpen) {
        (tree.children.get(mod.id) || []).forEach(child => {
          rows.push(...renderRow(child, depth + 1));
        });
      }
    } else {
      const { on: rowOn, total: rowTotal } = rowSummary(mod.id);
      const rowAllOn = rowOn === rowTotal;
      const rowAllowedCount = PERMS.filter(p => isPermAllowed(mod.slug, p.key)).length;
      const leafStyle = getLeafStyle(mod.slug);
      rows.push(
        <tr
          key={mod.id}
          className="perm-leaf-row"
        >
          <td className="py-2" style={{ paddingLeft: `${0.75 + depth * 2.75}rem` }}>
            <div className="d-flex align-items-center gap-2">







              <div className="avatar-xs">
                <span
                  className="avatar-title rounded fs-4"
                  style={{ background: 'rgba(64,81,137,0.12)', color: ACCENT }}
                >
                  <i className={leafStyle.icon}></i>
                </span>
              </div>
              <strong>{mod.name}</strong>
              {mod.is_default && (
                <Badge
                  pill
                  className="text-uppercase ms-1"
                  style={{ background: ACCENT, color: '#fff' }}
                >
                  Default
                </Badge>
              )}
            </div>
          </td>
          <td className="text-center py-2">
            <TriStateCheckbox
              on={mod.is_default ? rowTotal : rowOn}
              total={rowTotal}
              disabled={rowAllowedCount === 0 || mod.is_default}
              onToggle={() => toggleRow(mod.id)}
              title={mod.is_default
                ? 'Default module — automatically granted to every user'
                : (rowAllOn ? 'Clear all permissions for this row' : 'Grant all permissions for this row')}
            />
          </td>
          {(() => {
            // View is locked ON whenever this row has any action flag set —
            // every action implies visibility, so it can't be unchecked while
            // an action is granted. Untick the actions first to free it.
            const anyActionOn = ACTION_KEYS.some(k => !!rowPerms[k]);
            return PERMS.map(p => {
              const lockedByAction = p.key === 'can_view' && anyActionOn && !mod.is_default;
              // Default modules (Dashboard, Profile) are auto-granted to every user
              // by SubscriptionController.activatePlan(). Lock the checkboxes so they
              // appear checked and read-only — toggling them off would be misleading
              // since the next plan activation re-grants them.
              const disabled = mod.is_default || !isPermAllowed(mod.slug, p.key) || lockedByAction;
              const checked = mod.is_default ? true : (lockedByAction ? true : !!rowPerms[p.key]);
              const title = mod.is_default
                ? 'Default module — automatically granted'
                : lockedByAction
                  ? 'View is required by Add / Edit / Delete / Export / Import / Approve'
                  : undefined;
              return (
                <td key={p.key} className="text-center py-2">
                  <div className="form-check d-flex justify-content-center m-0">
                    <Input
                      type="checkbox"
                      className="form-check-input"
                      style={{ width: '0.95rem', height: '0.95rem', cursor: disabled ? 'not-allowed' : 'pointer' }}
                      checked={checked}
                      onChange={() => toggle(mod.id, p.key)}
                      disabled={disabled}
                      title={title}
                    />
                  </div>
                </td>
              );
            });
          })()}
        </tr>
      );
    }
    return rows;
  };

  return (
    <>
      <CardBody className="border-top border-bottom" style={{ background: 'var(--vz-secondary-bg)', padding: '12px 20px' }}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Label */}
          <span className="  text-dark fs-11 fw-semibold text-uppercase  px-3 py-2 ">
            <i className="ri-flashlight-line me-1"></i> Quick Actions :
          </span>

          {/* Utility buttons — all uniform light */}
          <Button color="light" size="sm" className="rounded-pill px-3 border" onClick={() => selectAll(true)}>
            <i className="ri-checkbox-multiple-line me-1 align-bottom text-primary"></i> Select All
          </Button>
          <Button color="light" size="sm" className="rounded-pill px-3 border" onClick={() => selectAll(false)}>
            <i className="ri-checkbox-multiple-blank-line me-1 align-bottom text-secondary"></i> Deselect All
          </Button>
          <Button
            color="light" size="sm" className="rounded-pill px-3 border"
            onClick={() => {
              const next: Record<number, boolean> = {};
              modules.forEach(m => { if (tree.children.has(m.id)) next[m.id] = true; });
              setExpanded(next);
            }}
          >
            <i className="ri-expand-up-down-line me-1 align-bottom text-info"></i> Expand All
          </Button>
          <Button color="light" size="sm" className="rounded-pill px-3 border" onClick={() => setExpanded({})}>
            <i className="ri-contract-up-down-line me-1 align-bottom text-muted"></i> Collapse All
          </Button>

          <span className="vr mx-1 opacity-50"></span>

          {/* Per-permission column toggles — all light, icon carries the colour */}
          {PERMS.map(p => (
            <Button
              key={p.key}
              color="light"
              size="sm"
              className="rounded-pill px-3 border"
              onClick={() => toggleColumn(p.key)}
            >
              <i className={`${p.icon} me-1 align-bottom text-${p.color}`}></i>
              <span className="text-muted">{p.label}</span>
            </Button>
          ))}

          {/* Counter */}
          <span className="ms-auto text-muted fs-12 fw-medium">
            <strong className="text-dark fs-13">{totalChecks}</strong>
            {' / '}{maxChecks} enabled
          </span>
        </div>
      </CardBody>

      <div className="px-3 pt-3 pb-2">
        <style>{`
          .perm-matrix-table .form-check-input:checked {
            background-color: ${ACCENT};
            border-color: ${ACCENT};
          }
          .perm-matrix-table .form-check-input:indeterminate {
            background-color: ${ACCENT};
            border-color: ${ACCENT};
          }
        `}</style>
        <div
          className="table-responsive perm-matrix-table rounded-3"
          style={{ border: '1px solid var(--vz-border-color)', overflow: 'hidden' }}
        >
          {loading ? (
            /* Permission matrix shimmer — mirrors the table's actual
             * column layout (Module / All / Add / Read / Edit / Delete
             * / Approve / Reject / Export) so the user gets a clear
             * preview of the grid that's about to render. Previously
             * this showed a small centered spinner that gave no hint
             * of the data structure — the page felt blank during the
             * ~300ms fetch after picking a branch/user. */
            <table className="table align-middle table-nowrap mb-0">
              <thead>
                <tr style={{ background: 'var(--vz-secondary-bg)' }}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <th key={i} className="py-3" style={{ width: i === 0 ? '34%' : '8%' }}>
                      <div
                        className="shimmer"
                        style={{
                          height: 12,
                          width: i === 0 ? '60%' : '40%',
                          borderRadius: 6,
                          marginInline: i === 0 ? 12 : 'auto',
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, rowIdx) => (
                  <tr key={rowIdx} style={{ borderTop: '1px solid var(--vz-border-color)' }}>
                    <td className="ps-3 py-3">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="shimmer" style={{ width: 28, height: 28, borderRadius: 8 }} />
                        <div className="shimmer" style={{ width: 140, height: 12, borderRadius: 6 }} />
                      </div>
                    </td>
                    {Array.from({ length: 8 }).map((__, cellIdx) => (
                      <td key={cellIdx} className="text-center py-3">
                        <div className="shimmer mx-auto" style={{ width: 16, height: 16, borderRadius: 4 }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table align-middle table-nowrap table-hover mb-0">
              <thead>
                <tr style={{
                  background: 'var(--vz-secondary-bg)',
                  borderBottom: '2px solid var(--vz-primary)',
                }}>
                  <th className="ps-3 py-3 fw-bold text-uppercase align-items-center fs-11" style={{ width: '34%', color: 'var(--vz-primary)', letterSpacing: '0.04em' }}>
                    Module
                  </th>
                  <th className="text-center py-3" style={{ width: '8%' }}>
                    <div className="d-flex flex-row align-items-center gap-1">
                      <i className="ri-checkbox-multiple-line fs-14" style={{ color: 'var(--vz-primary)' }}></i>
                      <span className="fs-10 fw-bold text-uppercase" style={{ color: 'var(--vz-primary)', letterSpacing: '0.05em' }}>All</span>
                    </div>
                  </th>
                  {PERMS.map(p => (
                    <th key={p.key} className="text-center py-3" style={{ width: `${58 / PERMS.length}%` }}>
                      <div className="d-flex flex-row align-items-center gap-1">
                        <i className={`${p.icon} fs-14`} style={{ color: 'var(--vz-primary)' }}></i>
                        <span className="fs-10 fw-bold text-uppercase" style={{ color: 'var(--vz-primary)', letterSpacing: '0.05em' }}>{p.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tree.roots.flatMap(root => renderRow(root, 0))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Helper: returns only leaf module ids.
 * Call when building the save payload — parents should never have permission rows.
 */
export function extractLeafPermissions(
  modules: PermModule[],
  matrix: Record<number, Record<PermKey, boolean>>
) {
  const byId = new Map<number, PermModule>();
  const childrenMap = new Map<number | null, PermModule[]>();
  modules.forEach(m => byId.set(m.id, m));
  modules.forEach(m => {
    const key = m.parent_id ?? null;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(m);
  });
  const isLeaf = (m: PermModule) => !childrenMap.has(m.id);
  return modules.filter(isLeaf).map(m => {
    // Default modules (Dashboard, Profile) are always-on. Force every flag true so
    // the saved row matches what the UI shows as locked-checked.
    if (m.is_default) {
      return {
        module_id: m.id,
        can_view: true, can_add: true, can_edit: true, can_delete: true,
        can_export: true, can_import: true, can_approve: true,
      };
    }
    return { module_id: m.id, ...(matrix[m.id] || emptyPerms()) };
  });
}
