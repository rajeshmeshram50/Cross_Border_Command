import { Card, CardBody, Col, Row } from 'reactstrap';
import { Shimmer } from '../../../components/ui/Shimmer';
import DataTable, { ActionIcon, type DataTableColumn } from '../../../components/ui/DataTable';
import { useEmployeeProfile } from '../EmployeeProfileContext';

export default function HiringTab() {
  const { hiringRequests, hiringLoading, setRaiseHiringOpen, setHiringEditing, setHiringViewing, authUser, teamSize } = useEmployeeProfile();

  // Paging, sorting and the footer all come from the shared DataTable now —
  // no local page / rows-per-page state to keep in sync.

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

        /* Column defs for the shared DataTable. Cell markup is lifted verbatim
           from the old hand-rolled <table>, so the chips/buttons look exactly
           as before — only the surrounding chrome is now the shared one. */
        const hiringColumns: DataTableColumn<any>[] = [
          {
            header: 'Code',
            accessorKey: 'code',
            meta: { width: '12%' },
            cell: info => {
              const r = info.row.original;
              return <span className="ht-code-chip">{r.code || `HR-${r.id}`}</span>;
            },
          },
          {
            header: 'Position',
            id: 'position',
            accessorFn: (r: any) => r.position || r.job_role || r.role_name || '',
            meta: { width: '20%', wrap: true },
            cell: info => <span className="ep-fs-125">{String(info.getValue() || '—')}</span>,
          },
          {
            header: 'Department',
            id: 'department',
            accessorFn: (r: any) => r.department?.name || r.department_name || '',
            meta: { width: '16%' },
            cell: info => <span className="ht-cell-muted">{String(info.getValue() || '—')}</span>,
          },
          {
            header: 'Urgency',
            accessorKey: 'urgency',
            meta: { width: '11%' },
            cell: info => {
              const u = String(info.getValue() || '');
              const t = urgencyTone(u);
              return <span className="ht-tone-chip" style={{ ['--ht-bg' as any]: t.bg, ['--ht-fg' as any]: t.fg }}>{u || '—'}</span>;
            },
          },
          {
            header: 'Status',
            id: 'status',
            // Sort/filter on what's DISPLAYED — a row with a recruitment shows
            // "Recruitment Created", not its raw status.
            accessorFn: (r: any) => (r._hasRecruitment ? 'Recruitment Created' : (r.status || '')),
            meta: { width: '16%' },
            cell: info => {
              const r = info.row.original;
              const label = r._hasRecruitment ? 'Recruitment Created' : (r.status || '—');
              const t = r._hasRecruitment
                ? { bg: 'rgba(16,185,129,0.16)', fg: '#047857' }
                : statusTone(r.status);
              return (
                <span className="ht-status-chip" style={{ ['--ht-bg' as any]: t.bg, ['--ht-fg' as any]: t.fg }}>
                  {r._hasRecruitment && <i className="ri-checkbox-circle-fill ep-fs-11" />}
                  {label}
                </span>
              );
            },
          },
          {
            header: 'Submitted',
            id: 'submitted',
            accessorFn: (r: any) => r.submittedAt || r.created_at || '',
            meta: { width: '14%' },
            cell: info => <span className="ht-cell-date">{fmtDate(info.getValue())}</span>,
          },
          {
            header: 'Actions',
            id: 'actions',
            enableSorting: false,
            meta: { width: '11%', align: 'center' },
            cell: info => {
              const r = info.row.original;
              /* Every request can be viewed (read-only). Draft rows can
                 additionally be reopened + edited before submitting to HR. */
              return (
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
                      <ActionIcon icon="edit-svg" />
                    </button>
                  )}
                </div>
              );
            },
          },
        ];

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
              <Row className="g-1 mb-3 align-items-stretch rec-page-kpis">
                {[
                  { label: 'TOTAL',     value: stats.total,     icon: 'ri-file-list-3-line', strip: '#6366f1' },
                  { label: 'DRAFT',     value: stats.draft,     icon: 'ri-draft-line',       strip: '#737373' },
                  { label: 'SUBMITTED', value: stats.submitted, icon: 'ri-send-plane-line',  strip: '#7c3aed' },
                  { label: 'CRITICAL',  value: stats.critical,  icon: 'ri-flashlight-line',  strip: '#ef4444' },
                ].map(k => (
                  <Col key={k.label} xl={3} md={6} sm={6} xs={12}>
                    <div className="rec-kpi-card">
                      <span className="rec-kpi-strip" style={{ background: k.strip }} />
                      <div className="rec-kpi-text">
                        <span className="rec-kpi-label">{k.label}</span>
                        <span className="rec-kpi-num">
                          {hiringLoading ? <Shimmer height={24} width={44} /> : k.value}
                        </span>
                      </div>
                      <span className="rec-kpi-icon" style={{ background: k.strip }}>
                        <i className={k.icon} />
                      </span>
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

              {/* Shared DataTable — same component as Leave, Holidays and the
                  rest of HRMS, so the header band, sortable columns and the
                  "Showing X–Y of Z / Rows per page" footer are identical
                  everywhere instead of being rebuilt per tab. */}
              <DataTable
                data={hiringRequests}
                columns={hiringColumns}
                loading={hiringLoading}
                accent="violet"
                /* SR NO, which every other list in the module shows (QA 172). */
                serial
                /* The HRMS header skin is scoped to .dt-root.hr-dt OR a .dt-root
                   inside a page carrying .hr-cstrip. This tab renders in a
                   modal, so it matched neither and took the saturated default. */
                className="hr-dt"
                pageSize={10}
                minWidth={880}
                emptyMessage={
                  <>
                    <i className="ri-inbox-line ht-empty-icon" />
                    You haven't raised any hiring requests yet.
                  </>
                }
              />
            </CardBody>
          </Card>
          </div>
        );
}
