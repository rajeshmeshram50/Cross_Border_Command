import { useState, useEffect, useCallback } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import { Td } from '../components/ui/Table';
import { Plus, Download, Search, Pencil, Trash2, ShieldCheck, Users, Star, GitBranch, Loader2, Building, Factory, Warehouse } from 'lucide-react';
import api from '../api';
import type { Branch, PaginatedResponse } from '../types';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

const typeIcons: Record<string, typeof Building> = {
  company: Building,
  division: GitBranch,
  factory: Factory,
  warehouse: Warehouse,
};

export default function Branches({ onNavigate }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Branch>>('/branches', {
        params: { search: search || undefined, page, per_page: 15 },
      });
      setBranches(res.data.data);
      setTotalPages(res.data.last_page);
      setTotal(res.data.total);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleDelete = async (branch: Branch) => {
    if (branch.is_main) {
      alert('Cannot delete the main branch. Set another branch as main first.');
      return;
    }
    if (!confirm(`Delete "${branch.name}"? Users in this branch will be unassigned.`)) return;
    setDeleting(branch.id);
    try {
      await api.delete(`/branches/${branch.id}`);
      fetchBranches();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete branch');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <GitBranch size={16} className="text-sky-500" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">Branches / Companies</h1>
            <p className="text-[11.5px] text-muted mt-0.5">Manage all branches & companies under your organization · {total} total</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Download size={13} /> Export</Button>
          <Button size="sm" onClick={() => onNavigate('branch-form')}><Plus size={13} /> Add Branch</Button>
        </div>
      </div>

      {/* Main Branch Info */}
      {branches.some(b => b.is_main) && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[12px] text-amber-700">
          <Star size={14} className="text-amber-500 flex-shrink-0" />
          <span><strong>Main Branch</strong> — {branches.find(b => b.is_main)?.name} · Main branch users can view all branches data</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-[260px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name, code, city..."
              className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted"
            />
          </div>
          <span className="text-[10.5px] text-muted ml-auto">
            {loading ? 'Loading...' : `${branches.length} of ${total} results`}
          </span>
        </div>

        {/* Data */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-sidebar">
                {['#', 'Branch / Company', 'Code', 'Type & Industry', 'Contact', 'Location', 'Users', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold tracking-wider uppercase text-white/50 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted text-[12px]"><Loader2 size={20} className="animate-spin inline-block mr-2" />Loading branches...</td></tr>
              ) : branches.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted text-[12px]">No branches found. Click "Add Branch" to create one.</td></tr>
              ) : branches.map((b, i) => {
                const TypeIcon = typeIcons[b.branch_type || ''] || GitBranch;
                return (
                  <tr key={b.id} className="hover:bg-primary/5 transition-colors">
                    <Td>{(page - 1) * 15 + i + 1}</Td>
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
                      ) : (
                        <span className="text-muted text-[10.5px]">—</span>
                      )}
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
                    <Td>
                      <div className="flex items-center gap-1">
                        {[
                          { icon: Pencil, cls: 'hover:bg-blue-50 hover:text-blue-500 hover:border-blue-300', title: 'Edit', onClick: () => onNavigate('branch-form', { editId: b.id }) },
                          { icon: Trash2, cls: 'hover:bg-red-50 hover:text-red-500 hover:border-red-300', title: 'Delete', onClick: () => handleDelete(b) },
                          { icon: Users, cls: 'hover:bg-sky-50 hover:text-sky-500 hover:border-sky-300', title: 'Users', onClick: () => {} },
                          { icon: ShieldCheck, cls: 'hover:bg-indigo-50 hover:text-indigo-500 hover:border-indigo-300', title: 'Permissions', onClick: () => {} },
                        ].map(({ icon: I, cls, title, onClick }, j) => (
                          <button key={j} title={title} onClick={onClick} disabled={deleting === b.id}
                            className={`w-6 h-6 rounded-md border border-border bg-surface text-muted flex items-center justify-center transition-all hover:-translate-y-px cursor-pointer ${cls} ${deleting === b.id ? 'opacity-50' : ''}`}>
                            <I size={11} />
                          </button>
                        ))}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border/50 flex justify-between items-center text-[10.5px] text-muted">
          <span>Showing {branches.length} of {total} entries</span>
          <div className="flex gap-0.5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={`w-6 h-6 rounded text-[10.5px] font-semibold flex items-center justify-center border cursor-pointer ${n === page ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:text-primary hover:border-primary/40'}`}>{n}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
