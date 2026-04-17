import { useState, useEffect, useCallback } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import { Td } from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import { Plus, Download, Search, Pencil, Trash2, ShieldCheck, GitBranch, Settings, IndianRupee, Building2, Eye, Loader2, Star, MapPin, Users, Phone, Mail, Building, Calendar, Clock as ClockIcon, CheckCircle, XCircle, TrendingUp, Layers } from 'lucide-react';
import api from '../api';
import { ShimmerCards } from '../components/ui/Shimmer';
import { useToast } from '../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Client, PaginatedResponse } from '../types';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

export default function Clients({ onNavigate }: Props) {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [branchModal, setBranchModal] = useState<{ open: boolean; client: Client | null; branches: any[]; loading: boolean }>({
    open: false,
    client: null,
    branches: [],
    loading: false
  });

  const openBranches = async (client: Client) => {
    setBranchModal({ open: true, client, branches: [], loading: true });
    try {
      const res = await api.get('/branches', { params: { client_id: client.id, per_page: 50 } });
      setBranchModal(prev => ({ ...prev, branches: res.data.data || [], loading: false }));
    } catch {
      setBranchModal(prev => ({ ...prev, loading: false }));
    }
  };

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Client>>('/clients', {
        params: { search: search || undefined, page, per_page: 15 },
      });
      setClients(res.data.data);
      setTotalPages(res.data.last_page);
      setTotal(res.data.total);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  // Debounce search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get<PaginatedResponse<Client>>('/clients', { params: { per_page: 9999 } });
      const allClients = res.data.data;

      const rows = allClients.map((c, i) => ({
        '#': i + 1,
        'Organization Name': c.org_name,
        'Unique ID': c.unique_number,
        'Email': c.email,
        'Phone': c.phone || '',
        'Website': c.website || '',
        'Type': c.org_type,
        'Industry': c.industry || '',
        'City': c.city || '',
        'District': c.district || '',
        'Taluka': c.taluka || '',
        'State': c.state || '',
        'Pincode': c.pincode || '',
        'Country': c.country || '',
        'GST Number': c.gst_number || '',
        'PAN Number': c.pan_number || '',
        'Plan': c.plan?.name || 'Free',
        'Plan Type': c.plan_type,
        'Status': c.status,
        'Branches': c.branches_count ?? 0,
        'Users': c.users_count ?? 0,
        'Plan Expires': c.plan_expires_at || '',
        'Created At': new Date(c.created_at).toLocaleDateString('en-IN'),
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const colWidths = Object.keys(rows[0] || {}).map(key => ({
        wch: Math.max(key.length, ...rows.map(r => String((r as any)[key]).length)) + 2,
      }));
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clients');

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Clients_${new Date().toISOString().slice(0, 10)}.xlsx`);

      toast.success('Exported', `${allClients.length} clients exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export clients');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteClick = (client: Client) => {
    setSelectedClient(client);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedClient) return;

    setDeleting(selectedClient.id);

    try {
      await api.delete(`/clients/${selectedClient.id}`);
      toast.success('Deleted', `${selectedClient.org_name} deleted successfully`);
      fetchClients();
      setDeleteOpen(false);
      setSelectedClient(null);
    } catch {
      toast.error('Error', 'Failed to delete client');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">Clients</h1>
            <p className="text-[11.5px] text-muted mt-0.5">Manage all registered organizations · {total} total</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Exporting...' : 'Export Excel'}
          </Button>
          <Button size="sm" onClick={() => onNavigate('client-form')}><Plus size={13} /> Add Client</Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-[260px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name or ID..."
              className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border bg-bg text-[11.5px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted"
            />
          </div>
          <span className="text-[10.5px] text-muted ml-auto">
            {loading ? 'Loading...' : `${clients.length} of ${total} results`}
          </span>
        </div>

        {/* Data */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-sidebar">
                {['#', 'Organization', 'Unique ID', 'Contact', 'Type', 'Branches', 'Plan', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold tracking-wider uppercase text-white/50 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={9} className="py-4"><ShimmerCards count={6} /></td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted text-[12px]">No clients found</td></tr>
              ) : clients.map((c, i) => (
                <tr key={c.id} className="hover:bg-primary/5 transition-colors">
                  <Td>{(page - 1) * 15 + i + 1}</Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={c.org_name.charAt(0) + (c.org_name.split(' ')[1]?.charAt(0) || '')} size="sm" />
                      <div>
                        <strong className="text-text block">{c.org_name}</strong>
                      </div>
                    </div>
                  </Td>
                  <Td><span className="font-mono text-[10.5px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">{c.unique_number}</span></Td>
                  <Td>
                    <div className="text-[11px]">
                      <div className="text-text">{c.email}</div>
                      {c.phone && <div className="text-muted">{c.phone}</div>}
                    </div>
                  </Td>
                  <Td><Badge variant="info">{c.org_type}</Badge></Td>
                  <Td>
                    <span className="inline-flex items-center justify-center min-w-[28px] h-7 bg-amber-500 text-white rounded-lg font-bold text-xs px-1.5">{c.branches_count ?? 0}</span>
                  </Td>
                  <Td>
                    <Badge variant="primary">{c.plan?.name || 'Free'}</Badge>
                    {c.plan && c.plan.price > 0 && <span className="text-[10.5px] text-emerald-500 font-semibold ml-1.5">₹{c.plan.price.toLocaleString()}/yr</span>}
                  </Td>
                  <Td><Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      {[
                        { icon: Eye, cls: 'hover:bg-emerald-50 hover:text-emerald-500 hover:border-emerald-300', title: 'View', onClick: () => { } },
                        { icon: Pencil, cls: 'hover:bg-blue-50 hover:text-blue-500 hover:border-blue-300', title: 'Edit', onClick: () => onNavigate('client-form', { editId: c.id }) },
                        { icon: Trash2, cls: 'hover:bg-red-50 hover:text-red-500 hover:border-red-300', title: 'Delete', onClick: () => handleDeleteClick(c) },
                        { icon: ShieldCheck, cls: 'hover:bg-indigo-50 hover:text-indigo-500 hover:border-indigo-300', title: 'Permissions', onClick: () => { } },
                        { icon: IndianRupee, cls: 'hover:bg-emerald-50 hover:text-emerald-500 hover:border-emerald-300', title: 'Billing', onClick: () => { } },
                        { icon: GitBranch, cls: 'hover:bg-sky-50 hover:text-sky-500 hover:border-sky-300', title: 'Branches', onClick: () => openBranches(c) },
                        { icon: Settings, cls: 'hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300', title: 'Settings', onClick: () => { } },
                      ].map(({ icon: I, cls, title, onClick }, j) => (
                        <button key={j} title={title} onClick={onClick} disabled={deleting === c.id}
                          className={`w-6 h-6 rounded-md border border-border bg-surface text-muted flex items-center justify-center transition-all hover:-translate-y-px cursor-pointer ${cls} ${deleting === c.id ? 'opacity-50' : ''}`}>
                          <I size={11} />
                        </button>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border/50 flex justify-between items-center text-[10.5px] text-muted">
          <span>Showing {clients.length} of {total} entries</span>
          <div className="flex gap-0.5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={`w-6 h-6 rounded text-[10.5px] font-semibold flex items-center justify-center border cursor-pointer ${n === page ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:text-primary hover:border-primary/40'}`}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal - Single instance */}
      <DeleteConfirmModal
        open={deleteOpen}
        clientName={selectedClient?.org_name}
        onClose={() => {
          setDeleteOpen(false);
          setSelectedClient(null);
        }}
        onConfirm={confirmDelete}
        loading={deleting !== null}
      />


      {/* Enhanced Branches Modal */}
      <Modal open={branchModal.open} onClose={() => setBranchModal(p => ({ ...p, open: false }))} title={`Branches — ${branchModal.client?.org_name || ''}`} size="lg">
        {branchModal.loading ? (
          <div className="flex items-center justify-center py-8 text-muted text-[12px]">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading branches...
          </div>
        ) : branchModal.branches.length === 0 ? (
          <div className="text-center py-8 text-muted text-[13px]">No branches found for this client.</div>
        ) : (
          <div className="space-y-3">
            {branchModal.branches.map((b: any, idx: number) => (
              <div
                key={b.id}
                className={`group relative overflow-hidden rounded-xl border-2 transition-all duration-300 hover:shadow-xl ${b.is_main
                    ? 'border-amber-300 bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/30 dark:to-amber-900/20'
                    : 'border-border hover:border-primary/30 bg-gradient-to-br from-surface to-surface-2/50'
                  }`}
              >
                {/* Shine Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

                <div className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center text-white text-[11px] font-extrabold shadow-md ${b.is_main ? 'bg-gradient-to-br from-amber-500 to-yellow-400' : 'bg-gradient-to-br from-sky-500 to-cyan-400'
                        }`}>
                        {b.code?.substring(0, 2) || b.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-text">{b.name}</span>
                          {b.is_main && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-sm">
                              <Star size={8} className="fill-white" /> MAIN
                            </span>
                          )}
                        </div>
                        {b.description && <div className="text-[10.5px] text-muted mt-0.5">{b.description}</div>}
                      </div>
                    </div>
                    <Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>{b.status}</Badge>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/30">
                    {b.code && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                          <GitBranch size={10} className="text-primary" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Code</div>
                          <div className="text-[11px] font-bold text-primary font-mono">{b.code}</div>
                        </div>
                      </div>
                    )}

                    {b.branch_type && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-purple-500/10 flex items-center justify-center">
                          <Building size={10} className="text-purple-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Type</div>
                          <div className="text-[11px] font-semibold text-text capitalize">{b.branch_type}</div>
                        </div>
                      </div>
                    )}

                    {(b.city || b.state) && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                          <MapPin size={10} className="text-emerald-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Location</div>
                          <div className="text-[11px] font-semibold text-text truncate">
                            {[b.city, b.state].filter(Boolean).join(', ')}
                          </div>
                        </div>
                      </div>
                    )}

                    {b.contact_person && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center">
                          <Users size={10} className="text-indigo-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Contact</div>
                          <div className="text-[11px] font-semibold text-text">{b.contact_person}</div>
                        </div>
                      </div>
                    )}

                    {b.email && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-sky-500/10 flex items-center justify-center">
                          <Mail size={10} className="text-sky-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Email</div>
                          <div className="text-[11px] font-semibold text-text truncate">{b.email}</div>
                        </div>
                      </div>
                    )}

                    {b.phone && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-teal-500/10 flex items-center justify-center">
                          <Phone size={10} className="text-teal-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Phone</div>
                          <div className="text-[11px] font-semibold text-text">{b.phone}</div>
                        </div>
                      </div>
                    )}

                    {b.users_count !== undefined && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                          <Users size={10} className="text-amber-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">Users</div>
                          <div className="text-[11px] font-bold text-text">{b.users_count}</div>
                        </div>
                      </div>
                    )}

                    {b.gst_number && (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-red-500/10 flex items-center justify-center">
                          <Building2 size={10} className="text-red-500" />
                        </div>
                        <div>
                          <div className="text-[9px] text-muted">GST</div>
                          <div className="text-[10px] font-mono font-semibold text-text">{b.gst_number}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Footer Note */}
            <div className="text-center text-[10.5px] text-muted pt-2">
              {branchModal.branches.length} branch{branchModal.branches.length !== 1 ? 'es' : ''} total
              {branchModal.branches.some((b: any) => b.is_main) && ' · Main branch users can view all branches data'}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}