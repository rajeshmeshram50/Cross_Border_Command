import { useState, useEffect, useCallback } from 'react';
import { Col, Row, Spinner, Input } from 'reactstrap';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';
import { Shimmer, ShimmerTable } from '../../components/ui/Shimmer';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Client, PaginatedResponse } from '../../types';
import { readClientFormBundle, writeClientFormBundle } from './clientFormBundleCache';

interface Props {
  onNavigate: (page: string, data?: any) => void;
}

interface ClientStats {
  total: number;
  active: number;
  inactive: number;
  plans_count: number;
  plan_breakdown: { plan_name: string; count: number }[];
}

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

export default function Clients({ onNavigate }: Props) {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [, setTotalPages] = useState(1);
  const [, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [exporting, setExporting] = useState(false);
  // Rows-per-page selector — dynamic pagination like the My Workplace list.
  // Drives TableContainer's customPageSize (it re-applies setPageSize when
  // this prop changes), so the page size updates live.
  const [rpp, setRpp] = useState(10);
  const [stats, setStats] = useState<ClientStats>({
    total: 0, active: 0, inactive: 0, plans_count: 0, plan_breakdown: [],
  });

  /* Merged list + stats fetch — /clients?include_stats=1 returns BOTH the
   * paginated list AND the KPI card stats in one response. Previously we
   * fired two separate calls (/clients and /clients/stats) sequentially,
   * doubling the round-trip cost. Now the list page paints in one trip. */
  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      // Pull all clients in one request and let TableContainer (react-table)
      // paginate on the client. Avoids the double-pagination conflict where
      // server pagination capped the dataset at 10 rows and react-table then
      // disabled its own next/prev because it only saw one page.
      const res = await api.get<PaginatedResponse<Client> & { stats?: ClientStats }>('/clients', {
        params: { search: search || undefined, per_page: 9999, include_stats: 1 },
      });
      setClients(res.data.data);
      setTotalPages(res.data.last_page);
      setTotal(res.data.total);
      if (res.data.stats) setStats(res.data.stats);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  /* Warm the ClientForm master bundle in the background.
   *
   * ClientForm.tsx needs /clients/form-bundle (organization-types + plans +
   * countries + states). By fetching it the moment the Clients list page
   * mounts, the data lands in sessionStorage by the time the user clicks
   * "Add Client" — the form hydrates synchronously and feels instant.
   *
   * Skips when a fresh cached copy is already present. Uses
   * requestIdleCallback (with a setTimeout fallback) so the warm-up never
   * competes with the visible list render. */
  useEffect(() => {
    if (readClientFormBundle()) return;
    const warm = () => {
      api.get('/clients/form-bundle')
        .then(res => writeClientFormBundle(res.data))
        .catch(() => { /* silent — form will retry on open */ });
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const handle = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 800);
    return () => {
      if (w.requestIdleCallback) w.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get<PaginatedResponse<Client>>('/clients', { params: { per_page: 9999 } });
      const allClients = res.data.data;
      const rows = allClients.map((c, i) => ({
        '#': i + 1, 'Organization Name': c.org_name, 'Unique ID': c.unique_number,
        'Email': c.email, 'Phone': c.phone || '', 'Type': c.org_type,
        'City': c.city || '', 'State': c.state || '',
        'Plan': c.plan?.name || 'Free', 'Status': c.status,
        'Branches': c.branches_count ?? 0, 'Users': c.users_count ?? 0,
        'Created At': new Date(c.created_at).toLocaleDateString('en-IN'),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clients');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `Clients_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${allClients.length} clients exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export clients');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteClick = (c: Client) => { setSelectedClient(c); setDeleteOpen(true); };

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

  // Reusable action button — outline icon pill with hover color.
  // Wrapped in <Tooltip> so the dark pill tooltip from the design
  // system shows on hover/focus instead of the native browser title.
  const ActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        className="btn p-0 d-inline-flex align-items-center justify-content-center"
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--vz-secondary-bg)',
          border: '1px solid var(--vz-border-color)',
          color: 'var(--vz-secondary-color)',
          transition: 'all .15s ease',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = `var(--vz-${color}-bg-subtle, ${color === 'primary' ? '#40518918' : color === 'danger' ? '#f0654818' : color === 'success' ? '#0ab39c18' : color === 'info' ? '#299cdb18' : color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)'})`;
          el.style.borderColor = `var(--vz-${color})`;
          el.style.color = `var(--vz-${color})`;
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = 'var(--vz-secondary-bg)';
          el.style.borderColor = 'var(--vz-border-color)';
          el.style.color = 'var(--vz-secondary-color)';
        }}
        onClick={onClick}
      >
        <i className={`${icon} fs-14`} />
      </button>
    </Tooltip>
  );

  // Table columns for TableContainer
  const columns = [
    {
      header: 'Sr No',
      accessorKey: 'index',
      cell: (info: any) => <span className="text-muted fs-13">{(page - 1) * 15 + info.row.index + 1}</span>,
    },
    {
      header: 'Organization',
      accessorKey: 'org_name',
      cell: (info: any) => {
        const photo = info.row.original.profile_photo_url || info.row.original.profile_photo;
        return (
          // Cap the cell at 240px and truncate long org names with ellipsis
          // — the full name lives in `title` so hovering shows it as a
          // native tooltip.
          <div className="d-flex align-items-center gap-2" style={{ maxWidth: 240, minWidth: 0 }}>
            {photo ? (
              <img
                src={photo}
                alt={info.row.original.org_name}
                className="rounded-circle flex-shrink-0"
                style={{ width: 34, height: 34, objectFit: 'cover', border: '1px solid rgba(128,128,128,0.2)' }}
              />
            ) : (
              <div
                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                style={{
                  width: 34, height: 34, fontSize: 12,
                  background: `linear-gradient(135deg, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}, ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}cc)`,
                  boxShadow: `0 2px 6px ${AVATAR_COLORS[info.row.index % AVATAR_COLORS.length]}40`,
                }}
              >
                {info.row.original.org_name.charAt(0)}{info.row.original.org_name.split(' ')[1]?.charAt(0) || ''}
              </div>
            )}
            <Tooltip label={info.row.original.org_name}>
              <span
                className="fw-semibold fs-13 text-truncate"
                style={{ minWidth: 0 }}
              >
                {info.row.original.org_name}
              </span>
            </Tooltip>
          </div>
        );
      },
    },
    {
      header: 'Unique ID',
      accessorKey: 'unique_number',
      cell: (info: any) => (
        <span className="fw-medium text-primary font-monospace fs-13">
          {info.row.original.unique_number}
        </span>
      ),
    },
    {
      header: 'Email',
      accessorKey: 'email',
      cell: (info: any) => (
        <a href={`mailto:${info.row.original.email}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
          <i className="ri-mail-line text-muted fs-13"></i>
          <span className="fs-13">{info.row.original.email}</span>
        </a>
      ),
    },
    {
      header: 'Phone',
      accessorKey: 'phone',
      cell: (info: any) => info.row.original.phone ? (
        <a href={`tel:${info.row.original.phone}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
          <i className="ri-phone-line text-muted fs-13"></i>
          <span className="fs-13 font-monospace">{info.row.original.phone}</span>
        </a>
      ) : <span className="text-muted fs-13">—</span>,
    },
    {
      header: 'Type',
      accessorKey: 'org_type',
      cell: (info: any) => {
        // First letter capital, rest lowercase — "BUSINESS" -> "Business",
        // "REACT" -> "React" etc. Handles multi-word types like "non-profit".
        const raw = String(info.row.original.org_type || '');
        const display = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return (
          <span className="fw-medium text-muted fs-13">
            {display}
          </span>
        );
      },
    },
    {
      header: 'Branches',
      accessorKey: 'branches_count',
      cell: (info: any) => (
        <span className="d-inline-flex align-items-center gap-1 fs-13">
          <i className="ri-git-branch-line text-muted"></i>
          <span className="fw-semibold">{info.row.original.branches_count ?? 0}</span>
        </span>
      ),
    },
    {
      header: 'Plan',
      accessorKey: 'plan_name',
      cell: (info: any) => (
        <span className="fw-semibold fs-13">{info.row.original.plan?.name || 'Free'}</span>
      ),
    },
    {
      header: 'Price',
      accessorKey: 'plan_price',
      cell: (info: any) => {
        const plan = info.row.original.plan;
        if (!plan || plan.price <= 0) return <span className="text-muted fs-13">—</span>;
        const suffix = plan.period === 'month' ? '/mo' : plan.period === 'quarter' ? '/qtr' : '/yr';
        return (
          <span className="text-success fw-semibold fs-13">
            ₹{plan.price.toLocaleString()}
            <small className="text-muted fw-normal fs-13 ms-1">{suffix}</small>
          </span>
        );
      },
    },
    {
      header: 'Org. Status',
      accessorKey: 'status',
      cell: (info: any) => {
        /* Status pill — three distinct states: Active (green),
         * Suspended (amber), Inactive (grey/red). Previously this
         * collapsed every non-active row into "Inactive", so a
         * suspended client showed up as "Inactive" on the list view
         * even though the row's status column actually held
         * "suspended" — the bug the user flagged. */
        const raw = String(info.row.original.status ?? '').toLowerCase();
        const cfg = raw === 'active'
          ? { color: 'success', label: 'Active' }
          : raw === 'suspended'
            ? { color: 'warning', label: 'Suspended' }
            : { color: 'danger', label: 'Inactive' };
        return (
          <span className={`badge rounded-pill bg-${cfg.color}-subtle text-${cfg.color} fw-semibold px-3 py-2 fs-13`}>
            {cfg.label}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: 'actions',
      cell: (info: any) => (
        <div className="d-flex gap-1 justify-content-center">
          <ActionBtn title="View"        icon="ri-eye-line"         color="primary" onClick={() => onNavigate('client-view',        { clientId: info.row.original.id })} />
          <ActionBtn title="Edit"        icon="ri-pencil-line"      color="info"    onClick={() => onNavigate('client-form',        { editId:   info.row.original.id })} />
          <ActionBtn title="Delete"      icon="ri-delete-bin-line"  color="danger"  disabled={deleting === info.row.original.id} onClick={() => handleDeleteClick(info.row.original)} />
          <ActionBtn title="Branches"    icon="ri-git-branch-line"  color="primary" onClick={() => onNavigate('client-branches',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Permissions" icon="ri-shield-check-line" color="success" onClick={() => onNavigate('client-permissions', { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Payments"    icon="ri-bank-card-line"   color="warning" onClick={() => onNavigate('client-payments',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionBtn title="Settings"    icon="ri-settings-3-line"  color="secondary" onClick={() => toast.info('Coming Soon', 'Client settings will be available in a future update.')} />
        </div>
      ),
    },
  ];

  const KPI_CARDS = [
    { label: 'Total Clients',    value: stats.total,        icon: 'ri-building-fill',         gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active Clients',   value: stats.active,       icon: 'ri-checkbox-circle-fill',  gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Inactive Clients', value: stats.inactive,     icon: 'ri-close-circle-fill',     gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  ];

  const PLAN_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#7c5cfc', '#299cdb', '#f06548', '#9b72cf'];
  const [hoveredPlan, setHoveredPlan] = useState<{ name: string; count: number; color: string } | null>(null);

  return (
    <>
      <style>{`
        .clients-surface { background: #ffffff; }
        [data-bs-theme="dark"] .clients-surface { background: #1c2531; }

        /* Header strip — same shape/parts as the Customers (.smc-cstrip)
           header (rounded container, left accent strip, violet icon, gradient
           Add button) but on a plain white surface (no violet wash). */
        .cl-cstrip {
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
          min-height: 70px; padding: 12px 18px;
          /* Light violet wash — the left-strip violet (#7c3aed) at 8% opacity. */
          background: #ffffff;
          /* 1px violet border on all sides (the left accent strip stays). */
          border: 1px solid #c4b5fd;
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.05);
          font-family: 'DM Sans', system-ui, sans-serif;
        }
        .cl-cstrip-accent {
          position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
          background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
          border-radius: 16px 0 0 16px;
        }
        .cl-cstrip-left { display: flex; align-items: center; gap: 16px; position: relative; z-index: 1; min-width: 0; flex: 1; }
        .cl-cstrip-icon {
          position: relative; width: 46px; height: 46px; border-radius: 12px;
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-size: 22px; flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(91,33,182,0.40), 0 0 0 3px rgba(124,58,237,0.10);
        }
        .cl-cstrip-icon::after {
          content: ''; position: absolute; bottom: -2px; right: -2px;
          width: 11px; height: 11px; border-radius: 50%;
          background: #22c55e; border: 2px solid #ffffff;
          box-shadow: 0 0 0 1px rgba(34,197,94,0.25), 0 2px 5px rgba(34,197,94,0.45);
        }
        .cl-cstrip-title { font-size: 18px; font-weight: 800; color: var(--vz-heading-color, #2e1065); letter-spacing: -.3px; line-height: 1.2; }
        .cl-cstrip-sub { font-size: 12px; color: var(--vz-secondary-color, #6b7280); font-weight: 400; margin-top: 4px; line-height: 1.5; max-width: 760px; }
        /* Primary "Add" button — same gradient pill as .smc-cstrip-add. */
        .cl-cstrip-add {
          position: relative; z-index: 1; overflow: hidden;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 0 22px; height: 44px; border: none; border-radius: 14px;
          font-family: inherit; font-size: 13px; font-weight: 700; color: #fff;
          white-space: nowrap; cursor: pointer; flex-shrink: 0;
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 45%, #6d28d9 100%);
          box-shadow: 0 5px 16px rgba(124,58,237,.40), 0 2px 5px rgba(91,33,182,.25), 0 1px 0 rgba(255,255,255,.22) inset;
          transition: background .18s, transform .18s, box-shadow .18s, filter .18s;
        }
        .cl-cstrip-add:hover { transform: translateY(-2px); filter: brightness(1.05); background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 45%, #5b21b6 100%); }
        .cl-cstrip-add:active { transform: translateY(0); }
        .cl-cstrip-add i { font-size: 16px; }
        /* Secondary "Export" button — outlined to pair with the gradient Add. */
        .cl-cstrip-export {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 0 18px; height: 44px; border-radius: 14px;
          border: 1px solid color-mix(in srgb, #7c3aed 30%, var(--vz-border-color));
          background: #fff; color: #6d28d9;
          font-family: inherit; font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer; flex-shrink: 0;
          transition: background .15s, border-color .15s, transform .15s;
        }
        .cl-cstrip-export:hover:not(:disabled) { background: #f5f3ff; border-color: #c4b5fd; transform: translateY(-1px); }
        .cl-cstrip-export:disabled { opacity: 0.6; cursor: default; }
        .cl-cstrip-export i { font-size: 15px; }
        [data-bs-theme="dark"] .cl-cstrip { background: var(--vz-card-bg); border-color: rgba(167,139,250,0.40); box-shadow: 0 6px 18px rgba(0,0,0,0.30); }
        [data-bs-theme="dark"] .cl-cstrip-icon::after { border-color: var(--vz-card-bg); }
        [data-bs-theme="dark"] .cl-cstrip-export { background: transparent; color: #c4b5fd; }
        [data-bs-theme="dark"] .cl-cstrip-export:hover:not(:disabled) { background: rgba(124,58,237,.14); }

        /* Unified list frame (search + table) — mirrors the Recruitment
           page's .rec-list-frame so search + table read as one clean
           bordered panel. */
        .clients-list-frame {
          background: #ffffff;
          border: 1px solid #ececf2;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 0 rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.05);
        }
        .clients-list-frame .clients-frame-filter {
          border-bottom: 1px solid var(--vz-border-color);
        }
        [data-bs-theme="dark"] .clients-list-frame {
          background: var(--vz-card-bg);
          border-color: var(--vz-border-color);
          box-shadow: 0 6px 18px rgba(0,0,0,0.30);
        }

        /* Add Client — call-to-action button. Previously the only
         * feedback was Reactstrap's default focus ring; users wanted
         * a clearer hover affordance. Lift + glow + colour-shift on
         * hover, with a press-down on active so the button feels
         * tactile. */
        .cl-add-client-btn {
          transition:
            transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 180ms ease,
            background-color 180ms ease,
            filter 180ms ease;
        }
        .cl-add-client-btn:hover {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.08);
          box-shadow: 0 8px 22px rgba(64, 81, 137, 0.32);
        }
        .cl-add-client-btn:active {
          transform: translateY(0) scale(0.99);
          box-shadow: 0 4px 12px rgba(64, 81, 137, 0.22);
        }

        /* Unify table typography — every cell + header reads at the same
           13px size so the table looks like a single grid, not a patchwork
           of differently-sized labels. */
        .clients-surface .table thead th,
        .clients-surface .table tbody td {
          font-size: 13px;
          vertical-align: middle;
        }
        .clients-surface .table thead th {
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        /* KPI cards — clear lift on hover with a layered shadow so the
           card visibly pops above the surface instead of sitting flat. */
        .clients-kpi {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease,
            border-color 220ms ease;
          will-change: transform;
          cursor: default;
        }
        .clients-kpi:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 36px -8px rgba(64, 81, 137, 0.28),
            0 8px 16px -4px rgba(64, 81, 137, 0.18),
            0 2px 4px rgba(0, 0, 0, 0.06);
          border-color: rgba(64, 81, 137, 0.35);
        }
        .clients-kpi:hover .clients-kpi-icon {
          transform: scale(1.08) rotate(-3deg);
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
        }
        .clients-kpi-icon {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease;
        }
        [data-bs-theme="dark"] .clients-kpi:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 8px 16px -4px rgba(0, 0, 0, 0.45),
            0 2px 4px rgba(0, 0, 0, 0.30);
          border-color: rgba(124, 92, 252, 0.50);
        }

        /* Export button — outlined emerald style. Distinct from the
           solid-purple Add button so the two never read as duplicates.
           Uses transparent + theme-aware tints so dark mode doesn't
           glow bright like a hard-coded #fff would. */
        .export-btn,
        .export-btn:focus,
        .export-btn:active {
          background: transparent !important;
          color: #0ab39c !important;
          border: 1px solid #0ab39c !important;
          box-shadow: none !important;
          transition:
            background 200ms ease,
            color 200ms ease,
            border-color 200ms ease,
            transform 200ms ease;
        }
        .export-btn:hover:not(:disabled) {
          background: rgba(10, 179, 156, 0.10) !important;
          color: #099481 !important;
          border-color: #099481 !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(10, 179, 156, 0.18) !important;
        }
        .export-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        [data-bs-theme="dark"] .export-btn,
        [data-bs-theme="dark"] .export-btn:focus,
        [data-bs-theme="dark"] .export-btn:active {
          color: #2ec7b0 !important;
          border-color: #2ec7b0 !important;
        }
        [data-bs-theme="dark"] .export-btn:hover:not(:disabled) {
          background: rgba(46, 199, 176, 0.14) !important;
          color: #5be0cb !important;
          border-color: #5be0cb !important;
          box-shadow: 0 4px 14px rgba(46, 199, 176, 0.28) !important;
        }
      `}</style>

      <Row>
        <Col xs={12}>
          {/* Header strip — same shape as the Customers (smc-cstrip) header:
              rounded container + left accent strip + violet icon + gradient
              "Add" button — but on a plain white surface (no violet wash). */}
          <div className="cl-cstrip mb-3">
            <span className="cl-cstrip-accent" />
            <div className="cl-cstrip-left">
              <div className="cl-cstrip-icon"><i className="ri-building-2-line" /></div>
              <div className="min-w-0">
                <div className="cl-cstrip-title">Clients</div>
                <div className="cl-cstrip-sub">
                  Manage client organizations, plans, branches and billing.
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-shrink-0">
              <button
                type="button"
                className="cl-cstrip-export"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? <Spinner size="sm" /> : <i className="ri-download-2-line" />}
                {exporting ? 'Exporting...' : 'Export'}
              </button>
              <button
                type="button"
                className="cl-cstrip-add"
                onClick={() => onNavigate('client-form')}
              >
                <i className="ri-add-line" />
                Add Client
              </button>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          {/* Whole-page card container removed — content sits flush on the
              page background. The `clients-surface` class is kept (table /
              KPI / dark-mode styles are scoped to it) but its card chrome
              (border / shadow / padding / white fill) is stripped. */}
          <div className="clients-surface" style={{ background: 'transparent' }}>
            {/* ── KPI cards (single row, equal height) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={3} sm={6} xs={12}>
                  <div
                    className="clients-surface clients-kpi"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        {loading ? (
                          <Shimmer width={72} height={26} radius={6} style={{ marginTop: 2 }} />
                        ) : (
                          <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                            {k.value.toLocaleString()}
                          </h3>
                        )}
                      </div>
                      <div className="clients-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}

              {/* Plan Distribution — donut + total count, same height as other KPIs */}
              <Col md={3} sm={6} xs={12}>
                <div
                  className="clients-surface clients-kpi"
                  style={{
                    borderRadius: 14,
                    border: '1px solid var(--vz-border-color)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                    padding: '16px 18px',
                    position: 'relative',
                    height: '100%',
                  }}
                >
                  {/* Inner clip wrapper — holds the strip + decorative wave so they
                      respect borderRadius without clipping the donut tooltip. */}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden', pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(135deg,#7c5cfc,#a993fd)' }} />
                    <svg
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.4 }}
                      viewBox="0 0 400 180" preserveAspectRatio="none"
                    >
                      <path d="M0,130 C80,90 180,170 280,110 C340,75 380,120 400,100 L400,180 L0,180 Z" fill="var(--vz-secondary-bg)" />
                    </svg>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                        Plan Distribution
                      </p>
                      <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                        {stats.plans_count.toLocaleString()}
                      </h3>
                      <small style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        {stats.plans_count === 1 ? 'plan in use' : 'plans in use'}
                      </small>
                    </div>

                    {/* Donut with custom controlled tooltip */}
                    <div style={{ width: 76, height: 76, flexShrink: 0, position: 'relative' }}>
                      {stats.plan_breakdown.length === 0 ? (
                        <div style={{
                          width: 76, height: 76, borderRadius: '50%',
                          border: '7px solid var(--vz-secondary-bg)',
                        }} />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={stats.plan_breakdown}
                              dataKey="count"
                              nameKey="plan_name"
                              cx="50%"
                              cy="50%"
                              innerRadius={22}
                              outerRadius={36}
                              paddingAngle={2}
                              stroke="none"
                              isAnimationActive
                              onMouseLeave={() => setHoveredPlan(null)}
                            >
                              {stats.plan_breakdown.map((p, i) => (
                                <Cell
                                  key={i}
                                  fill={PLAN_COLORS[i % PLAN_COLORS.length]}
                                  onMouseEnter={() => setHoveredPlan({
                                    name: p.plan_name,
                                    count: p.count,
                                    color: PLAN_COLORS[i % PLAN_COLORS.length],
                                  })}
                                  style={{ cursor: 'pointer', outline: 'none' }}
                                />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      )}

                      {/* Custom tooltip — anchored above the donut, never clipped */}
                      {hoveredPlan && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 'calc(100% + 6px)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#1e2a3a',
                            color: '#fff',
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '5px 10px',
                            borderRadius: 8,
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                            pointerEvents: 'none',
                            zIndex: 1050,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: hoveredPlan.color }} />
                          {hoveredPlan.name}
                          <strong style={{ fontWeight: 800 }}>{hoveredPlan.count}</strong>
                          {/* Pointer arrow */}
                          <span style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 0, height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderTop: '5px solid #1e2a3a',
                          }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Col>
            </Row>

            {/* ── Search + Table — one bordered frame (matches the
                Recruitment list frame: search row on top, table below) ── */}
            <div className="clients-list-frame">
              <div className="clients-frame-filter p-3 d-flex align-items-center gap-3 flex-wrap">
                <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search by name or ID..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
                {/* Rows-per-page selector — dynamic pagination (My Workplace style) */}
                <div className="cl-rows-sel d-flex align-items-center gap-2 flex-shrink-0">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Rows per page</span>
                  <select
                    value={rpp}
                    onChange={e => setRpp(parseInt(e.target.value, 10))}
                    className="form-select form-select-sm"
                    style={{ width: 'auto', minWidth: 72 }}
                  >
                    {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              {/* ── Table ── */}
              <div className="p-3 pt-2">
                {loading ? (
                  <ShimmerTable rows={6} cols={9} />
                ) : (
                  <>
                    <TableContainer
                      columns={columns}
                      data={clients}
                      isGlobalFilter={false}
                      customPageSize={rpp}
                      tableClass="align-middle table-nowrap mb-0"
                      theadClass="table-light"
                      divClass="table-responsive"
                      SearchPlaceholder="Search by name or ID..."
                    />
                    {clients.length === 0 && <div className="text-center text-muted py-5">No clients found</div>}
                  </>
                )}
              </div>
            </div>
          </div>
        </Col>
      </Row>

      <DeleteConfirmModal
        open={deleteOpen}
        clientName={selectedClient?.org_name}
        onClose={() => { setDeleteOpen(false); setSelectedClient(null); }}
        onConfirm={confirmDelete}
        loading={deleting !== null}
      />
    </>
  );
}
