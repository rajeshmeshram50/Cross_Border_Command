import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  Building2, Mail, Phone, Globe, MapPin, Hash, FileText,
  CreditCard, IndianRupee, Calendar, Shield, Users, Palette, ArrowLeft,
  Loader2, Pencil, GitBranch, ShieldCheck, Settings, Clock
} from 'lucide-react';
import api from '../api';

interface Props {
  clientId: number;
  onBack: () => void;
  onNavigate: (page: string, data?: any) => void;
}

export default function ClientView({ clientId, onBack, onNavigate }: Props) {
  const [client, setClient] = useState<any>(null);
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    api.get(`/clients/${clientId}`).then(res => {
      setClient(res.data.client);
      setAdminUser(res.data.admin_user);
    }).finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-primary mr-3" />
        <span className="text-muted text-[13px]">Loading client details...</span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-20">
        <p className="text-muted">Client not found.</p>
        <Button variant="outline" size="sm" onClick={onBack} className="mt-4"><ArrowLeft size={13} /> Back</Button>
      </div>
    );
  }

  const InfoRow = ({ icon: Icon, label, value, mono }: { icon: any; label: string; value: any; mono?: boolean }) => {
    if (!value) return null;
    return (
      <div className="flex items-center gap-3 py-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Icon size={13} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold text-muted uppercase tracking-wider">{label}</div>
          <div className={`text-[12.5px] font-semibold text-text ${mono ? 'font-mono text-[11.5px]' : ''}`}>{value}</div>
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
    { id: 'payments', label: 'Payments', icon: IndianRupee },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleTabClick = (tabId: string) => {
    if (tabId === 'overview') { setActiveTab('overview'); return; }
    const pageMap: Record<string, string> = {
      branches: 'client-branches',
      permissions: 'client-permissions',
      payments: 'client-payments',
      settings: 'client-settings',
    };
    onNavigate(pageMap[tabId], { clientId, clientName: client.org_name });
  };

  return (
    <div className="space-y-0">
      {/* Header Card */}
      <div className="bg-surface border border-border rounded-t-xl px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={15} />
          </button>
          <div>
            <h1 className="text-[16px] font-bold text-text tracking-tight">Client Details</h1>
            <p className="text-[10.5px] text-muted mt-0.5">{client.plan_type === 'paid' ? 'Active subscription' : 'Free plan'} · {client.org_type}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate('client-form', { editId: clientId })}>
          <Pencil size={11} /> Edit
        </Button>
      </div>

      {/* Hero Strip */}
      <div className="bg-sidebar px-5 py-3.5 flex items-center gap-4">
        {client.logo ? (
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src={client.logo} alt="" className="w-full h-full object-contain p-0.5" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white text-sm font-extrabold flex-shrink-0">
            {client.org_name.charAt(0)}{client.org_name.split(' ')[1]?.charAt(0) || ''}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-extrabold text-white tracking-tight truncate">{client.org_name}</h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[9px] font-semibold text-white/50 bg-white/10 px-1.5 py-0.5 rounded">{client.branches_count ?? 0} branch</span>
            <span className="text-[9px] font-semibold text-white/50 bg-white/10 px-1.5 py-0.5 rounded">{client.users_count ?? 0} user</span>
            <Badge variant={client.plan?.name ? 'primary' : 'muted'}>{client.plan?.name || 'Free'}</Badge>
            <Badge variant="info">{client.org_type}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-5 flex-shrink-0">
          <div className="text-center">
            <div className="text-[20px] font-extrabold text-white">{client.branches_count ?? 0}</div>
            <div className="text-[8px] font-bold text-white/35 uppercase tracking-wider">Branches</div>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="text-center">
            <div className="text-[20px] font-extrabold text-white">{client.users_count ?? 0}</div>
            <div className="text-[8px] font-bold text-white/35 uppercase tracking-wider">User</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-x border-border px-5 flex items-center gap-0 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => handleTabClick(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-[11.5px] font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text hover:border-border'
            }`}>
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-surface border border-border rounded-b-xl p-5">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Organization Details */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Building2 size={12} className="text-primary" /> Organization Details
              </h3>
              <div className="space-y-0 divide-y divide-border/30">
                <InfoRow icon={Mail} label="Email" value={client.email} />
                <InfoRow icon={Phone} label="Phone" value={client.phone} />
                <InfoRow icon={Globe} label="Website" value={client.website} />
                <InfoRow icon={Building2} label="Industry" value={client.industry || client.sports} />
              </div>
            </div>

            {/* Address */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MapPin size={12} className="text-primary" /> Address
              </h3>
              <div className="space-y-0 divide-y divide-border/30">
                <InfoRow icon={MapPin} label="Address" value={client.address} />
                <InfoRow icon={MapPin} label="City / District" value={[client.city, client.district].filter(Boolean).join(', ') || null} />
                <InfoRow icon={MapPin} label="State / Country" value={[client.state, client.country].filter(Boolean).join(', ') || null} />
                {client.pincode && <InfoRow icon={Hash} label="Pincode" value={client.pincode} mono />}
              </div>
              {!client.address && !client.city && !client.state && (
                <p className="text-[11px] text-muted py-3 text-center">No address added</p>
              )}
            </div>

            {/* Legal & Tax */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText size={12} className="text-primary" /> Legal & Tax
              </h3>
              {(client.gst_number || client.pan_number) ? (
                <div className="space-y-0 divide-y divide-border/30">
                  {client.gst_number && <InfoRow icon={FileText} label="GST Number" value={client.gst_number} mono />}
                  {client.pan_number && <InfoRow icon={CreditCard} label="PAN Number" value={client.pan_number} mono />}
                </div>
              ) : (
                <p className="text-[11px] text-muted py-3 text-center">No legal details added</p>
              )}
            </div>

            {/* Plan & Billing */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <IndianRupee size={12} className="text-primary" /> Plan & Billing
              </h3>
              <div className="space-y-0 divide-y divide-border/30">
                <InfoRow icon={Shield} label="Plan" value={client.plan?.name || 'Free'} />
                <InfoRow icon={IndianRupee} label="Billing" value={client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'N/A'} />
                {client.plan_expires_at && <InfoRow icon={Calendar} label="Expires" value={new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} />}
              </div>
            </div>

            {/* Client Admin */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Users size={12} className="text-indigo-500" /> Client Admin
                </h3>
                <button onClick={() => onNavigate('client-permissions', { clientId, clientName: client.org_name })}
                  className="text-[10px] font-semibold text-primary hover:underline cursor-pointer">Manage &rsaquo;</button>
              </div>
              {adminUser ? (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                    {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-bold text-text">{adminUser.name}</div>
                    <div className="text-[10.5px] text-muted">{adminUser.email}</div>
                  </div>
                  <Badge variant={adminUser.status === 'active' ? 'success' : 'danger'} dot>{adminUser.status}</Badge>
                </div>
              ) : (
                <p className="text-[11px] text-muted py-2 text-center">No admin assigned</p>
              )}
            </div>

            {/* Branding */}
            <div className="bg-surface-2/30 rounded-xl border border-border/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Palette size={12} className="text-primary" /> Branding
                </h3>
                <button onClick={() => onNavigate('client-form', { editId: clientId })}
                  className="text-[10px] font-semibold text-primary hover:underline cursor-pointer">Manage &rsaquo;</button>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg border border-border shadow-sm" style={{ backgroundColor: client.primary_color }} />
                  <div>
                    <div className="text-[8px] text-muted font-bold uppercase">Primary</div>
                    <div className="text-[10.5px] font-mono text-text">{client.primary_color}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg border border-border shadow-sm" style={{ backgroundColor: client.secondary_color }} />
                  <div>
                    <div className="text-[8px] text-muted font-bold uppercase">Secondary</div>
                    <div className="text-[10.5px] font-mono text-text">{client.secondary_color}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-[10px] text-muted flex items-center justify-center gap-1.5 mt-4">
        <Clock size={10} />
        Created on {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}
