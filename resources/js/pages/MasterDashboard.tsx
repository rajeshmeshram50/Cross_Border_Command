import { useState, useMemo, useEffect } from 'react';
import { Row, Col } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MASTER_GROUPS, SUPER_ADMIN_MASTERS } from '../constants';
import type { MenuChild, MenuGroup } from '../types';
import api from '../api';
import { getMasterConfig, masterEndpoint } from './master/masterConfigs';
import './MasterDashboard.css';
import '../../css/master.css';
import './p2p/p2p-common.css';
import './p2p/purchase-management/order/po-list/order.css';
import SearchClear from '../components/ui/SearchClear';

const INVENTORY_MASTER_PAGES: Record<string, string> = {
  'master.warehouse_master': '/inventory-management/warehouse-master',
  'master.zone_master':      '/inventory-management/zone-master',
  'master.racks':            '/inventory-management/rack-master',
  'master.product_flags':    '/inventory-management/product-flags',
  'sales.lead_ack_master': '/master/lead-ack',
  'hr.holiday':            '/master/holiday_groups',
  'clm.authority':         '/master/clm/authority',
  'clm.kyc':               '/master/clm/kyc',
  'clm.due_diligence':     '/master/clm/due-diligence',
  'clm.trade_licenses':    '/master/clm/trade-licenses',
  'clm.quality_docs':      '/master/clm/quality-docs',
  'clm.trade_documents':   '/master/clm/trade-documents',
  'clm.agreements':        '/master/clm/agreements',
  'clm.terms_conditions':  '/master/clm/terms-conditions',
  'clm.clause_library':    '/master/clm/clause-library',
};
const INVENTORY_MASTER_LISTS: Record<string, string> = {
  'master.warehouse_master': '/inventory/warehouses',
  'master.zone_master':      '/inventory/zones',
  'master.racks':            '/inventory/racks',
  'master.product_flags':    '/inventory/product-flags',
};
const GROUP_SUMMARIES: Record<string, string> = {
  'master.organisation': 'Company identity, bank accounts, departments, roles and designations.',
  'master.geography':    'Countries, states, GST state codes and address types.',
  'master.hrms':         'Leave, overtime, expenses, assets, holidays and document trigger points.',
  'master.sales':        'Customer categories, classifications and lead acknowledgement reasons.',
  'master.p2p':          'Supplier types, behaviour, compliance, risk levels and service categories.',
  'master.product':      'Segments, HSN, GST, currencies, units, packaging and product handling.',
  'master.shipment':     'Incoterms and ports used on export documents.',
  'master.warehouse':    'Warehouses, zones, racks and product flags from Inventory Management.',
  'master.clm':          'Authorities, KYC, due diligence, licences, trade documents and contract libraries from CLM.',
};

const OWN_LIST_COUNTS: Record<string, { url: string; rows: (data: any) => any[] }> = {
  'hr.holiday': { url: '/holiday-groups', rows: d => (Array.isArray(d) ? d : []) },
  'sales.lead_ack_master': {
    url: '/sales/lead-ack-reasons',
    rows: d => [...(d?.qualified ?? []), ...(d?.disqualified ?? []), ...(d?.clarity_pending ?? [])],
  },
};

const MASTER_PERM_ALIAS: Record<string, string> = {
  'master.product_flags': 'master.warehouse_master',
};

type CountEntry = { active: number; inactive: number; total: number };

const SUPER_ADMIN_ONLY_MASTERS = new Set<string>(['master.organization_types']);

interface CategoryStyle { color: string; icon: string; gradient: string; }

