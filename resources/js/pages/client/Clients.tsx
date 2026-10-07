import { useState, useEffect, useCallback } from 'react';
import { Col, Row, Spinner } from 'reactstrap';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import DataTable, { ActionCell } from '../../components/ui/DataTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';
import { Shimmer } from '../../components/ui/Shimmer';
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

  // Row actions use the shared <ActionCell> from DataTable, as every other list
  // does. This page had its own ActionBtn wrapper: it painted the right .dt-act
  // classes, so the squares looked close, but it diverged in three ways —
  //   · Edit drew `ri-pencil-line`, a bare pencil, where ActionIcon renders the
  //     product's edit glyph (`edit-svg`, a pencil on a page). That is the
  //     difference you can actually see in the row.
  //   · it did not stopPropagation, so an action also fired the row click.
  //   · it wrapped DISABLED buttons in a Tooltip, which never shows — a disabled
  //     button emits no pointer events.
  // Nothing page-specific was being added, so the wrapper is gone.

  // Columns for the shared DataTable. No "Sr No" column here — `serial` on the
  // table renders the product's numbered puck, the same one every other list has.
  const columns = [
    {
      header: 'Organization',
      accessorKey: 'org_name',
      cell: (info: any) => (
        // Name only. The avatar circle that used to sit in front of it was a
        // second identity marker in a row that already carries the Unique ID,
        // and it pushed the name off the column's left edge.
        // Capped at 240px and truncated; the full name lives in `title`.
        <div className="d-flex align-items-center" style={{ maxWidth: 240, minWidth: 0 }}>
          <Tooltip label={info.row.original.org_name}>
            <span className="fw-semibold fs-13 text-truncate" style={{ minWidth: 0 }}>
              {info.row.original.org_name}
            </span>
          </Tooltip>
        </div>
      ),
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
        // The cell clips at the column edge, so without this the full address
        // was simply unreachable — no tooltip and no title attribute either.
        // Organization already does this; Email had been missed.
        <Tooltip label={info.row.original.email}>
          <a
            href={`mailto:${info.row.original.email}`}
            className="text-body text-decoration-none d-inline-flex align-items-center gap-1"
            style={{ maxWidth: '100%', minWidth: 0 }}
          >
            <i className="ri-mail-line text-muted fs-13"></i>
            <span className="fs-13 text-truncate">{info.row.original.email}</span>
          </a>
        </Tooltip>
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
      header: 'Actions',
      id: 'actions',
      // 228px: seven 28px buttons and their 4px gaps need 220, and every column
      // here was an even 153 — so the row overflowed 46px on BOTH sides into a
      // cell that clips, eating the eye and the gear. Left-aligned so the group
      // sits against the status column instead of floating in the middle of a
      // wide cell.
      meta: { width: 238, align: 'left' },
      cell: (info: any) => (
        // No `gap-1`: DataTable.css already spaces these with
        // `.dt-act + .dt-act { margin-left: 4px }`, and carrying both put 4px
        // twice between every pair — 244px of buttons in what I had sized as a
        // 220px row, so the last one still fell off the edge.
        <div className="d-flex justify-content-start">
          <ActionCell title="View"        icon="ri-eye-line"          tone="accent"  onClick={() => onNavigate('client-view',        { clientId: info.row.original.id })} />
          {/* `edit-svg`, not ri-pencil-line — ActionIcon maps it to the product's
              edit glyph, the same one Biometric Devices and Document Templates
              show. A bare pencil reads as "draw", not "edit this record". */}
          <ActionCell title="Edit"        icon="edit-svg"             tone="info"    onClick={() => onNavigate('client-form',        { editId:   info.row.original.id })} />
          <ActionCell title="Delete"      icon="ri-delete-bin-line"   tone="danger"  disabled={deleting === info.row.original.id} onClick={() => handleDeleteClick(info.row.original)} />
          <ActionCell title="Branches"    icon="ri-git-branch-line"   tone="accent"  onClick={() => onNavigate('client-branches',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionCell title="Permissions" icon="ri-shield-check-line" tone="success" onClick={() => onNavigate('client-permissions', { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionCell title="Payments"    icon="ri-bank-card-line"    tone="warning" onClick={() => onNavigate('client-payments',    { clientId: info.row.original.id, clientName: info.row.original.org_name })} />
          <ActionCell title="Settings"    icon="ri-settings-3-line"   tone="accent"  onClick={() => toast.info('Coming Soon', 'Client settings will be available in a future update.')} />
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
          font-family: var(--font-sans);
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
          font-size: 11.5px; font-weight: 500;
          vertical-align: middle;
        }
        .clients-surface .table thead th {
          /* The Customers header strip's type, used on every module's
             header strip so the tables read as one product. */
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: .07em;
          text-transform: uppercase;
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
                          <h3 style={{ fontSize: 26, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
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
                      <h3 style={{ fontSize: 26, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                        {stats.plans_count.toLocaleString()}
                      </h3>
                      <small style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        {stats.plans_count === 1 ? 'plan in use' : 'plans in use'}
                      </small>
                    </div>

                    {/* Donut with custom controlled tooltip */}
                    {/* 44px, the size of the icon tile on the other three KPI cards. The
    donut was 76px — the cards all measure the same height, but an
    ornament nearly twice the size of its neighbours made this one
    read as the bigger card. Radii scale with it. */}
                    <div style={{ width: 44, height: 44, flexShrink: 0, position: 'relative' }}>
                      {stats.plan_breakdown.length === 0 ? (
                        <div style={{
                          width: 44, height: 44, borderRadius: '50%',
                          border: '4px solid var(--vz-secondary-bg)',
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
                              innerRadius={13}
                              outerRadius={21}
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

            {/* The shared list table (components/ui/DataTable), as Branches
                already uses on the page next door. Velzon's TableContainer sized
                itself to its rows, so with one client the table stopped a third
                of the way down and left the rest of the window blank; `fitToViewport`
                measures the gap to the footer and `autoFitRows` fills it with as
                many rows as fit. The toolbar also brings the product's search box,
                so the hand-rolled one above it is gone. */}
            <DataTable<any>
              data={clients}
              columns={columns}
              serial
              /* `hr-dt` is the table's second skin — the pale recessed header
                 and tab rail HRMS uses — rather than the default solid violet
                 band. The super-admin pages take it so the platform side reads
                 as one product with the modules, not as a louder cousin. */
              className="hr-dt"
              accent="violet"
              /* This list has no tabs, so without a title the toolbar's left
                 half was empty and the search sat alone on the right. The
                 subtitle counts the rows rather than repeating the strip's
                 "Manage client organizations…" line above it. */
              title="Client List"
              subtitle={
                loading
                  ? 'Loading…'
                  : `${clients.length} ${clients.length === 1 ? 'organization' : 'organizations'} on the platform`
              }
              minWidth={1400}
              fitToViewport
              autoFitRows
              loading={loading}
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              searchPlaceholder="Search by name or ID..."
              emptyMessage={
                <>
                  <i className="ri-building-2-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No clients found
                </>
              }
            />
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
