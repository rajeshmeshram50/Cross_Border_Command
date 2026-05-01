import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col } from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import { HR_GROUPS } from '../constants';
import type { MenuChild, MenuGroup } from '../types';

// Maps HR leaf ids to the route they should open. Mirrors `hrLeafLink` in
// LayoutMenuData.tsx — kept in sync here so the overview cards and the
// sidebar both navigate to the same destination. Leaves omitted from this
// map render as disabled "Coming Soon" cards.
const HR_LEAF_ROUTES: Record<string, string> = {
  'hr.employee':    '/hr/employees',
  'hr.recruitment': '/hr/recruitment',
  'hr.exit':        '/hr/exit-management',
  'hr.onboarding':  '/hr/employee-onboarding',
};

interface CategoryStyle { color: string; icon: string; gradient: string; }

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  'hr.command':    { color: '#405189', icon: 'ri-dashboard-3-line',  gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  'hr.core':       { color: '#0ab39c', icon: 'ri-team-line',         gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)' },
  'hr.operations': { color: '#f7b84b', icon: 'ri-briefcase-4-line',  gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' },
  'hr.time_pay':   { color: '#7c5cfc', icon: 'ri-time-line',         gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)' },
  'hr.documents':  { color: '#299cdb', icon: 'ri-file-list-3-line',  gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' },
  'hr.ai':         { color: '#e83e8c', icon: 'ri-sparkling-line',    gradient: 'linear-gradient(135deg,#e83e8c,#ef79b0)' },
};

const LEAF_ICONS: Record<string, string> = {
  LayoutGrid: 'ri-dashboard-2-line', ClipboardCheck: 'ri-clipboard-line',
  User: 'ri-user-3-line', Building2: 'ri-building-line',
  BadgeCheck: 'ri-verified-badge-line', UserCog: 'ri-user-settings-line',
  TrendingUp: 'ri-line-chart-line',
  UserPlus: 'ri-user-add-line', UserCheck: 'ri-user-follow-line', LogOut: 'ri-logout-box-line',
  IndianRupee: 'ri-money-rupee-circle-line', Calculator: 'ri-calculator-line',
  CalendarCheck: 'ri-calendar-check-line', CalendarOff: 'ri-calendar-close-line', Receipt: 'ri-receipt-line',
  FileText: 'ri-file-text-line', BookOpen: 'ri-book-open-line',
  Megaphone: 'ri-megaphone-line', FolderOpen: 'ri-folder-open-line',
  FileBadge: 'ri-file-shield-2-line', Settings2: 'ri-settings-3-line', PlusSquare: 'ri-add-box-line',
  BarChart3: 'ri-bar-chart-2-line', Sparkles: 'ri-sparkling-line',
};
const leafIcon = (name?: string) => (name && LEAF_ICONS[name]) || 'ri-file-list-3-line';

const LEAF_DESCRIPTIONS: Record<string, string> = {
  'hr.overview':          'Live HRMS dashboard — headcount, attrition & key trends at a glance',
  'hr.pip':               'Performance Improvement Plans for underperforming employees',
  'hr.employee':          'Master employee record — personal, official & contract data',
  'hr.department':        'Departments mapped to org chart and approval routing',
  'hr.designation':       'Job titles shown on letters, profiles & HR records',
  'hr.role':              'User roles controlling module access permissions',
  'hr.kpis':              'KPI templates assigned to roles & employees for appraisals',
  'hr.recruitment':       'Job openings, candidate pipeline & interview tracking',
  'hr.onboarding':        'Document collection, induction & day-1 readiness checklist',
  'hr.exit':              'Resignation, F&F settlement & clearance workflow',
  'hr.payroll':           'Salary structure, monthly run, payslips & bank advice',
  'hr.calculation_master':'Earning, deduction & contribution formula library',
  'hr.attendance':        'Daily attendance, biometric sync & late-mark policies',
  'hr.leave':             'Leave types, balances, approvals & holiday calendar',
  'hr.expense':           'Expense claims, receipts & multi-stage approvals',
  'hr.doc_dashboard':     'Central view of all HR-issued documents and statuses',
  'hr.templates':         'Reusable letter templates — offer, appointment, increment',
  'hr.policies':          'Company policies — published, acknowledged & versioned',
  'hr.broadcast':         'Company-wide announcements with read receipts',
  'hr.doc_category':      'Group HR documents into categories for filing & search',
  'hr.doc_types':         'Document types attachable to employee profiles',
  'hr.doc_gen_rules':     'Auto-generation rules for letters & merge fields',
  'hr.custom_fields':     'Configurable fields added to HR forms & records',
  'hr.reports':           'Pre-built HR reports — headcount, payroll, attendance',
  'hr.ai_master':         'AI assistants for HR — drafting, summarising, insights',
};
const leafDescription = (leaf: MenuChild) =>
  LEAF_DESCRIPTIONS[leaf.id] || `Manage ${leaf.label.toLowerCase()} records`;

const STAT_CARDS = [
  { label: 'Total Modules',  icon: 'ri-stack-line',           gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { label: 'Categories',     icon: 'ri-folder-line',          gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { label: 'Active Records', icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#10b981,#34d399)' },
  { label: 'Coming Soon',    icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#f1963b)' },
  { label: 'Time & Pay',     icon: 'ri-money-rupee-circle-line', gradient: 'linear-gradient(135deg,#7c5cfc,#a78bfa)' },
  { label: 'Documents',      icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg,#e83e8c,#ef79b0)' },
];

export default function HrDashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};

  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const groups = useMemo<MenuGroup[]>(() => {
    if (isSuperAdmin) return HR_GROUPS;
    return HR_GROUPS
      .map(g => ({ ...g, children: g.children.filter(c => !!perms[c.id]?.can_view) }))
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

  const totals = useMemo(() => {
    const total = groups.reduce((s, g) => s + g.children.length, 0);
    const findCount = (id: string) => groups.find(g => g.id === id)?.children.length ?? 0;
    return {
      total,
      categories: groups.length,
      active: 0,
      soon: total,
      timePay: findCount('hr.time_pay'),
      documents: findCount('hr.documents'),
    };
  }, [groups]);

  const toggle = (id: string) => setClosedGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (groups.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340 }}>
        <div style={{ background: 'var(--vz-card-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '48px 40px', textAlign: 'center', maxWidth: 460, boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#f7b84b18', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <i className="ri-lock-2-line" style={{ fontSize: 28, color: '#f7b84b' }} />
          </div>
          <h5 style={{ fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', marginBottom: 8 }}>No HR Access</h5>
          <p style={{ color: 'var(--vz-secondary-color)', fontSize: 13, margin: 0 }}>
            Your account does not have permission for any HR module. Ask your administrator to grant access.
          </p>
        </div>
      </div>
    );
  }

  const statValues = [totals.total, totals.categories, totals.active, totals.soon, totals.timePay, totals.documents];

  return (
    <>
    <style>{`
      .hr-surface { background: #ffffff; }
      [data-bs-theme="dark"] .hr-surface { background: #1c2531; }

      /* KPI cards — hover lift + icon scale, mirrors the onboarding/admin dashboards */
      .hr-kpi-card { cursor: pointer; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
      .hr-kpi-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(18,38,63,0.12) !important; border-color: rgba(124,92,252,0.30) !important; }
      .hr-kpi-card .hr-kpi-icon { transition: transform .25s ease; }
      .hr-kpi-card:hover .hr-kpi-icon { transform: scale(1.08); }
      [data-bs-theme="dark"] .hr-kpi-card:hover { box-shadow: 0 12px 32px rgba(0,0,0,0.45) !important; }
    `}</style>
    <div>
      {/* ── Page Header ── */}
      <div className="page-title-box d-sm-flex align-items-center justify-content-between mb-2">
        <div>
          <h4 className="mb-0">Human Resources Center</h4>
          <p className="text-muted fs-12 mb-0 mt-1">{totals.total} modules across {totals.categories} categories</p>
        </div>
        <ol className="breadcrumb m-0 fs-12">
          <li className="breadcrumb-item"><a href="#">HR</a></li>
          <li className="breadcrumb-item active">Overview</li>
        </ol>
      </div>

      {/* ── KPI Stat Cards ── */}
      <Row className="g-3 mb-4">
        {STAT_CARDS.map((sc, i) => (
          <Col key={sc.label} xl={2} md={4} sm={6} xs={12}>
            <div className="hr-surface hr-kpi-card" style={{ borderRadius: 14, border: '1px solid var(--vz-border-color)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', position: 'relative', padding: '16px 18px 14px', height: '100%' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sc.gradient }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                    {sc.label}
                  </p>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>
                    {statValues[i].toLocaleString()}
                  </div>
                </div>
                <div className="hr-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sc.gradient, flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                  <i className={sc.icon} style={{ fontSize: 20, color: '#fff' }} />
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── Search Bar ── */}
      <div className="hr-surface" style={{ border: '1px solid var(--vz-border-color)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="ri-search-line" style={{ color: 'var(--vz-secondary-color)', fontSize: 17 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search HR modules — e.g. Payroll, Attendance, Leave, Recruitment…"
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
          <span style={{ color: 'var(--vz-secondary-color)', fontSize: 13 }}>No HR modules match "<strong style={{ color: 'var(--vz-body-color)' }}>{search}</strong>"</span>
        </div>
      )}

      {/* ── Category Sections ── */}
      {filteredGroups.map(group => {
        const s = CATEGORY_STYLES[group.id] || { color: '#405189', icon: 'ri-folder-line', gradient: 'linear-gradient(135deg,#405189,#6691e7)' };
        const isCollapsed = hasSearch ? false : closedGroups.has(group.id);

        return (
          <div key={group.id} style={{ marginBottom: 12 }}>

            {/* ── Category Header — single white row, clickable to toggle ── */}
            <div
              className="hr-surface"
              style={{
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
              <div style={{ width: 4, height: 28, borderRadius: 4, background: s.gradient, flexShrink: 0 }} />

              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={s.icon} style={{ color: s.color, fontSize: 15 }} />
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.2 }}>
                  {group.label}
                </span>
                <span style={{ background: s.gradient, color: '#fff', borderRadius: 20, padding: '1px 9px', fontSize: 10.5, fontWeight: 700, flexShrink: 0, lineHeight: '18px', boxShadow: `0 2px 6px ${s.color}40` }}>
                  {group.children.length}
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(group.id); }}
                aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28,
                  background: 'transparent',
                  color: s.color,
                  border: 'none',
                  cursor: 'pointer', outline: 'none', padding: 0,
                  transition: 'transform .2s ease',
                  transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  flexShrink: 0,
                }}
              >
                <i className="ri-arrow-down-s-fill" style={{ fontSize: 22 }} />
              </button>
            </div>

            {/* ── Expanded HR cards ── */}
            {!isCollapsed && (
              <Row className="g-3" style={{ marginTop: 10 }}>
                {group.children.map(leaf => (
                  <Col key={leaf.id} xl={3} lg={4} md={6}>
                    <HrCard leaf={leaf} s={s} perms={perms} isSuperAdmin={!!isSuperAdmin} />
                  </Col>
                ))}
              </Row>
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}

function HrCard({ leaf, s, perms, isSuperAdmin }: { leaf: MenuChild; s: CategoryStyle; perms: Record<string, any>; isSuperAdmin: boolean }) {
  const navigate = useNavigate();
  const p = perms[leaf.id] || {};
  const flags = ['view', 'add', 'edit', 'delete'].filter(f => (p as any)[`can_${f}`]);
  const route = HR_LEAF_ROUTES[leaf.id];
  const isLive = !!route;
  // Live cards require either super admin or an explicit can_view permission
  // for that leaf — mirrors the sidebar's permission gating so the overview
  // never opens a page the user can't access.
  const canOpen = isLive && (isSuperAdmin || !!(p as any).can_view);
  return (
    <div
      className="hr-surface"
      title={canOpen ? `Open ${leaf.label}` : isLive ? 'You don’t have permission to view this' : 'HR pages coming soon'}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? () => navigate(route!) : undefined}
      onKeyDown={canOpen ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(route!); }
      } : undefined}
      style={{
        borderRadius: 12,
        border: '1px solid var(--vz-border-color)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        cursor: canOpen ? 'pointer' : 'not-allowed',
        transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease',
        display: 'flex', flexDirection: 'column', height: '100%',
        padding: '15px 15px 13px', position: 'relative', overflow: 'hidden',
      }}
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
        {isLive ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0ab39c18', color: '#0ab39c', border: '1px solid #0ab39c30', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0ab39c' }} />
            Live
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f7b84b18', color: '#f7b84b', border: '1px solid #f7b84b30', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f7b84b' }} />
            Coming Soon
          </span>
        )}
      </div>

      {/* Row 2: Description */}
      <p style={{ margin: '0 0 12px 0', paddingLeft: 46, fontSize: 11.5, color: 'var(--vz-secondary-color)', lineHeight: 1.55, flexGrow: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {leafDescription(leaf)}
      </p>

      {/* Row 3: Permission flags + Manage (active when route is wired up) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--vz-border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {!isSuperAdmin && flags.length > 0 ? (
            flags.map(f => (
              <span
                key={f}
                style={{ background: s.color + '15', color: s.color, borderRadius: 20, padding: '1px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                {f}
              </span>
            ))
          ) : (
            <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>{isLive ? 'Click to open' : 'No data yet'}</span>
          )}
        </div>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: canOpen ? s.gradient : 'var(--vz-secondary-bg)',
            color: canOpen ? '#fff' : 'var(--vz-secondary-color)',
            border: canOpen ? 'none' : '1px solid var(--vz-border-color)',
            borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700,
            boxShadow: canOpen ? `0 3px 8px ${s.color}33` : 'none',
            opacity: canOpen ? 1 : 0.7,
          }}
        >
          {canOpen ? 'Open' : 'Manage'} <i className="ri-arrow-right-line" style={{ fontSize: 11 }} />
        </span>
      </div>
    </div>
  );
}