const MD_TEAL_BAR  = 'linear-gradient(90deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)';
const MD_TEAL_ICON = 'linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%)';

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'master.organisation': { color: '#0891b2', icon: 'ri-building-line',       gradient: MD_TEAL_ICON },
  'master.geography':    { color: '#0891b2', icon: 'ri-global-line',         gradient: MD_TEAL_ICON },
  'master.hrms':         { color: '#0891b2', icon: 'ri-team-line',           gradient: MD_TEAL_ICON },
  'master.sales':        { color: '#0891b2', icon: 'ri-line-chart-line',     gradient: MD_TEAL_ICON },
  'master.p2p':          { color: '#0891b2', icon: 'ri-exchange-funds-line', gradient: MD_TEAL_ICON },
  'master.product':      { color: '#0891b2', icon: 'ri-box-3-line',          gradient: MD_TEAL_ICON },
  'master.shipment':     { color: '#0891b2', icon: 'ri-ship-line',           gradient: MD_TEAL_ICON },
  'master.clm':         { color: '#0891b2', icon: 'ri-shield-check-line', gradient: MD_TEAL_ICON },
  'master.warehouse':    { color: '#0891b2', icon: 'ri-building-2-line',     gradient: MD_TEAL_ICON },
};

const LEAF_ICONS: Record<string, string> = {
  Building: 'ri-building-4-line', Landmark: 'ri-bank-line', Building2: 'ri-building-line',
  UserCog: 'ri-user-settings-line', BadgeCheck: 'ri-verified-badge-line',
  Globe2: 'ri-earth-line', Map: 'ri-map-2-line', Hash: 'ri-hashtag',
  Home: 'ri-home-line', Anchor: 'ri-anchor-line', Ship: 'ri-ship-line',
  Target: 'ri-focus-3-line', Binary: 'ri-file-code-line', Percent: 'ri-percent-line',
  DollarSign: 'ri-money-dollar-circle-line', Ruler: 'ri-ruler-line', Package: 'ri-box-3-line',
  Leaf: 'ri-leaf-line', Handshake: 'ri-shake-hands-line',
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
  Thermometer: 'ri-temp-cold-line', Flag: 'ri-flag-line',
  UserCheck: 'ri-user-follow-line', SearchCheck: 'ri-search-eye-line', CheckSquare: 'ri-checkbox-line',
  Hexagon: 'ri-hexagon-line', Users: 'ri-group-line', List: 'ri-list-check-2', BookOpen: 'ri-book-open-line', Rows3: 'ri-layout-row-line', Rows4: 'ri-layout-grid-line',
  Monitor: 'ri-computer-line', Snowflake: 'ri-snowy-line',
  CalendarCheck: 'ri-calendar-check-line', CalendarOff: 'ri-calendar-close-line', CalendarRange: 'ri-calendar-2-line',
  Timer: 'ri-timer-flash-line',
};
const leafIcon = (name?: string) => (name && LEAF_ICONS[name]) || 'ri-file-list-3-line';

