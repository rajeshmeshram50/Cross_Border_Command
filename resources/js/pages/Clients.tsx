import { useState, useEffect, useCallback } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import {
  Plus, Download, Search, Pencil, Trash2, ShieldCheck, GitBranch, Settings, IndianRupee,
  Building2, Eye, Loader2
} from 'lucide-react';
import api from '../api';
import { ShimmerCards } from '../components/ui/Shimmer';
import { useToast } from '../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';
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
        '#': i + 1, 'Organization Name': c.org_name, 'Unique ID': c.unique_number,
        'Email': c.email, 'Phone': c.phone || '', 'Website': c.website || '',
        'Type': c.org_type, 'Industry': c.industry || '', 'City': c.city || '',
        'State': c.state || '', 'Country': c.country || '',
        'GST Number': c.gst_number || '', 'PAN Number': c.pan_number || '',
        'Plan': c.plan?.name || 'Free', 'Status': c.status,
        'Branches': c.branches_count ?? 0, 'Users': c.users_count ?? 0,
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
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Clients_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${allClients.length} clients exported`);
    } catch {
      toast.error('Export Failed', 'Could not export clients');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (client: Client) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: `Delete "${client.org_name}" and all its data?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, Delete',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;

    setDeleting(client.id);
    try {
      await api.delete(`/clients/${client.id}`);
      Swal.fire({ title: 'Deleted!', text: `"${client.org_name}" deleted successfully.`, icon: 'success', timer: 1500, showConfirmButton: false });
      fetchClients();
    } catch {
      Swal.fire({ title: 'Error!', text: 'Failed to delete client.', icon: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-text tracking-tight">Clients</h1>
            <p className="text-[12px] text-muted mt-0.5">Manage all registered organizations · {total} total</p>
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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name or ID..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-bg text-[12px] text-text outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted" />
          </div>
          <span className="text-[11px] text-muted ml-auto">{loading ? 'Loading...' : `${clients.length} of ${total} results`}</span>
        </div>

        {/* Data */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px]">
            <thead>
              <tr className="bg-sidebar">
                {['#', 'Organization', 'Unique ID', 'Contact', 'Type', 'Branches', 'Plan', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[9.5px] font-bold tracking-wider uppercase text-white/50 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={9} className="py-6"><ShimmerCards count={6} /></td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-muted text-[13px]">No clients found</td></tr>
              ) : clients.map((c, i) => (
                <tr key={c.id} className="hover:bg-primary/5 transition-colors">
                  <td className="px-4 py-3 text-[12px] text-muted font-medium">{(page - 1) * 15 + i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar initials={c.org_name.charAt(0) + (c.org_name.split(' ')[1]?.charAt(0) || '')} size="sm" />
                      <strong className="text-[13px] text-text leading-tight">{c.org_name}</strong>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10.5px] text-primary bg-primary/10 px-2 py-1 rounded-md">{c.unique_number}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[11.5px]">
                      <div className="text-text">{c.email}</div>
                      {c.phone && <div className="text-muted mt-0.5">{c.phone}</div>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="info">{c.org_type}</Badge></td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-7 bg-amber-500 text-white rounded-lg font-bold text-xs px-2">{c.branches_count ?? 0}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="primary">{c.plan?.name || 'Free'}</Badge>
                      {c.plan && c.plan.price > 0 && <span className="text-[10.5px] text-emerald-500 font-semibold">₹{c.plan.price.toLocaleString()}/yr</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {[
                        { icon: Eye, cls: 'hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300', title: 'View', onClick: () => onNavigate('client-view', { clientId: c.id }) },
                        { icon: Pencil, cls: 'hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300', title: 'Edit', onClick: () => onNavigate('client-form', { editId: c.id }) },
                        { icon: Trash2, cls: 'hover:bg-red-50 hover:text-red-600 hover:border-red-300', title: 'Delete', onClick: () => handleDelete(c) },
                        { icon: ShieldCheck, cls: 'hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300', title: 'Permissions', onClick: () => onNavigate('client-permissions', { clientId: c.id, clientName: c.org_name }) },
                        { icon: IndianRupee, cls: 'hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300', title: 'Payments', onClick: () => onNavigate('client-payments', { clientId: c.id, clientName: c.org_name }) },
                        { icon: GitBranch, cls: 'hover:bg-sky-50 hover:text-sky-600 hover:border-sky-300', title: 'Branches', onClick: () => onNavigate('client-branches', { clientId: c.id, clientName: c.org_name }) },
                        { icon: Settings, cls: 'hover:bg-purple-50 hover:text-purple-600 hover:border-purple-300', title: 'Settings', onClick: () => onNavigate('client-settings', { clientId: c.id, clientName: c.org_name }) },
                      ].map(({ icon: I, cls, title, onClick }, j) => (
                        <button key={j} title={title} onClick={onClick} disabled={deleting === c.id}
                          className={`w-7 h-7 rounded-lg border border-border bg-surface text-muted flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${cls} ${deleting === c.id ? 'opacity-40 pointer-events-none' : ''}`}>
                          {deleting === c.id && title === 'Delete' ? <Loader2 size={11} className="animate-spin" /> : <I size={12} />}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/50 flex justify-between items-center text-[11px] text-muted">
          <span>Showing {clients.length} of {total} entries</span>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={`w-7 h-7 rounded-lg text-[11px] font-semibold flex items-center justify-center border cursor-pointer transition-all ${n === page ? 'bg-primary text-white border-primary shadow-md shadow-primary/25' : 'border-border text-muted hover:text-primary hover:border-primary/40'}`}>{n}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
