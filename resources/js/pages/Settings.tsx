import { useState } from 'react';
import Input, { Textarea } from '../components/ui/Input';
import Button from '../components/ui/Button';
import {
  Settings as SettingsIcon, Lock, Info, HelpCircle, Phone, Save,
  Globe, Mail, Shield, Bell, Eye, Database, Palette, Server,
  ChevronRight, CheckCircle2, AlertTriangle, Monitor
} from 'lucide-react';

const tabs = [
  { id: 'general', icon: SettingsIcon, label: 'General', desc: 'Platform configuration', gradient: 'from-indigo-500 to-violet-600', shadow: 'shadow-indigo-500/20' },
  { id: 'security', icon: Shield, label: 'Security', desc: 'Auth & access control', gradient: 'from-red-500 to-orange-600', shadow: 'shadow-red-500/20' },
  { id: 'notifications', icon: Bell, label: 'Notifications', desc: 'Email & push alerts', gradient: 'from-amber-500 to-yellow-600', shadow: 'shadow-amber-500/20' },
  { id: 'appearance', icon: Palette, label: 'Appearance', desc: 'Branding & themes', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
  { id: 'privacy', icon: Lock, label: 'Privacy', desc: 'Data & compliance', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/20' },
  { id: 'about', icon: Info, label: 'About', desc: 'Platform info', gradient: 'from-sky-500 to-blue-600', shadow: 'shadow-sky-500/20' },
  { id: 'help', icon: HelpCircle, label: 'Help & FAQs', desc: 'Support resources', gradient: 'from-pink-500 to-rose-600', shadow: 'shadow-pink-500/20' },
  { id: 'contact', icon: Phone, label: 'Contact Us', desc: 'Support channels', gradient: 'from-cyan-500 to-teal-600', shadow: 'shadow-cyan-500/20' },
];

function ToggleSwitch({ label, desc, defaultChecked = false }: { label: string; desc?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="flex items-center justify-between py-4 border-b border-border/30 last:border-0 group hover:bg-primary/[.02] -mx-5 px-5 transition-colors duration-200">
      <div className="flex-1 min-w-0 mr-4">
        <span className="text-[13px] font-semibold text-text">{label}</span>
        {desc && <p className="text-[11px] text-muted mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => setOn(!on)}
        className={`relative w-12 h-[26px] rounded-full transition-all duration-300 cursor-pointer flex-shrink-0 ${on ? 'bg-primary shadow-md shadow-primary/25' : 'bg-border'}`}>
        <div className={`absolute top-[3px] w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-300 ${on ? 'left-[26px]' : 'left-[3px]'}`} />
      </button>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  const activeTab = tabs.find(t => t.id === tab)!;

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-red-500/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-3xl" />
        <div className="relative px-8 py-7 flex items-center gap-5">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-red-500/30">
              <SettingsIcon size={24} className="text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-emerald-500 border-[3px] border-slate-900 flex items-center justify-center">
              <CheckCircle2 size={10} className="text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-[24px] font-extrabold text-white tracking-tight">Global Settings</h1>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg">
                <Shield size={11} /> System Config
              </span>
              <p className="text-white/50 text-[13px]">Platform-wide configuration</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Sidebar */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
          <div className="px-5 py-4 border-b border-border/50">
            <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest">Configuration</h3>
          </div>
          <div className="p-2.5">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all duration-200 cursor-pointer mb-0.5 group ${
                  tab === t.id ? 'bg-primary/8' : 'hover:bg-surface-2'
                }`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 shadow-md ${
                  tab === t.id ? `bg-gradient-to-br ${t.gradient} ${t.shadow}` : 'bg-surface-2 shadow-none group-hover:shadow-sm'
                }`}>
                  <t.icon size={16} className={tab === t.id ? 'text-white' : 'text-muted group-hover:text-text'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12.5px] font-semibold ${tab === t.id ? 'text-primary' : 'text-text'}`}>{t.label}</div>
                  <div className="text-[10px] text-muted truncate">{t.desc}</div>
                </div>
                <ChevronRight size={12} className={`flex-shrink-0 transition-all duration-200 ${tab === t.id ? 'text-primary opacity-100' : 'text-muted opacity-0 group-hover:opacity-50'}`} />
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300">
          {/* Tab Header */}
          <div className="px-6 py-5 border-b border-border/50 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${activeTab.gradient} flex items-center justify-center shadow-lg ${activeTab.shadow}`}>
              <activeTab.icon size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-[16px] font-extrabold text-text">{activeTab.label}</h2>
              <p className="text-[11.5px] text-muted mt-0.5">{activeTab.desc}</p>
            </div>
          </div>

          <div className="p-6">
            {/* ── General ── */}
            {tab === 'general' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Platform Name" defaultValue="Cross Border Command" />
                  <Input label="Tagline" defaultValue="Multi-Tenant SaaS Platform" />
                  <Input label="Support Email" defaultValue="support@cbc.com" />
                  <Input label="Admin Email" defaultValue="admin@cbc.com" />
                  <Input label="Contact Phone" defaultValue="+91 9876543210" />
                  <Input label="Website URL" defaultValue="https://cbc.com" />
                </div>
                <Textarea label="Platform Description" defaultValue="Cross Border Command is a comprehensive multi-tenant platform for managing organizations, branches, and teams." />
                <div className="flex justify-end pt-2">
                  <Button><Save size={13} /> Save Changes</Button>
                </div>
              </div>
            )}

            {/* ── Security ── */}
            {tab === 'security' && (
              <div>
                <ToggleSwitch label="Two-Factor Authentication" desc="Require 2FA for all admin users" defaultChecked />
                <ToggleSwitch label="Force Password Reset (90 days)" desc="Users must change password every 90 days" />
                <ToggleSwitch label="Login Notifications" desc="Send email on new device login" defaultChecked />
                <ToggleSwitch label="IP Whitelisting" desc="Restrict access to specific IP addresses" />
                <ToggleSwitch label="Session Timeout (30 min)" desc="Auto logout after 30 minutes of inactivity" defaultChecked />
                <ToggleSwitch label="Brute Force Protection" desc="Lock account after 5 failed login attempts" defaultChecked />
                <div className="flex justify-end pt-5">
                  <Button><Save size={13} /> Save Security Settings</Button>
                </div>
              </div>
            )}

            {/* ── Notifications ── */}
            {tab === 'notifications' && (
              <div>
                <ToggleSwitch label="Email Notifications" desc="Send email for important events" defaultChecked />
                <ToggleSwitch label="Push Notifications" desc="Browser push notifications" defaultChecked />
                <ToggleSwitch label="Plan Expiry Alerts" desc="Notify 7 days before plan expires" defaultChecked />
                <ToggleSwitch label="New User Registration" desc="Notify admin on new user signup" defaultChecked />
                <ToggleSwitch label="Payment Alerts" desc="Notify on successful/failed payments" defaultChecked />
                <ToggleSwitch label="Weekly Reports" desc="Send weekly summary to admins" />
                <div className="flex justify-end pt-5">
                  <Button><Save size={13} /> Save Notification Settings</Button>
                </div>
              </div>
            )}

            {/* ── Appearance ── */}
            {tab === 'appearance' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.5px] font-semibold text-text">Primary Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" defaultValue="#4F46E5" className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
                      <Input defaultValue="#4F46E5" className="flex-1" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.5px] font-semibold text-text">Secondary Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" defaultValue="#10B981" className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
                      <Input defaultValue="#10B981" className="flex-1" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.5px] font-semibold text-text">Platform Logo</label>
                    <div className="flex items-center justify-center py-8 border-2 border-dashed border-border rounded-xl bg-surface-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group">
                      <span className="text-[12px] text-muted group-hover:text-primary transition-colors">Click to upload logo</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.5px] font-semibold text-text">Favicon</label>
                    <div className="flex items-center justify-center py-8 border-2 border-dashed border-border rounded-xl bg-surface-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group">
                      <span className="text-[12px] text-muted group-hover:text-primary transition-colors">Click to upload favicon</span>
                    </div>
                  </div>
                </div>
                <ToggleSwitch label="Dark Mode Default" desc="Set dark mode as default for new users" />
                <div className="flex justify-end pt-2">
                  <Button><Save size={13} /> Save Appearance</Button>
                </div>
              </div>
            )}

            {/* ── Privacy ── */}
            {tab === 'privacy' && (
              <div className="space-y-5">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200/60">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-emerald-800">Data Compliance</div>
                    <p className="text-[11.5px] text-emerald-700 mt-0.5">Your platform meets basic data protection requirements</p>
                  </div>
                </div>
                <ToggleSwitch label="Data Encryption at Rest" desc="Encrypt all stored data using AES-256" defaultChecked />
                <ToggleSwitch label="Activity Logging" desc="Log all user actions for audit trail" defaultChecked />
                <ToggleSwitch label="Data Retention (90 days)" desc="Auto-delete inactive data after 90 days" />
                <ToggleSwitch label="Cookie Consent Banner" desc="Show cookie consent to users" defaultChecked />
                <Textarea label="Privacy Policy URL" defaultValue="https://cbc.com/privacy" />
                <div className="flex justify-end pt-2">
                  <Button><Save size={13} /> Save Privacy Settings</Button>
                </div>
              </div>
            )}

            {/* ── About ── */}
            {tab === 'about' && (
              <div className="space-y-5">
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-white">
                  <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-xl" />
                  <div className="relative">
                    <h3 className="text-[20px] font-extrabold">Cross Border Command</h3>
                    <p className="text-white/70 text-[13px] mt-1">Multi-Tenant SaaS Platform</p>
                    <div className="flex items-center gap-3 mt-4 flex-wrap">
                      {['v1.0.0', 'Laravel 12', 'React + TypeScript', 'PostgreSQL'].map(t => (
                        <span key={t} className="text-[11px] bg-white/15 px-3 py-1 rounded-lg font-semibold">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Framework', value: 'Laravel 12.x', icon: Server },
                    { label: 'Frontend', value: 'React 19 + Vite', icon: Monitor },
                    { label: 'Database', value: 'PostgreSQL', icon: Database },
                    { label: 'Auth', value: 'Laravel Sanctum', icon: Shield },
                  ].map(d => (
                    <div key={d.label} className="flex items-center gap-3 p-4 rounded-xl bg-surface-2 border border-border/40 hover:border-primary/20 transition-all duration-200 group">
                      <div className="w-9 h-9 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                        <d.icon size={16} className="text-primary" />
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{d.label}</div>
                        <div className="text-[13px] font-bold text-text">{d.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Help ── */}
            {tab === 'help' && (
              <div className="space-y-3">
                {[
                  { q: 'How to add a new client?', a: 'Go to Clients and click Add Client. Fill in the organization details and admin credentials. The client admin will receive a welcome email with login credentials.' },
                  { q: 'How to manage branches?', a: 'Client admins can add branches from the Branches page. Set one branch as "Main" (Head Office) to give its users visibility across all branches.' },
                  { q: 'How do permissions work?', a: 'Super admins assign permissions to client admins. Client admins can then assign permissions to their branch users. Each module has View, Add, Edit, Delete, Export, Import, and Approve permissions.' },
                  { q: 'How to subscribe to a plan?', a: 'Client admins can go to My Plan page to view available plans and subscribe. Plans determine which modules and features are available.' },
                  { q: 'What happens when a plan expires?', a: 'Branch users will be blocked from accessing the platform. Client admins will only see the plan selection page until they renew.' },
                ].map((faq, i) => (
                  <details key={i} className="group rounded-xl border border-border bg-surface overflow-hidden hover:shadow-md transition-shadow duration-200">
                    <summary className="flex items-center gap-3 px-5 py-4 cursor-pointer list-none select-none hover:bg-primary/[.02] transition-all">
                      <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0 group-open:bg-primary/15 transition-all">
                        <HelpCircle size={14} className="text-primary" />
                      </div>
                      <span className="text-[13px] font-semibold text-text flex-1">{faq.q}</span>
                      <ChevronRight size={14} className="text-muted transition-transform duration-200 group-open:rotate-90" />
                    </summary>
                    <div className="px-5 pb-4 pl-16">
                      <p className="text-[12.5px] text-secondary leading-relaxed">{faq.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            )}

            {/* ── Contact ── */}
            {tab === 'contact' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Email Support', value: 'support@cbc.com', icon: Mail, desc: 'Response within 24 hours' },
                    { label: 'Phone Support', value: '+91 9876543210', icon: Phone, desc: 'Mon-Fri, 9 AM - 6 PM IST' },
                    { label: 'Website', value: 'https://cbc.com', icon: Globe, desc: 'Documentation & resources' },
                    { label: 'Status Page', value: 'status.cbc.com', icon: Eye, desc: 'System uptime & incidents' },
                  ].map(c => (
                    <div key={c.label} className="flex items-start gap-3 p-4 rounded-xl bg-surface-2 border border-border/40 hover:border-primary/20 hover:shadow-md transition-all duration-200 group">
                      <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-colors">
                        <c.icon size={18} className="text-primary" />
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{c.label}</div>
                        <div className="text-[14px] font-bold text-text mt-0.5">{c.value}</div>
                        <div className="text-[11px] text-muted mt-0.5">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200/60">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle size={16} className="text-amber-500" />
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-amber-800">Emergency Support</div>
                    <p className="text-[11.5px] text-amber-700 mt-0.5">For critical issues: <strong>+91 98765 00000</strong></p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