const LEAF_DESCRIPTIONS: Record<string, string> = {
  'master.organization_types':       'Organisation types for client setup',
  'master.company':                  'Legal identity — GSTIN, PAN, IEC',
  'master.bank_accounts':            'Company bank accounts for invoices',
  'master.departments':              'Departments, heads & hierarchy',
  'master.roles':                    'Employee roles and role types',
  'master.designations':             'Job titles and reporting levels',
  'master.countries':                'Countries for addresses & trade',
  'master.states':                   'States for addresses & GST',
  'master.state_codes':              '2-digit GST state codes',
  'master.address_types':            'Billing, Shipping, Registered…',
  'master.leave_type':               'Leave categories with short codes',
  'master.leave_plan':               'Leave plans and yearly rules',
  'master.overtime_rates':           'Overtime rates and multipliers',
  'master.expense_category':         'Expense heads and monthly limits',
  'master.assets':                   'Company equipment and assets',
  'master.asset_categories':         'Asset types — Laptop, Mobile…',
  'master.customer_types':           'Customer categories for pricing',
  'master.customer_classifications': 'Tiers for credit & discount',
  'master.vendor_types':             'Supplier types for procurement',
  'master.vendor_behaviour':         'Supplier performance tags',
  'master.compliance_behaviours':    'Supplier compliance handling rules',
  'master.risk_levels':              'Risk tags for screening',
  'master.service_categories':       'Soft / Digital & Operational services',
  'master.segments':                 'Business lines for products & orders',
  'master.hsn_codes':                'HSN codes for GST & customs',
  'master.gst_percentage':           'GST slabs for products & invoices',
  'master.currencies':               'Currencies and exchange rates',
  'master.uom':                      'Units — Kg, Box, Pcs…',
  'master.packaging_material':       'Packaging — box, carton, drum…',
  'master.conditions':               'Storage states — Fresh, Frozen…',
  'master.haz_class':                'GHS / UN hazard classes',
  'master.incoterms':                'Trade terms — FOB, CIF…',
  'master.port_of_loading':          'Origin ports for export documents',
  'master.port_of_discharge':        'Destination ports for shipments',
  'master.warehouse_master':         'Own & third-party warehouses',
  'master.zone_master':              'Storage zones inside warehouses',
  'master.racks':                    'Racks and shelves inside zones',
  'master.product_flags':            'Product handling & storage flags',
  'sales.lead_ack_master':          'Lead qualify & disqualify reasons',
  'hr.holiday':                     'Holiday lists you assign to employees',
  'master.trigger_point':           'Document trigger points',
  'clm.authority':                   'Issuing authorities — BIS, FSSAI…',
  'clm.kyc':                         'Owner KYC documents',
  'clm.due_diligence':               'Company due-diligence documents',
  'clm.trade_licenses':              'Trade licences per segment',
  'clm.quality_docs':                'Quality & compliance certificates',
  'clm.trade_documents':             'Trade document library',
  'clm.agreements':                  'Agreement templates',
  'clm.terms_conditions':            'Terms & conditions library',
  'clm.clause_library':              'Reusable contract clauses',
};
const leafDescription = (leaf: MenuChild) =>
  LEAF_DESCRIPTIONS[leaf.id] || `Manage ${leaf.label.toLowerCase()} records`;

