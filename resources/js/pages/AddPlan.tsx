import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Input, { Select, Textarea } from '../components/ui/Input';
import Button from '../components/ui/Button';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  ArrowLeft, Save, RotateCcw, CreditCard, Shield, Layers,
  Loader2, AlertCircle, Sparkles, Check, X
} from 'lucide-react';

interface Props { onBack: () => void; editId?: number; }
interface ModuleOption { id: number; name: string; slug: string; icon: string; }
type AccessLevel = 'full' | 'limited' | 'addon' | 'not_included';

const ACCESS_STYLES: Record<AccessLevel, { label: string; bg: string; text: string }> = {
  full: { label: 'Full', bg: 'bg-emerald-500', text: 'text-white' },
  limited: { label: 'Limited', bg: 'bg-sky-500', text: 'text-white' },
  addon: { label: 'Add-on', bg: 'bg-amber-500', text: 'text-white' },
  not_included: { label: 'Not Included', bg: 'bg-gray-300', text: 'text-gray-700' },
};

const empty = {
  name: '', price: '0', period: 'month',
  max_branches: '', max_users: '', storage_limit: '', support_level: 'Email',
  is_featured: false, badge: '', color: '#5A51E8',
  description: '', best_for: '', status: 'active',
  trial_days: '', yearly_discount: '', is_custom: false,
};

