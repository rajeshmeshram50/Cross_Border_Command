import { useState, useMemo } from 'react';
import { Row, Col } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MASTER_GROUPS } from '../constants';
import type { MenuChild, MenuGroup } from '../types';

const SUPER_ADMIN_ONLY_MASTERS = new Set<string>(['master.organization_types']);

interface CategoryStyle { color: string; icon: string; gradient: string; }

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'master.identity':   { color: '#405189', icon: 'ri-profile-line',    gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  'master.geography':  { color: '#0ab39c', icon: 'ri-global-line',     gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' },
  'master.trade':      { color: '#f7b84b', icon: 'ri-line-chart-line', gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' },
  'master.party':      { color: '#f06548', icon: 'ri-team-line',       gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  'master.legal':      { color: '#e83e8c', icon: 'ri-scales-3-line',   gradient: 'linear-gradient(135deg,#e83e8c,#ef79b0)' },
  'master.operations': { color: '#299cdb', icon: 'ri-tools-line',      gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' },
  'master.p2p':        { color: '#7c5cfc', icon: 'ri-handshake-line',  gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)' },
  'master.warehouse':  { color: '#10b981', icon: 'ri-building-2-line', gradient: 'linear-gradient(135deg,#10b981,#34d399)' },
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
  { label: 'Total Masters', icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { label: 'Active',        icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { label: 'Inactive',      icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { label: 'Total Records', icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg,#f7b84b,#f1963b)' },
];

export default function MasterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [initialized, setInitialized]  = useState(false);
  const [search, setSearch] = useState('');

  const groups = useMemo<MenuGroup[]>(() => {
    if (isSuperAdmin) return MASTER_GROUPS;
    return MASTER_GROUPS
      .map(g => ({ ...g, children: g.children.filter(c => !SUPER_ADMIN_ONLY_MASTERS.has(c.id) && !!perms[c.id]?.can_view) }))
      .filter(g => g.children.length > 0);
  }, [isSuperAdmin, perms]);

  if (!initialized && groups.length > 0) { setOpenGroupId(groups[0].id); setInitialized(true); }

  const q = search.trim().toLowerCase();
  const hasSearch = q.length > 0;

  const filteredGroups = useMemo<MenuGroup[]>(() => {
    if (!hasSearch) return groups;
    return groups
      .map(g => ({ ...g, children: g.children.filter(c => c.label.toLowerCase().includes(q)) }))
      .filter(g => g.children.length > 0);
  }, [groups, q, hasSearch]);

  const totals = useMemo(() => {
    const total = groups.reduce((s, g) => s + g.children.length, 0);
    return { total, active: total, inactive: 0, records: 0 };
  }, [groups]);

  const toggle = (id: string) => setOpenGroupId(prev => (prev === id ? null : id));
  const goTo   = (leaf: MenuChild) => navigate(`/master/${leaf.id.replace('master.', '')}`);

  if (groups.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340 }}>
        <div style={{ background: 'var(--vz-card-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '48px 40px', textAlign: 'center', maxWidth: 460, boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#f7b84b18', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <i className="ri-lock-2-line" style={{ fontSize: 28, color: '#f7b84b' }} />
          </div>
          <h5 style={{ fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', marginBottom: 8 }}>No Master Access</h5>
          <p style={{ color: 'var(--vz-secondary-color)', fontSize: 13, margin: 0 }}>
            Your account does not have permission for any master. Ask your administrator to grant access.
          </p>
        </div>
      </div>
    );
  }

  const statValues = [totals.total, totals.active, totals.inactive, totals.records];

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-title-box d-sm-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="mb-0">Master Control Center</h4>
          <p className="text-muted fs-12 mb-0 mt-1">{totals.total} masters across {groups.length} categories</p>
        </div>
        <ol className="breadcrumb m-0 fs-12">
          <li className="breadcrumb-item"><a href="#">Master Data</a></li>
          <li className="breadcrumb-item active">Overview</li>
        </ol>
      </div>

      {/* ── KPI Stat Cards ── */}
      <Row className="g-3 mb-4">
        {STAT_CARDS.map((sc, i) => (
          <Col key={sc.label} xl={3} md={6} xs={12}>
            <div style={{ background: 'var(--vz-card-bg)', borderRadius: 14, border: '1px solid var(--vz-border-color)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', position: 'relative', padding: '16px 18px 14px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sc.gradient }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{sc.label}</p>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>
                    {statValues[i].toLocaleString()}
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', flexShrink: 0 }}>
                  <i className={sc.icon} style={{ fontSize: 18, color: 'var(--vz-secondary-color)' }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Search Bar ── */}
      <div style={{ background: 'var(--vz-card-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ri-search-line" style={{ color: 'var(--vz-secondary-color)', fontSize: 17 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search masters — e.g. Company, GST, Bank, Warehouse…"
          style={{ flexGrow: 1, border: 'none', outline: 'none', fontSize: 13, color: 'var(--vz-body-color)', background: 'transparent' }}
        />
        {hasSearch && (
          <>
            <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, background: 'var(--vz-secondary-bg)', borderRadius: 20, padding: '2px 10px', border: '1px solid var(--vz-border-color)' }}>
              {filteredGroups.reduce((s, g) => s + g.children.length, 0)} results
            </span>
            <button type="button" onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--vz-secondary-color)', padding: 2 }}>
              <i className="ri-close-line" style={{ fontSize: 17 }} />
            </button>
          </>
        )}
      </div>

      {/* No results */}
      {hasSearch && filteredGroups.length === 0 && (
        <div style={{ background: 'var(--vz-card-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 12, padding: '28px 20px', textAlign: 'center' }}>
          <i className="ri-search-eye-line" style={{ fontSize: 28, color: 'var(--vz-secondary-color)', display: 'block', marginBottom: 6 }} />
          <span style={{ color: 'var(--vz-secondary-color)', fontSize: 13 }}>No masters match "<strong style={{ color: 'var(--vz-body-color)' }}>{search}</strong>"</span>
        </div>
      )}

      {/* ── Category Sections ── */}
      {filteredGroups.map(group => {
        const s = CATEGORY_STYLES[group.id] || { color: '#405189', icon: 'ri-folder-line', gradient: 'linear-gradient(135deg,#405189,#6691e7)' };
        const isCollapsed = hasSearch ? false : openGroupId !== group.id;

        return (
          <div key={group.id} style={{ marginBottom: 12 }}>

            {/* ── Category Header — entire row is clickable ── */}
            <div
              style={{
                background: 'var(--vz-card-bg)',
                border: '1px solid var(--vz-border-color)',
                borderRadius: 12,
                padding: '12px 16px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                transition: 'box-shadow 0.15s ease',
                userSelect: 'none',
              }}
              onClick={() => toggle(group.id)}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 2px 12px ${s.color}22`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
            >
              {/* Gradient accent strip */}
              <div style={{ width: 4, height: 28, borderRadius: 4, background: s.gradient, flexShrink: 0 }} />

              {/* Icon chip */}
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={s.icon} style={{ color: s.color, fontSize: 15 }} />
              </div>

              {/* Title + count badge */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.2 }}>
                    {group.label}
                  </span>
                  <span style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-secondary-color)', border: '1px solid var(--vz-border-color)', borderRadius: 20, padding: '1px 9px', fontSize: 10.5, fontWeight: 600, flexShrink: 0, lineHeight: '18px' }}>
                    {group.children.length}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                  {group.children.length} masters · {isCollapsed ? 'Click to expand' : 'Click to collapse'}
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

            {/* ── Expanded master cards ── */}
            {!isCollapsed && (
              <Row className="g-3" style={{ marginTop: 10 }}>
                {group.children.map(leaf => (
                  <Col key={leaf.id} xl={3} lg={4} md={6}>
                    <MasterCard leaf={leaf} s={s} onClick={() => goTo(leaf)} />
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

/* ── MasterCard ─────────────────────────────────────────────── */
function MasterCard({ leaf, s, onClick }: { leaf: MenuChild; s: CategoryStyle; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ background: 'var(--vz-card-bg)', borderRadius: 12, border: '1px solid var(--vz-border-color)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease', display: 'flex', flexDirection: 'column', height: '100%', padding: '15px 15px 13px', position: 'relative', overflow: 'hidden' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = `0 8px 24px ${s.color}22`;
        el.style.transform = 'translateY(-2px)';
        el.style.borderColor = s.color + '50';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
        el.style.transform = 'translateY(0)';
        el.style.borderColor = 'var(--vz-border-color)';
      }}
    >
      {/* Left gradient strip */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, background: s.gradient }} />

      {/* Soft glow */}
      <div style={{ position: 'absolute', top: -36, right: -36, width: 110, height: 110, borderRadius: '50%', background: `radial-gradient(circle,${s.color}10 0%,transparent 70%)`, pointerEvents: 'none' }} />

      {/* Row 1: icon + title + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 9, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: s.gradient, boxShadow: `0 3px 10px ${s.color}33`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className={leafIcon(leaf.icon)} style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <h6 style={{ margin: 0, fontWeight: 700, fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {leaf.label}
          </h6>
        </div>
        {/* Active badge */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0ab39c18', color: '#0ab39c', border: '1px solid #0ab39c30', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0ab39c' }} />
          Active
        </span>
      </div>

      {/* Row 2: Description */}
      <p style={{ margin: '0 0 12px 0', paddingLeft: 46, fontSize: 11.5, color: 'var(--vz-secondary-color)', lineHeight: 1.55, flexGrow: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {leafDescription(leaf)}
      </p>

      {/* Row 3: Counts + Manage */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--vz-border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--vz-secondary-color)' }}>Active</span>
            <span style={{ background: '#0ab39c18', color: '#0ab39c', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>0</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--vz-secondary-color)' }}>Inactive</span>
            <span style={{ background: '#f0654818', color: '#f06548', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>0</span>
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.color + '15', color: s.color, border: `1px solid ${s.color}30`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
          Manage <i className="ri-arrow-right-line" style={{ fontSize: 11 }} />
        </span>
      </div>
    </div>
  );
}