const STAT_CARDS = [
  { label: 'Total Masters',    icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { label: 'Active Records',   icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { label: 'Inactive Records', icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { label: 'Total Records',    icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg,#f7b84b,#f1963b)' },
];

export default function MasterDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};

  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [anaOpen, setAnaOpen] = useState(true);

  const groups = useMemo<MenuGroup[]>(() => {
    if (isSuperAdmin) {
      return MASTER_GROUPS
        .map(g => ({ ...g, children: g.children.filter(c => SUPER_ADMIN_MASTERS.has(c.id)) }))
        .filter(g => g.children.length > 0);
    }
    return MASTER_GROUPS
      .map(g => ({ ...g, children: g.children.filter(c => !SUPER_ADMIN_ONLY_MASTERS.has(c.id) && !!perms[MASTER_PERM_ALIAS[c.id] ?? c.id]?.can_view) }))
      .filter(g => g.children.length > 0);
  }, [isSuperAdmin, perms]);

  const q = search.trim().toLowerCase();
  const hasSearch = q.length > 0;

  const filteredGroups = useMemo<MenuGroup[]>(() => {
    if (!hasSearch) return groups;
    return groups
      .map(g => ({ ...g, children: g.children.filter(c => c.label.toLowerCase().includes(q)) }))
      .filter(g => g.children.length > 0);
  }, [groups, q, hasSearch]);

  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    const allLeaves = groups.flatMap(g => g.children);
    if (allLeaves.length === 0) {
      setCounts({});
      setPending(new Set());
      return;
    }

    let cancelled = false;
    setCounts({});
    setPending(new Set(allLeaves.map(l => l.id)));

    const ownLeaves = allLeaves.filter(l => OWN_LIST_COUNTS[l.id]);
    const runOwnLists = () => Promise.all(ownLeaves.map(async leaf => {
      const src = OWN_LIST_COUNTS[leaf.id];
      let entry: CountEntry = { active: 0, inactive: 0, total: 0 };
      try {
        const rows = src.rows((await api.get(src.url)).data);
        const active = rows.filter(r => String(r?.status ?? '').toLowerCase().trim() === 'active').length;
        entry = { active, inactive: rows.length - active, total: rows.length };
      } catch {}
      if (cancelled) return;
      setCounts(prev => ({ ...prev, [leaf.id]: entry }));
      setPending(prev => { const next = new Set(prev); next.delete(leaf.id); return next; });
    }));

    const runBatch = async () => {
      try {
        const res = await api.get('/master-counts');
        if (cancelled) return true;
        const map: Record<string, { active: number; inactive: number; total: number }> = res.data || {};
        const next: Record<string, CountEntry> = {};
        for (const leaf of allLeaves) {
          if (OWN_LIST_COUNTS[leaf.id]) continue;
          const slug = leaf.id.replace('master.', '');
          const c = map[slug] || { active: 0, inactive: 0, total: 0 };
          next[leaf.id] = { active: c.active, inactive: c.inactive, total: c.total };
        }
        setCounts(prev => ({ ...prev, ...next }));
        setPending(prev => new Set([...prev].filter(id => OWN_LIST_COUNTS[id])));
        return true;
      } catch {
        return false;
      }
    };

    const runPerCardFallback = async () => {
      const POOL = 10;
      const queue = allLeaves.filter(l => !OWN_LIST_COUNTS[l.id]);
      const worker = async () => {
        while (queue.length > 0) {
          if (cancelled) return;
          const leaf = queue.shift();
          if (!leaf) return;
          try {
            const slug = leaf.id.replace('master.', '');
            const cfg = getMasterConfig(slug);
            const invUrl = INVENTORY_MASTER_LISTS[leaf.id];
            const url = invUrl ?? (cfg ? masterEndpoint(cfg) : `/master/${slug}`);
            const res = await api.get(url, invUrl ? { params: { per_page: 1000 } } : undefined);
            const records: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || []);
            let active = 0, inactive = 0;
            for (const r of records) {
              const s = String(r?.status ?? '').toLowerCase().trim();
              const isActive = s === 'active' || s === '1' || s === 'true' || s === 'yes' || s === 'enabled';
              if (isActive) active++; else inactive++;
            }
            if (cancelled) return;
            setCounts(prev => ({ ...prev, [leaf.id]: { active, inactive, total: records.length } }));
          } catch {
            if (cancelled) return;
            setCounts(prev => ({ ...prev, [leaf.id]: { active: 0, inactive: 0, total: 0 } }));
          } finally {
            if (!cancelled) {
              setPending(prev => {
                if (!prev.has(leaf.id)) return prev;
                const next = new Set(prev);
                next.delete(leaf.id);
                return next;
              });
            }
          }
        }
      };
      const workers = Array.from({ length: Math.min(POOL, allLeaves.length) }, () => worker());
      await Promise.all(workers);
    };

    void runOwnLists();
    (async () => {
      const ok = await runBatch();
      if (!ok && !cancelled) await runPerCardFallback();
    })();

    return () => { cancelled = true; };
  }, [groups]);

  const isLoadingCounts = pending.size > 0;

  const totals = useMemo(() => {
    const total = groups.reduce((s, g) => s + g.children.length, 0);
    let active = 0, inactive = 0, records = 0;
    for (const k in counts) {
      active   += counts[k].active;
      inactive += counts[k].inactive;
      records  += counts[k].total;
    }
    return { total, active, inactive, records };
  }, [groups, counts]);

  const toggle = (id: string) => setClosedGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const goTo   = (leaf: MenuChild) => navigate(INVENTORY_MASTER_PAGES[leaf.id] ?? `/master/${leaf.id.replace('master.', '')}`);

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
    <>
    <style>{`
      .master-surface { background: #ffffff; }
      [data-bs-theme="dark"] .master-surface { background: #1c2531; }
      @keyframes mc-spin { to { transform: rotate(360deg); } }

      .md-page .spi-head { gap: 14px; padding: 10px 14px 10px 20px; }
      .md-head-right { display: flex; align-items: center; gap: 10px; z-index: 1; flex: 0 1 560px; min-width: 0; justify-content: flex-end; }
      .md-page .md-head-right .spi-search { flex: 1 1 380px; max-width: 420px; height: 40px; margin: 0; background: rgba(255, 255, 255, .35); border-color: rgba(8, 145, 178, .28); backdrop-filter: blur(4px); }
      .md-page .md-head-right .spi-search:focus-within { background: rgba(255, 255, 255, .55); }
      [data-bs-theme="dark"] .md-page .md-head-right .spi-search { background: rgba(255, 255, 255, .04); border-color: rgba(34, 211, 238, .24); }
      .md-page .spi-head-btn { height: 40px; }
      .md-ana { position: relative; overflow: hidden; flex-shrink: 0; background: #fff; border: 1px solid #d6eef5; border-radius: 14px; box-shadow: 0 4px 16px rgba(6, 182, 212, .06); }
      .md-ana__strip { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; z-index: 2; background: linear-gradient(180deg, #67e8f9, #0891b2, #0e7490); }
      .md-ana__head {
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
        min-height: 48px; padding: 8px 12px 8px 20px;
        background: linear-gradient(110deg, #f0fdff 0%, #e8fbfd 30%, #d8f8fc 60%, #caf5fa 80%, #baf2f9 100%);
        border-bottom: 1px solid #a5f3fc;
      }
      .md-ana__left { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .md-ana__ico {
        width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #06b6d4, #0891b2);
        box-shadow: 0 0 0 3px rgba(6, 182, 212, .18), 0 3px 10px rgba(8, 145, 178, .32);
      }
      .md-ana__row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      .md-ana__lbl { font-size: 10px; font-weight: 800; color: #0891b2; }
      .md-ana__sep { width: 1px; height: 12px; background: #a5e8f5; display: inline-block; }
      .md-ana__title { font-size: 12px; font-weight: 800; color: #0c4a6e; letter-spacing: -.2px; }
      .md-ana__pill { font-size: 8.5px; font-weight: 700; color: #0891b2; background: rgba(6, 182, 212, .1); border: 1px solid rgba(6, 182, 212, .25); padding: 1px 7px; border-radius: 20px; }
      .md-ana__sub { font-size: 10px; font-weight: 500; color: #0e7490; margin-top: 2px; }
      .md-ana__toggle {
        width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
        color: #0891b2; background: rgba(255, 255, 255, .75); border: 1.5px solid rgba(8, 145, 178, .22);
        transition: background .15s, border-color .15s;
      }
      .md-ana__toggle:hover { background: #fff; border-color: #22d3ee; }
      .md-grp {
        position: relative; overflow: hidden; cursor: pointer; user-select: none;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        min-height: 52px; padding: 8px 12px 8px 20px;
        border: 1px solid #c7eef5; border-radius: 14px;
        background: linear-gradient(110deg, #f0fdff 0%, #e8fbfd 30%, #d8f8fc 60%, #caf5fa 80%, #baf2f9 100%);
        box-shadow: 0 2px 0 rgba(255, 255, 255, .85) inset, 0 4px 14px rgba(6, 182, 212, .10);
        transition: box-shadow .15s ease;
      }
      .md-grp:hover { box-shadow: 0 2px 0 rgba(255, 255, 255, .85) inset, 0 8px 22px rgba(6, 182, 212, .18); }
      .md-grp:focus-visible { outline: 2px solid #0891b2; outline-offset: 2px; }
      .md-grp__ico {
        width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 16px;
        background: linear-gradient(135deg, #06b6d4, #0891b2 55%, #0e7490);
        box-shadow: 0 0 0 3px rgba(6, 182, 212, .18), 0 3px 10px rgba(8, 145, 178, .32);
      }
      .md-grp__title { font-size: 13px; font-weight: 800; color: #0c4a6e; letter-spacing: -.2px; }
      .md-grp__sub { font-size: 10.5px; font-weight: 500; color: #0e7490; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .md-grp__toggle { pointer-events: none; }
      .md-grp .md-ana__left { flex: 1; }
      [data-bs-theme="dark"] .md-grp { background: linear-gradient(110deg, #0c2630 0%, #0e2e3a 60%, #103642 100%); border-color: rgba(34, 211, 238, .18); box-shadow: 0 6px 22px rgba(0, 0, 0, .35); }
      [data-bs-theme="dark"] .md-grp__title { color: #e2e8f0; }
      [data-bs-theme="dark"] .md-grp__sub { color: #7dd3fc; }
      .md-ana__body { padding: 8px 8px 8px 12px; background: linear-gradient(180deg, #f0fdff, #f4feff); }
      [data-bs-theme="dark"] .md-ana { background: #0e1b24; border-color: rgba(34, 211, 238, .18); box-shadow: 0 6px 22px rgba(0, 0, 0, .4); }
      [data-bs-theme="dark"] .md-ana__head { background: linear-gradient(110deg, #0c2630 0%, #0e2e3a 60%, #103642 100%); border-bottom-color: rgba(34, 211, 238, .18); }
      [data-bs-theme="dark"] .md-ana__title { color: #e2e8f0; }
      [data-bs-theme="dark"] .md-ana__lbl, [data-bs-theme="dark"] .md-ana__sub { color: #7dd3fc; }
      [data-bs-theme="dark"] .md-ana__toggle { background: rgba(255, 255, 255, .06); color: #67e8f9; border-color: rgba(34, 211, 238, .28); }
      [data-bs-theme="dark"] .md-ana__body { background: rgba(34, 211, 238, .03); }
      .md-cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
      @media (max-width: 1399.98px) { .md-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      @media (max-width: 1199.98px) { .md-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 991.98px)  { .md-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 575.98px)  { .md-cards { grid-template-columns: minmax(0, 1fr); } }
      .md-empty {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
        min-height: calc(100vh - 330px);
        padding: 28px 20px; text-align: center;
        background: #fff; border: 1px solid #d6eef5; border-radius: 16px;
        box-shadow: 0 4px 16px rgba(6, 182, 212, .06);
      }
      .md-empty__ico {
        width: 56px; height: 56px; border-radius: 16px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 26px; color: #0891b2;
        background: #ecfeff; border: 1px solid #cdeef4;
      }
      .md-empty__t { font-size: 14px; font-weight: 700; color: #0c4a6e; }
      .md-empty__t strong { color: #0e7490; }
      .md-empty__s { font-size: 12px; font-weight: 500; color: #5b8a99; }
      [data-bs-theme="dark"] .md-empty { background: #0e1b24; border-color: rgba(34, 211, 238, .18); box-shadow: 0 6px 22px rgba(0, 0, 0, .4); }
      [data-bs-theme="dark"] .md-empty__ico { color: #67e8f9; background: rgba(34, 211, 238, .10); border-color: rgba(34, 211, 238, .24); }
      [data-bs-theme="dark"] .md-empty__t { color: #e2e8f0; }
      [data-bs-theme="dark"] .md-empty__t strong { color: #67e8f9; }
      [data-bs-theme="dark"] .md-empty__s { color: #94a3b8; }
      .md-page .row { --vz-gutter-x: 8px; --vz-gutter-y: 8px; --bs-gutter-x: 8px; --bs-gutter-y: 8px; }
      @media (max-width: 768px) {
        .md-page .spi-head { flex-direction: column; align-items: stretch; }
        .md-head-right { flex-wrap: wrap; flex-basis: auto; }
      }
    `}</style>
    <div className="spi-root ord-page whm-page mp-inv md-page">
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><i className="ri-stack-line" style={{ fontSize: 18 }} /></div>
          <div className="min-w-0">
            <div className="spi-head-title">Master Control Center</div>
            <div className="spi-head-sub">Manage every master — organisation, geography, HRMS, sales, P2P, product, shipment and inventory.</div>
          </div>
        </div>
        <div className="md-head-right">
          <div className="spi-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
              placeholder="Search masters — e.g. Company, GST, Bank…"
              aria-label="Search masters"
            />
            <SearchClear show={search} onClear={() => setSearch('')} />
          </div>
        </div>
      </div>

      <div className="md-ana">
        <div className="md-ana__strip" />
        <div className="md-ana__head">
          <div className="md-ana__left">
            <div className="md-ana__ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
            </div>
            <div>
              <div className="md-ana__row">
                <span className="md-ana__lbl">Master Control Center</span>
                <span className="md-ana__sep" />
                <span className="md-ana__title">Analytics View</span>
                <span className="md-ana__pill">{STAT_CARDS.length} metrics</span>
              </div>
              <div className="md-ana__sub">Live snapshot of masters and their active and inactive records.</div>
            </div>
          </div>
          <button
            type="button"
            className="md-ana__toggle"
            onClick={() => setAnaOpen(o => !o)}
            aria-label={anaOpen ? 'Collapse analytics' : 'Expand analytics'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: anaOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        </div>
        {anaOpen && (
          <div className="md-ana__body">
           <Row className="g-3">
          {STAT_CARDS.map((sc, i) => (
            <Col key={sc.label} xl={3} md={6} xs={12}>
              <div
                className="master-surface stat-card mp-kpi-tile"
                style={{
                  borderRadius: 14,
                  border: '1px solid var(--vz-border-color)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                  position: 'relative',
                  padding: '16px 18px 14px',
                  transition: 'all 0.25s ease',
                  cursor: 'pointer'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: MD_TEAL_BAR
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <p className="mp-kpi-tile__label" style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      {sc.label}

                      {isLoadingCounts && i !== 0 && (
                        <span
                          aria-label="loading"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            border: '1.5px solid var(--vz-secondary-color)',
                            borderTopColor: 'transparent',
                            animation: 'mc-spin 0.7s linear infinite',
                            display: 'inline-block',
                          }}
                        />
                      )}
                    </p>

                    <div className="mp-kpi-tile__value" style={{
                      fontSize: 26,
                      fontWeight: 800,
                      lineHeight: 1
                    }}>
                      {statValues[i].toLocaleString()}
                    </div>
                  </div>

                  <div
                    className="icon-box"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: MD_TEAL_ICON,
                      flexShrink: 0,
                      boxShadow: '0 0 0 3px rgba(6,182,212,.18), 0 4px 12px rgba(8,145,178,.35)',
                      transition: 'transform 0.25s ease'
                    }}
                  >
                    <i className={sc.icon} style={{ fontSize: 20, color: '#fff' }} />
                  </div>
                </div>
              </div>
            </Col>
          ))}
        </Row>
          </div>
        )}
      </div>

      {hasSearch && filteredGroups.length === 0 && (
        <div className="md-empty">
          <span className="md-empty__ico"><i className="ri-search-eye-line" /></span>
          <span className="md-empty__t">No masters match "<strong>{search}</strong>"</span>
          <span className="md-empty__s">Try another name, e.g. Company, GST or Bank.</span>
        </div>
      )}

      {filteredGroups.map(group => {
        const s = CATEGORY_STYLES[group.id] || { color: '#405189', icon: 'ri-folder-line', gradient: 'linear-gradient(135deg,#405189,#6691e7)' };
        const isCollapsed = hasSearch ? false : closedGroups.has(group.id);

        return (
          <div key={group.id}>

            <div
              className="md-grp"
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(group.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(group.id); } }}
            >
              <span className="md-ana__strip" />
              <div className="md-ana__left">
                <div className="md-grp__ico"><i className={s.icon} /></div>
                <div className="min-w-0">
                  <div className="md-ana__row">
                    <span className="md-ana__lbl">Masters</span>
                    <span className="md-ana__sep" />
                    <span className="md-grp__title">{group.label}</span>
                    <span className="md-ana__pill">{group.children.length} {group.children.length === 1 ? 'master' : 'masters'}</span>
                  </div>
                  <div className="md-grp__sub">{GROUP_SUMMARIES[group.id] ?? group.children.map(c => c.label).join(', ')}</div>
                </div>
              </div>
              <span className="md-ana__toggle md-grp__toggle" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
              </span>
            </div>

            {!isCollapsed && (
              <div className="md-cards">
                {group.children.map(leaf => (
                  <div key={leaf.id}>
                    <MasterCard
                      leaf={leaf}
                      s={s}
                      onClick={() => goTo(leaf)}
                      count={counts[leaf.id]}
                      loading={pending.has(leaf.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}

function MasterCard({ leaf, s, onClick, count, loading }: { leaf: MenuChild; s: CategoryStyle; onClick: () => void; count?: CountEntry; loading?: boolean }) {
  const activeCount = count?.active ?? 0;
  const inactiveCount = count?.inactive ?? 0;
  const totalCount = count?.total ?? 0;
  const headerStatus: 'active' | 'inactive' | 'empty' | 'loading' =
    loading && !count ? 'loading'
    : totalCount === 0 ? 'empty'
    : activeCount > 0 ? 'active'
    : 'inactive';
  return (
    <div
      onClick={onClick}
      className="master-surface"
      style={{ borderRadius: 12, border: '1px solid var(--vz-border-color)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease', display: 'flex', flexDirection: 'column', height: '100%', padding: '15px 15px 13px', position: 'relative', overflow: 'hidden' }}
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
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 3, background: s.gradient }} />

      <div style={{ position: 'absolute', top: -36, right: -36, width: 110, height: 110, borderRadius: '50%', background: `radial-gradient(circle,${s.color}10 0%,transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: s.gradient, boxShadow: `0 3px 10px ${s.color}33`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className={leafIcon(leaf.icon)} style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <h6 style={{ margin: 0, fontWeight: 700, fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {leaf.label}
          </h6>
        </div>
        {(() => {
          const cfg = headerStatus === 'active'
            ? { bg: '#0ab39c18', fg: '#0ab39c', dot: '#0ab39c', text: 'Active' }
            : headerStatus === 'inactive'
              ? { bg: '#f0654818', fg: '#f06548', dot: '#f06548', text: 'Inactive' }
              : headerStatus === 'loading'
                ? { bg: 'var(--vz-secondary-bg)', fg: 'var(--vz-secondary-color)', dot: 'var(--vz-secondary-color)', text: 'Loading' }
                : { bg: 'var(--vz-secondary-bg)', fg: 'var(--vz-secondary-color)', dot: 'var(--vz-secondary-color)', text: 'Empty' };
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.fg}30`, borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />
              {cfg.text}
            </span>
          );
        })()}
      </div>

      <p style={{ margin: '-3px 0 12px 0', paddingLeft: 46, position: 'relative', fontSize: 11.5, color: 'var(--vz-secondary-color)', lineHeight: 1.55, flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {leafDescription(leaf)}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--vz-border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--vz-secondary-color)' }}>Active</span>
            <span style={{ background: '#0ab39c18', color: '#0ab39c', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
              {loading && !count ? '…' : activeCount}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--vz-secondary-color)' }}>Inactive</span>
            <span style={{ background: '#f0654818', color: '#f06548', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
              {loading && !count ? '…' : inactiveCount}
            </span>
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.color + '15', color: s.color, border: `1px solid ${s.color}30`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
          Manage <i className="ri-arrow-right-line" style={{ fontSize: 11 }} />
        </span>
      </div>
    </div>
  );
}
