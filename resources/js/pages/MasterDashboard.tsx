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

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'master.identity':   { color: '#405189', softBg: '#eef0fb', border: '#c5caf0', icon: 'ri-profile-line',    gradient: 'linear-gradient(135deg,#405189,#6775c0)' },
  'master.geography':  { color: '#0ab39c', softBg: '#e0f8f5', border: '#7de0d5', icon: 'ri-global-line',     gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' },
  'master.trade':      { color: '#f7b84b', softBg: '#fef8ec', border: '#fce3a1', icon: 'ri-line-chart-line', gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' },
  'master.party':      { color: '#f06548', softBg: '#fef0ed', border: '#f9c4b9', icon: 'ri-team-line',       gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  'master.legal':      { color: '#e83e8c', softBg: '#fceef6', border: '#f4b8d8', icon: 'ri-scales-3-line',   gradient: 'linear-gradient(135deg,#e83e8c,#ef79b0)' },
  'master.operations': { color: '#299cdb', softBg: '#e8f5fd', border: '#97d4f5', icon: 'ri-tools-line',      gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' },
  'master.p2p':        { color: '#7c5cfc', softBg: '#f0ecff', border: '#c8b9fd', icon: 'ri-handshake-line',  gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)' },
  'master.warehouse':  { color: '#0ab39c', softBg: '#e0f8f5', border: '#7de0d5', icon: 'ri-building-2-line', gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' },
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
  { label: 'Total Masters',      icon: 'ri-stack-line',             gradient: 'linear-gradient(135deg,#405189,#6775c0)' },
  { label: 'Active',             icon: 'ri-checkbox-circle-line',   gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' },
  { label: 'Inactive',           icon: 'ri-close-circle-line',      gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { label: 'Total Records',      icon: 'ri-file-list-3-line',       gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' },
  { label: 'HSN Pending Review', icon: 'ri-time-line',              gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' },
];

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
    return { total, active: total, inactive: 0, records: 0, pending: 0 };
  }, [groups]);

  const statValues = [totals.total, totals.active, totals.inactive, totals.records, totals.pending];

  const toggle = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }));
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

      {/* ── Stat Cards Row ── */}
      <Row className="g-3 mb-4">
        {STAT_CARDS.map((sc, i) => (
          <Col key={sc.label}>
            <div style={{
              background: '#fff',
              border: '1px solid #e9ebec',
              borderRadius: 8,
              boxShadow: '0 1px 2px rgba(56,65,74,.10)',
              padding: '16px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}>
              <div style={{
                width: 50, height: 50, borderRadius: 8,
                background: sc.gradient, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <i className={sc.icon} style={{ color: '#fff', fontSize: 22 }} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#212529', lineHeight: 1, letterSpacing: '-0.5px' }}>
                  {statValues[i]}
                </div>
                <div style={{ fontSize: 11.5, color: '#878a99', marginTop: 4, fontWeight: 500 }}>
                  {sc.label}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Category Sections ── */}
      {groups.map(group => {
        const s = CATEGORY_STYLES[group.id] || {
          color: '#405189', softBg: '#eef0fb', border: '#c5caf0',
          icon: 'ri-folder-line', gradient: 'linear-gradient(135deg,#405189,#6775c0)',
        };
        const isCollapsed = !!collapsed[group.id];

        return (
          <div key={group.id} style={{ marginBottom: 32 }}>

            {/* ── Section Header ── */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              paddingBottom: 14,
              borderBottom: '1px solid #e9ebec',
            }}>
              {/* Colored strip */}
              <div style={{ width: 4, height: 22, borderRadius: 4, background: s.gradient, flexShrink: 0 }} />
              {/* Icon box */}
              <div style={{
                width: 32, height: 32, borderRadius: 6, background: s.softBg, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <i className={s.icon} style={{ color: s.color, fontSize: 16 }} />
              </div>
              {/* Title */}
              <h6 style={{ margin: 0, fontWeight: 600, color: '#212529', fontSize: 14, flexGrow: 1 }}>
                {group.label}
              </h6>
              {/* Count */}
              <span style={{
                background: s.softBg, color: s.color, border: `1px solid ${s.border}`,
                borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
              }}>
                {group.children.length} masters
              </span>

              {/* ── Hide / Show button ── */}
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
                  minWidth: 76,
                  justifyContent: 'center',
                }}
              >
                <i className={isCollapsed ? 'ri-eye-line' : 'ri-eye-off-line'} style={{ fontSize: 13 }} />
                {isCollapsed ? 'Show' : 'Hide'}
              </button>
            </div>

            {/* ── Cards ── */}
            {!isCollapsed && (
              <Row className="g-3">
                {group.children.map(leaf => (
                  <Col key={leaf.id} xl={3} lg={4} md={6}>
                    <MasterCard leaf={leaf} style={s} onClick={() => goTo(leaf)} />
                  </Col>
                ))}
              </Row>
            )}

            {/* Collapsed hint */}
            {isCollapsed && (
              <div style={{
                textAlign: 'center', padding: '10px 0',
                color: '#adb5bd', fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <i className="ri-arrow-down-s-line" style={{ fontSize: 15 }} />
                {group.children.length} masters hidden — click <strong style={{ color: s.color }}>Show</strong> to expand
              </div>
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
        background: '#ffffff',
        borderRadius: 8,
        border: '1px solid #e9ebec',
        borderLeft: `3px solid ${s.color}`,      /* ← Velzon left accent */
        boxShadow: '0 1px 2px rgba(56,65,74,.08)',
        cursor: 'pointer',
        transition: 'box-shadow .18s ease, transform .18s ease',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '15px 16px',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(56,65,74,.15)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(56,65,74,.08)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
      }}
    >
      {/* ── Row 1: Title + Status pill ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          {/* Icon */}
          <div style={{
            width: 34, height: 34, borderRadius: 6, background: s.softBg, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={leafIcon(leaf.icon)} style={{ color: s.color, fontSize: 16 }} />
          </div>
          <h6 style={{
            margin: 0, fontWeight: 600, fontSize: 13, color: '#212529',
            lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {leaf.label}
          </h6>
        </div>
        {/* Status badge — like Velzon's "Completed / Inprogress" */}
        <span style={{
          background: s.softBg, color: s.color,
          border: `1px solid ${s.border}`,
          borderRadius: 20, padding: '2px 9px',
          fontSize: 10.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          Active
        </span>
      </div>

      {/* ── Row 2: Description — like "Last Update" ── */}
      <p style={{
        margin: '0 0 14px 0',
        paddingLeft: 43,   /* align under title text (icon 34 + gap 9) */
        fontSize: 12,
        color: '#878a99',
        lineHeight: 1.55,
        flexGrow: 1,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {leafDescription(leaf)}
      </p>

      {/* ── Row 3: Counts + Manage — like "Members" row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, borderTop: '1px solid #f3f3f9',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <span style={{ color: '#878a99', fontSize: 11 }}>Active :</span>
            <span style={{
              background: '#d1fae5', color: '#059669',
              borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>0</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <span style={{ color: '#878a99', fontSize: 11 }}>Inactive :</span>
            <span style={{
              background: '#fee2e2', color: '#dc2626',
              borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>0</span>
          </span>
        </div>
        {/* Manage link */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          color: s.color, fontSize: 12, fontWeight: 600,
        }}>
          Manage <i className="ri-arrow-right-line" style={{ fontSize: 13 }} />
        </span>
      </div>
    </div>
  );
}
