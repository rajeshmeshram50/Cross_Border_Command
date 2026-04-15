import { useState } from 'react';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import {
  ArrowLeft, LayoutDashboard, FolderKanban, TrendingUp, ShoppingCart,
  FileText, Globe, Package, KeyRound, Users, Database, Info, Eye,
  Sparkles, Crown, Zap, Shield, Settings, ChevronDown, ChevronUp,
} from 'lucide-react';

interface Props {
  onBack: () => void;
}

interface ModuleConfig {
  id: string;
  title: string;
  description: string;
  subModules: number;
  icon: React.ElementType;
  status: 'included' | 'limited' | 'addon' | 'none';
}

const INITIAL_MODULES: ModuleConfig[] = [
  { id: 'dashboard', title: 'Dashboard / Analytics', description: 'Analytics and reporting overview', subModules: 0, icon: LayoutDashboard, status: 'none' },
  { id: 'project', title: 'Project Navigator', description: 'Task and KPI management', subModules: 2, icon: FolderKanban, status: 'none' },
  { id: 'sales', title: 'Sales Matrix', description: 'CRM, quotations, lead management', subModules: 6, icon: TrendingUp, status: 'none' },
  { id: 'p2p', title: 'Procure to Pay (P2P)', description: 'Procurement & vendor management', subModules: 7, icon: ShoppingCart, status: 'none' },
  { id: 'clm', title: 'Contract Lifecycle Mgmt (CLM)', description: 'Contract creation and tracking', subModules: 0, icon: FileText, status: 'none' },
  { id: 'gts', title: 'Global Trade System (GTS)', description: 'E-docs, remittance, export paper', subModules: 3, icon: Globe, status: 'none' },
  { id: 'ims', title: 'Inventory Management (IMS)', description: 'GRN, QA, outward, PSD, e-BRC', subModules: 5, icon: Package, status: 'none' },
  { id: 'password', title: 'Password Manager', description: 'Secure credential vault', subModules: 0, icon: KeyRound, status: 'none' },
  { id: 'hrms', title: 'HRMS', description: 'HR, payroll, attendance, recruitment', subModules: 8, icon: Users, status: 'none' },
  { id: 'master', title: 'Master', description: 'Master data configuration', subModules: 0, icon: Database, status: 'none' },
];

