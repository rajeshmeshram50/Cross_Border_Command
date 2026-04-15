import { useState } from 'react';
import Button from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import { ShieldCheck, Check, ChevronDown, ChevronRight, Eye, Plus, Pencil, Trash2, CheckSquare, XSquare } from 'lucide-react';

/* ── Module Tree Data ── */
interface Module {
  id: string;
  label: string;
  children: Module[];
}

const MODULES: Module[] = [
  { id: 'dashboard', label: 'Dashboard / Analytics', children: [] },
  { id: 'sales', label: 'Sales Matrix', children: [
    { id: 'sales_cust', label: 'Customer Master', children: [] },
    { id: 'sales_crm', label: 'Sales CRM', children: [] },
    { id: 'sales_analytics', label: 'Sales Analytics', children: [] },
    { id: 'sales_lead', label: 'Lead Worksheet', children: [] },
  ]},
  { id: 'p2p', label: 'Procure to Pay (P2P)', children: [
    { id: 'p2p_product', label: 'Product Master', children: [] },
    { id: 'p2p_vendor', label: 'Vendor Master', children: [] },
    { id: 'p2p_po', label: 'Purchase Order (PO)', children: [] },
    { id: 'p2p_vti', label: 'Vendor Tax Invoice (VTI)', children: [] },
  ]},
  { id: 'clm', label: 'Contract Lifecycle (CLM)', children: [] },
  { id: 'gts', label: 'GTS (E-Docs)', children: [
    { id: 'gts_remit', label: 'Remittance Vault', children: [] },
    { id: 'gts_export', label: 'Export Paper', children: [] },
    { id: 'gts_ocr', label: 'OCR', children: [] },
  ]},
  { id: 'ims', label: 'Inventory (IMS)', children: [
    { id: 'ims_grn', label: 'GRN', children: [] },
    { id: 'ims_qa', label: 'QA', children: [] },
    { id: 'ims_out', label: 'Outward', children: [] },
    { id: 'ims_psd', label: 'PSD', children: [] },
    { id: 'ims_ebrc', label: 'e-BRC', children: [] },
  ]},
  { id: 'hrms', label: 'HRMS', children: [
    { id: 'hrms_emp', label: 'Employees', children: [] },
    { id: 'hrms_payroll', label: 'Payroll', children: [] },
    { id: 'hrms_leave', label: 'Leave', children: [] },
    { id: 'hrms_perf', label: 'Performance', children: [] },
    { id: 'hrms_recruit', label: 'Recruitment', children: [] },
  ]},
  { id: 'pwd_mgr', label: 'Password Manager', children: [] },
  { id: 'master', label: 'Master', children: [] },
  { id: 'billing', label: 'Billing', children: [] },
  { id: 'settings_mod', label: 'Settings', children: [] },
];

const PERMS = ['View', 'Add', 'Edit', 'Delete'] as const;
const PERM_ICONS = { View: Eye, Add: Plus, Edit: Pencil, Delete: Trash2 };

