import { useMemo } from 'react';
import { Card, Col, Row } from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import { HR_GROUPS } from '../constants';

// Map the lucide-style icon names used in HR_GROUPS to RemixIcon classes
// (matches the convention used elsewhere — e.g. MasterDashboard).
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

const CATEGORY_STYLES: Record<string, { color: string; gradient: string; icon: string }> = {
  'hr.command':   { color: '#405189', gradient: 'linear-gradient(135deg,#405189,#6691e7)', icon: 'ri-dashboard-3-line' },
  'hr.core':      { color: '#0ab39c', gradient: 'linear-gradient(135deg,#0ab39c,#3dd6c3)', icon: 'ri-team-line' },
  'hr.time_pay':  { color: '#7c5cfc', gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)', icon: 'ri-time-line' },
  'hr.documents': { color: '#299cdb', gradient: 'linear-gradient(135deg,#299cdb,#63bcec)', icon: 'ri-file-list-3-line' },
};

export default function HrDashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perms = user?.permissions || {};

  // Filter each group to only the leaves the user can view; hide the whole
  // group if nothing remains. Super admin sees everything.
  const visibleGroups = useMemo(() => {
    return HR_GROUPS
      .map((g) => ({
        ...g,
        children: g.children.filter((c) => isSuperAdmin || perms[c.id]?.can_view),
      }))
      .filter((g) => g.children.length > 0);
  }, [isSuperAdmin, perms]);

  const totalLeaves = visibleGroups.reduce((sum, g) => sum + g.children.length, 0);

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h4 className="fw-bold mb-1" style={{ letterSpacing: '-0.01em' }}>
            <i className="ri-team-line me-2 text-primary"></i>
            Human Resources
          </h4>
          <p className="text-muted mb-0" style={{ fontSize: 13 }}>
            {totalLeaves} module{totalLeaves === 1 ? '' : 's'} available across {visibleGroups.length} categor{visibleGroups.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
      </div>

      {visibleGroups.length === 0 && (
        <Card className="text-center py-5" style={{ borderRadius: 16 }}>
          <div
            className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning"
            style={{ width: 80, height: 80 }}
          >
            <i className="ri-lock-2-line fs-32"></i>
          </div>
          <h5 className="fw-bold mb-2">No HR Modules Available</h5>
          <p className="text-muted mb-0" style={{ maxWidth: 460, marginInline: 'auto', fontSize: 13 }}>
            You don't have permission to view any HR module. Contact your administrator to request access.
          </p>
        </Card>
      )}

      <Row className="g-3">
        {visibleGroups.map((g) => {
          const style = CATEGORY_STYLES[g.id] || { color: '#405189', gradient: 'linear-gradient(135deg,#405189,#6691e7)', icon: 'ri-folder-line' };
          return (
            <Col xl={6} lg={6} md={12} key={g.id}>
              <Card className="h-100" style={{ borderRadius: 16, border: '1px solid var(--vz-border-color)', overflow: 'hidden' }}>
                {/* Header */}
                <div className="d-flex align-items-center gap-3 p-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                  <div
                    className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                    style={{ width: 44, height: 44, background: style.gradient }}
                  >
                    <i className={style.icon} style={{ fontSize: 22, color: '#fff' }}></i>
                  </div>
                  <div className="flex-grow-1 min-w-0">
                    <h6 className="mb-0 fw-bold text-truncate" style={{ fontSize: 14 }}>{g.label}</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>
                      {g.children.length} module{g.children.length === 1 ? '' : 's'}
                    </small>
                  </div>
                </div>

                {/* Leaves */}
                <div className="p-2">
                  {g.children.map((leaf) => {
                    const p = perms[leaf.id] || {};
                    const flags = ['view', 'add', 'edit', 'delete'].filter(f => (p as any)[`can_${f}`]);
                    return (
                      <div
                        key={leaf.id}
                        className="d-flex align-items-center gap-2 px-2 py-2 rounded-2"
                        style={{ borderBottom: '1px dashed var(--vz-border-color)', cursor: 'not-allowed', opacity: 0.85 }}
                        title="HR pages coming soon"
                      >
                        <i className={leafIcon(leaf.icon)} style={{ fontSize: 16, color: style.color, width: 22 }}></i>
                        <div className="flex-grow-1 min-w-0">
                          <div className="text-truncate" style={{ fontSize: 13, fontWeight: 500 }}>{leaf.label}</div>
                          {!isSuperAdmin && flags.length > 0 && (
                            <div className="d-flex gap-1 mt-1">
                              {flags.map(f => (
                                <span
                                  key={f}
                                  className="badge text-uppercase"
                                  style={{ background: style.color + '15', color: style.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="badge bg-light text-muted" style={{ fontSize: 9 }}>SOON</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </>
  );
}
