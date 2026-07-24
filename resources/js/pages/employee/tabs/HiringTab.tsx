import { useEffect, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { Shimmer, ShimmerTableRows } from '../../../components/ui/Shimmer';
import WorklistPager from '../../../components/ui/WorklistPager';
import { useEmployeeProfile } from '../EmployeeProfileContext';

export default function HiringTab() {
  const { hiringRequests, hiringLoading, setRaiseHiringOpen, setHiringEditing, setHiringViewing, authUser, teamSize } = useEmployeeProfile();

  // Pagination — mirrors the Employee Onboarding footer (WorklistPager with a
  // rows-per-page dropdown, default 10). Keeps the table consistent with the
  // other modules that already show a standard footer.
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const pageCount = Math.max(1, Math.ceil(hiringRequests.length / rowsPerPage));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const sliceFrom = (safePage - 1) * rowsPerPage;
  const visibleRequests = hiringRequests.slice(sliceFrom, sliceFrom + rowsPerPage);
  // Snap back to page 1 when the page size changes or the list shrinks below
  // the current page so the footer never points at an empty slice.
  useEffect(() => { setPage(1); }, [rowsPerPage, hiringRequests.length]);

        const stats = {
          total:     hiringRequests.length,
          draft:     hiringRequests.filter((r: any) => r.status === 'Draft').length,
          submitted: hiringRequests.filter((r: any) => r.status === 'Submitted').length,
          critical:  hiringRequests.filter((r: any) => r.urgency === 'Critical').length,
        };
        const fmtDate = (raw: any): string => {
          if (!raw) return '—';
          const d = new Date(String(raw));
          if (Number.isNaN(d.getTime())) return '—';
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        };
        const urgencyTone = (u?: string) => {
          switch ((u || '').toLowerCase()) {
            case 'critical': return { bg: 'rgba(239,68,68,0.14)',  fg: '#b91c1c' };
            case 'high':     return { bg: 'rgba(249,115,22,0.14)', fg: '#c2410c' };
            case 'medium':   return { bg: 'rgba(245,158,11,0.14)', fg: '#92400e' };
            default:         return { bg: 'rgba(16,185,129,0.14)', fg: '#047857' };
          }
        };
        const statusTone = (s?: string) => {
          switch ((s || '').toLowerCase()) {
            case 'draft':     return { bg: 'rgba(115,115,115,0.14)', fg: '#525252' };
            case 'submitted': return { bg: 'rgba(124,58,237,0.14)',  fg: '#6d28d9' };
            case 'approved':  return { bg: 'rgba(16,185,129,0.14)',  fg: '#047857' };
            case 'rejected':  return { bg: 'rgba(239,68,68,0.14)',   fg: '#b91c1c' };
            default:          return { bg: 'rgba(99,102,241,0.14)',  fg: '#4338ca' };
          }
        };
        return (
          <div className="ep-tab-fill">
          <Card className="mb-3 border-0 ht-card h-100">
            <CardBody>
              {/* Header — title + Raise CTA + View All */}
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                <div className="d-flex align-items-center gap-2">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3 ht-header-icon">
                    <i className="ri-user-add-line ep-fs-18" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold ep-fs-14">Hiring Requests</h6>
                    <small className="text-muted ep-fs-115">
                      {(() => {
                        const seesAll = ['branch_user', 'client_admin', 'super_admin']
                          .includes(String(authUser?.user_type || ''));
                        if (seesAll) return `All hiring requests across the organisation · ${hiringRequests.length} total`;
                        return `Raise hires for your team · ${teamSize} direct report${teamSize === 1 ? '' : 's'}`;
                      })()}
                    </small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn d-inline-flex align-items-center gap-2 fw-semibold ht-raise-btn"
                    onClick={() => { setHiringEditing(null); setRaiseHiringOpen(true); }}
                  >
                    <i className="ri-file-add-line" /> Raise Hiring Request
                  </button>
                </div>
              </div>

              {/* KPI strip — matches the recruitment KPI shape (top accent
                  strip + label/number + iconTile). Scoped to this manager's
                  own raised requests. */}
              <Row className="g-3 mb-3 align-items-stretch">
                {[
                  { label: 'Total',     value: stats.total,     icon: 'ri-file-list-3-line', accent: 'linear-gradient(135deg,#4338ca 0%,#6366f1 60%,#818cf8 100%)', deep: '#4338ca' },
                  { label: 'Draft',     value: stats.draft,     icon: 'ri-draft-line',       accent: 'linear-gradient(135deg,#525252 0%,#737373 60%,#a3a3a3 100%)', deep: '#525252' },
                  { label: 'Submitted', value: stats.submitted, icon: 'ri-send-plane-line',  accent: 'linear-gradient(135deg,#7c3aed 0%,#9333ea 60%,#a855f7 100%)', deep: '#7c3aed' },
                  { label: 'Critical',  value: stats.critical,  icon: 'ri-flashlight-line',  accent: 'linear-gradient(135deg,#be123c 0%,#ef4444 60%,#fb7185 100%)', deep: '#be123c' },
                ].map(k => (
                  <Col key={k.label} xl={3} md={6} sm={6} xs={12}>
                    <div className="ep-hr-kpi ht-kpi-tile">
                      <span className="ht-kpi-accent" style={{ ['--ht-accent' as any]: k.accent }} />
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div className="min-w-0">
                          <p className="mb-1 text-uppercase fw-semibold ht-kpi-label">
                            {k.label}
                          </p>
                          {hiringLoading
                            ? <Shimmer height={26} width={48} />
                            : <h3 className="mb-0 fw-bold ht-kpi-number" style={{ ['--ht-deep' as any]: k.deep }}>{k.value}</h3>}
                        </div>
                        <span className="ep-hr-kpi-icon d-inline-flex align-items-center justify-content-center rounded-3 ht-kpi-icon"
                          style={{ ['--ht-accent' as any]: k.accent }}>
                          <i className={`${k.icon} ep-fs-18`} />
                        </span>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
              <style>{`
                .ep-hr-kpi:hover {
                  transform: translateY(-2px);
                  box-shadow: 0 12px 26px rgba(99,102,241,0.16), 0 4px 10px rgba(15,23,42,0.08);
                  border-color: rgba(99,102,241,0.40) !important;
                }
                .ep-hr-kpi:hover .ep-hr-kpi-icon {
                  transform: scale(1.06) rotate(-2deg);
                }
                [data-bs-theme="dark"] .ep-hr-kpi:hover {
                  box-shadow: 0 12px 26px rgba(124,92,252,0.22), 0 4px 10px rgba(0,0,0,0.40);
                  border-color: rgba(124,92,252,0.50) !important;
                }
              `}</style>

              {/* Inline list — compact 5-row preview of recent requests.
                  Full filtering / pagination lives behind View All Requests. */}
              <div className="table-responsive border rounded">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Code</th>
                      <th>Position</th>
                      <th>Department</th>
                      <th>Urgency</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hiringLoading ? (
                      <ShimmerTableRows rows={4} cols={7} keyPrefix="hr-req-shim" />
                    ) : hiringRequests.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-4 text-muted ep-fs-125">
                          <i className="ri-inbox-line ht-empty-icon" />
                          You haven't raised any hiring requests yet.
                        </td>
                      </tr>
                    ) : visibleRequests.map((r: any) => {
                      const uTone = urgencyTone(r.urgency);
                    
                      const displayStatus = r._hasRecruitment ? 'Recruitment Created' : (r.status || '—');
                      const sTone = r._hasRecruitment
                        ? { bg: 'rgba(16,185,129,0.16)', fg: '#047857' }
                        : statusTone(r.status);
                      return (
                        <tr key={r.id}>
                          <td className="ps-3 fw-semibold ep-fs-12">
                            <span className="ht-code-chip">{r.code || `HR-${r.id}`}</span>
                          </td>
                          <td className="ep-fs-125">{r.position || r.job_role || r.role_name || '—'}</td>
                          <td className="ht-cell-muted">{r.department?.name || r.department_name || '—'}</td>
                          <td>
                            <span className="ht-tone-chip" style={{ ['--ht-bg' as any]: uTone.bg, ['--ht-fg' as any]: uTone.fg }}>{r.urgency || '—'}</span>
                          </td>
                          <td>
                            <span className="ht-status-chip" style={{ ['--ht-bg' as any]: sTone.bg, ['--ht-fg' as any]: sTone.fg }}>
                              {r._hasRecruitment && <i className="ri-checkbox-circle-fill ep-fs-11" />}
                              {displayStatus}
                            </span>
                          </td>
                          <td className="ht-cell-date">
                            {fmtDate(r.submittedAt || r.created_at)}
                          </td>
                          <td className="text-center">
                            {/* Every request can be viewed (read-only). Draft
                                rows can additionally be reopened + edited before
                                submitting to HR. */}
                            <div className="d-inline-flex align-items-center justify-content-center gap-1">
                              <button
                                type="button"
                                className="btn btn-sm d-inline-flex align-items-center justify-content-center ht-edit-btn"
                                data-tooltip="View"
                                aria-label="View hiring request"
                                onClick={() => setHiringViewing(r)}
                              >
                                <i className="ri-eye-line" />
                              </button>
                              {r.status === 'Draft' && !r._hasRecruitment && (
                                <button
                                  type="button"
                                  className="btn btn-sm d-inline-flex align-items-center justify-content-center ht-edit-btn"
                                  data-tooltip="Edit Draft"
                                  aria-label="Edit Draft"
                                  onClick={() => { setHiringEditing({ ...r, _raw: r }); setRaiseHiringOpen(true); }}
                                >
                                  <i className="ri-pencil-line" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!hiringLoading && hiringRequests.length > 0 && (
                <WorklistPager
                  className="mt-2"
                  total={hiringRequests.length}
                  page={safePage}
                  pageSize={rowsPerPage}
                  onPage={p => setPage(Math.min(Math.max(1, p), pageCount))}
                  onPageSize={setRowsPerPage}
                  pageSizeOptions={[5, 10, 25, 50, 100]}
                />
              )}
            </CardBody>
          </Card>
          </div>
        );
}
