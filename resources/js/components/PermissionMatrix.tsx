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
  { key: 'can_view',    label: 'View',    icon: 'ri-eye-line',           color: 'info' },
  { key: 'can_add',     label: 'Add',     icon: 'ri-add-line',           color: 'success' },
  { key: 'can_edit',    label: 'Edit',    icon: 'ri-pencil-line',        color: 'warning' },
  { key: 'can_delete',  label: 'Delete',  icon: 'ri-delete-bin-line',    color: 'danger' },
  { key: 'can_export',  label: 'Export',  icon: 'ri-download-2-line',    color: 'primary' },
  { key: 'can_import',  label: 'Import',  icon: 'ri-upload-2-line',      color: 'secondary' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line',  color: 'primary' },
];

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
        <tr key={mod.id} style={{ background: depth === 0 ? '#eef2ff' : '#f8fafc', lineHeight: 1.2 }}>
          <td className="py-2" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-sm p-0 border-0 bg-transparent"
                onClick={() => toggleExpand(mod.id)}
                style={{ width: 20, height: 20 }}
              >
                <i className={`ri-arrow-${isOpen ? 'down' : 'right'}-s-line fs-16 ${depth === 0 ? 'text-primary' : 'text-secondary'}`}></i>
              </button>
              <span className={`d-inline-flex align-items-center justify-content-center rounded ${depth === 0 ? 'bg-primary text-white' : 'bg-primary-subtle text-primary'}`} style={{ width: 26, height: 26 }}>
                <i className={`ri-folder${isOpen ? '-open' : ''}-line fs-13`}></i>
              </span>
              <div>
                <span className={`fw-bold ${depth === 0 ? 'text-primary fs-14' : 'text-dark fs-13'}`}>{mod.name}</span>
                {mod.description && <div className="text-muted fs-11">{mod.description}</div>}
              </div>
              <Badge color={depth === 0 ? 'primary' : 'secondary-subtle'} className={depth === 0 ? 'ms-2' : 'ms-2 text-secondary'}>
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
                  className={`btn btn-sm rounded-pill px-2 py-0 ${allOn ? `btn-${p.color}` : partial ? `btn-soft-${p.color}` : 'btn-light text-muted'}`}
                  style={{ fontSize: 10, fontWeight: 700, minWidth: 42 }}
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
      rows.push(
        <tr key={mod.id} style={{ lineHeight: 1.2 }}>
          <td className="py-2" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
            <div className="d-flex align-items-center gap-2">
              <span className="text-muted" style={{ width: 20, display: 'inline-block' }}>·</span>
              <span className="d-inline-flex align-items-center justify-content-center rounded bg-light text-muted" style={{ width: 22, height: 22 }}>
                <i className="ri-file-list-3-line fs-12"></i>
              </span>
              <span className="fw-medium text-dark fs-13">{mod.name}</span>
              {mod.is_default && <Badge color="success-subtle" className="text-success fs-10 rounded-pill ms-1">DEFAULT</Badge>}
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
          <Button
            color="soft-info" size="sm" className="rounded-pill px-3"
            onClick={() => {
              const next: Record<number, boolean> = {};
              modules.forEach(m => { if (tree.children.has(m.id)) next[m.id] = true; });
              setExpanded(next);
            }}
          >
            <i className="ri-expand-up-down-line me-1 align-bottom"></i> Expand All
          </Button>
          <Button
            color="soft-secondary" size="sm" className="rounded-pill px-3"
            onClick={() => setExpanded({})}
          >
            <i className="ri-contract-up-down-line me-1 align-bottom"></i> Collapse All
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
        {loading ? (
          <div className="text-center py-5"><Spinner color="primary" /> <span className="ms-2 text-muted">Loading permissions...</span></div>
        ) : (
          <table className="table align-middle table-nowrap table-hover table-sm mb-0">
            <thead className="table-light">
              <tr>
                <th className="ps-3 py-2" style={{ width: '34%' }}>Module</th>
                <th className="text-center py-2" style={{ width: '8%' }}>
                  <div className="d-flex flex-column align-items-center gap-1">
                    <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary" style={{ width: '22px', height: '22px' }}>
                      <i className="ri-checkbox-multiple-line fs-12"></i>
                    </span>
                    <span className="fs-11 fw-semibold text-uppercase">All</span>
                  </div>
                </th>
                {PERMS.map(p => (
                  <th key={p.key} className="text-center py-2" style={{ width: `${58 / PERMS.length}%` }}>
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
              {tree.roots.flatMap(root => renderRow(root, 0))}
            </tbody>
          </table>
        )}
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
