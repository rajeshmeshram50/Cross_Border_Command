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
  bg: string;
  border: string;
  icon: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'master.identity':    { color: '#4F46E5', bg: '#EEF2FF', border: '#C7D2FE', icon: 'ri-profile-line' },
  'master.geography':   { color: '#0891B2', bg: '#ECFEFF', border: '#A5F3FC', icon: 'ri-global-line' },
  'master.trade':       { color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', icon: 'ri-line-chart-line' },
  'master.party':       { color: '#EC4899', bg: '#FDF2F8', border: '#FBCFE8', icon: 'ri-team-line' },
  'master.legal':       { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', icon: 'ri-scales-3-line' },
  'master.operations':  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', icon: 'ri-tools-line' },
  'master.p2p':         { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', icon: 'ri-handshake-line' },
  'master.warehouse':   { color: '#0F766E', bg: '#F0FDFA', border: '#99F6E4', icon: 'ri-building-2-line' },
};

// Lucide icon names → Remix icons
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

// Per-master short descriptions (shown on the dashboard card)
const LEAF_DESCRIPTIONS: Record<string, string> = {
  // Identity & Entity
  'master.company':                 'Legal identity, GSTIN, PAN, IEC — used on every export document',
  'master.bank_accounts':           'Bank registry — Swift Code + AD Code mandatory for export',
  'master.departments':             'Organizational units — assign staff & route approvals',
  'master.roles':                   'User roles controlling module access permissions',
  'master.designations':            'Job titles shown on letters, profiles & HR records',
  // Geography & Location
  'master.countries':               'Country master — referenced on all trade documents',
  'master.states':                  'State list for addresses & GST place-of-supply',
  'master.state_codes':             '2-digit GST state codes for tax filings',
  'master.address_types':           'Tag addresses: Billing, Shipping, Registered, etc.',
  'master.port_of_loading':         'Origin ports on shipping bills & export invoices',
  'master.port_of_discharge':       'Destination ports on packing lists & shipping docs',
  // Trade & Commercial
  'master.segments':                'Business lines classifying orders & products',
  'master.hsn_codes':               '8-digit commodity codes for GST & customs filings',
  'master.gst_percentage':          'GST tax slabs applied on product invoices',
  'master.currencies':              'Active currencies with exchange rates for export invoicing',
  'master.uom':                     'Units (Kg, Box, Pcs) on product & shipment records',
  'master.packaging_material':      'Box, carton & wrapping types linked to packaging module',
  'master.conditions':              'Storage & handling states (Organic, Fresh, Frozen)',
  'master.incoterms':               'Trade terms (FOB, CIF) defining delivery & risk',
  // Party & Classification
  'master.customer_types':          'Classify buyers as Domestic / Export for pricing rules',
  'master.customer_classifications':'Tier labels (A/B/C, Key Account) for credit & discount',
  'master.vendor_types':            'Supplier categories for procurement rules',
  'master.vendor_behaviour':        'Performance tags used in purchase order workflows',
  'master.applicable_types':        'Who appears on documents — Buyer, Consignee, Notify Party',
  // Legal & Compliance
  'master.license_name':            'Import/export license categories per product or market',
  'master.risk_levels':             'Risk severity tags for vendor & shipment screening',
  'master.document_type':           'Document categories for upload & linking (Invoice, COA, SDS)',
  'master.haz_class':               'GHS/UN hazard classes for products requiring special handling',
  'master.compliance_behaviours':   'Rules for regulated, cold-chain & controlled substance handling',
  // Operations & Support
  'master.assets':                  'Company equipment & assets for ops & depreciation tracking',
  'master.asset_categories':        'Group assets by type (Machinery, IT, Furniture)',
  'master.numbering_series':        'System auto-numbering — locks after first transaction',
  // P2P Masters
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
  // Warehouse Masters
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

export default function MasterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  const totals = useMemo(() => {
    const total = groups.reduce((s, g) => s + g.children.length, 0);
    return {
      total,
      active: total, // all seeded as Active
      inactive: 0,
      records: 0,
      pending: 0,
    };
  }, [groups]);

  const toggle = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  const goTo = (leaf: MenuChild) => navigate(`/master/${leaf.id.replace('master.', '')}`);

  if (groups.length === 0) {
    return (
      <Row>
        <Col xs={12}>
          <div className="card shadow-sm">
            <div className="card-body text-center py-5">
              <div className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning"
                   style={{ width: 84, height: 84 }}>
                <i className="ri-lock-2-line fs-36" />
              </div>
              <h4 className="fw-bold mb-2">No Master Access</h4>
              <p className="text-muted mb-0" style={{ maxWidth: 460, margin: '0 auto' }}>
                Your account does not have permission for any master. Ask your administrator
                to grant access in the Permission Management page.
              </p>
            </div>
          </div>
        </Col>
      </Row>
    );
  }

  return (
    <>
      {/* Header */}
      <Row className="mb-4">
        <Col xs={12}>
          <div>
            <h3 className="fw-bold mb-1" style={{ letterSpacing: '-0.3px' }}>Master Control Center</h3>
            <p className="text-muted mb-0 fs-13">
              {totals.total} masters across {groups.length} categories — click any card to manage records
            </p>
          </div>
        </Col>
      </Row>

      {/* Stats Row */}
      <Row className="g-3 mb-4">
        <StatCard label="MASTERS"           value={totals.total}    iconBg="#F1F5F9" iconColor="#4F46E5" icon="ri-stack-line" emoji="📦" />
        <StatCard label="ACTIVE"            value={totals.active}   iconBg="#D1FAE5" iconColor="#059669" icon="ri-checkbox-circle-line" emoji="✅" />
        <StatCard label="INACTIVE"          value={totals.inactive} iconBg="#FEE2E2" iconColor="#DC2626" icon="ri-pause-circle-line" emoji="⏸" />
        <StatCard label="TOTAL RECORDS"     value={totals.records}  iconBg="#FFEDD5" iconColor="#EA580C" icon="ri-file-list-3-line" emoji="📋" />
        <StatCard label="HSN PENDING REVIEW" value={totals.pending} iconBg="#FEF9C3" iconColor="#CA8A04" icon="ri-time-line" emoji="⏳" />
      </Row>

      {/* Category Sections */}
      {groups.map(group => {
        const style = CATEGORY_STYLES[group.id] || { color: '#64748B', bg: '#F1F5F9', border: '#CBD5E1', icon: 'ri-folder-line' };
        const isCollapsed = !!collapsed[group.id];
        return (
          <div key={group.id} className="mb-4">
            {/* Category Header */}
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 rounded-3 mb-3"
              style={{
                background: style.bg,
                borderLeft: `4px solid ${style.color}`,
              }}
            >
              <div
                className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                style={{ background: `${style.color}22`, width: 38, height: 38 }}
              >
                <i className={style.icon} style={{ color: style.color, fontSize: 18 }}></i>
              </div>
              <h5 className="mb-0 fw-bold" style={{ color: style.color, fontSize: 15 }}>
                {group.label}
              </h5>
              <span
                className="px-2 py-1 rounded-pill fw-bold"
                style={{
                  background: '#fff',
                  color: style.color,
                  border: `1px solid ${style.border}`,
                  fontSize: 11,
                }}
              >
                {group.children.length} masters
              </span>
              <button
                type="button"
                className="ms-auto btn btn-sm px-3 d-flex align-items-center gap-1"
                style={{
                  background: '#fff',
                  border: `1px solid ${style.border}`,
                  color: style.color,
                  fontSize: 12,
                  fontWeight: 600,
                }}
                onClick={() => toggle(group.id)}
              >
                <i className={`ri-arrow-${isCollapsed ? 'down' : 'up'}-s-line fs-14`}></i>
                {isCollapsed ? 'Show' : 'Hide'}
              </button>
            </div>

            {/* Cards Grid */}
            {!isCollapsed && (
              <Row className="g-3">
                {group.children.map(leaf => (
                  <Col key={leaf.id} xl={3} lg={4} md={6}>
                    <MasterCard
                      leaf={leaf}
                      style={style}
                      activeCount={0}
                      inactiveCount={0}
                      onClick={() => goTo(leaf)}
                    />
                  </Col>
                ))}
              </Row>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ─────────────── Sub Components ─────────────── */

function StatCard({
  label,
  value,
  iconBg,
  iconColor,
  icon,
  emoji,
}: {
  label: string;
  value: number;
  iconBg: string;
  iconColor: string;
  icon: string;
  emoji: string;
}) {
  return (
    <Col>
      <div
        className="bg-white rounded-3 shadow-sm p-3 d-flex align-items-center gap-3 h-100"
        style={{ border: '1px solid #E2E8F0' }}
      >
        <div
          className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
          style={{ background: iconBg, width: 44, height: 44, fontSize: 20 }}
        >
          <span style={{ color: iconColor }}>{emoji}</span>
        </div>
        <div className="flex-grow-1">
          <div className="fs-22 fw-bold" style={{ color: iconColor, lineHeight: 1, letterSpacing: '-0.5px' }}>
            {value}
          </div>
          <div
            className="text-muted fw-bold mt-1"
            style={{ fontSize: 10, letterSpacing: '0.6px' }}
          >
            {label}
          </div>
        </div>
        <i className={icon} style={{ color: iconColor, opacity: 0.3, fontSize: 20 }}></i>
      </div>
    </Col>
  );
}

function MasterCard({
  leaf,
  style,
  activeCount,
  inactiveCount,
  onClick,
}: {
  leaf: MenuChild;
  style: CategoryStyle;
  activeCount: number;
  inactiveCount: number;
  onClick: () => void;
}) {
  return (
    <div
      className="bg-white rounded-3 shadow-sm h-100 p-3 d-flex flex-column position-relative master-card"
      style={{
        border: '1px solid #E2E8F0',
        borderTop: `3px solid ${style.color}`,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = `0 10px 25px rgba(0,0,0,0.08), 0 0 0 1px ${style.border}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,0.06)';
      }}
    >
      {/* Top: icon + counts */}
      <div className="d-flex align-items-start justify-content-between mb-2">
        <div
          className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
          style={{ background: style.bg, width: 40, height: 40 }}
        >
          <i className={leafIcon(leaf.icon)} style={{ color: style.color, fontSize: 18 }}></i>
        </div>
        <div className="d-flex flex-column align-items-end gap-1">
          <div
            className="d-flex align-items-center gap-1 fw-bold"
            style={{ fontSize: 11 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }}></span>
            <span style={{ color: '#059669' }}>{activeCount}</span>
          </div>
          <div
            className="d-flex align-items-center gap-1 fw-bold"
            style={{ fontSize: 11 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626' }}></span>
            <span style={{ color: '#DC2626' }}>{inactiveCount}</span>
          </div>
        </div>
      </div>

      {/* Title */}
      <h6 className="fw-bold mb-1 text-dark" style={{ fontSize: 13.5, lineHeight: 1.3, letterSpacing: '-0.1px' }}>
        {leaf.label}
      </h6>

      {/* Description */}
      <p
        className="text-muted mb-3"
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          flexGrow: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {leafDescription(leaf)}
      </p>

      {/* CTA */}
      <div
        className="text-center rounded-2 fw-semibold py-2"
        style={{
          background: style.bg,
          color: style.color,
          fontSize: 11,
        }}
      >
        Manage {leaf.label} <i className="ri-arrow-right-line ms-1"></i>
      </div>
    </div>
  );
}
