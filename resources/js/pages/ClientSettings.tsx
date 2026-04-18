import { useState, useEffect } from 'react';
import Badge from '../components/ui/Badge';
import {
  Settings, ArrowLeft, Loader2, Shield, Bell, Palette, Globe,
  Lock, Database, CheckCircle2, XCircle
} from 'lucide-react';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const groupIcons: Record<string, typeof Settings> = {
  general: Globe,
  security: Shield,
  notifications: Bell,
  appearance: Palette,
  privacy: Lock,
  billing: Database,
};

export default function ClientSettings({ clientId, clientName, onBack }: Props) {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/client-settings', { params: { client_id: clientId } })
      .then(res => {
        // Handle different response formats
        const data = res.data;
        if (Array.isArray(data)) {
          setSettings(data);
        } else if (data && Array.isArray(data.data)) {
          setSettings(data.data);
        } else if (data && typeof data === 'object') {
          // If it's an object with settings, convert to array
          setSettings(Object.values(data));
        } else {
          setSettings([]);
        }
      })
      .catch(() => setSettings([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  // Group by group field
  const groups: Record<string, any[]> = {};
  settings.forEach((s: any) => {
    const group = s.group || 'general';
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
          <ArrowLeft size={16} />
        </button>
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
          <Settings size={18} className="text-purple-500" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-text tracking-tight">Client Settings</h1>
          <p className="text-[12px] text-muted mt-0.5">{clientName} · Configuration & Preferences</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary mr-3" />
          <span className="text-muted text-[13px]">Loading settings...</span>
        </div>
      ) : settings.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl">
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-50 flex items-center justify-center mb-4">
              <Settings size={24} className="text-purple-300" />
            </div>
            <p className="text-[14px] font-semibold text-text">No Custom Settings</p>
            <p className="text-[12px] text-muted mt-1">This client is using all default platform settings.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([group, items]) => {
            const Icon = groupIcons[group] || Settings;
            return (
              <div key={group} className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border/50 flex items-center gap-2.5 bg-surface-2/50">
                  <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center">
                    <Icon size={14} className="text-primary" />
                  </div>
                  <h3 className="text-[13px] font-bold text-text capitalize">{group}</h3>
                  <span className="text-[10px] text-muted ml-auto">{items.length} settings</span>
                </div>
                <div className="divide-y divide-border/30">
                  {items.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between px-5 py-4 hover:bg-primary/[.02] transition-colors">
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="text-[13px] font-semibold text-text capitalize">{s.key?.replace(/_/g, ' ')}</div>
                        {s.description && <div className="text-[11px] text-muted mt-0.5">{s.description}</div>}
                      </div>
                      <div className="flex-shrink-0">
                        {s.type === 'boolean' ? (
                          <div className="flex items-center gap-2">
                            {(s.value === 'true' || s.value === '1' || s.value === true) ? (
                              <><CheckCircle2 size={16} className="text-emerald-500" /><span className="text-[12px] font-semibold text-emerald-600">Enabled</span></>
                            ) : (
                              <><XCircle size={16} className="text-red-400" /><span className="text-[12px] font-semibold text-red-500">Disabled</span></>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] font-mono text-text bg-surface-2 px-3 py-1.5 rounded-lg border border-border/50">
                            {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