export default function Permissions() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    MODULES.forEach(m => { if (m.children.length) init[m.id] = true; });
    return init;
  });

  const toggle = (modId: string, perm: string) => {
    setMatrix(prev => ({
      ...prev,
      [modId]: { ...(prev[modId] || {}), [perm]: !(prev[modId]?.[perm]) },
    }));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Toggle entire column
  const toggleColumn = (perm: string) => {
    const allIds = getAllIds();
    const allOn = allIds.every(id => matrix[id]?.[perm]);
    const next = { ...matrix };
    allIds.forEach(id => { next[id] = { ...(next[id] || {}), [perm]: !allOn }; });
    setMatrix(next);
  };

  // Toggle entire row (all 4 perms for a module + its children)
  const toggleRow = (mod: Module, val: boolean) => {
    const next = { ...matrix };
    const setAll = (m: Module) => {
      next[m.id] = {};
      PERMS.forEach(p => { next[m.id][p] = val; });
      m.children.forEach(setAll);
    };
    setAll(mod);
    setMatrix(next);
  };

  // Select All / Deselect All
  const selectAll = (val: boolean) => {
    const next: Record<string, Record<string, boolean>> = {};
    getAllIds().forEach(id => {
      next[id] = {};
      PERMS.forEach(p => { next[id][p] = val; });
    });
    setMatrix(next);
  };

  function getAllIds(): string[] {
    const ids: string[] = [];
    const collect = (m: Module) => { ids.push(m.id); m.children.forEach(collect); };
    MODULES.forEach(collect);
    return ids;
  }

  // Count checked
  const allIds = getAllIds();
  const totalChecks = allIds.reduce((s, id) => s + PERMS.filter(p => matrix[id]?.[p]).length, 0);
  const maxChecks = allIds.length * PERMS.length;

  return (
    <div>
      {/* ═══ Header ═══ */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-violet-400 flex items-center justify-center shadow-lg shadow-primary/20">
            <ShieldCheck size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-extrabold text-text tracking-tight">Permission Management</h1>
            <p className="text-[12px] text-muted mt-0.5">Configure module-level CRUD permissions per client</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select>
            <option value="">Select Client...</option>
            <option>Rajesh Meshram Enterprises</option>
            <option>Hockey Maharashtra</option>
            <option>Curious Learner</option>
            <option>Inorbvict Agrotech</option>
          </Select>
          <Select>
            <option value="">Select Role...</option>
            <option>Client Admin</option>
            <option>Branch Manager</option>
            <option>Staff</option>
            <option>Viewer</option>
          </Select>
          <Button><Check size={13} /> Save</Button>
        </div>
      </div>

      {/* ═══ Quick Actions Bar ═══ */}
      <div className="flex items-center gap-2 mb-4 flex-wrap px-1">
        <span className="text-[10.5px] font-bold text-muted uppercase tracking-wider">Quick:</span>
        <Button variant="outline" size="sm" onClick={() => selectAll(true)}><CheckSquare size={12} /> Select All</Button>
        <Button variant="outline" size="sm" onClick={() => selectAll(false)}><XSquare size={12} /> Deselect All</Button>
        <div className="w-px h-5 bg-border mx-1" />
        {PERMS.map(p => {
          const Icon = PERM_ICONS[p];
          return (
            <button key={p} onClick={() => toggleColumn(p)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-border bg-surface text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer">
              <Icon size={11} /> {p}
            </button>
          );
        })}
        <span className="text-[10.5px] text-muted ml-auto">{totalChecks} / {maxChecks} permissions enabled</span>
      </div>

      {/* ═══ Permission Matrix Table ═══ */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 640 }}>
            {/* Header */}
            <thead>
              <tr className="bg-sidebar">
                <th className="text-left px-4 py-3 text-[9.5px] font-bold tracking-wider uppercase text-white/55" style={{ width: '45%' }}>
                  Module / Sub-module
                </th>
                {PERMS.map(p => {
                  const Icon = PERM_ICONS[p];
                  return (
                    <th key={p} className="text-center px-2 py-3" style={{ width: '13.75%' }}>
                      <div className="flex flex-col items-center gap-1">
                        <Icon size={13} className="text-white/50" />
                        <span className="text-[9.5px] font-bold tracking-wider uppercase text-white/55">{p}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {MODULES.map(mod => (
                <ModuleRow
                  key={mod.id}
                  mod={mod}
                  depth={0}
                  matrix={matrix}
                  expanded={expanded}
                  onTogglePerm={toggle}
                  onToggleExpand={toggleExpand}
                  onToggleRow={toggleRow}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/50 bg-surface-2 flex items-center justify-between">
          <span className="text-[11.5px] text-muted">
            {totalChecks > 0
              ? <><span className="font-bold text-primary">{totalChecks}</span> permissions enabled across {allIds.length} modules</>
              : 'No permissions configured yet — select a client and assign access'
            }
          </span>
          <Button><Check size={13} /> Save Permissions</Button>
        </div>
      </div>
    </div>
  );
}

/* ── Module Row Component (recursive for children) ── */
function ModuleRow({ mod, depth, matrix, expanded, onTogglePerm, onToggleExpand, onToggleRow }: {
  mod: Module;
  depth: number;
  matrix: Record<string, Record<string, boolean>>;
  expanded: Record<string, boolean>;
  onTogglePerm: (id: string, perm: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleRow: (mod: Module, val: boolean) => void;
}) {
  const hasChildren = mod.children.length > 0;
  const isExpanded = expanded[mod.id] ?? false;
  const isParent = depth === 0;

  // Check if all perms are on for this row
  const allOn = PERMS.every(p => matrix[mod.id]?.[p]);

  return (
    <>
      {/* This module's row */}
      <tr className={`border-b border-border/30 transition-colors hover:bg-primary/[.03] ${isParent ? 'bg-surface-2/50' : ''}`}>
        {/* Module Name Cell */}
        <td className="px-4 py-0">
          <div className="flex items-center h-11" style={{ paddingLeft: depth * 32 }}>
            {/* Tree connector for children */}
            {depth > 0 && (
              <div className="flex items-center mr-2.5 flex-shrink-0">
                <span className="w-4 h-px bg-border" />
              </div>
            )}

            {/* Expand/Collapse button */}
            {hasChildren ? (
              <button
                onClick={() => onToggleExpand(mod.id)}
                className="w-6 h-6 rounded-md border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all mr-2.5 cursor-pointer flex-shrink-0"
              >
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            ) : (
              <span className={`${depth > 0 ? '' : 'w-6 mr-2.5'} flex-shrink-0`} />
            )}

            {/* Label */}
            <span
              className={`${isParent ? 'text-[13px] font-bold text-text' : 'text-[12.5px] text-secondary'} truncate`}
              onClick={() => hasChildren && onToggleExpand(mod.id)}
              style={{ cursor: hasChildren ? 'pointer' : 'default' }}
            >
              {mod.label}
            </span>

            {/* Child count badge */}
            {hasChildren && (
              <span className="ml-2 text-[10px] font-semibold text-muted bg-bg border border-border rounded-full px-1.5 py-px flex-shrink-0">
                {mod.children.length}
              </span>
            )}

            {/* Row toggle (select all for this row) */}
            {isParent && (
              <button
                onClick={() => onToggleRow(mod, !allOn)}
                title={allOn ? 'Deselect row' : 'Select row'}
                className="ml-auto text-[10px] font-semibold text-muted hover:text-primary transition-colors cursor-pointer flex-shrink-0 opacity-0 group-hover:opacity-100"
              >
                {allOn ? '✕' : '✓ all'}
              </button>
            )}
          </div>
        </td>

        {/* Permission Checkboxes */}
        {PERMS.map(p => (
          <td key={p} className="text-center px-2 py-0">
            <div className="flex items-center justify-center h-11">
              <input
                type="checkbox"
                checked={!!matrix[mod.id]?.[p]}
                onChange={() => onTogglePerm(mod.id, p)}
                className="w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer transition-all hover:border-primary/50"
              />
            </div>
          </td>
        ))}
      </tr>

      {/* Children rows */}
      {hasChildren && isExpanded && mod.children.map(child => (
        <ModuleRow
          key={child.id}
          mod={child}
          depth={depth + 1}
          matrix={matrix}
          expanded={expanded}
          onTogglePerm={onTogglePerm}
          onToggleExpand={onToggleExpand}
          onToggleRow={onToggleRow}
        />
      ))}
    </>
  );
}
