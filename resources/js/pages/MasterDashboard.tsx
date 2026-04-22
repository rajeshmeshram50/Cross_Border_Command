import { useState, useMemo } from 'react';
import { Row, Col } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MASTER_GROUPS } from '../constants';
import type { MenuChild, MenuGroup } from '../types';

// Master slugs that only super admin is allowed to see/manage.
// These feed super-admin-only workflows (e.g. client registration).
const SUPER_ADMIN_ONLY_MASTERS = new Set<string>(['master.organization_types']);

interface CategoryStyle {
  color: string;
  softBg: string;
  border: string;
  icon: string;
  gradient: string;
}

// Shared base (color, softBg, border) — the navy accent stays unified across
// headers, pills, badges, buttons. Only the `gradient` is varied per category.
const BASE = {
  color:   'rgb(64, 81, 137)',
  softBg:  '#e8f5fd',
  border:  'rgb(102, 145, 231)',
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'master.identity':   { ...BASE, icon: 'ri-profile-line',    gradient: 'linear-gradient(135deg,#405189,#6691e7)' }, // navy
  'master.geography':  { ...BASE, icon: 'ri-global-line',     gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' }, // teal
  'master.trade':      { ...BASE, icon: 'ri-line-chart-line', gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' }, // amber
  'master.party':      { ...BASE, icon: 'ri-team-line',       gradient: 'linear-gradient(135deg,#f06548,#f4907b)' }, // coral
  'master.legal':      { ...BASE, icon: 'ri-scales-3-line',   gradient: 'linear-gradient(135deg,#e83e8c,#ef79b0)' }, // pink
  'master.operations': { ...BASE, icon: 'ri-tools-line',      gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' }, // sky blue
  'master.p2p':        { ...BASE, icon: 'ri-handshake-line',  gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)' }, // violet
  'master.warehouse':  { ...BASE, icon: 'ri-building-2-line', gradient: 'linear-gradient(135deg,#10b981,#34d399)' }, // emerald
};

const LEAF_ICONS: Record<string, string> = {
  Building: 'ri-building-4-line', Landmark: 'ri-bank-line', Building2: 'ri-building-line',
  UserCog: 'ri-user-settings-line', BadgeCheck: 'ri-verified-badge-line',
  Globe2: 'ri-earth-line', Map: 'ri-map-2-line', Hash: 'ri-hashtag',
  Home: 'ri-home-line', Anchor: 'ri-anchor-line', Ship: 'ri-ship-line',
  Target: 'ri-focus-3-line', Binary: 'ri-file-code-line', Percent: 'ri-percent-line',
  DollarSign: 'ri-money-dollar-circle-line', Ruler: 'ri-ruler-line', Package: 'ri-box-3-line',
  Leaf: 'ri-leaf-line', Handshake: 'ri-handshake-line',
  UserSquare: 'ri-user-3-line', Award: 'ri-award-line', Store: 'ri-store-2-line',
  Activity: 'ri-pulse-line', Users2: 'ri-team-fill',
  FileBadge: 'ri-file-shield-2-line', Zap: 'ri-flashlight-line',
  FileText: 'ri-file-text-line', AlertTriangle: 'ri-alert-line', Scale: 'ri-scales-3-line',
  Briefcase: 'ri-briefcase-4-line', Tags: 'ri-price-tag-3-line',
  CalendarDays: 'ri-calendar-line', ShieldCheck: 'ri-shield-check-line', Boxes: 'ri-stack-line',
  Tag: 'ri-price-tag-line', AlertOctagon: 'ri-error-warning-line',
  GitCompare: 'ri-git-commit-line', CreditCard: 'ri-bank-card-line',
  Repeat: 'ri-refresh-line', ToggleRight: 'ri-toggle-line', BookUser: 'ri-contacts-book-line',
  Warehouse: 'ri-building-2-line', Grid3x3: 'ri-grid-line', Layers: 'ri-stack-line',
  Thermometer: 'ri-temp-cold-line', Rows3: 'ri-layout-row-line', Rows4: 'ri-layout-grid-line',
  Monitor: 'ri-computer-line', Snowflake: 'ri-snowy-line',
};

const leafIcon = (name?: string) => (name && LEAF_ICONS[name]) || 'ri-file-list-3-line';

const LEAF_DESCRIPTIONS: Record<string, string> = {
  'master.company':                 'Legal identity, GSTIN, PAN, IEC — used on every export document',
  'master.bank_accounts':           'Bank registry — Swift Code + AD Code mandatory for export',
  'master.departments':             'Organizational units — assign staff & route approvals',
  'master.roles':                   'User roles controlling module access permissions',
  'master.designations':            'Job titles shown on letters, profiles & HR records',
  'master.countries':               'Country master — referenced on all trade documents',
  'master.states':                  'State list for addresses & GST place-of-supply',
  'master.state_codes':             '2-digit GST state codes for tax filings',
  'master.address_types':           'Tag addresses: Billing, Shipping, Registered, etc.',
  'master.port_of_loading':         'Origin ports on shipping bills & export invoices',
  'master.port_of_discharge':       'Destination ports on packing lists & shipping docs',
  'master.segments':                'Business lines classifying orders & products',
  'master.hsn_codes':               '8-digit commodity codes for GST & customs filings',
  'master.gst_percentage':          'GST tax slabs applied on product invoices',
  'master.currencies':              'Active currencies with exchange rates for export invoicing',
  'master.uom':                     'Units (Kg, Box, Pcs) on product & shipment records',
  'master.packaging_material':      'Box, carton & wrapping types linked to packaging module',
  'master.conditions':              'Storage & handling states (Organic, Fresh, Frozen)',
  'master.incoterms':               'Trade terms (FOB, CIF) defining delivery & risk',
  'master.customer_types':          'Classify buyers as Domestic / Export for pricing rules',
  'master.customer_classifications':'Tier labels (A/B/C, Key Account) for credit & discount',
  'master.vendor_types':            'Supplier categories for procurement rules',
  'master.vendor_behaviour':        'Performance tags used in purchase order workflows',
  'master.applicable_types':        'Who appears on documents — Buyer, Consignee, Notify Party',
  'master.license_name':            'Import/export license categories per product or market',
  'master.risk_levels':             'Risk severity tags for vendor & shipment screening',
  'master.document_type':           'Document categories for upload & linking (Invoice, COA, SDS)',
  'master.haz_class':               'GHS/UN hazard classes for products requiring special handling',
  'master.compliance_behaviours':   'Rules for regulated, cold-chain & controlled substance handling',
  'master.assets':                  'Company equipment & assets for ops & depreciation tracking',
  'master.asset_categories':        'Group assets by type (Machinery, IT, Furniture)',
  'master.numbering_series':        'System auto-numbering — locks after first transaction',
  'master.payment_terms':           'Credit days, advance % & milestone structure for PO terms',
  'master.approval_authority':      'Value threshold + role matrix for PO, VPI & Payment approvals',
  'master.procurement_category':    'Goods / Services / AMC / Job Work — drives 3-way vs 2-way match',
  'master.sourcing_type':           'Direct / Open Market / Spot / Rate Contract classifications',
  'master.deviation_reason':        'Locked picklist for all manual override actions',
  'master.match_exception':         'Exception types + resolver role for 3-way match engine',
  'master.advance_payment_rules':   'Max advance % per vendor type / category + approval matrix',
  'master.exchange_rate_log':       'Date-wise exchange rate history vs INR for multi-currency',
  'master.goods_service_flag':      'Switches GRN logic between physical receipt and service proof',
  'master.vendor_directory':        'Vendor information, addresses & document verification',
  'master.warehouse_master':        'Define all warehouse locations — Own & Third Party',
  'master.zone_master':             'Storage zones inside warehouses — Storage, Cold Chain, Hazmat',
  'master.rack_type_master':        'Rack types used across warehouses — Pallet, Cold, Hazardous',
  'master.temp_class_master':       'Temperature classifications for controlled storage',
  'master.racks':                   'Warehouse structure — Warehouse → Zone → Rack → Shelf',
  'master.shelf_master':            'Add and manage shelves (levels) inside each rack',
  'master.digital_twin':            'Visual warehouse location view — Warehouse → Zone → Rack',
  'master.freezers':                'Cold storage units — direct placement, no bins required',
};

const leafDescription = (leaf: MenuChild) =>
  LEAF_DESCRIPTIONS[leaf.id] || `Manage ${leaf.label.toLowerCase()} records`;

const STAT_CARDS = [
  { label: 'Total Masters',  icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { label: 'Active',         icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { label: 'Inactive',       icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { label: 'Total Records',  icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg,#f7b84b,#f1963b)' },
];

export default function MasterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};

  // Accordion state — only one category is open at a time.
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Global master search.
  const [search, setSearch] = useState('');

  // Filter groups/children by permission, and hide super-admin-only masters from everyone else.
  const groups = useMemo<MenuGroup[]>(() => {
    if (isSuperAdmin) return MASTER_GROUPS;
    return MASTER_GROUPS
      .map(g => ({
        ...g,
        children: g.children.filter(
          c => !SUPER_ADMIN_ONLY_MASTERS.has(c.id) && !!perms[c.id]?.can_view
        ),
      }))
      .filter(g => g.children.length > 0);
  }, [isSuperAdmin, perms]);

  // Initialize: first group open by default.
  if (!initialized && groups.length > 0) {
    setOpenGroupId(groups[0].id);
    setInitialized(true);
  }

  const q = search.trim().toLowerCase();
  const hasSearch = q.length > 0;

  // Apply search filter — when active, show only matching leaves per group.
  const filteredGroups = useMemo<MenuGroup[]>(() => {
    if (!hasSearch) return groups;
    return groups
      .map(g => ({
        ...g,
        children: g.children.filter(c => c.label.toLowerCase().includes(q)),
      }))
      .filter(g => g.children.length > 0);
  }, [groups, q, hasSearch]);

  const totals = useMemo(() => {
    const total = groups.reduce((s, g) => s + g.children.length, 0);
    return { total, active: total, inactive: 0, records: 0 };
  }, [groups]);

  const statValues = [totals.total, totals.active, totals.inactive, totals.records];

  // Accordion toggle — click an open group closes it, click a closed one opens it
  // (and the previously open one closes automatically because only one id is tracked).
  const toggle = (id: string) => setOpenGroupId(prev => (prev === id ? null : id));
  const goTo   = (leaf: MenuChild) => navigate(`/master/${leaf.id.replace('master.', '')}`);

  if (groups.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340 }}>
        <div style={{
          background: '#fff', border: '1px solid #e9ebec', borderRadius: 8,
          padding: '48px 40px', textAlign: 'center', maxWidth: 460,
          boxShadow: '0 1px 2px rgba(56,65,74,.12)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: '#fef8ec',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <i className="ri-lock-2-line" style={{ fontSize: 30, color: '#f7b84b' }} />
          </div>
          <h5 style={{ fontWeight: 600, color: '#212529', marginBottom: 8 }}>No Master Access</h5>
          <p style={{ color: '#878a99', fontSize: 13, margin: 0 }}>
            Your account does not have permission for any master. Ask your administrator to grant access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h4 style={{ fontWeight: 600, color: '#212529', marginBottom: 4, letterSpacing: '-0.2px' }}>
            Master Control Center
          </h4>
          <p style={{ color: '#878a99', fontSize: 13, margin: 0 }}>
            {totals.total} masters across {groups.length} categories
          </p>
        </div>
        <nav>
          <ol style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
            <li><span style={{ color: '#878a99' }}>Master Data</span></li>
            <li style={{ color: '#adb5bd' }}>/</li>
            <li><span style={{ color: '#495057', fontWeight: 500 }}>Overview</span></li>
          </ol>
        </nav>
      </div>

      {/* ── KPI Stat Cards Row (AdminDashboard KpiCard style) ── */}
      <Row className="g-3 mb-4">
        {STAT_CARDS.map((sc, i) => (
          <Col key={sc.label} xl={3} md={6} xs={12}>
            <div style={{
              background: '#fff',
              borderRadius: 16,
              padding: '20px 20px 16px',
              boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
              border: '1px solid #f0f3f8',
              position: 'relative',
              overflow: 'hidden',
              height: '100%',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                background: sc.gradient,
              }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: 11, fontWeight: 700, color: '#878a99',
                    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
                  }}>
                    {sc.label}
                  </p>
                  <h3 style={{ fontSize: 28, fontWeight: 800, color: '#1e2a3a', margin: 0, lineHeight: 1 }}>
                    {statValues[i].toLocaleString()}
                  </h3>
                </div>
                <div style={{
                  width: 46, height: 46, borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: sc.gradient, flexShrink: 0,
                }}>
                  <i className={sc.icon} style={{ fontSize: 20, color: '#fff' }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Global search bar ── */}
      <div style={{
        background: '#fff',
        border: '1px solid #eef0f3',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <i className="ri-search-line" style={{ color: '#9ca3af', fontSize: 18 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search masters — e.g. Company, GST, Bank, Warehouse…"
          style={{
            flexGrow: 1,
            border: 'none',
            outline: 'none',
            fontSize: 13.5,
            color: '#1f2937',
            background: 'transparent',
          }}
        />
        {hasSearch && (
          <>
            <span style={{
              fontSize: 11, color: '#6b7280', fontWeight: 600,
              background: '#f3f4f6', borderRadius: 20, padding: '2px 10px',
            }}>
              {filteredGroups.reduce((s, g) => s + g.children.length, 0)} results
            </span>
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: '#9ca3af', padding: 2,
              }}
              title="Clear search"
            >
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </>
        )}
      </div>

      {/* No search results */}
      {hasSearch && filteredGroups.length === 0 && (
        <div style={{
          background: '#fff', border: '1px dashed #e5e7eb', borderRadius: 12,
          padding: '28px 20px', textAlign: 'center', color: '#6b7280', fontSize: 13,
        }}>
          <i className="ri-search-eye-line" style={{ fontSize: 28, color: '#9ca3af', display: 'block', marginBottom: 6 }} />
          No masters match "<strong>{search}</strong>"
        </div>
      )}

      {/* ── Category Sections — accordion; when searching, all matching sections stay open ── */}
      {filteredGroups.map(group => {
        const s = CATEGORY_STYLES[group.id] || {
          ...BASE, icon: 'ri-folder-line',
          gradient: 'linear-gradient(135deg,#405189,#6691e7)',
        };
        // In search mode, always expand sections that have matches.
        // Otherwise accordion — only the openGroupId is expanded.
        const isCollapsed = hasSearch ? false : openGroupId !== group.id;

        return (
          <div key={group.id} style={{ marginBottom: 14 }}>

            {/* ── White container holds header row + pills (when collapsed) ── */}
            <div style={{
              background: '#fff',
              border: `1px solid ${isCollapsed ? s.border : '#eef0f3'}`,
              borderRadius: 12,
              padding: '14px 16px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              transition: 'border-color .15s, box-shadow .15s',
            }}>

              {/* Single-row header: title (left) — click-to-expand link (middle) — count + Hide/Show (right) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}>
                {/* Colored vertical strip */}
                <div style={{
                  width: 4, height: 24, borderRadius: 4,
                  background: s.gradient, flexShrink: 0,
                }} />
                {/* Icon chip */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: s.softBg, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <i className={s.icon} style={{ color: s.color, fontSize: 16 }} />
                </div>
                {/* Title */}
                <h6 style={{
                  margin: 0, fontWeight: 600, color: '#1f2937',
                  fontSize: 14, flexShrink: 0,
                }}>
                  {group.label}
                </h6>

                {/* Middle: "N masters · Click here to expand" — only when collapsed */}
                {isCollapsed ? (
                  <button
                    type="button"
                    onClick={() => toggle(group.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      flexGrow: 1,
                      justifyContent: 'center',
                      background: 'transparent',
                      border: 'none',
                      color: s.color,
                      fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', outline: 'none',
                      padding: 0,
                    }}
                  >
                    {group.children.length} masters · Click here to expand
                    <i className="ri-arrow-down-s-line" style={{ fontSize: 14 }} />
                  </button>
                ) : (
                  <div style={{ flexGrow: 1 }} />
                )}

                {/* Count badge */}
                <span style={{
                  background: s.softBg, color: s.color,
                  border: `1px solid ${s.border}`,
                  borderRadius: 20, padding: '2px 10px',
                  fontSize: 11, fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {group.children.length} masters
                </span>
                {/* Show / Hide */}
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: isCollapsed ? s.color : '#fff',
                    color: isCollapsed ? '#fff' : s.color,
                    border: `1px solid ${s.border}`,
                    borderRadius: 6,
                    padding: '5px 13px',
                    fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', outline: 'none', lineHeight: 1.5,
                    transition: 'background .15s, color .15s',
                    minWidth: 16,
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <i className={isCollapsed ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} style={{ fontSize: 13 }} />
                </button>
              </div>
            </div>

            {/* Expanded: cards grid below the white header container */}
            {!isCollapsed && (
              <Row className="g-3" style={{ marginTop: 14 }}>
                {group.children.map(leaf => (
                  <Col key={leaf.id} xl={3} lg={4} md={6}>
                    <MasterCard leaf={leaf} style={s} onClick={() => goTo(leaf)} />
                  </Col>
                ))}
              </Row>
            )}

          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   MasterCard — Velzon project-card style
   Left colored border + title + status badge + description + footer row
───────────────────────────────────────────────────────── */
function MasterCard({
  leaf,
  style: s,
  onClick,
}: {
  leaf: MenuChild;
  style: CategoryStyle;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #eef0f3',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        transition: 'box-shadow .2s ease, transform .2s ease, border-color .2s ease',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px 16px 14px',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = `0 10px 24px ${s.color}22`;
        el.style.transform = 'translateY(-3px)';
        el.style.borderColor = s.border;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = '0 1px 2px rgba(0,0,0,.04)';
        el.style.transform = 'translateY(0)';
        el.style.borderColor = '#eef0f3';
      }}
    >
      {/* ── Left gradient strip ── */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0,
        width: 4,
        background: s.gradient,
      }} />

      {/* ── Soft watermark glow (top-right) ── */}
      <div style={{
        position: 'absolute',
        top: -40, right: -40,
        width: 120, height: 120,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${s.color}14 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* ── Row 1: Gradient icon chip + title + Active pill ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 8, marginBottom: 10, position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          {/* Gradient icon chip */}
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: s.gradient,
            boxShadow: `0 4px 12px ${s.color}33`,
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={leafIcon(leaf.icon)} style={{ color: '#fff', fontSize: 17 }} />
          </div>
          <h6 style={{
            margin: 0, fontWeight: 700, fontSize: 13.5, color: '#1f2937',
            lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {leaf.label}
          </h6>
        </div>
        {/* Active pill */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: '#ecfdf5', color: '#059669',
          border: '1px solid #bbf7d0',
          borderRadius: 20, padding: '2px 9px',
          fontSize: 10.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
          Active
        </span>
      </div>

      {/* ── Row 2: Description ── */}
      <p style={{
        margin: '0 0 14px 0',
        paddingLeft: 49,
        fontSize: 12,
        color: '#6b7280',
        lineHeight: 1.55,
        flexGrow: 1,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {leafDescription(leaf)}
      </p>

      {/* ── Row 3: Counts + Manage ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, borderTop: '1px solid #f0f3f8',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <span style={{ color: '#6b7280', fontSize: 11 }}>Active :</span>
            <span style={{
              background: '#ecfdf5', color: '#059669',
              borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>0</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <span style={{ color: '#6b7280', fontSize: 11 }}>Inactive :</span>
            <span style={{
              background: '#fef2f2', color: '#dc2626',
              borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>0</span>
          </span>
        </div>
        {/* Manage pill — gradient on hover background tint */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: s.softBg,
          color: s.color,
          border: `1px solid ${s.border}`,
          borderRadius: 20, padding: '3px 10px',
          fontSize: 11.5, fontWeight: 700,
        }}>
          Manage <i className="ri-arrow-right-line" style={{ fontSize: 12 }} />
        </span>
      </div>
    </div>
  );
}
