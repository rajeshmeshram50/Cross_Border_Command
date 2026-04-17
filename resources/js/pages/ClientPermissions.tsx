import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  ShieldCheck, ArrowLeft, Loader2, CheckCircle2, XCircle, Eye, Plus,
  Pencil, Trash2, Download, Upload, Stamp, Check, AlertCircle, Users
} from 'lucide-react';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

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

export default function ClientPermissions({ clientId, clientName, onBack }: Props) {
  const toast = useToast();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<Record<number, Record<PermKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const emptyPerms = (): Record<PermKey, boolean> => ({
    can_view: false, can_add: false, can_edit: false, can_delete: false,
    can_export: false, can_import: false, can_approve: false,
  });

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${clientId}`),
      api.get('/modules'),
    ]).then(async ([clientRes, modRes]) => {
      const admin = clientRes.data.admin_user;
      setAdminUser(admin);
      const mods = modRes.data;
      setModules(mods);

      // Initialize matrix
      const m: Record<number, Record<PermKey, boolean>> = {};
      mods.forEach((mod: any) => { m[mod.id] = emptyPerms(); });

      if (admin) {
        try {
          const permRes = await api.get(`/permissions/user/${admin.id}`);
          const perms = permRes.data.permissions || [];
          setPermissions(perms);
          perms.forEach((p: any) => {
            if (m[p.module_id]) {
              m[p.module_id] = {
                can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
                can_delete: !!p.can_delete, can_export: !!p.can_export, can_import: !!p.can_import, can_approve: !!p.can_approve,
              };
            }
          });
        } catch {}
      }
      setMatrix(m);
    }).finally(() => setLoading(false));
  }, [clientId]);

  const toggle = (modId: number, key: PermKey) => {
    setMatrix(prev => ({
      ...prev,
      [modId]: { ...(prev[modId] || emptyPerms()), [key]: !(prev[modId]?.[key]) },
    }));
  };

  const toggleRow = (modId: number) => {
    const allOn = PERMS.every(p => matrix[modId]?.[p.key]);
    const next = { ...matrix };
    next[modId] = {} as Record<PermKey, boolean>;
    PERMS.forEach(p => { next[modId][p.key] = !allOn; });
    setMatrix(next);
  };

  const toggleColumn = (key: PermKey) => {
    const allOn = modules.every(m => matrix[m.id]?.[key]);
    const next = { ...matrix };
    modules.forEach(m => { next[m.id] = { ...(next[m.id] || emptyPerms()), [key]: !allOn }; });
    setMatrix(next);
  };

  const selectAll = (val: boolean) => {
    const next: Record<number, Record<PermKey, boolean>> = {};
    modules.forEach(m => {
      next[m.id] = {} as Record<PermKey, boolean>;
      PERMS.forEach(p => { next[m.id][p.key] = val; });
    });
    setMatrix(next);
  };

  const handleSave = async () => {
    if (!adminUser) return;
    setSaving(true);
    try {
      const permsPayload = modules.map(m => {
        const p = matrix[m.id] || emptyPerms();
        return { module_id: m.id, ...p };
      });
      await api.post(`/permissions/user/${adminUser.id}`, { permissions: permsPayload });
      toast.success('Saved', 'Permissions updated successfully');
    } catch {
      toast.error('Error', 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const totalChecks = Object.values(matrix).reduce((s, m) => s + PERMS.filter(p => m[p.key]).length, 0);
  const maxChecks = modules.length * PERMS.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-primary mr-3" />
        <span className="text-muted text-[13px]">Loading permissions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <ShieldCheck size={18} className="text-indigo-500" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-text tracking-tight">Permissions</h1>
            <p className="text-[12px] text-muted mt-0.5">{clientName} · Client Admin Access Control</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !adminUser}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {saving ? 'Saving...' : 'Save Permissions'}
        </Button>
      </div>

      {/* Admin info */}
      {adminUser && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-50/50 border border-indigo-200/40">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs">
            {adminUser.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1">
            <span className="text-[13px] font-semibold text-text">{adminUser.name}</span>
            <span className="text-[11px] text-muted ml-2">{adminUser.email}</span>
          </div>
          <Badge variant={adminUser.status === 'active' ? 'success' : 'danger'} dot>{adminUser.status}</Badge>
        </div>
      )}

      {!adminUser && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
          <AlertCircle size={14} />
          No client admin found for this organization.
        </div>
      )}

      {adminUser && (
        <>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] font-bold text-muted uppercase tracking-wider">Quick:</span>
            <Button variant="outline" size="sm" onClick={() => selectAll(true)}>Select All</Button>
            <Button variant="outline" size="sm" onClick={() => selectAll(false)}>Deselect All</Button>
            <div className="w-px h-5 bg-border mx-1" />
            {PERMS.map(p => (
              <button key={p.key} onClick={() => toggleColumn(p.key)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-border bg-surface text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer">
                <p.icon size={11} /> {p.label}
              </button>
            ))}
            <span className="text-[10.5px] text-muted ml-auto">{totalChecks} / {maxChecks}</span>
          </div>

          {/* Matrix */}
          <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 800 }}>
                <thead>
                  <tr className="bg-border border-b border-border">
                    <th className="text-left px-5 py-3 text-[9.5px] font-bold tracking-wider uppercase text-secondary" style={{ width: '28%' }}>Module</th>
                    {PERMS.map(p => (
                      <th key={p.key} className="text-center px-3 py-3">
                        <div className="flex flex-col items-center gap-1">
                          <p.icon size={13} className="text-secondary/70" />
                          <span className="text-[9.5px] font-bold tracking-wider uppercase text-secondary">{p.label}</span>
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
                        <td className="px-5 py-0">
                          <div className="flex items-center h-12 gap-2.5">
                            <span className="text-[13px] font-bold text-text">{mod.name}</span>
                            {mod.is_default && (
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">DEFAULT</span>
                            )}
                            <button onClick={() => toggleRow(mod.id)}
                              className="ml-auto text-[10px] font-semibold text-muted hover:text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100">
                              {allOn ? 'deselect' : 'select all'}
                            </button>
                          </div>
                        </td>
                        {PERMS.map(p => (
                          <td key={p.key} className="text-center px-3 py-0">
                            <div className="flex items-center justify-center h-12">
                              <input type="checkbox" checked={!!rowPerms[p.key]} onChange={() => toggle(mod.id, p.key)}
                                className="w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer transition-all hover:border-primary/50" />
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-border/50 bg-surface-2 flex items-center justify-between">
              <span className="text-[11.5px] text-muted">
                <strong className="text-text">{adminUser.name}</strong> · <span className="font-bold text-primary">{totalChecks}</span> permissions enabled
              </span>
              <Button onClick={handleSave} disabled={saving}>
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
