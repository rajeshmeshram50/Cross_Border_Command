import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import {
  Building2, Mail, Phone, Globe, MapPin, MapPinned, Hash, FileText,
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

  const InfoItem = ({ icon: Icon, label, value, mono }: { icon: any; label: string; value: any; mono?: boolean }) => {
    if (!value) return null;
    return (
      <div className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0">
        <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Icon size={14} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider">{label}</div>
          <div className={`text-[13px] font-semibold text-text mt-0.5 ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-text tracking-tight">Client Details</h1>
            <p className="text-[12px] text-muted mt-0.5">View organization information</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate('client-form', { editId: clientId })}>
            <Pencil size={12} /> Edit
          </Button>
        </div>
      </div>

      {/* Hero Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl" />
        <div className="relative px-8 py-7 flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white text-xl font-extrabold shadow-2xl shadow-primary/30">
            {client.org_name.charAt(0)}{client.org_name.split(' ')[1]?.charAt(0) || ''}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[22px] font-extrabold text-white tracking-tight">{client.org_name}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="font-mono text-[11px] text-white/70 bg-white/10 px-2.5 py-1 rounded-lg">{client.unique_number}</span>
              <Badge variant={client.status === 'active' ? 'success' : 'danger'} dot>{client.status}</Badge>
              <Badge variant="info">{client.org_type}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-shrink-0">
            <div className="text-center">
              <div className="text-[28px] font-extrabold text-white">{client.branches_count ?? 0}</div>
              <div className="text-[9px] font-bold text-white/40 uppercase tracking-wider">Branches</div>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div className="text-center">
              <div className="text-[28px] font-extrabold text-white">{client.users_count ?? 0}</div>
              <div className="text-[9px] font-bold text-white/40 uppercase tracking-wider">Users</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Branches', icon: GitBranch, color: 'from-sky-500 to-cyan-500', shadow: 'shadow-sky-500/20', page: 'client-branches' },
          { label: 'Permissions', icon: ShieldCheck, color: 'from-indigo-500 to-violet-500', shadow: 'shadow-indigo-500/20', page: 'client-permissions' },
          { label: 'Payments', icon: IndianRupee, color: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/20', page: 'client-payments' },
          { label: 'Settings', icon: Settings, color: 'from-purple-500 to-pink-500', shadow: 'shadow-purple-500/20', page: 'client-settings' },
        ].map(item => (
          <button key={item.label} onClick={() => onNavigate(item.page, { clientId, clientName: client.org_name })}
            className={`flex items-center gap-3 p-4 rounded-xl bg-surface border border-border hover:border-primary/20 hover:shadow-lg transition-all duration-200 cursor-pointer group`}>
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-lg ${item.shadow}`}>
              <item.icon size={18} className="text-white" />
            </div>
            <span className="text-[13px] font-semibold text-text group-hover:text-primary transition-colors">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Organization */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 pb-3 border-b border-border/50">
            <Building2 size={13} className="text-primary" /> Organization Details
          </h3>
          <InfoItem icon={Mail} label="Email" value={client.email} />
          <InfoItem icon={Phone} label="Phone" value={client.phone} />
          <InfoItem icon={Globe} label="Website" value={client.website} />
          <InfoItem icon={Building2} label="Industry" value={client.industry} />
          {client.sports && <InfoItem icon={Shield} label="Sports" value={client.sports} />}
        </div>

        {/* Address */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 pb-3 border-b border-border/50">
            <MapPin size={13} className="text-primary" /> Address
          </h3>
          <InfoItem icon={MapPinned} label="Address" value={client.address} />
          <InfoItem icon={MapPin} label="City / District" value={[client.city, client.district].filter(Boolean).join(', ') || null} />
          <InfoItem icon={MapPin} label="Taluka" value={client.taluka} />
          <InfoItem icon={MapPin} label="State / Country" value={[client.state, client.country].filter(Boolean).join(', ') || null} />
          <InfoItem icon={Hash} label="Pincode" value={client.pincode} mono />
        </div>

        {/* Legal & Tax */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 pb-3 border-b border-border/50">
            <FileText size={13} className="text-primary" /> Legal & Tax
          </h3>
          <InfoItem icon={FileText} label="GST Number" value={client.gst_number} mono />
          <InfoItem icon={CreditCard} label="PAN Number" value={client.pan_number} mono />
          {!client.gst_number && !client.pan_number && (
            <p className="text-[12px] text-muted py-4 text-center">No legal details added</p>
          )}
        </div>

        {/* Plan & Billing */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 pb-3 border-b border-border/50">
            <IndianRupee size={13} className="text-primary" /> Plan & Billing
          </h3>
          <InfoItem icon={Shield} label="Plan" value={client.plan?.name || 'Free'} />
          <InfoItem icon={IndianRupee} label="Price" value={client.plan?.price ? `₹${client.plan.price.toLocaleString()}/yr` : 'Free'} />
          <InfoItem icon={Calendar} label="Expires" value={client.plan_expires_at ? new Date(client.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'} />
        </div>
      </div>

      {/* Admin User */}
      {adminUser && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-4 flex items-center gap-2 pb-3 border-b border-border/50">
            <Users size={13} className="text-indigo-500" /> Client Admin
          </h3>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-indigo-500/20">
              {adminUser.name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1">
              <div className="text-[15px] font-bold text-text">{adminUser.name}</div>
              <div className="text-[12px] text-muted mt-0.5">{adminUser.email}</div>
              {adminUser.phone && <div className="text-[11px] text-muted mt-0.5">{adminUser.phone}</div>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {adminUser.designation && (
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200/50">{adminUser.designation}</span>
              )}
              <Badge variant={adminUser.status === 'active' ? 'success' : 'danger'} dot>{adminUser.status}</Badge>
            </div>
          </div>
        </div>
      )}

      {/* Branding */}
      {(client.primary_color || client.secondary_color) && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-4 flex items-center gap-2 pb-3 border-b border-border/50">
            <Palette size={13} className="text-primary" /> Branding
          </h3>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border-2 border-border shadow-sm" style={{ backgroundColor: client.primary_color }} />
              <div>
                <div className="text-[10px] text-muted font-semibold uppercase">Primary</div>
                <div className="text-[12px] font-mono text-text">{client.primary_color}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border-2 border-border shadow-sm" style={{ backgroundColor: client.secondary_color }} />
              <div>
                <div className="text-[10px] text-muted font-semibold uppercase">Secondary</div>
                <div className="text-[12px] font-mono text-text">{client.secondary_color}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 pb-3 border-b border-border/50">
            <FileText size={13} className="text-amber-500" /> Internal Notes
          </h3>
          <p className="text-[13px] text-secondary leading-relaxed">{client.notes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[11px] text-muted flex items-center justify-center gap-2 pb-2">
        <Clock size={11} />
        Created on {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}
