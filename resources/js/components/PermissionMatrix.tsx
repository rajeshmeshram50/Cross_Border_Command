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

export const PERMS: { key: PermKey; label: string; icon: string; color: string }[] = [
  { key: 'can_view', label: 'View', icon: 'ri-eye-line', color: 'info' },
  { key: 'can_add', label: 'Add', icon: 'ri-add-line', color: 'success' },
  { key: 'can_edit', label: 'Edit', icon: 'ri-pencil-line', color: 'warning' },
  { key: 'can_delete', label: 'Delete', icon: 'ri-delete-bin-line', color: 'danger' },
  { key: 'can_export', label: 'Export', icon: 'ri-download-2-line', color: 'primary' },
  { key: 'can_import', label: 'Import', icon: 'ri-upload-2-line', color: 'secondary' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line', color: 'primary' },
];

// Per-leaf accent — each top-level leaf row (Dashboard, Branches, etc.) gets a
// distinct icon + color chip so the table isn't visually flat.
const LEAF_STYLE: Record<string, { color: string; icon: string }> = {
  'dashboard':   { color: '#405189', icon: 'ri-dashboard-2-line' },
  'clients':     { color: '#299cdb', icon: 'ri-building-line' },
  'branches':    { color: '#0ab39c', icon: 'ri-git-branch-line' },
  'employees':   { color: '#f7b84b', icon: 'ri-user-settings-line' },
  'plans':       { color: '#7c5cfc', icon: 'ri-bank-card-line' },
  'payments':    { color: '#10b981', icon: 'ri-money-rupee-circle-line' },
  'permissions': { color: '#e83e8c', icon: 'ri-shield-check-line' },
  'profile':     { color: '#6b7280', icon: 'ri-account-circle-line' },
  'settings':    { color: '#495057', icon: 'ri-settings-3-line' },
  'my-plan':     { color: '#7c5cfc', icon: 'ri-calendar-schedule-line' },
};

const getLeafStyle = (slug: string): { color: string; icon: string } => {
  if (LEAF_STYLE[slug]) return LEAF_STYLE[slug];
  // Master sub-items share a navy family so they tie back to the parent row.
  if (slug.startsWith('master.')) return { color: '#6691e7', icon: 'ri-folder-user-line' };
  return { color: '#6b7280', icon: 'ri-file-list-3-line' };
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
    tree.roots.forEach(r => { next[r.id] = r.slug === 'master'; });
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

  const toggle = (modId: number, key: PermKey) => {
    const mod = tree.byId.get(modId);
    if (!mod || !isPermAllowed(mod.slug, key)) return;
    onChange({
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
    onChange({ ...matrix, [modId]: nextRow });
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
    onChange(next);
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
    onChange(next);
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
    onChange(next);
  };

  const selectAll = (val: boolean) => {
    const next: Record<number, Record<PermKey, boolean>> = {};
    leaves.forEach(m => {
      next[m.id] = {} as Record<PermKey, boolean>;
      PERMS.forEach(p => {
        next[m.id][p.key] = val && isPermAllowed(m.slug, p.key);
      });
    });
    onChange(next);
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
        <tr
          key={mod.id}
          style={{
            background: 'rgba(64,81,137,0.06)',
            borderLeft: '3px solid #405189',
            lineHeight: 1.2,
          }}
        >
          <td className="py-2" style={{ paddingLeft: `0.75rem` }}>
            <div className="d-flex align-items-center gap-2">








              <button
                type="button"
                className="btn btn-sm p-0 border-0 bg-transparent"
                onClick={() => toggleExpand(mod.id)}
                style={{ width: 20, height: 20 }}
              >
                <i className={`ri-arrow-${isOpen ? 'down' : 'right'}-s-line fs-16`} style={{ color: '#405189' }}></i>
              </button>
              <span
                className="d-inline-flex align-items-center justify-content-center rounded"
                style={{
                  width: 26, height: 26,
                  background: 'linear-gradient(135deg,#405189,#6691e7)',
                  color: '#fff',
                  boxShadow: '0 2px 6px rgba(64,81,137,0.3)',
                }}
              >
                <i className={`ri-folder${isOpen ? '-open' : ''}-line fs-13`}></i>
              </span>
              <div>
                <span className="fw-bold fs-14" style={{ color: '#405189' }}>{mod.name}</span>
                {mod.description && <div className="text-muted fs-11">{mod.description}</div>}
              </div>
              <span
                className="ms-2 fs-10 fw-bold rounded-pill px-2 py-1"
                style={{
                  background: 'linear-gradient(135deg,#405189,#6691e7)',
                  color: '#fff',
                }}
              >
                {(tree.children.get(mod.id) || []).length}
              </span>
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
      // Top-level leaves (Dashboard, Branches, Employees, Profile) get the colored
      // Master-style treatment with their own color. Leaves nested under Master stay plain.
      const isTopLevel = depth === 0;
      rows.push(
        <tr
          key={mod.id}
          className="perm-leaf-row"
          style={
            {
              lineHeight: 1.2,
              background: isTopLevel ? `${leafStyle.color}0d` : undefined,
              borderLeft: isTopLevel ? `3px solid ${leafStyle.color}` : undefined,
              ['--leaf-color' as any]: leafStyle.color,
              ['--leaf-color-soft' as any]: `${leafStyle.color}1a`,
            } as React.CSSProperties
          }
        >
          <td className="py-2" style={{ paddingLeft: `0.75rem` }}>
            <div className="d-flex align-items-center gap-2">







              <span
                className="d-inline-flex align-items-center justify-content-center rounded"
                style={{
                  width: 26, height: 26,
                  background: isTopLevel
                    ? `linear-gradient(135deg, ${leafStyle.color}, ${leafStyle.color}cc)`
                    : 'rgba(64,81,137,0.08)',
                  color: isTopLevel ? '#fff' : '#405189',
                  flexShrink: 0,
                  boxShadow: isTopLevel ? `0 2px 6px ${leafStyle.color}40` : undefined,
                }}
              >
                <i className={`${leafStyle.icon} fs-13`}></i>
              </span>
              <span
                className={isTopLevel ? 'fw-bold fs-14' : 'fw-semibold fs-13'}
                style={{ color: isTopLevel ? leafStyle.color : '#1f2937' }}
              >
                {mod.name}
              </span>
              {mod.is_default && (
                <Badge
                  pill
                  className="fs-10 ms-1"
                  style={{
                    background: '#fff',
                    color: leafStyle.color,
                    border: `1px solid ${leafStyle.color}`,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  DEFAULT
                </Badge>
              )}
            </div>
          </td>
          <td className="text-center py-2">
            <TriStateCheckbox
              on={rowOn}
              total={rowTotal}
              disabled={rowAllowedCount === 0}
              onToggle={() => toggleRow(mod.id)}
              title={rowAllOn ? 'Clear all permissions for this row' : 'Grant all permissions for this row'}
            />
          </td>
          {PERMS.map(p => {
            const disabled = !isPermAllowed(mod.slug, p.key);
            return (
              <td key={p.key} className="text-center py-2">
                <div className="form-check d-flex justify-content-center m-0">
                  <Input
                    type="checkbox"
                    className="form-check-input"
                    style={{ width: '0.95rem', height: '0.95rem', cursor: disabled ? 'not-allowed' : 'pointer' }}
                    checked={!!rowPerms[p.key]}
                    onChange={() => toggle(mod.id, p.key)}
                    disabled={disabled}
                  />
                </div>
              </td>
            );
          })}
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
        <div
          className="table-responsive rounded-3"
          style={{ border: '1px solid var(--vz-border-color)', overflow: 'hidden' }}
        >
          {loading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
              <span className="ms-2 text-muted">Loading permissions...</span>
            </div>
          ) : (
            <table className="table align-middle table-nowrap table-hover mb-0">
              <thead>
                <tr style={{
                  background: 'linear-gradient(180deg, #5a626e, #8b939f)',
                  boxShadow: '0 2px 4px rgba(64,81,137,0.15)',
                }}>
                  <th className="ps-3 py-3 fw-bold text-uppercase fs-11" style={{ width: '34%', color: '#fff', letterSpacing: '0.04em' }}>
                    Module
                  </th>
                  <th className="text-center py-3" style={{ width: '8%' }}>
                    <div className="d-flex flex-column align-items-center gap-1">
                      <i className="ri-checkbox-multiple-line fs-14" style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                      <span className="fs-10 fw-bold text-uppercase" style={{ color: '#fff', letterSpacing: '0.05em' }}>All</span>
                    </div>
                  </th>
                  {PERMS.map(p => (
                    <th key={p.key} className="text-center py-3" style={{ width: `${58 / PERMS.length}%` }}>
                      <div className="d-flex flex-column align-items-center gap-1">
                        <i className={`${p.icon} fs-14`} style={{ color: 'rgba(255,255,255,0.9)' }}></i>
                        <span className="fs-10 fw-bold text-uppercase" style={{ color: '#fff', letterSpacing: '0.05em' }}>{p.label}</span>
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
  return modules.filter(isLeaf).map(m => ({ module_id: m.id, ...(matrix[m.id] || emptyPerms()) }));
}