export default function AddPlan({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [moduleAccess, setModuleAccess] = useState<Record<number, AccessLevel>>({});
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  // Load modules list
  useEffect(() => {
    api.get('/modules').then(res => {
      const mods = (res.data || []).filter((m: ModuleOption) => !['dashboard', 'profile'].includes(m.slug));
      setModules(mods);
      // Default all to not_included
      const acc: Record<number, AccessLevel> = {};
      mods.forEach((m: ModuleOption) => { acc[m.id] = 'not_included'; });
      setModuleAccess(acc);
    });
  }, []);

  // Load plan for edit
  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/plans/${editId}`).then(res => {
      const p = res.data;
      setForm({
        name: p.name || '', price: String(p.price ?? 0), period: p.period || 'month',
        max_branches: p.max_branches != null ? String(p.max_branches) : '',
        max_users: p.max_users != null ? String(p.max_users) : '',
        storage_limit: p.storage_limit || '', support_level: p.support_level || 'Email',
        is_featured: p.is_featured || false, badge: p.badge || '', color: p.color || '#5A51E8',
        description: p.description || '', best_for: p.best_for || '', status: p.status || 'active',
        trial_days: p.trial_days != null ? String(p.trial_days) : '',
        yearly_discount: p.yearly_discount != null ? String(p.yearly_discount) : '',
        is_custom: p.is_custom || false,
      });
      // Load plan modules
      if (p.plan_modules) {
        setModuleAccess(prev => {
          const acc = { ...prev };
          p.plan_modules.forEach((pm: any) => { acc[pm.module_id] = pm.access_level; });
          return acc;
        });
      }
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleSubmit = async () => {
    setErrors({});
    setSaving(true);
    try {
      const modulesPayload = Object.entries(moduleAccess).map(([modId, level]) => ({
        module_id: Number(modId),
        access_level: level,
      }));

      const payload: Record<string, any> = {
        name: form.name, price: parseFloat(form.price) || 0, period: form.period,
        max_branches: form.max_branches ? parseInt(form.max_branches) : null,
        max_users: form.max_users ? parseInt(form.max_users) : null,
        storage_limit: form.storage_limit || null, support_level: form.support_level || null,
        is_featured: form.is_featured, badge: form.badge || null, color: form.color || null,
        description: form.description || null, best_for: form.best_for || null, status: form.status,
        trial_days: form.trial_days ? parseInt(form.trial_days) : null,
        yearly_discount: form.yearly_discount ? parseFloat(form.yearly_discount) : null,
        is_custom: form.is_custom, modules: modulesPayload,
      };

      if (isEdit) {
        await api.put(`/plans/${editId}`, payload);
        toast.success('Plan Updated', `"${form.name}" updated successfully`);
      } else {
        await api.post('/plans', payload);
        toast.success('Plan Created', `"${form.name}" created successfully`);
        setTimeout(() => onBack(), 1000);
      }
    } catch (err: any) {
      if (err.response?.status === 422) {
        setErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => errors[key]?.[0];
  const includedCount = Object.values(moduleAccess).filter(a => a !== 'not_included').length;
  const periodLabel: Record<string, string> = { month: '/mo', quarter: '/qtr', year: '/yr' };

  if (loadingData) {
    return <div className="flex items-center justify-center py-20 text-muted text-[13px]"><Loader2 size={20} className="animate-spin mr-2" /> Loading plan...</div>;
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-400 flex items-center justify-center shadow-lg shadow-primary/20">
            <CreditCard size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-extrabold text-text tracking-tight">{isEdit ? 'Edit Plan' : 'Add New Plan'}</h1>
            <p className="text-[12px] text-muted mt-0.5">{isEdit ? 'Update plan details and modules' : 'Create a subscription plan with pricing, limits and modules'}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={13} /> Back to Plans</Button>
      </div>

      {errors.general && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600">
          <AlertCircle size={14} /> {errors.general[0]}
        </div>
      )}

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-5">

          {/* Section A: Plan Details */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center"><Sparkles size={14} className="text-primary" /></div>
                <div>
                  <span className="text-[13px] font-bold text-text">Plan Details</span>
                  <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section A</span>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                <Input label="Plan Name" required placeholder="e.g. Pro, Business" value={form.name} onChange={e => set('name', e.target.value)} error={fieldError('name')} />
                <div className="flex flex-col gap-1">
                  <label className="text-[11.5px] font-semibold text-text">Price<span className="text-red-500 ml-0.5">*</span></label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-lg border-[1.5px] border-r-0 border-border bg-bg text-[12px] font-semibold text-secondary">₹</span>
                    <input type="number" className={`flex-1 px-3 py-2 rounded-r-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted ${fieldError('price') ? 'border-red-400' : ''}`}
                      placeholder="0" value={form.price} onChange={e => set('price', e.target.value)} />
                  </div>
                </div>
                <Select label="Billing Period" required value={form.period} onChange={e => set('period', e.target.value)}>
                  <option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Yearly</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                <Input label="Best For" placeholder="e.g. Small teams" value={form.best_for} onChange={e => set('best_for', e.target.value)} />
                <Select label="Status" required value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option><option value="inactive">Inactive</option>
                </Select>
                <Input label="Badge" placeholder="e.g. Most Popular" value={form.badge} onChange={e => set('badge', e.target.value)} />
              </div>
              <Textarea label="Description" placeholder="What this plan offers..." rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
              <div className="flex gap-6 flex-wrap mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_featured} onChange={e => set('is_featured', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                  <span className="text-[12px] font-medium text-text">Featured / Popular</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_custom} onChange={e => set('is_custom', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                  <span className="text-[12px] font-medium text-text">Custom Plan</span>
                </label>
              </div>
            </CardBody>
          </Card>

          {/* Section B: Limits */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Shield size={14} className="text-emerald-500" /></div>
                <div>
                  <span className="text-[13px] font-bold text-text">Usage Limits</span>
                  <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section B</span>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <Input label="Max Branches" type="number" placeholder="0 = unlimited" value={form.max_branches} onChange={e => set('max_branches', e.target.value)} />
                <Input label="Max Users" type="number" placeholder="0 = unlimited" value={form.max_users} onChange={e => set('max_users', e.target.value)} />
                <Input label="Storage Limit" placeholder="e.g. 25GB" value={form.storage_limit} onChange={e => set('storage_limit', e.target.value)} />
                <Select label="Support Level" value={form.support_level} onChange={e => set('support_level', e.target.value)}>
                  <option value="Email">Email</option><option value="Chat">Email + Chat</option>
                  <option value="Priority">Priority</option><option value="Dedicated">Dedicated</option>
                  <option value="Enterprise SLA">Enterprise SLA</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input label="Trial Days" type="number" placeholder="e.g. 14" value={form.trial_days} onChange={e => set('trial_days', e.target.value)} />
                <Input label="Yearly Discount (%)" type="number" placeholder="e.g. 20" value={form.yearly_discount} onChange={e => set('yearly_discount', e.target.value)} />
                <div className="flex flex-col gap-1">
                  <label className="text-[11.5px] font-semibold text-text">Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={form.color} onChange={e => set('color', e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5" />
                    <Input value={form.color} onChange={e => set('color', e.target.value)} className="flex-1" />
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Section C: Module Access */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center"><Layers size={14} className="text-violet-500" /></div>
                <div>
                  <span className="text-[13px] font-bold text-text">Module Access</span>
                  <span className="text-[10px] text-muted ml-2 bg-bg px-2 py-0.5 rounded-full border border-border">Section C</span>
                  <span className="text-[10px] text-primary font-bold ml-2">{includedCount} / {modules.length} included</span>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl px-4 py-3 mb-4 flex items-center gap-2 text-[12px] text-violet-700">
                <Layers size={14} />
                Select which modules are included in this plan. Clients with this plan will get access to these modules.
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(Object.entries(ACCESS_STYLES) as [AccessLevel, typeof ACCESS_STYLES.full][]).map(([key, s]) => (
                  <span key={key} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
                    {key === 'not_included' ? <X size={9} /> : <Check size={9} />} {s.label}
                  </span>
                ))}
              </div>

              {/* Quick actions */}
              <div className="flex gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={() => {
                  const acc: Record<number, AccessLevel> = {};
                  modules.forEach(m => { acc[m.id] = 'full'; });
                  setModuleAccess(acc);
                }}>All Full</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const acc: Record<number, AccessLevel> = {};
                  modules.forEach(m => { acc[m.id] = 'not_included'; });
                  setModuleAccess(acc);
                }}>Clear All</Button>
              </div>

              {/* Module grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {modules.map(mod => {
                  const level = moduleAccess[mod.id] || 'not_included';
                  const included = level !== 'not_included';
                  return (
                    <div key={mod.id} className={`border rounded-xl p-3.5 transition-all duration-200 ${included ? 'border-primary/30 bg-primary/[.02] shadow-sm' : 'border-border'}`}>
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold ${included ? 'bg-primary/10 text-primary' : 'bg-bg text-muted'}`}>
                          {mod.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-bold text-text">{mod.name}</span>
                        </div>
                        {included && <Check size={14} className="text-emerald-500" />}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.keys(ACCESS_STYLES) as AccessLevel[]).map(key => (
                          <button key={key} type="button"
                            onClick={() => setModuleAccess(prev => ({ ...prev, [mod.id]: key }))}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all duration-150 cursor-pointer ${
                              level === key
                                ? `${ACCESS_STYLES[key].bg} ${ACCESS_STYLES[key].text} ring-2 ring-offset-1 ring-current/20 shadow-sm`
                                : 'bg-bg text-secondary hover:bg-bg/80'
                            }`}>
                            {ACCESS_STYLES[key].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Footer */}
          <div className="sticky bottom-0 left-0 right-0 bg-surface border-t border-border px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between z-[50]">
            <div className="text-[12px] text-muted">{includedCount} modules included · Click <strong>{isEdit ? 'Update' : 'Create'} Plan</strong> to save</div>
            <div className="flex gap-2.5">
              <Button variant="ghost" size="sm" onClick={onBack}>Cancel</Button>
              <Button variant="outline" size="sm" onClick={() => { setForm(empty); setModuleAccess(prev => { const a: Record<number, AccessLevel> = {}; Object.keys(prev).forEach(k => a[Number(k)] = 'not_included'); return a; }); }}><RotateCcw size={12} /> Reset</Button>
              <Button size="md" onClick={handleSubmit} disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving...' : isEdit ? 'Update Plan' : 'Create Plan'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-6">
            <div className={`bg-surface border-2 ${form.is_featured ? 'border-primary shadow-lg shadow-primary/10' : 'border-border'} rounded-2xl p-5 transition-all`}>
              {form.is_featured && form.badge && (
                <div className="text-center mb-2">
                  <span className="text-[8px] font-bold bg-primary text-white px-3 py-1 rounded-full tracking-wider uppercase">{form.badge}</span>
                </div>
              )}
              <div className="text-center mb-4">
                <h3 className="text-[17px] font-extrabold text-text">{form.name || 'Plan Name'}</h3>
                <div className="mt-2">
                  {parseFloat(form.price) <= 0
                    ? <span className="text-2xl font-extrabold text-primary">Free</span>
                    : <><span className="text-sm text-primary font-semibold">₹</span><span className="text-2xl font-extrabold text-primary">{parseFloat(form.price || '0').toLocaleString()}</span><span className="text-sm text-secondary">{periodLabel[form.period]}</span></>
                  }
                </div>
                {form.best_for && <p className="text-[10px] text-muted mt-1">{form.best_for}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4 text-center">
                {[['Branches', form.max_branches || '∞'], ['Users', form.max_users || '∞'], ['Storage', form.storage_limit || '—'], ['Support', form.support_level || '—']].map(([l, v]) => (
                  <div key={l} className="bg-bg rounded-lg px-2 py-1.5">
                    <div className="text-[8px] font-semibold text-muted uppercase">{l}</div>
                    <div className="text-[12px] font-bold text-text">{v}</div>
                  </div>
                ))}
              </div>

              {/* Included modules preview */}
              <div className="border-t border-border/40 pt-3">
                <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-2">Modules ({includedCount})</p>
                {includedCount > 0 ? (
                  <div className="space-y-1">
                    {modules.filter(m => moduleAccess[m.id] !== 'not_included').map(m => (
                      <div key={m.id} className="flex items-center justify-between">
                        <span className="text-[11px] text-text">{m.name}</span>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${ACCESS_STYLES[moduleAccess[m.id]].bg} ${ACCESS_STYLES[moduleAccess[m.id]].text}`}>
                          {ACCESS_STYLES[moduleAccess[m.id]].label}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted italic">No modules selected</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
