import { useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button } from 'reactstrap';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import AddVendorModal, { type VendorPayload } from './AddVendorModal';

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

const SEED: Vendor[] = [
  { id: 1, code: 'V-01', companyName: 'Om Powertech Exports Pvt. Ltd.', legalName: 'Om Powertech Exports Pvt. Ltd.', type: 'Genuine',     state: 'Maharashtra', city: 'Mumbai',     contactName: 'Daniel Robertson', designation: 'Sales Manager',    phone: '9821456789', email: 'd.robertson@ompowertech.com', status: 'Active',   country: 'India', pincode: '400001' },
  { id: 2, code: 'V-02', companyName: 'GreenHarvest Pvt Ltd',          legalName: 'GreenHarvest Pvt Ltd',           type: 'Genuine',     state: 'Gujarat',     city: 'Ahmedabad',  contactName: 'Anita Desai',      designation: 'Procurement Mgr',  phone: '9988877665', email: 'anita@greenharvest.co',       status: 'Active',   country: 'India', pincode: '380001' },
  { id: 3, code: 'V-003', companyName: 'Shree Exports',                  legalName: 'Shree Exports LLP',              type: 'Verified',    state: 'Delhi',       city: 'New Delhi',  contactName: 'Mohit Sharma',     designation: 'Director',         phone: '9554422119', email: 'mohit@shreeexports.in',       status: 'Active',   country: 'India', pincode: '110001' },
  { id: 4, code: 'V-004', companyName: 'Sun Agri Solutions',             legalName: 'Sun Agri Pvt Ltd',               type: 'Verified',    state: 'Karnataka',   city: 'Bengaluru',  contactName: 'Pooja Iyer',       designation: 'Account Mgr',      phone: '9123456789', email: 'pooja@sunagri.com',           status: 'Inactive', country: 'India', pincode: '560001' },
];

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

  const [vendors, setVendors] = useState<Vendor[]>(SEED);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'Active' | 'Inactive'>('Active');
  const [addOpen, setAddOpen] = useState(false);

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

  const nextCode = () => {
    let n = 0;
    vendors.forEach(v => {
      const m = v.code.match(/(\d+)$/);
      if (m) n = Math.max(n, parseInt(m[1], 10));
    });
    // 2-digit padding: V-01, V-02, …, V-99. Beyond 99 the code grows
    // naturally (V-100) — str_pad never truncates.
    return 'V-' + String(n + 1).padStart(2, '0');
  };

  const handleSave = (p: VendorPayload) => {
    const vendor: Vendor = {
      id: Date.now(),
      code: nextCode(),
      companyName: p.companyName || 'Untitled Vendor',
      legalName:   p.legalName   || p.companyName || 'Untitled Vendor',
      type:        p.vendorType  || 'Pending',
      state:       p.state       || '—',
      city:        p.city        || '—',
      contactName: p.contactName || '—',
      designation: p.designation || '—',
      phone:       p.contactNo   || '—',
      email:       p.email       || '—',
      status:      'Active',
      segment:     p.segment,
      risk:        p.riskLevel,
      website:     p.website,
      address:     p.registeredOffice,
      country:     p.country,
      pincode:     p.pincode,
    };
    setVendors(prev => [vendor, ...prev]);
    setAddOpen(false);
    toast.success('Vendor saved', `${vendor.companyName} added to the vendor master`);
  };

  const removeVendor = (v: Vendor) => {
    if (!confirm(`Delete ${v.companyName}?`)) return;
    setVendors(prev => prev.filter(x => x.id !== v.id));
    toast.info('Deleted', `${v.companyName} removed`);
  };

  const toggleStatus = (v: Vendor) => {
    setVendors(prev => prev.map(x => x.id === v.id ? { ...x, status: x.status === 'Active' ? 'Inactive' : 'Active' } : x));
    toast.success('Status changed', `${v.companyName} is now ${v.status === 'Active' ? 'Inactive' : 'Active'}`);
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

            {/* Table */}
            <div className="table-responsive table-card border rounded">
              <table className="table align-middle table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">SR</th>
                    <th scope="col">Vendor Code</th>
                    <th scope="col">Company Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">State</th>
                    <th scope="col">City</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Email</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center text-muted py-5">
                        <i className="ri-store-2-line d-block" style={{ fontSize: 36, color: '#cbd5e1' }} />
                        <div className="mt-2 fw-semibold">No vendors found</div>
                        <div style={{ fontSize: 12 }}>Try clearing the search, or click "Add Vendor" to create one.</div>
                      </td>
                    </tr>
                  ) : filtered.map((v, i) => {
                    const initials = (v.companyName.split(/\s+/).slice(0, 2).map(s => s.charAt(0)).join('') || 'V').toUpperCase();
                    const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
                    const typeColor = TYPE_COLORS[v.type] || '#475569';
                    return (
                      <tr key={v.id}>
                        <td><span className="text-muted fs-13">{i + 1}</span></td>
                        <td>
                          <span className="badge bg-light text-primary border" style={{ fontFamily: 'monospace', padding: '5px 10px', fontSize: 12 }}>
                            {v.code}
                          </span>
                        </td>
                        <td>
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
                        </td>
                        <td>
                          <span
                            className="badge rounded-pill fw-semibold px-3 py-2 fs-13"
                            style={{
                              background: `${typeColor}15`,
                              color: typeColor,
                              border: `1px solid ${typeColor}40`,
                            }}
                          >
                            {v.type}
                          </span>
                        </td>
                        <td><span className="fs-13">{v.state}</span></td>
                        <td>
                          <span className="d-inline-flex align-items-center gap-1 fs-13">
                            <i className="ri-map-pin-line text-muted" />
                            {v.city}
                          </span>
                        </td>
                        <td>
                          <div className="min-w-0">
                            <div className="fw-semibold fs-13">{v.contactName}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{v.designation}</div>
                          </div>
                        </td>
                        <td>
                          <a href={`tel:${v.phone}`} className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
                            <i className="ri-phone-line text-muted fs-13" />
                            <span className="fs-13 font-monospace">{v.phone}</span>
                          </a>
                        </td>
                        <td>
                          <a href={`mailto:${v.email}`} className="text-decoration-none d-inline-flex align-items-center gap-1" style={{ color: '#405189' }}>
                            <i className="ri-mail-line text-muted fs-13" />
                            <span className="fs-13">{v.email}</span>
                          </a>
                        </td>
                        <td>
                          {(() => {
                            const isActive = v.status === 'Active';
                            const color = isActive ? 'success' : 'danger';
                            return (
                              <span className={`badge rounded-pill bg-${color}-subtle text-${color} fw-semibold px-3 py-2 fs-13`}>
                                {v.status}
                              </span>
                            );
                          })()}
                        </td>
                        <td>
                          <div className="d-flex gap-1 justify-content-center">
                            <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => toast.info('View', `Viewing ${v.companyName}`)} />
                            <ActionBtn title="Edit"   icon="ri-pencil-line"     color="info"    onClick={() => toast.info('Edit', `Editing ${v.companyName}`)} />
                            <ActionBtn
                              title={v.status === 'Active' ? 'Deactivate' : 'Activate'}
                              icon={v.status === 'Active' ? 'ri-pause-circle-line' : 'ri-play-circle-line'}
                              color={v.status === 'Active' ? 'warning' : 'success'}
                              onClick={() => toggleStatus(v)}
                            />
                            <ActionBtn title="Vault"  icon="ri-folder-3-line"   color="secondary" onClick={() => toast.info('Vault', 'Vendor vault coming soon')} />
                            <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger"  onClick={() => removeVendor(v)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-muted mt-2" style={{ fontSize: 12 }}>
              {filtered.length} {filtered.length === 1 ? 'vendor' : 'vendors'} · {statusTab.toLowerCase()}
            </div>
          </div>
        </Col>
      </Row>

      {addOpen && (
        <AddVendorModal
          onClose={() => setAddOpen(false)}
          onSubmit={handleSave}
        />
      )}
    </>
  );
}