const STATUS_STYLES = {
  included: { label: 'Included', bg: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-500/30' },
  limited: { label: 'Limited', bg: 'bg-sky-500', text: 'text-white', ring: 'ring-sky-500/30' },
  addon: { label: 'Add-on', bg: 'bg-amber-500', text: 'text-white', ring: 'ring-amber-500/30' },
  none: { label: 'Not Included', bg: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-700 dark:text-gray-300', ring: 'ring-gray-300/30' },
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer group">
      <span className="text-[12.5px] text-text font-medium group-hover:text-primary transition-colors">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-all duration-200 ${checked ? 'bg-primary shadow-md shadow-primary/30' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function SectionHeader({ label, title, subtitle, icon: Icon }: { label: string; title: string; subtitle: string; icon: React.ElementType }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={18} className="text-primary" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full tracking-widest">{label}</span>
        </div>
        <h2 className="text-[15px] font-bold text-text mt-1">{title}</h2>
        <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export default function AddPlan({ onBack }: Props) {
  // Section A
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState('Basic');
  const [status, setStatus] = useState('Active');
  const [price, setPrice] = useState('');
  const [billing, setBilling] = useState('Monthly');
  const [bestFor, setBestFor] = useState('');
  const [description, setDescription] = useState('');
  const [isPopular, setIsPopular] = useState(false);
  const [isRecommended, setIsRecommended] = useState(false);

  // Section B
  const [maxUsers, setMaxUsers] = useState('');
  const [maxBranches, setMaxBranches] = useState('');
  const [storage, setStorage] = useState('');
  const [supportLevel, setSupportLevel] = useState('Email');
  const [apiAccess, setApiAccess] = useState(false);
  const [auditLogs, setAuditLogs] = useState(false);
  const [rbac, setRbac] = useState(false);
  const [makerChecker, setMakerChecker] = useState(false);
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [customWorkflow, setCustomWorkflow] = useState(false);

  // Section C & D
  const [modules, setModules] = useState<ModuleConfig[]>(INITIAL_MODULES);

  // Section E
  const [customPricing, setCustomPricing] = useState(false);
  const [visibleToSales, setVisibleToSales] = useState(true);
  const [upgradeAllowed, setUpgradeAllowed] = useState(true);
  const [downgradeAllowed, setDowngradeAllowed] = useState(false);
  const [addonPurchase, setAddonPurchase] = useState(false);
  const [freeTrial, setFreeTrial] = useState(false);
  const [trialDays, setTrialDays] = useState('14');
  const [internalNotes, setInternalNotes] = useState('');
  const [clientNotes, setClientNotes] = useState('');

  // Collapsed sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleSection = (s: string) => setCollapsed(p => ({ ...p, [s]: !p[s] }));

  const setModuleStatus = (id: string, status: ModuleConfig['status']) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, status } : m));
  };

  const selectedModules = modules.filter(m => m.status !== 'none');
  const billingLabel = billing === 'Monthly' ? '/month' : billing === 'Yearly' ? '/year' : billing === 'Quarterly' ? '/quarter' : '/period';
  const enabledFeatures = [
    apiAccess && 'API Access',
    auditLogs && 'Audit Logs',
    rbac && 'RBAC',
    makerChecker && 'Maker-Checker',
    whiteLabel && 'White Label',
    customWorkflow && 'Custom Workflow',
    customPricing && 'Custom Pricing',
    freeTrial && 'Free Trial',
    addonPurchase && 'Add-on Purchase',
  ].filter(Boolean) as string[];

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!planName.trim()) e.planName = 'Plan name is required';
    if (!price.trim()) e.price = 'Price is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      // TODO: submit to API
      onBack();
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Add New Plan</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Create a module-based subscription plan with pricing, limits, and access allocation</p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft size={13} /> Back to Plans
        </Button>
      </div>

      <div className="flex gap-6 items-start">
        {/* LEFT: Form */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* SECTION A */}
          <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => toggleSection('a')} className="w-full px-5 py-4 flex items-center justify-between hover:bg-bg/50 transition-colors cursor-pointer">
              <SectionHeader label="SECTION A" title="Plan Details" subtitle="Basic plan information, pricing, and billing configuration" icon={Sparkles} />
              {collapsed.a ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
            </button>
            {!collapsed.a && (
              <div className="px-5 pb-5 border-t border-border/40">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <Input label="Plan Name" required placeholder="e.g. Pro, Business, Enterprise" value={planName} onChange={e => setPlanName(e.target.value)} error={errors.planName} />
                  <Select label="Plan Type" required value={planType} onChange={e => setPlanType(e.target.value)}>
                    <option>Basic</option><option>Standard</option><option>Premium</option><option>Custom</option>
                  </Select>
                  <Select label="Status" value={status} onChange={e => setStatus(e.target.value)}>
                    <option>Active</option><option>Inactive</option>
                  </Select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.5px] font-semibold text-text">Price<span className="text-red-500 ml-0.5">*</span></label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-lg border-[1.5px] border-r-0 border-border bg-bg text-[12px] font-semibold text-secondary">₹</span>
                      <input
                        type="number"
                        className={`flex-1 px-3 py-2 rounded-r-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted ${errors.price ? 'border-red-400' : ''}`}
                        placeholder="0"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                      />
                    </div>
                    {errors.price && <span className="text-[11px] text-red-500">{errors.price}</span>}
                  </div>
                  <Select label="Billing Period" value={billing} onChange={e => setBilling(e.target.value)}>
                    <option>Monthly</option><option>Yearly</option><option>Quarterly</option><option>Custom</option>
                  </Select>
                  <Input label="Best For" placeholder="e.g. Small teams, Growing businesses" value={bestFor} onChange={e => setBestFor(e.target.value)} />
                </div>
                <div className="mt-4">
                  <Textarea label="Short Description" placeholder="Describe what this plan offers..." value={description} onChange={e => setDescription(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-5 p-4 bg-bg rounded-xl">
                  <Toggle checked={isPopular} onChange={setIsPopular} label="Mark as Popular Plan" />
                  <Toggle checked={isRecommended} onChange={setIsRecommended} label="Show as Recommended" />
                </div>
              </div>
            )}
          </div>

          {/* SECTION B */}
          <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => toggleSection('b')} className="w-full px-5 py-4 flex items-center justify-between hover:bg-bg/50 transition-colors cursor-pointer">
              <SectionHeader label="SECTION B" title="Usage & Support Limits" subtitle="Define usage capacity and advanced control access for this plan" icon={Shield} />
              {collapsed.b ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
            </button>
            {!collapsed.b && (
              <div className="px-5 pb-5 border-t border-border/40">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                  <Input label="Max Users" placeholder="e.g. 50 or Unlimited" value={maxUsers} onChange={e => setMaxUsers(e.target.value)} />
                  <Input label="Max Branches" placeholder="e.g. 10" value={maxBranches} onChange={e => setMaxBranches(e.target.value)} />
                  <Input label="Storage Limit" placeholder="e.g. 25GB" value={storage} onChange={e => setStorage(e.target.value)} />
                  <Select label="Support Level" value={supportLevel} onChange={e => setSupportLevel(e.target.value)}>
                    <option>Email</option><option>Chat</option><option>Phone</option><option>Priority</option>
                  </Select>
                </div>
                <div className="mt-5">
                  <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">Feature Toggles</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 p-4 bg-bg rounded-xl">
                    <Toggle checked={apiAccess} onChange={setApiAccess} label="API Access" />
                    <Toggle checked={auditLogs} onChange={setAuditLogs} label="Audit Logs" />
                    <Toggle checked={rbac} onChange={setRbac} label="Role-Based Access Control (RBAC)" />
                    <Toggle checked={makerChecker} onChange={setMakerChecker} label="Maker-Checker-Approver" />
                    <Toggle checked={whiteLabel} onChange={setWhiteLabel} label="White Label Support" />
                    <Toggle checked={customWorkflow} onChange={setCustomWorkflow} label="Custom Workflow Support" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION C & D */}
          <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => toggleSection('cd')} className="w-full px-5 py-4 flex items-center justify-between hover:bg-bg/50 transition-colors cursor-pointer">
              <SectionHeader label="SECTION C & D" title="Module Allocation" subtitle="Select the status for each module. Choose Included or Limited to configure sub-modules" icon={Crown} />
              {collapsed.cd ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
            </button>
            {!collapsed.cd && (
              <div className="px-5 pb-5 border-t border-border/40">
                <div className="flex flex-wrap gap-2 mt-4 mb-5">
                  {Object.entries(STATUS_STYLES).map(([key, s]) => (
                    <span key={key} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                      {s.label}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {modules.map(mod => {
                    const Icon = mod.icon;
                    return (
                      <div key={mod.id} className={`border rounded-xl p-4 transition-all ${mod.status !== 'none' ? 'border-primary/30 bg-primary/[0.02] shadow-sm' : 'border-border'}`}>
                        <div className="flex items-start gap-3 mb-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${mod.status !== 'none' ? 'bg-primary/10' : 'bg-bg'}`}>
                            <Icon size={17} className={mod.status !== 'none' ? 'text-primary' : 'text-muted'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[13px] font-bold text-text leading-tight">{mod.title}</h4>
                            <p className="text-[10.5px] text-muted mt-0.5">{mod.description}</p>
                            {mod.subModules > 0 && (
                              <span className="text-[9.5px] text-secondary font-medium">{mod.subModules} sub-modules</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(STATUS_STYLES) as Array<keyof typeof STATUS_STYLES>).map(key => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setModuleStatus(mod.id, key)}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                mod.status === key
                                  ? `${STATUS_STYLES[key].bg} ${STATUS_STYLES[key].text} ring-2 ${STATUS_STYLES[key].ring} shadow-sm`
                                  : 'bg-bg text-secondary hover:bg-bg/80'
                              }`}
                            >
                              {STATUS_STYLES[key].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* SECTION E */}
          <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => toggleSection('e')} className="w-full px-5 py-4 flex items-center justify-between hover:bg-bg/50 transition-colors cursor-pointer">
              <SectionHeader label="SECTION E" title="Advanced Plan Controls" subtitle="Control how this plan behaves commercially and operationally" icon={Settings} />
              {collapsed.e ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
            </button>
            {!collapsed.e && (
              <div className="px-5 pb-5 border-t border-border/40">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mt-4 p-4 bg-bg rounded-xl">
                  <Toggle checked={customPricing} onChange={setCustomPricing} label="Custom Pricing Allowed" />
                  <Toggle checked={visibleToSales} onChange={setVisibleToSales} label="Visible to Sales Team" />
                  <Toggle checked={upgradeAllowed} onChange={setUpgradeAllowed} label="Upgrade Allowed" />
                  <Toggle checked={downgradeAllowed} onChange={setDowngradeAllowed} label="Downgrade Allowed" />
                  <Toggle checked={addonPurchase} onChange={setAddonPurchase} label="Add-on Purchase Allowed" />
                  <Toggle checked={freeTrial} onChange={setFreeTrial} label="Free Trial Available" />
                </div>
                {freeTrial && (
                  <div className="mt-4 max-w-xs">
                    <Input label="Trial Days" type="number" placeholder="e.g. 14" value={trialDays} onChange={e => setTrialDays(e.target.value)} />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Textarea label="Internal Notes" placeholder="Team-only notes about this plan..." value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
                  <Textarea label="Client-Facing Notes" placeholder="Notes visible to clients..." value={clientNotes} onChange={e => setClientNotes(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <Info size={13} />
              <span>All changes are saved only when you click Create Plan</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="md" onClick={onBack}>Cancel</Button>
              <Button size="md" onClick={handleSubmit}>
                <Zap size={13} /> Create Plan
              </Button>
            </div>
          </div>
        </div>

        {/* RIGHT: Live Preview */}
        <div className="hidden lg:block w-80 xl:w-96 flex-shrink-0">
          <div className="sticky top-6">
            <div className="bg-surface border border-border rounded-2xl shadow-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-border/60 bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-2">
                  <Eye size={15} className="text-primary" />
                  <h3 className="text-[13px] font-bold text-text">Live Plan Preview</h3>
                </div>
              </div>

              <div className="p-5">
                {/* Plan Name & Price */}
                <div className="text-center mb-5">
                  <div className="flex items-center justify-center gap-2">
                    <h4 className="text-[18px] font-extrabold text-text">{planName || 'Untitled Plan'}</h4>
                    {isPopular && <span className="text-[8px] font-bold bg-primary text-white px-2 py-0.5 rounded-full">POPULAR</span>}
                  </div>
                  {isRecommended && <span className="text-[9px] font-bold text-amber-500">★ Recommended</span>}
                  <div className="mt-2">
                    <span className="text-sm text-primary font-semibold">₹</span>
                    <span className="text-3xl font-extrabold text-primary">{price ? Number(price).toLocaleString() : '0'}</span>
                    <span className="text-sm text-secondary">{billingLabel}</span>
                  </div>
                  {bestFor && <p className="text-[10.5px] text-muted mt-1">Best for: {bestFor}</p>}
                </div>

                {/* Limits */}
                <div className="mb-4">
                  <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-2">Limits</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Branches', maxBranches || '—'],
                      ['Users', maxUsers || '—'],
                      ['Storage', storage || '—'],
                      ['Support', supportLevel],
                    ].map(([l, v]) => (
                      <div key={l} className="bg-bg rounded-lg px-2.5 py-2 text-center">
                        <div className="text-[8.5px] font-semibold text-muted uppercase">{l}</div>
                        <div className="text-[12px] font-bold text-text">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Modules */}
                <div className="mb-4">
                  <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-2">
                    Modules <span className="text-primary">({selectedModules.length})</span>
                  </p>
                  {selectedModules.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedModules.map(m => (
                        <div key={m.id} className="flex items-center justify-between">
                          <span className="text-[11px] text-text font-medium">{m.title}</span>
                          <span className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLES[m.status].bg} ${STATUS_STYLES[m.status].text}`}>
                            {STATUS_STYLES[m.status].label}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted italic">No modules selected</p>
                  )}
                </div>

                {/* Advanced Features */}
                <div>
                  <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-2">Advanced Features</p>
                  {enabledFeatures.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {enabledFeatures.map(f => (
                        <span key={f} className="text-[9.5px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{f}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted italic">None enabled</p>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <div className="px-5 py-3 border-t border-border/60 bg-bg/50 flex items-center justify-between">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status === 'Active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-200 text-gray-500'}`}>
                  {status}
                </span>
                <span className="text-[10px] text-muted">{planType}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
