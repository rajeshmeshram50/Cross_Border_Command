import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button } from 'reactstrap';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import AddVendorModal from './AddVendorModal';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import { ShimmerTable } from '../../components/ui/Shimmer';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Vendors — front-end only master list
 *
 * Mirrors the Clients master shell:
 *   • White surface card wrapping the page (no purple gradient hero)
 *   • Active / Inactive status filter pills
 *   • Velzon table chrome (table-card border rounded, table-light thead)
 *   • Add Vendor button → opens a 4-step wizard modal
 *
 * No API: vendors live in component state. When the backend ships, swap
 * SEED + the modal's submit handler for real fetch / POST calls.
 * ──────────────────────────────────────────────────────────────────────── */

export type Vendor = {
  id: number;
  code: string;
  companyName: string;
  legalName: string;
  type: string;
  state: string;
  city: string;
  contactName: string;
  designation: string;
  phone: string;
  email: string;
  status: 'Active' | 'Inactive';
  segment?: string;
  risk?: string;
  website?: string;
  address?: string;
  country?: string;
  pincode?: string;
};

/* Shape of an item in the paginated GET /api/vendors response. Only
 * the fields the list page actually renders are typed — anything else
 * the backend ships is ignored. */
type ApiVendor = {
  id: number;
  vendor_code: string | null;
  company_name: string;
  legal_name: string | null;
  status: string;
  primary_email: string | null;
  vendor_type?: { id: number; name: string | null } | null;
  segment?: { id: number; title: string | null } | null;
  risk_level?: { id: number; name: string | null } | null;
  primary_address?: {
    city: string | null;
    state_id: number | null;
    contact_name: string | null;
    email: string | null;
    contact_no: string | null;
  } | null;
};

const TYPE_COLORS: Record<string, string> = {
  Genuine:    '#16a34a',
  Verified:   '#2563eb',
  Pending:    '#f59e0b',
  Blacklisted:'#dc2626',
};

