import { useState, useEffect, useCallback } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import { Td } from '../components/ui/Table';
import DeleteConfirmModal from '../components/ui/DeleteConfirmModal';
import { Plus, Download, Search, Pencil, Trash2, ShieldCheck, GitBranch, Settings, IndianRupee, Building2, Eye, Loader2 } from 'lucide-react';
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
              <tr className="bg-border border-b border-border">
                {['#', 'Organization', 'Unique ID', 'Contact', 'Type', 'Branches', 'Plan', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] text-[9.5px] font-bold tracking-wider uppercase text-secondary tracking-wider uppercase  whitespace-nowrap">{h}</th>
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
                        { icon: Eye, cls: 'hover:bg-emerald-50 hover:text-emerald-500 hover:border-emerald-300', title: 'View', onClick: () => onNavigate('client-view', { clientId: c.id }) },
                        { icon: Pencil, cls: 'hover:bg-blue-50 hover:text-blue-500 hover:border-blue-300', title: 'Edit', onClick: () => onNavigate('client-form', { editId: c.id }) },
                        { icon: Trash2, cls: 'hover:bg-red-50 hover:text-red-500 hover:border-red-300', title: 'Delete', onClick: () => handleDeleteClick(c) },
                        { icon: ShieldCheck, cls: 'hover:bg-indigo-50 hover:text-indigo-500 hover:border-indigo-300', title: 'Permissions', onClick: () => onNavigate('client-permissions', { clientId: c.id, clientName: c.org_name }) },
                        { icon: IndianRupee, cls: 'hover:bg-emerald-50 hover:text-emerald-500 hover:border-emerald-300', title: 'Payments', onClick: () => onNavigate('client-payments', { clientId: c.id, clientName: c.org_name }) },
                        { icon: GitBranch, cls: 'hover:bg-sky-50 hover:text-sky-500 hover:border-sky-300', title: 'Branches', onClick: () => onNavigate('client-branches', { clientId: c.id, clientName: c.org_name }) },
                        { icon: Settings, cls: 'hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300', title: 'Settings', onClick: () => onNavigate('client-settings', { clientId: c.id, clientName: c.org_name }) },
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

    </div>
  );
}