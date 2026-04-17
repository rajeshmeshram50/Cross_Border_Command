import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  GitBranch, ArrowLeft, Loader2, Star, MapPin, Users, Phone, Mail,
  Building2, Search, Hash
} from 'lucide-react';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

export default function ClientBranches({ clientId, clientName, onBack }: Props) {
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    api.get('/branches', { params: { client_id: clientId, per_page: 100 } })
      .then(res => setBranches(res.data.data || []))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = branches.filter(b => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return b.name?.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q) || b.city?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <GitBranch size={18} className="text-sky-500" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-text tracking-tight">Branches</h1>
            <p className="text-[12px] text-muted mt-0.5">{clientName} · {branches.length} branches</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <div className="text-[24px] font-extrabold text-text">{branches.length}</div>
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider mt-1">Total</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <div className="text-[24px] font-extrabold text-emerald-500">{branches.filter(b => b.status === 'active').length}</div>
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider mt-1">Active</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <div className="text-[24px] font-extrabold text-amber-500">{branches.filter(b => b.is_main).length}</div>
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider mt-1">Main</div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <div className="text-[24px] font-extrabold text-sky-500">{branches.reduce((s: number, b: any) => s + (b.users_count || 0), 0)}</div>
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider mt-1">Total Users</div>
        </div>
      </div>

      {/* Search */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <div className="relative flex-1 max-w-[280px]">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search branches..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-bg text-[12px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted" />
          </div>
          <span className="text-[11px] text-muted ml-auto">{filtered.length} branches</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted text-[13px]">
            <Loader2 size={20} className="animate-spin mr-3" /> Loading branches...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
              <GitBranch size={24} className="text-sky-300" />
            </div>
            <p className="text-[14px] font-semibold text-text">No Branches Found</p>
            <p className="text-[12px] text-muted mt-1">No branches match your search.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((b: any) => (
              <div key={b.id} className={`px-5 py-4 hover:bg-primary/[.02] transition-colors ${b.is_main ? 'bg-amber-50/30' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white text-[13px] font-extrabold shadow-lg ${b.is_main ? 'bg-gradient-to-br from-amber-500 to-yellow-400 shadow-amber-500/20' : 'bg-gradient-to-br from-sky-500 to-cyan-400 shadow-sky-500/20'}`}>
                      {b.code?.substring(0, 2) || b.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-bold text-text">{b.name}</span>
                        {b.is_main && (
                          <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">
                            <Star size={8} /> MAIN BRANCH
                          </span>
                        )}
                      </div>
                      {b.description && <div className="text-[11px] text-muted mt-0.5">{b.description}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {b.code && <span className="font-mono text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-md">{b.code}</span>}
                    <Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>{b.status}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 mt-3 pl-[58px]">
                  {b.branch_type && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Building2 size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text capitalize">{b.branch_type}</span>
                    </div>
                  )}
                  {(b.city || b.state) && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <MapPin size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text">{[b.city, b.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {b.email && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Mail size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text truncate">{b.email}</span>
                    </div>
                  )}
                  {b.phone && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Phone size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text">{b.phone}</span>
                    </div>
                  )}
                  {b.contact_person && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Users size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text">{b.contact_person}</span>
                    </div>
                  )}
                  {b.users_count !== undefined && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Users size={11} className="text-muted flex-shrink-0" />
                      <span className="text-muted">Users:</span>
                      <span className="font-bold text-text">{b.users_count}</span>
                    </div>
                  )}
                  {b.gst_number && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Hash size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text font-mono text-[10.5px]">{b.gst_number}</span>
                    </div>
                  )}
                  {b.industry && (
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <Building2 size={11} className="text-muted flex-shrink-0" />
                      <span className="text-text">{b.industry}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
