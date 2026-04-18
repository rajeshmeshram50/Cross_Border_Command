import { useState, useEffect } from 'react';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import { Td } from '../components/ui/Table';
import {
  GitBranch, ArrowLeft, Star, Search,
  Building, Factory, Warehouse
} from 'lucide-react';
import api from '../api';
import { ShimmerCards } from '../components/ui/Shimmer';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const typeIcons: Record<string, typeof Building> = {
  company: Building,
  division: GitBranch,
  factory: Factory,
  warehouse: Warehouse,
};

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

  const totalUsers = branches.reduce((s: number, b: any) => s + (b.users_count || 0), 0);
  const activeBranches = branches.filter(b => b.status === 'active').length;
  const mainBranch = branches.find((b: any) => b.is_main);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-border bg-surface flex items-center justify-center text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <GitBranch size={16} className="text-sky-500" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">Branches</h1>
            <p className="text-[11.5px] text-muted mt-0.5">{clientName} · {branches.length} branches</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: branches.length, color: 'text-text' },
          { label: 'Active', value: activeBranches, color: 'text-emerald-500' },
          { label: 'Main', value: mainBranch ? 1 : 0, color: 'text-amber-500' },
          { label: 'Total Users', value: totalUsers, color: 'text-sky-500' },
        ].map(s => (
          <div key={s.label} className="bg-surface rounded-xl border border-border p-3.5 text-center">
            <div className={`text-[22px] font-extrabold ${s.color}`}>{s.value}</div>
            <div className="text-[9.5px] font-bold text-muted uppercase tracking-wider mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Main Branch Info */}
      {mainBranch && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[12px] text-amber-700">
          <Star size={14} className="text-amber-500 flex-shrink-0" />
          <span><strong>Main Branch</strong> — {mainBranch.name} · Main branch users can view all branches data</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-[260px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name, code, city..."
              className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted" />
          </div>
          <span className="text-[10.5px] text-muted ml-auto">{filtered.length} of {branches.length} branches</span>
        </div>

        {/* Data */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-border border-b border-border">
                {['#', 'Branch / Company', 'Code', 'Type & Industry', 'Contact', 'Location', 'Users', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold tracking-wider uppercase text-secondary tracking-wider uppercase  whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={8} className="py-4"><ShimmerCards count={5} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted text-[12px]">No branches found</td></tr>
              ) : filtered.map((b: any, i: number) => {
                const TypeIcon = typeIcons[b.branch_type || ''] || GitBranch;
                return (
                  <tr key={b.id} className={`hover:bg-primary/5 transition-colors ${b.is_main ? 'bg-amber-50/30' : ''}`}>
                    <Td>{i + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={b.name.charAt(0) + (b.name.split(' ')[1]?.charAt(0) || '')} size="sm" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <strong className="text-text">{b.name}</strong>
                            {b.is_main && (
                              <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">
                                <Star size={7} /> MAIN
                              </span>
                            )}
                          </div>
                          {b.description && <div className="text-[10px] text-muted mt-0.5 max-w-[200px] truncate">{b.description}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {b.code ? (
                        <span className="font-mono text-[10.5px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">{b.code}</span>
                      ) : <span className="text-muted text-[10.5px]">—</span>}
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        {b.branch_type && (
                          <div className="flex items-center gap-1">
                            <TypeIcon size={10} className="text-muted" />
                            <span className="text-[11px] text-text capitalize">{b.branch_type}</span>
                          </div>
                        )}
                        {b.industry && <span className="text-[10px] text-muted">{b.industry}</span>}
                        {!b.branch_type && !b.industry && <span className="text-muted text-[10.5px]">—</span>}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-[11px]">
                        {b.contact_person && <div className="text-text font-medium">{b.contact_person}</div>}
                        {b.email && <div className="text-muted">{b.email}</div>}
                        {b.phone && <div className="text-muted">{b.phone}</div>}
                        {!b.contact_person && !b.email && <span className="text-muted">—</span>}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-[11px]">
                        {b.city && <span className="text-text">{b.city}</span>}
                        {b.city && b.state && <span className="text-muted">, </span>}
                        {b.state && <span className="text-muted">{b.state}</span>}
                        {!b.city && !b.state && <span className="text-muted">—</span>}
                      </div>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center justify-center min-w-[28px] h-7 bg-sky-500 text-white rounded-lg font-bold text-xs px-1.5">
                        {b.users_count ?? 0}
                      </span>
                    </Td>
                    <Td><Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>{b.status}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border/50 flex justify-between items-center text-[10.5px] text-muted">
          <span>Showing {filtered.length} of {branches.length} branches</span>
        </div>
      </div>
    </div>
  );
}
