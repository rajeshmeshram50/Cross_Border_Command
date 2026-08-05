import { Card, CardBody, Col, Row } from 'reactstrap';
import { Shimmer } from '../../../components/ui/Shimmer';
import DataTable, { type DataTableColumn } from '../../../components/ui/DataTable';
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
                      <i className="ri-pencil-line" />
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

              {/* Shared DataTable — same component as Leave, Holidays and the
                  rest of HRMS, so the header band, sortable columns and the
                  "Showing X–Y of Z / Rows per page" footer are identical
                  everywhere instead of being rebuilt per tab. */}
              <DataTable
                data={hiringRequests}
                columns={hiringColumns}
                loading={hiringLoading}
                accent="violet"
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
