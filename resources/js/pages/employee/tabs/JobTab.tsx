// Job tab — employment details, reporting, assets, leave/holiday summary.
// Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { useEffect, useState } from 'react';
import { Col, Row } from 'reactstrap';
import { useEmployeeProfile } from '../EmployeeProfileContext';
import { ShimmerForm } from '../../../components/ui/Shimmer';
import { AncillaryRolesChip } from '../../../components/AncillaryRolesChip';
import { leavePlansApi } from '../../hrms/leavePlansApi';

/** "18:30" → "06:30 PM" for the shift window shown beside Time Type. */
const fmtShiftTime = (hhmm?: string | null): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${m[2]} ${ampm}`;
};

export default function JobTab() {
  const { empDetail, empDetailLoading, employee, employeeId, fmtDate, ancillaryList, salaryStruct } = useEmployeeProfile();

  /* Salary Effective Date.
   *
   * What HR wants here is the date the employee's CURRENT pay took effect, so
   * the active salary structure's effective_from wins when there is one — a
   * revision moves it forward, and the employee record's own
   * salary_effective_from stays pinned to the joining date. That column is the
   * fallback for anyone not yet on a structure. */
  const salaryEffectiveFrom = salaryStruct?.effective_from || empDetail?.salary_effective_from;

  /* "General (09:30 AM – 06:30 PM)".
   *
   * The name alone is what both fields used to print, which tells the reader
   * nothing about when the person is actually expected in. The window is
   * resolved server-side (Employee::resolveShiftWindow → the branch's Shift
   * Details, matched on the shift NAME) and arrives as shift_start/shift_end.
   *
   * It comes back null when the employee's stored shift name matches no shift
   * the branch defines — the name is a plain string with no foreign key, so a
   * shift renamed or removed in Branch leaves the employee pointing at nothing.
   * The name is still shown in that case; inventing a window would be worse
   * than admitting there isn't one. */
  const shiftName  = (empDetail?.shift || '').trim();
  const shiftStart = fmtShiftTime(empDetail?.shift_start);
  const shiftEnd   = fmtShiftTime(empDetail?.shift_end);
  const shiftLabel = !shiftName
    ? '—'
    : (shiftStart && shiftEnd
        ? <>{shiftName}<span className="ep-field-note"> ({shiftStart} – {shiftEnd})</span></>
        : <>{shiftName}</>);

  // `leave_plan` stores the plan ID — resolve it to the plan name for display
  // (the field shows a bare id like "3" otherwise).
  const [leavePlanName, setLeavePlanName] = useState('');
  useEffect(() => {
    const id = empDetail?.leave_plan;
    if (!id) { setLeavePlanName(''); return; }
    let alive = true;
    leavePlansApi.list()
      .then(plans => { if (alive) setLeavePlanName(plans.find(p => String(p.id) === String(id))?.plan_name || ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, [empDetail?.leave_plan]);

  /* QA #189 — skeleton while the job details load. Placed AFTER the effects
     above: an early return before a hook changes the hook order between
     renders, which React treats as an error. */
  if (empDetailLoading) {
    return <ShimmerForm header={false} sections={3} cols={4} fieldsPerSection={8} />;
  }

  return (
        <>
          {/* Employment Details — single row of 8 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-indigo">
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-indigo"
            >
              <span className="ep-section-icon ep-icon-indigo">
                <i className="ri-briefcase-line" />
              </span>
              <h6 className="mb-0 fw-bold ep-fs-13">Employment Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col>
                  <div className="ep-field-label">Employee Number</div>
                  <span className=" fw-semibold jt-emp-badge">{empDetail?.emp_code || employeeId}</span>
                </Col>
                <Col><div className="ep-field-label">Joining Date</div><div className="ep-field-value  ep-fs-11">{fmtDate(empDetail?.date_of_joining)}</div></Col>
                <Col><div className="ep-field-label">Salary Effective Date</div><div className="ep-field-value  ep-fs-11">{fmtDate(salaryEffectiveFrom)}</div></Col>
                <Col><div className="ep-field-label">Job Title (Primary)</div><div className="ep-field-value">{empDetail?.designation?.name || employee?.designation || '—'}</div></Col>
                <Col>
                  <div className="ep-field-label">Job Title (Secondary)</div>
                  <AncillaryRolesChip names={ancillaryList} />
                </Col>
                <Col><div className="ep-field-label">Employment Status</div><div className="ep-field-value">{empDetail?.status || (employee?.enabled === false ? 'Disabled' : 'Active')}</div></Col>
                {/* "Time Type" was the old label and it named nothing anyone
                    recognises — the value it printed is the employee's SHIFT and
                    the window that shift resolves to in the branch's Shift
                    Details, so it is called Shift Time. (Work Type beside it is
                    the employee form's own Work Type; the two once shared the
                    `work_type` column and printed "Full Time" twice.) */}
                <Col><div className="ep-field-label">Work Type</div><div className="ep-field-value">{empDetail?.work_type || '—'}</div></Col>
                <Col>
                  <div className="ep-field-label">Shift Time</div>
                  <div className="ep-field-value">{shiftLabel}</div>
                </Col>
              </Row>
            </div>
          </div>

          {/* Organisational Structure — 4 fields full width */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-blue">
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-blue"
            >
              <span className="ep-section-icon ep-icon-blue">
                <i className="ri-building-2-line" />
              </span>
              <h6 className="mb-0 fw-bold ep-fs-12">Organisational Structure</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">{empDetail?.legal_entity?.name || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Department</div><div className="ep-field-value">{empDetail?.department?.name || employee?.department || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Location</div><div className="ep-field-value">{empDetail?.location || '—'}</div></Col>
                <Col md={3}>
                  <div className="ep-field-label">Reporting Manager</div>
                  <div className="ep-field-value">{(() => {
                    const m = empDetail?.reporting_manager;
                    if (!m) return employee?.manager || '—';
                    return m.display_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ') || '—';
                  })()}</div>
                </Col>
              </Row>
            </div>
          </div>

          {/* Row of 3 cards: Role & Positioning | Employment Terms | Attendance & Time */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 ep-ct-emerald">
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-emerald"
                >
                  <span className="ep-section-icon ep-icon-emerald">
                    <i className="ri-edit-line" />
                  </span>
                  <h6 className="mb-0 fw-bold ep-fs-12">Role &amp; Positioning</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-4">
                    <Col xs={4}><div className="ep-field-label">Primary Role</div><div className="ep-field-value">{employee?.primaryRole || 'Executive'}</div></Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Ancillary Role</div>
                      <AncillaryRolesChip names={ancillaryList} />
                    </Col>
                    <Col xs={4}><div className="ep-field-label">Employee Level</div><div className="ep-field-value">L3 — Mid</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 ep-ct-amber">
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-amber"
                >
                  <span className="ep-section-icon ep-icon-amber">
                    <i className="ri-file-list-3-line" />
                  </span>
                  <h6 className="mb-0 fw-bold ep-fs-12">Employment Terms</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-3">
                    <Col xs={6}><div className="ep-field-label">Probation Policy</div><div className="ep-field-value">{empDetail?.probation_policy || '—'}</div></Col>
                    {/* Notice Period carries the auto-calculated Probation End
                        Date alongside it. The date is derived in the Add/Edit
                        form (joining date + probation months) and stored, but
                        had no read-side surface anywhere on the profile — HR
                        could set it and then never see it again (CBC #102).
                        The suffix is dropped when no probation end is stored,
                        so "No Probation" employees don't show an empty bracket. */}
                    <Col xs={6}>
                      <div className="ep-field-label">Notice Period</div>
                      <div className="ep-field-value">
                        {empDetail?.notice_period || (empDetail?.notice_period_days ? `${empDetail.notice_period_days} Days` : '—')}
                        {empDetail?.probation_end_date && (
                          <span className="ep-field-note"> (Probation End Date: {fmtDate(empDetail.probation_end_date)})</span>
                        )}
                      </div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 ep-ct-blue">
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-blue"
                >
                  <span className="ep-section-icon ep-icon-blue">
                    <i className="ri-time-line" />
                  </span>
                  <h6 className="mb-0 fw-bold ep-fs-12">Attendance &amp; Time</h6>
                </div>
                <div className="px-3 py-3">
                  {/* Mirrors the Edit Employee form's "Leave & Attendance"
                      step (Leave Plan, Holiday List, Shift, Weekly Off,
                      Attendance Number, Overtime, Expense Policy) bound to real
                      data. Fields with no form equivalent (Time Tracking,
                      Penalization, Shift Allowance) were removed. */}
                  {/* 6 fields, 3-per-row — mirrors the Edit Employee form's
                      "Leave & Attendance" step (Expense Policy removed). */}
                  <Row className="g-3">
                    <Col xs={4}><div className="ep-field-label">Leave Plan</div><div className="ep-field-value">{leavePlanName || empDetail?.leave_plan || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Holiday List</div><div className="ep-field-value">{empDetail?.holidayGroup?.name || empDetail?.holiday_group?.name || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Shift</div><div className="ep-field-value">{shiftLabel}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Weekly Off</div><div className="ep-field-value">{empDetail?.weekly_off || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Attendance Number</div><div className="ep-field-value font-monospace">{empDetail?.attendance_number || '—'}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Overtime</div><div className="ep-field-value">{empDetail?.overtime || '—'}</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

          {/* Asset Details */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-amber">
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-amber"
            >
              <span className="ep-section-icon ep-icon-amber">
                <i className="ri-computer-line" />
              </span>
              <h6 className="mb-0 fw-bold ep-fs-12">Asset Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-3">
                {(() => {
                  const laptop = empDetail?.laptop_asset;
                  const mobile = empDetail?.mobile_asset;
                  // `other_assets_resolved` is an accessor on the Employee
                  // model that joins the selected master_asset rows. Falls
                  // back to the raw id array if the accessor wasn't loaded.
                  const otherAssets: Array<{ asset_name?: string; code?: string }> =
                    Array.isArray(empDetail?.other_assets_resolved)
                      ? empDetail.other_assets_resolved
                      : [];
                  const otherSummary = otherAssets.length > 0
                    ? otherAssets.map(a => a.asset_name || a.code).filter(Boolean).join(', ')
                    : '—';
                  return (
                    <>
                      {/* All asset fields on a single row — equal-width auto cols. */}
                      <Col><div className="ep-field-label">Laptop Assigned</div><div className="ep-field-value">{empDetail?.laptop_assigned || (laptop ? 'Yes' : 'No')}</div></Col>
                      <Col>
                        <div className="ep-field-label">Laptop Asset ID</div>
                        {laptop ? (
                          <span className="font-monospace fw-semibold jt-asset-badge">{laptop.code || laptop.asset_number || `LAP-${laptop.id}`}</span>
                        ) : <div className="ep-field-value text-muted fw-normal">—</div>}
                      </Col>
                      <Col><div className="ep-field-label">Laptop Type</div><div className="ep-field-value">{laptop?.asset_name || '—'}</div></Col>
                      <Col>
                        <div className="ep-field-label">Mobile Device</div>
                        {mobile ? (
                          <div className="ep-field-value">{mobile.asset_name || mobile.code || '—'}</div>
                        ) : <div className="ep-field-value text-muted fw-normal">—</div>}
                      </Col>
                      <Col><div className="ep-field-label">Other Assets</div><div className="ep-field-value">{otherSummary}</div></Col>
                      <Col><div className="ep-field-label">Asset Issued Date</div><div className="ep-field-value font-monospace">{fmtDate(empDetail?.asset_issued_date)}</div></Col>
                      <Col><div className="ep-field-label">Return Required</div><div className="ep-field-value">{empDetail?.return_required || '—'}</div></Col>
                    </>
                  );
                })()}
              </Row>
            </div>
          </div>
        </>
  );
}
