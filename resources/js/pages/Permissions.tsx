import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import { Select } from '../components/ui/Input';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  ShieldCheck, Check, Eye, Plus, Pencil, Trash2,
  CheckSquare, XSquare, Loader2, AlertCircle, Download, Upload, Stamp
} from 'lucide-react';

interface Module { id: number; name: string; slug: string; icon: string; is_default: boolean; }
interface ManagedUser { id: number; name: string; email: string; user_type: string; client_id?: number; branch_id?: number; client?: { id: number; org_name: string }; branch?: { id: number; name: string }; status: string; }
type PermKey = 'can_view' | 'can_add' | 'can_edit' | 'can_delete' | 'can_export' | 'can_import' | 'can_approve';

const PERMS: { key: PermKey; label: string; icon: typeof Eye }[] = [
  { key: 'can_view', label: 'View', icon: Eye },
  { key: 'can_add', label: 'Add', icon: Plus },
  { key: 'can_edit', label: 'Edit', icon: Pencil },
  { key: 'can_delete', label: 'Delete', icon: Trash2 },
  { key: 'can_export', label: 'Export', icon: Download },
  { key: 'can_import', label: 'Import', icon: Upload },
  { key: 'can_approve', label: 'Approve', icon: Stamp },
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

  // Load modules and users on mount
  useEffect(() => {
    Promise.all([
      api.get('/modules'),
      api.get('/permissions/users'),
    ]).then(([modRes, usersRes]) => {
      let mods: Module[] = modRes.data;
      if (!isSuperAdmin) {
        mods = mods.filter(m => !['clients', 'plans', 'payments', 'settings'].includes(m.slug));
      }
      setModules(mods);
      setUsers(usersRes.data);
    }).finally(() => setLoading(false));

    // Client admin: load own permissions for enforcement
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

  // Load permissions when user selected — fetch fresh from API every time
  const loadUserPermissions = (userId: string) => {
    if (!userId || modules.length === 0) {
      setMatrix({});
      return;
    }

    setLoadingPerms(true);

    // Initialize all modules to empty first
    const freshMatrix: Record<number, Record<PermKey, boolean>> = {};
    modules.forEach(mod => { freshMatrix[mod.id] = emptyPerms(); });

    api.get(`/permissions/user/${userId}`).then(res => {
      // Overlay saved permissions on top
      (res.data.permissions || []).forEach((p: any) => {
        if (freshMatrix[p.module_id]) {
          freshMatrix[p.module_id] = {
            can_view: !!p.can_view,
            can_add: !!p.can_add,
            can_edit: !!p.can_edit,
            can_delete: !!p.can_delete,
            can_export: !!p.can_export,
            can_import: !!p.can_import,
            can_approve: !!p.can_approve,
          };
        }
      });
      setMatrix({ ...freshMatrix });
    }).catch(() => {
      setMatrix({ ...freshMatrix });
    }).finally(() => setLoadingPerms(false));
  };

  // When user or modules change, reload permissions
  useEffect(() => {
    if (selectedUserId && modules.length > 0) {
      loadUserPermissions(selectedUserId);
    }
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
        return {
          module_id: m.id,
          can_view: !!p.can_view,
          can_add: !!p.can_add,
          can_edit: !!p.can_edit,
          can_delete: !!p.can_delete,
          can_export: !!p.can_export,
          can_import: !!p.can_import,
          can_approve: !!p.can_approve,
        };
      });
      console.log('Saving permissions:', JSON.stringify(permissions));
      const res = await api.post(`/permissions/user/${selectedUserId}`, { permissions });
      toast.success('Permissions Saved', `${res.data.saved_count} module permissions saved successfully`);
      // Reload to confirm saved correctly
      loadUserPermissions(selectedUserId);
    } catch (err: any) {
      toast.error('Save Failed', err.response?.data?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  // Count
  const totalChecks = Object.values(matrix).reduce((s, m) => s + PERMS.filter(p => m[p.key]).length, 0);
  const maxChecks = modules.length * PERMS.length;
  const selectedUser = users.find(u => u.id === Number(selectedUserId));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted text-[13px]">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-violet-400 flex items-center justify-center shadow-lg shadow-primary/20">
            <ShieldCheck size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-extrabold text-text tracking-tight">Permission Management</h1>
            <p className="text-[12px] text-muted mt-0.5">
              {isSuperAdmin
                ? 'Assign module permissions to client admins & branch users'
                : 'Assign module permissions to branch users'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
            <option value="">
              {isSuperAdmin ? 'Select User...' : 'Select Branch User...'}
            </option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.email}
                {u.client ? ` (${u.client.org_name})` : ''}
                {u.branch ? ` · ${u.branch.name}` : ''}
                {` [${u.user_type.replace('_', ' ')}]`}
              </option>
            ))}
          </Select>
          <Button onClick={handleSave} disabled={saving || !selectedUserId}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* No users message */}
      {users.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-700 mb-4">
          <AlertCircle size={14} />
          {isSuperAdmin
            ? 'No client admins found. Create a client first to assign permissions.'
            : 'No branch users found. Create a branch first to assign permissions.'}
        </div>
      )}

      {/* Info banner for client admin */}
      {!isSuperAdmin && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20 text-[12px] text-primary mb-4">
          <ShieldCheck size={14} />
          You can only grant permissions that you have. Disabled checkboxes indicate permissions you don't have.
        </div>
      )}

      {/* Selected user info */}
      {selectedUser && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500/5 border border-sky-500/20 text-[12px] text-sky-700 mb-4">
          <Eye size={14} />
          Editing permissions for <strong className="mx-1">{selectedUser.name}</strong>
          ({selectedUser.user_type.replace('_', ' ')})
          {selectedUser.client && <> · {selectedUser.client.org_name}</>}
          {selectedUser.branch && <> · {selectedUser.branch.name}</>}
        </div>
      )}

      {selectedUserId && (
        <>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 mb-4 flex-wrap px-1">
            <span className="text-[10.5px] font-bold text-muted uppercase tracking-wider">Quick:</span>
            <Button variant="outline" size="sm" onClick={() => selectAll(true)}><CheckSquare size={12} /> Select All</Button>
            <Button variant="outline" size="sm" onClick={() => selectAll(false)}><XSquare size={12} /> Deselect All</Button>
            <div className="w-px h-5 bg-border mx-1" />
            {PERMS.map(p => (
              <button key={p.key} onClick={() => toggleColumn(p.key)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-border bg-surface text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer">
                <p.icon size={11} /> {p.label}
              </button>
            ))}
            <span className="text-[10.5px] text-muted ml-auto">{totalChecks} / {maxChecks} enabled</span>
          </div>

          {/* Matrix */}
          <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
            {loadingPerms ? (
              <div className="flex items-center justify-center py-12 text-muted text-[12px]">
                <Loader2 size={18} className="animate-spin mr-2" /> Loading permissions...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 800 }}>
                  <thead>
                    <tr className="bg-sidebar">
                      <th className="text-left px-4 py-3 text-[9.5px] font-bold tracking-wider uppercase text-white/55" style={{ width: '30%' }}>
                        Module
                      </th>
                      {PERMS.map(p => (
                        <th key={p.key} className="text-center px-2 py-3" style={{ width: `${70 / PERMS.length}%` }}>
                          <div className="flex flex-col items-center gap-1">
                            <p.icon size={13} className="text-white/50" />
                            <span className="text-[9.5px] font-bold tracking-wider uppercase text-white/55">{p.label}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map(mod => {
                      const rowPerms = matrix[mod.id] || emptyPerms();
                      const allOn = PERMS.every(p => rowPerms[p.key]);
                      return (
                        <tr key={mod.id} className="border-b border-border/30 hover:bg-primary/[.03] transition-colors group">
                          <td className="px-4 py-0">
                            <div className="flex items-center h-11 gap-2.5">
                              <span className="text-[13px] font-bold text-text">{mod.name}</span>
                              {mod.is_default && (
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">DEFAULT</span>
                              )}
                              <button
                                onClick={() => {
                                  const next = { ...matrix };
                                  next[mod.id] = {} as Record<PermKey, boolean>;
                                  PERMS.forEach(p => {
                                    if (!isSuperAdmin && myPerms && myPerms[mod.slug] && !myPerms[mod.slug][p.key]) {
                                      next[mod.id][p.key] = false;
                                    } else {
                                      next[mod.id][p.key] = !allOn;
                                    }
                                  });
                                  setMatrix(next);
                                }}
                                className="ml-auto text-[10px] font-semibold text-muted hover:text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100">
                                {allOn ? 'deselect' : 'select all'}
                              </button>
                            </div>
                          </td>
                          {PERMS.map(p => {
                            const disabled = !isSuperAdmin && myPerms && myPerms[mod.slug] !== undefined && !myPerms[mod.slug][p.key];
                            return (
                              <td key={p.key} className="text-center px-2 py-0">
                                <div className="flex items-center justify-center h-11">
                                  <input
                                    type="checkbox"
                                    checked={!!rowPerms[p.key]}
                                    onChange={() => toggle(mod.id, p.key)}
                                    disabled={!!disabled}
                                    className={`w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer transition-all hover:border-primary/50 ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
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
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border/50 bg-surface-2 flex items-center justify-between">
              <span className="text-[11.5px] text-muted">
                {selectedUser ? (
                  <>Editing: <strong className="text-text">{selectedUser.name}</strong> ({selectedUser.user_type.replace('_', ' ')})</>
                ) : 'Select a user to configure permissions'}
                {totalChecks > 0 && <> · <span className="font-bold text-primary">{totalChecks}</span> permissions enabled</>}
              </span>
              <Button onClick={handleSave} disabled={saving || !selectedUserId}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Save Permissions
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
