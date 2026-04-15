import { useState } from 'react';
import { Card, CardBody } from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Settings as SettingsIcon, Lock, Info, HelpCircle, Phone, Palette, Save } from 'lucide-react';

const tabs = [
  { id: 'general', icon: SettingsIcon, label: 'General Settings' },
  { id: 'privacy', icon: Lock, label: 'Privacy Policy' },
  { id: 'security', icon: Lock, label: 'Security' },
  { id: 'about', icon: Info, label: 'About Us' },
  { id: 'help', icon: HelpCircle, label: 'Help & FAQs' },
  { id: 'contact', icon: Phone, label: 'Contact Us' },
];

export default function Settings() {
  const [tab, setTab] = useState('general');

  return (
    <div>
      <h1 className="text-[17px] font-bold text-text tracking-tight mb-4 flex items-center gap-2">
        <SettingsIcon size={16} className="text-primary" /> Global Settings
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-0 bg-surface border border-border rounded-xl overflow-hidden shadow-sm min-h-[500px]">
        {/* Sidebar */}
        <div className="border-r border-border p-4 md:p-0 md:py-5">
          <div className="text-sm font-extrabold text-text px-5 pb-3">App Menu</div>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-[13px] font-medium border-l-[3px] transition-all cursor-pointer ${
                tab === t.id
                  ? 'text-primary font-semibold bg-primary/5 border-primary'
                  : 'text-secondary border-transparent hover:text-text hover:bg-primary/5'
              }`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 bg-surface-2">
          {tab === 'general' && (
            <div>
              <h2 className="text-[15px] font-bold text-text mb-1">General Settings</h2>
              <p className="text-[12.5px] text-secondary mb-5">Platform-wide configuration</p>
              <Card>
                <CardBody>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Platform Name" defaultValue="TenantOS" />
                    <Input label="Tagline" defaultValue="Multi-Tenant SaaS Platform" />
                    <Input label="Support Email" defaultValue="support@tenantos.com" />
                    <Input label="Admin Email" defaultValue="admin@tenantos.com" />
                  </div>
                </CardBody>
              </Card>
              <div className="flex justify-end mt-4">
                <Button><Save size={13} /> Submit</Button>
              </div>
            </div>
          )}
          {tab === 'security' && (
            <div>
              <h2 className="text-[15px] font-bold text-text mb-4">Security Settings</h2>
              <Card>
                <CardBody>
                  {['Two-Factor Authentication', 'Force Password Reset (90 days)', 'Login Notifications'].map((label, i) => (
                    <div key={label} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                      <span className="text-[13px] font-medium text-text">{label}</span>
                      <label className="relative inline-block w-11 h-6 cursor-pointer">
                        <input type="checkbox" defaultChecked={i !== 1} className="sr-only peer" />
                        <div className="w-11 h-6 bg-border rounded-full peer-checked:bg-primary transition-colors" />
                        <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                      </label>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}
          {!['general', 'security'].includes(tab) && (
            <div className="text-center py-16 text-muted">
              <div className="text-3xl mb-2">🔧</div>
              <div className="font-semibold text-text text-sm mb-1">{tabs.find(t => t.id === tab)?.label}</div>
              <p className="text-xs">Configuration panel for this section</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