const AVATAR_COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'Active' | 'Inactive'>('Active');
  const [addOpen, setAddOpen] = useState(false);
  /* Edit vs Add — same modal, just seeded with an existing vendor id.
     Reset to null on close so the next "+ Add Vendor" click opens a
     blank form. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /* Two-stage delete — opens DeleteConfirmModal first, then hits the
     API on confirm. Matches the Clients / Products patterns. */
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Map a paginated API row to the local list-page shape. Anything the
     backend doesn't populate yet falls back to '—' so the table never
     renders raw `null` cells. */
  const apiToVendor = (row: ApiVendor): Vendor => ({
    id:          row.id,
    code:        row.vendor_code ?? `V-${row.id}`,
    companyName: row.company_name ?? 'Untitled Vendor',
    legalName:   row.legal_name ?? row.company_name ?? '—',
    type:        row.vendor_type?.name ?? 'Pending',
    state:       String(row.primary_address?.state_id ?? '—'),
    city:        row.primary_address?.city ?? '—',
    contactName: row.primary_address?.contact_name ?? '—',
    designation: '—',
    phone:       row.primary_address?.contact_no ?? '—',
    email:       row.primary_address?.email ?? row.primary_email ?? '—',
    status:      row.status === 'active' ? 'Active' : 'Inactive',
    segment:     row.segment?.title ?? undefined,
    risk:        row.risk_level?.name ?? undefined,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: ApiVendor[] }>('/vendors?per_page=200');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setVendors(rows.map(apiToVendor));
    } catch {
      toast.error('Load failed', 'Could not load vendors');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';

  // Outline icon-pill action button — matches the style used in Clients.tsx
  // so every list page in the shell shares the same affordance.
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

  const stats = useMemo(() => ({
    active:   vendors.filter(v => v.status === 'Active').length,
    inactive: vendors.filter(v => v.status === 'Inactive').length,
  }), [vendors]);

  const filtered = useMemo(() => {
    const lo = search.trim().toLowerCase();
    return vendors
      .filter(v => v.status === statusTab)
      .filter(v => !lo
        || v.code.toLowerCase().includes(lo)
        || v.companyName.toLowerCase().includes(lo)
        || v.contactName.toLowerCase().includes(lo)
        || v.email.toLowerCase().includes(lo)
        || v.phone.toLowerCase().includes(lo)
        || v.city.toLowerCase().includes(lo)
        || v.state.toLowerCase().includes(lo));
  }, [vendors, search, statusTab]);

  /* TanStack column definitions — mirrors the Clients master list so
     the two pages read with the same chrome (Sr No, avatar+name,
     type pill, contact / phone / email links, status pill, action
     buttons). Each column carries its own renderer; TableContainer
     handles paging + sorting. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: any[] = useMemo(() => [
    {
      header: 'Sr No',
      accessorKey: 'index',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
    },
    {
      header: 'Vendor Code',
      accessorKey: 'code',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => (
        <span className="badge bg-light text-primary border" style={{ fontFamily: 'monospace', padding: '5px 10px', fontSize: 12 }}>
          {info.row.original.code}
        </span>
      ),
    },
    {
      header: 'Company Name',
      accessorKey: 'companyName',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => {
        const v: Vendor = info.row.original;
        const initials = (v.companyName.split(/\s+/).slice(0, 2).map(s => s.charAt(0)).join('') || 'V').toUpperCase();
        const color = AVATAR_COLORS[info.row.index % AVATAR_COLORS.length];
        return (
          <div className="d-flex align-items-center gap-2" style={{ minWidth: 0, maxWidth: 260 }}>
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{
                width: 34, height: 34, fontSize: 12,
                background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                boxShadow: `0 2px 6px ${color}40`,
              }}
            >
              {initials}
            </div>
            <Tooltip label={v.companyName}>
              <div className="min-w-0">
                <div className="fw-semibold fs-13 text-truncate" style={{ maxWidth: 200 }}>{v.companyName}</div>
                <div className="text-muted text-truncate" style={{ fontSize: 11, maxWidth: 200 }}>{v.country || 'India'}</div>
              </div>
            </Tooltip>
          </div>
        );
      },
    },
    {
      header: 'Type',
      accessorKey: 'type',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => {
        const v: Vendor = info.row.original;
        const typeColor = TYPE_COLORS[v.type] || '#475569';
        return (
          <span
            className="badge rounded-pill fw-semibold px-3 py-2 fs-13"
            style={{ background: `${typeColor}15`, color: typeColor, border: `1px solid ${typeColor}40` }}
          >
            {v.type}
          </span>
        );
      },
    },
    {
      header: 'State',
      accessorKey: 'state',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => <span className="fs-13">{info.row.original.state}</span>,
    },
    {
      header: 'City',
      accessorKey: 'city',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => (
        <span className="d-inline-flex align-items-center gap-1 fs-13">
          <i className="ri-map-pin-line text-muted" />
          {info.row.original.city}
        </span>
      ),
    },
    {
      header: 'Contact',
      accessorKey: 'contactName',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => (
        <div className="min-w-0">
          <div className="fw-semibold fs-13">{info.row.original.contactName}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>{info.row.original.designation}</div>
        </div>
      ),
    },
    {
      header: 'Phone',
      accessorKey: 'phone',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => (
        <a href={`tel:${info.row.original.phone}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
          <i className="ri-phone-line text-muted fs-13" />
          <span className="fs-13 font-monospace">{info.row.original.phone}</span>
        </a>
      ),
    },
    {
      header: 'Email',
      accessorKey: 'email',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => (
        <a href={`mailto:${info.row.original.email}`} className="text-decoration-none d-inline-flex align-items-center gap-1" style={{ color: '#405189' }}>
          <i className="ri-mail-line text-muted fs-13" />
          <span className="fs-13">{info.row.original.email}</span>
        </a>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => {
        const isActive = info.row.original.status === 'Active';
        const color = isActive ? 'success' : 'danger';
        return (
          <span className={`badge rounded-pill bg-${color}-subtle text-${color} fw-semibold px-3 py-2 fs-13`}>
            {info.row.original.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: 'actions',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: (info: any) => {
        const v: Vendor = info.row.original;
        return (
          <div className="d-flex gap-1 justify-content-center">
            <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => toast.info('View', `Viewing ${v.companyName}`)} />
            <ActionBtn title="Edit"   icon="ri-pencil-line"     color="info"    onClick={() => { setEditingId(v.id); setAddOpen(true); }} />
            <ActionBtn
              title={v.status === 'Active' ? 'Deactivate' : 'Activate'}
              icon={v.status === 'Active' ? 'ri-pause-circle-line' : 'ri-play-circle-line'}
              color={v.status === 'Active' ? 'warning' : 'success'}
              onClick={() => toggleStatus(v)}
            />
            <ActionBtn title="Vault"  icon="ri-folder-3-line"   color="secondary" onClick={() => toast.info('Vault', 'Vendor vault coming soon')} />
            <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger"  disabled={deleting && deleteTarget?.id === v.id} onClick={() => removeVendor(v)} />
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleting, deleteTarget]);

  /* The wizard now persists each step to /api/vendors/* directly, so
     this handler only re-fetches and closes the modal. The payload is
     ignored — its fields are already in the database by the time
     onSubmit fires from the final Save Vendor click. */
  const handleSave = () => {
    setAddOpen(false);
    setEditingId(null);
    void refresh();
  };

  /* Delete is two-stage via the shared DeleteConfirmModal — the action
     button just stages the row; the modal's confirm handler hits the
     API and refreshes the list. */
  const removeVendor = (v: Vendor) => {
    setDeleteTarget(v);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/vendors/${deleteTarget.id}`);
      toast.success('Deleted', `${deleteTarget.companyName} removed`);
      setDeleteTarget(null);
      await refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not delete vendor';
      toast.error('Delete failed', msg);
    } finally {
      setDeleting(false);
    }
  };

  /* Status toggle stays local-only for now — there's no PATCH endpoint
     for vendor status. The Active/Inactive flag flips when Step 4 (map
     products) saves; flipping it outside the wizard would skip the
     creator-hierarchy mutate guard anyway. Tooltip + toast make the
     "coming soon" affordance obvious. */
  const toggleStatus = (v: Vendor) => {
    toast.info('Coming soon', `Toggle status for ${v.companyName} from the wizard`);
  };

  if (!allowed) {
    return (
      <Row>
        <Col xs={12}>
          <Card>
            <CardBody className="text-center py-5">
              <i className="ri-shield-keyhole-line text-danger" style={{ fontSize: 42 }} />
              <h5 className="mt-3 mb-1">Branch / Employee only</h5>
              <p className="text-muted mb-0">The Vendors module is available only to branch users and employees.</p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    );
  }

  return (
    <>
      <style>{`
        .vendors-surface { background: #fff; }
        [data-bs-theme="dark"] .vendors-surface { background: #1c2531; }

        /* Match the Clients master table — plain Velzon table-light thead
           with 13px cells. No coloured gradient on the header. The explicit
           background is here because some parent rules in this page neutralise
           Bootstrap's --bs-table-bg variable on the thead. */
        .vendors-surface .table thead th,
        .vendors-surface .table tbody td {
          font-size: 13px;
          vertical-align: middle;
        }
        .vendors-surface .table > thead.table-light > tr > th,
        .vendors-surface .table thead.table-light th {
          background-color: var(--vz-light, #eff2f7) !important;
          color: var(--vz-heading-color, #495057);
          font-weight: 600;
          letter-spacing: 0.01em;
          white-space: nowrap;
          border-bottom: 1px solid var(--vz-border-color, #e9ebec);
        }
        [data-bs-theme="dark"] .vendors-surface .table > thead.table-light > tr > th,
        [data-bs-theme="dark"] .vendors-surface .table thead.table-light th {
          background-color: rgba(255,255,255,0.04) !important;
          color: #ced4da;
        }

        /* Status tab pill strip — same look as the Products page */
        .v-status-tabs {
          display: inline-flex; gap: 4px; padding: 4px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
        }
        .v-status-tab {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 16px;
          background: transparent; border: none;
          border-radius: 9px;
          font-family: inherit; font-size: 12.5px; font-weight: 800;
          color: #6b7280; cursor: pointer;
          transition: background .15s, color .15s;
        }
        .v-status-tab:hover { background: #eef2ff; color: #405189; }
        .v-status-tab.on {
          background: linear-gradient(120deg, #405189 0%, #6691e7 100%);
          color: #fff;
          box-shadow: 0 4px 12px rgba(64,81,137,.35);
        }
        .v-status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .v-status-dot.is-active   { background: #22c55e; }
        .v-status-dot.is-inactive { background: #f59e0b; }
        .v-status-tab.on .v-status-dot { background: #fff; }
        .v-status-count {
          min-width: 22px; height: 20px; padding: 0 8px; border-radius: 99px;
          background: #e2e8f0; color: #475569;
          font-size: 10.5px; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .v-status-tab.on .v-status-count { background: rgba(255,255,255,.25); color: #fff; }
        [data-bs-theme="dark"] .v-status-tabs { background: #1c2531; border-color: rgba(255,255,255,0.1); }
        [data-bs-theme="dark"] .v-status-tab { color: #adb5bd; }
        [data-bs-theme="dark"] .v-status-tab:hover { background: rgba(64,81,137,.22); color: #ede9fe; }
        [data-bs-theme="dark"] .v-status-count { background: rgba(255,255,255,0.08); color: #ced4da; }

        /* Type chip — coloured by vendor classification */
        .v-type-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 10px; border-radius: 99px;
          font-size: 11px; font-weight: 700;
        }
        .v-type-chip .ri-checkbox-circle-fill { font-size: 13px; }

        /* Action button row in the last column */
        .v-actions { display: inline-flex; gap: 4px; }
        .v-actions .btn { padding: .25rem .5rem; line-height: 1; }
      `}</style>

      <Row>
        <Col xs={12}>
          <div
            className="vendors-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* Header row */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
                    boxShadow: '0 4px 10px rgba(64,81,137,.25)',
                  }}
                >
                  <i className="ri-store-2-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Vendors</h5>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Vendor directory — companies you buy product from, with compliance and contact details
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button
                  onClick={() => setAddOpen(true)}
                  className="btn-label waves-effect waves-light rounded-pill"
                  style={{
                    background: 'linear-gradient(120deg, #405189 0%, #6691e7 100%)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                  }}
                >
                  <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                  Add Vendor
                </Button>
              </div>
            </div>

            {/* Status pills + search row */}
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
              <div className="v-status-tabs">
                <button className={`v-status-tab ${statusTab === 'Active' ? 'on' : ''}`} onClick={() => setStatusTab('Active')}>
                  <span className="v-status-dot is-active" /> Active
                  <span className="v-status-count">{stats.active}</span>
                </button>
                <button className={`v-status-tab ${statusTab === 'Inactive' ? 'on' : ''}`} onClick={() => setStatusTab('Inactive')}>
                  <span className="v-status-dot is-inactive" /> Inactive
                  <span className="v-status-count">{stats.inactive}</span>
                </button>
              </div>
              <div className="search-box" style={{ maxWidth: 320, width: '100%' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search by code, name, contact, phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <i className="ri-search-line search-icon"></i>
              </div>
            </div>

            {/* Table — TanStack-based TableContainer with built-in
                 pagination, mirrors the Clients master list. The
                 shimmer placeholder renders while the initial /vendors
                 fetch is in flight. */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-0">
                {loading ? (
                  <ShimmerTable rows={6} cols={9} />
                ) : (
                  <>
                    <TableContainer
                      columns={columns}
                      data={filtered}
                      isGlobalFilter={false}
                      customPageSize={10}
                      tableClass="align-middle table-nowrap mb-0"
                      theadClass="table-light"
                      divClass="table-responsive table-card border rounded"
                      SearchPlaceholder="Search vendors..."
                    />
                    {filtered.length === 0 && (
                      <div className="text-center text-muted py-5">
                        <i className="ri-store-2-line d-block" style={{ fontSize: 36, color: '#cbd5e1' }} />
                        <div className="mt-2 fw-semibold">No vendors found</div>
                        <div style={{ fontSize: 12 }}>Try clearing the search, or click "Add Vendor" to create one.</div>
                      </div>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {addOpen && (
        <AddVendorModal
          vendorId={editingId}
          onClose={() => { setAddOpen(false); setEditingId(null); }}
          onSubmit={handleSave}
        />
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        itemName={deleteTarget?.companyName}
        title="Delete Vendor"
        subMessage="This vendor is soft-deleted and removed from the list. KYC documents and product mappings are kept and can be restored if the vendor is recovered."
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}
