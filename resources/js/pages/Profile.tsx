import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  Save, LogOut, ShieldCheck, Mail, Phone, Building2, GitBranch,
  Calendar, Globe, User, Lock, Eye, EyeOff, Briefcase,
  CreditCard, Monitor, Loader2, CheckCircle2,
  Plus, Pencil, Trash2, Download, Upload
} from 'lucide-react';
import api from '../api';

export default function Profile() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [saving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  if (!user) return null;

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Administrator',
    client_admin: 'Client Administrator',
    branch_user: 'Branch User',
    client_user: 'Client User',
  };

  const roleColors: Record<string, string> = {
    super_admin: 'from-red-500 to-orange-600',
    client_admin: 'from-indigo-500 to-violet-600',
    branch_user: 'from-sky-500 to-blue-600',
    client_user: 'from-emerald-500 to-teal-600',
  };

  const handleChangePassword = async () => {
    if (!currentPw) { toast.warning('Required', 'Enter your current password'); return; }
    if (newPw.length < 8) { toast.warning('Weak Password', 'Password must be at least 8 characters'); return; }
    if (newPw !== confirmPw) { toast.warning('Mismatch', 'Passwords do not match'); return; }

    setChangingPw(true);
    try {
      await api.post('/change-password', { current_password: currentPw, password: newPw, password_confirmation: confirmPw });
      toast.success('Updated', 'Password changed successfully');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not change password');
    } finally { setChangingPw(false); }
  };

  const isSuperAdmin = user.user_type === 'super_admin';
  const isClientAdmin = user.user_type === 'client_admin';
  const isBranchUser = user.user_type === 'branch_user';

  const infoItems = [
    { icon: Mail, label: 'Email', value: user.email },
    { icon: Phone, label: 'Phone', value: user.phone || 'Not set' },
    { icon: Briefcase, label: 'Designation', value: user.designation || (isSuperAdmin ? 'Platform Administrator' : 'Not set') },
    ...(isSuperAdmin ? [
      { icon: ShieldCheck, label: 'Access Level', value: 'Full System Access' },
      { icon: Globe, label: 'Timezone', value: 'Asia/Kolkata (IST)' },
    ] : []),
    ...(!isSuperAdmin ? [
      { icon: Building2, label: 'Organization', value: user.client_name || 'N/A' },
    ] : []),
    ...(isBranchUser ? [
      { icon: GitBranch, label: 'Branch', value: user.branch_name || 'N/A' },
    ] : []),
    ...(!isSuperAdmin ? [
      { icon: Globe, label: 'Timezone', value: 'Asia/Kolkata (IST)' },
    ] : []),
  ];

  const planInfo = user.plan;

  const heroBlurColor = isSuperAdmin ? 'bg-red-500/10' : isClientAdmin ? 'bg-indigo-500/10' : 'bg-sky-500/10';
  const heroBlurColor2 = isSuperAdmin ? 'bg-orange-500/10' : isClientAdmin ? 'bg-violet-500/10' : 'bg-blue-500/10';

  return (
    <div className="space-y-6">
      {/* ── Profile Hero ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 shadow-xl">
        {/* Decorative */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className={`absolute top-0 right-0 w-80 h-80 ${heroBlurColor} rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl`} />
        <div className={`absolute bottom-0 left-0 w-60 h-60 ${heroBlurColor2} rounded-full translate-y-1/2 -translate-x-1/4 blur-3xl`} />

        <div className="relative px-8 py-8 flex items-center gap-6 flex-wrap">
          {/* Avatar */}
          <div className="relative group">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${roleColors[user.user_type] || 'from-indigo-500 to-violet-600'} flex items-center justify-center text-white text-[20px] font-extrabold shadow-2xl shadow-indigo-500/30 group-hover:scale-105 transition-transform duration-300`}>
              {user.initials}
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-emerald-500 border-[3px] border-slate-900 flex items-center justify-center">
              <CheckCircle2 size={10} className="text-white" />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] font-extrabold text-white tracking-tight">{user.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r ${roleColors[user.user_type] || 'from-indigo-500 to-violet-600'} text-white text-[10px] font-bold uppercase tracking-wider shadow-lg`}>
                <ShieldCheck size={11} />
                {roleLabels[user.user_type] || user.user_type}
              </span>
              <Badge variant="success" dot>Active</Badge>
              {user.client_name && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-white/70 text-[11px] font-medium">
                  <Building2 size={11} /> {user.client_name}
                </span>
              )}
              {user.branch_name && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-white/70 text-[11px] font-medium">
                  <GitBranch size={11} /> {user.branch_name}
                </span>
              )}
              <div className="flex items-center gap-4 mt-0 text-[12px] text-white/50">
              <span className="flex items-center gap-1.5"><Mail size={11} /> {user.email}</span>
              {user.phone && <span className="flex items-center gap-1.5"><Phone size={11} /> {user.phone}</span>}
            </div>
            </div>
            
          </div>

          {/* Logout */}
          <Button variant="danger" size="sm" onClick={() => { toast.info('Logged Out', 'You have been signed out'); logout(); }}
            className="!bg-white/10 !text-white !border-white/10 hover:!bg-red-500/80 !shadow-none">
            <LogOut size={13} /> Sign Out
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left Column ── */}
        <div className="space-y-5">
          {/* Quick Info Card */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <User size={15} className="text-indigo-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Account Details</h3>
            </div>
            <div className="p-5 space-y-4">
              {infoItems.map(item => (
                <div key={item.label} className="flex items-start gap-3 group">
                  <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/8 transition-colors duration-200">
                    <item.icon size={14} className="text-muted group-hover:text-primary transition-colors duration-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{item.label}</div>
                    <div className="text-[13px] font-medium text-text mt-0.5 truncate">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Plan Card — only for client/branch users */}
          {planInfo && !isSuperAdmin && (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
              <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <CreditCard size={15} className="text-amber-500" />
                </div>
                <h3 className="text-[13px] font-bold text-text">Subscription</h3>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[15px] font-extrabold text-text">{planInfo.plan_name || 'Free'}</div>
                    <div className="text-[11px] text-muted mt-0.5 capitalize">{planInfo.plan_type} plan</div>
                  </div>
                  <Badge variant={planInfo.expired ? 'danger' : planInfo.has_plan ? 'success' : 'warning'} dot>
                    {planInfo.expired ? 'Expired' : planInfo.has_plan ? 'Active' : 'Free'}
                  </Badge>
                </div>
                {planInfo.expires_at && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-[11px]">
                    <Calendar size={12} className="text-muted" />
                    <span className="text-muted">Expires:</span>
                    <span className="font-semibold text-text">{new Date(planInfo.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Session Info */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Monitor size={15} className="text-emerald-500" />
              </div>
              <h3 className="text-[13px] font-bold text-text">Session</h3>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Status', value: 'Online', dot: true },
                { label: 'Platform', value: 'Web Browser' },
                { label: 'Last Active', value: 'Just now' },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-[11.5px] text-muted">{s.label}</span>
                  <div className="flex items-center gap-1.5">
                    {s.dot && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                    <span className="text-[12px] font-semibold text-text">{s.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Edit Profile */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <User size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-text">Personal Information</h3>
                  <p className="text-[11px] text-muted mt-0.5">Update your profile details</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Full Name" defaultValue={user.name} />
                <Input label="Email Address" defaultValue={user.email} disabled />
                <Input label="Phone Number" defaultValue={user.phone || ''} placeholder="+91 9876543210" />
                <Input label="Designation" defaultValue={user.designation || ''} placeholder="e.g. Manager" />
              </div>
              <div className="flex justify-end mt-5">
                <Button disabled={saving} onClick={() => toast.info('Info', 'Profile update coming soon')}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Update Profile
                </Button>
              </div>
            </div>
          </div>

          {/* Change Password */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="px-6 py-5 border-b border-border/50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Lock size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-extrabold text-text">Change Password</h3>
                <p className="text-[11px] text-muted mt-0.5">Secure your account with a strong password</p>
              </div>
            </div>
            <div className="p-6">
              {/* Current Password */}
              <div className="mb-4">
                <label className="text-[11.5px] font-semibold text-text mb-1 block">Current Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input type={showCurrent ? 'text' : 'password'} value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3 py-2 pr-10 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted hover:border-border/80" />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                    {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* New Password */}
                <div>
                  <label className="text-[11.5px] font-semibold text-text mb-1 block">New Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full px-3 py-2 pr-10 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted hover:border-border/80" />
                    <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                      {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {newPw && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${
                          newPw.length >= 12 ? 'bg-emerald-500 w-full' : newPw.length >= 8 ? 'bg-amber-500 w-3/4' : 'bg-red-500 w-1/3'
                        }`} style={{ width: newPw.length >= 12 ? '100%' : newPw.length >= 8 ? '75%' : '33%' }} />
                      </div>
                      <span className={`text-[9px] font-bold ${newPw.length >= 12 ? 'text-emerald-500' : newPw.length >= 8 ? 'text-amber-500' : 'text-red-500'}`}>
                        {newPw.length >= 12 ? 'Strong' : newPw.length >= 8 ? 'Good' : 'Weak'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Confirm */}
                <div>
                  <label className="text-[11.5px] font-semibold text-text mb-1 block">Confirm Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type={showConfirm ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Re-enter password"
                      className={`w-full px-3 py-2 pr-10 rounded-lg border-[1.5px] bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:ring-2 placeholder:text-muted hover:border-border/80 ${
                        confirmPw && confirmPw !== newPw ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : 'border-border focus:border-primary/50 focus:ring-primary/10'
                      }`} />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {confirmPw && (
                    <div className="mt-1.5 text-[10px] font-semibold">
                      {confirmPw === newPw
                        ? <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> Passwords match</span>
                        : <span className="text-red-500">Passwords do not match</span>}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end mt-5">
                <Button onClick={handleChangePassword} disabled={changingPw}>
                  {changingPw ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                  {changingPw ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </div>
          </div>

          {/* Permissions Overview */}
          {isSuperAdmin && (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
              <div className="px-6 py-5 border-b border-border/50 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
                  <ShieldCheck size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-text">Your Permissions</h3>
                  <p className="text-[11px] text-muted mt-0.5">System access level</p>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-200/50">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
                    <ShieldCheck size={20} className="text-white" />
                  </div>
                  <div>
                    <div className="text-[14px] font-extrabold text-red-800">Full System Access</div>
                    <div className="text-[11.5px] text-red-600/70 mt-0.5">As Super Administrator, you have unrestricted access to all modules and features.</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {!isSuperAdmin && user.permissions && Object.keys(user.permissions).length > 0 && (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
              <div className="px-6 py-5 border-b border-border/50 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <ShieldCheck size={16} className="text-white" />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-text">Your Permissions</h3>
                  <p className="text-[11px] text-muted mt-0.5">Modules you have access to</p>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(user.permissions).map(([slug, perms]) => {
                    const enabled = Object.values(perms).filter(Boolean).length;
                    const total = Object.values(perms).length;
                    const permIcons: Record<string, { icon: typeof Eye; label: string; activeColor: string }> = {
                      can_view: { icon: Eye, label: 'View', activeColor: 'bg-emerald-500 text-white shadow-emerald-500/30' },
                      can_add: { icon: Plus, label: 'Add', activeColor: 'bg-blue-500 text-white shadow-blue-500/30' },
                      can_edit: { icon: Pencil, label: 'Edit', activeColor: 'bg-amber-500 text-white shadow-amber-500/30' },
                      can_delete: { icon: Trash2, label: 'Delete', activeColor: 'bg-red-500 text-white shadow-red-500/30' },
                      can_export: { icon: Download, label: 'Export', activeColor: 'bg-purple-500 text-white shadow-purple-500/30' },
                      can_import: { icon: Upload, label: 'Import', activeColor: 'bg-sky-500 text-white shadow-sky-500/30' },
                      can_approve: { icon: CheckCircle2, label: 'Approve', activeColor: 'bg-indigo-500 text-white shadow-indigo-500/30' },
                    };
                    return (
                      <div key={slug} className="p-3.5 rounded-xl bg-surface-2 border border-border/40 hover:border-primary/20 hover:shadow-md transition-all duration-200">
                        <div className="flex items-center gap-2.5 mb-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-extrabold shadow-md ${
                            enabled === total ? 'bg-emerald-500 shadow-emerald-500/25' : enabled > 0 ? 'bg-indigo-500 shadow-indigo-500/25' : 'bg-slate-400'
                          }`}>
                            {slug.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] font-bold text-text capitalize">{slug.replace(/-/g, ' ')}</div>
                            <div className="text-[10px] text-muted">{enabled} of {total} enabled</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {Object.entries(perms).map(([key, val]) => {
                            const pi = permIcons[key];
                            if (!pi) return null;
                            const Icon = pi.icon;
                            return (
                              <div key={key} className="relative group/tip">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${
                                  val ? `${pi.activeColor} shadow-sm` : 'bg-border/40 text-muted/40'
                                }`}>
                                  <Icon size={12} />
                                </div>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg bg-[#1e293b] text-white text-[9px] font-semibold whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity duration-200 z-10">
                                  {pi.label}{val ? '' : ' (off)'}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-[#1e293b]" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
