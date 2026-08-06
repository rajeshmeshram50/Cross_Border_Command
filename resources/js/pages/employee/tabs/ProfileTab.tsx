// Profile tab — personal / contact / address identity sections, the profile
// photo uploader and the account-security card. Extracted from
// EmployeeProfile.tsx; shared state is read via useEmployeeProfile().
import { Button, Col, Row } from 'reactstrap';
import { Shimmer } from '../../../components/ui/Shimmer';
import { useEmployeeProfile } from '../EmployeeProfileContext';

export default function ProfileTab() {
  const {
    empDetail, empDetailLoading, employee, fmtDate, profilePct,
    profilePhotoSrc, profilePhotoFile, setProfilePhotoFile, savingPhoto,
    handleProfilePhotoChange, handleSaveProfilePhoto, restoreSavedProfilePhoto,
    profilePhotoInputRef, setFaceRegOpen, setPwOpen, resetPwForm,
  } = useEmployeeProfile();

  return (
        <>
          {/* Personal Information — full-width row of 7 identity fields */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-indigo">
  <div
    className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-indigo"
  >
    <span className="ep-section-icon ep-icon-indigo">
      <i className="ri-user-line" />
    </span>
    <h6 className="mb-0 fw-bold ep-fs-13">Personal Information</h6>
  </div>
  <div className="px-3 py-3">
    {/* Row 1 — three action tiles side by side: Profile Photo · Login
        Password · Face Biometric. Each takes 1/3 of the width on md+
        and stacks on smaller screens. Tiles are vertically aligned (no
        h-100 stretch) and use compact padding so the row stays low. */}
    <Row className="g-3 mb-3 align-items-center">
      {/* Profile Photo tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2 pft-tile-photo"
        >
          {profilePhotoSrc ? (
            <img
              src={profilePhotoSrc}
              alt="profile"
              className="rounded-circle flex-shrink-0 pft-avatar-img"
            />
          ) : (
            <div
              className="rounded-circle d-inline-flex align-items-center justify-content-center text-muted flex-shrink-0 pft-avatar-placeholder"
            >
              <i className="ri-user-line" />
            </div>
          )}
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold ep-fs-12">Profile Photo</div>
            <input
              ref={profilePhotoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={e => handleProfilePhotoChange(e.target.files?.[0] || null)}
              className="form-control form-control-sm pft-file-input"
            />
          </div>
          {profilePhotoFile && (
            <div className="d-flex gap-1 flex-shrink-0">
              <button
                type="button"
                className="btn btn-sm btn-success pft-btn-icon-sm"
                onClick={handleSaveProfilePhoto}
                disabled={savingPhoto}
                title="Save photo"
              >
                {savingPhoto ? <span className="spinner-border spinner-border-sm pft-spinner-sm" /> : <i className="ri-save-line" />}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary pft-btn-icon-sm"
                onClick={() => {
                  setProfilePhotoFile(null);
                  restoreSavedProfilePhoto();
                }}
                title="Cancel"
              >
                <i className="ri-close-line" />
              </button>
            </div>
          )}
        </div>
      </Col>

      {/* Change Password tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2 pft-tile-password"
        >
          <span className="ep-section-icon flex-shrink-0 pft-icon-rose">
            <i className="ri-shield-keyhole-line" />
          </span>
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold ep-fs-12">Login Password</div>
            <small className="text-muted pft-tile-caption">Rotate regularly. Email on change.</small>
          </div>
          <Button
            color="danger"
            size="sm"
            className="d-inline-flex align-items-center gap-1 flex-shrink-0 pft-btn-action"
            onClick={() => { resetPwForm(); setPwOpen(true); }}
          >
            <i className="ri-lock-password-line" /> Change
          </Button>
        </div>
      </Col>

      {/* Face Biometric tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2 pft-tile-face"
        >
          <span className="ep-section-icon flex-shrink-0 pft-icon-indigo">
            <i className="ri-user-smile-line" />
          </span>
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold ep-fs-12">Face Biometric</div>
            <small className="text-muted pft-tile-caption">Register once to clock in.</small>
          </div>
          <Button
            color="primary"
            size="sm"
            className="d-inline-flex align-items-center gap-1 flex-shrink-0 pft-btn-action"
            onClick={() => setFaceRegOpen(true)}
          >
            <i className="ri-camera-line" /> Register
          </Button>
        </div>
      </Col>
    </Row>

    {/* Row 2 — seven identity fields in a single horizontal row on lg+.
        While empDetail is loading each value cell renders a shimmer
        placeholder so the page doesn't flash "—" before the API resolves. */}
    <Row className="g-4">
      {[
        { label: 'First Name',  value: empDetail?.first_name || (employee?.name || '').split(' ')[0] },
        { label: 'Middle Name', value: empDetail?.middle_name },
        { label: 'Last Name',   value: empDetail?.last_name || (employee?.name || '').split(' ').slice(1).join(' ') },
        { label: 'Display Name', value: empDetail?.display_name || employee?.name },
        { label: 'Date of Birth', value: fmtDate(empDetail?.date_of_birth), monospace: true },
        { label: 'Gender', value: empDetail?.gender },
        { label: 'Nationality', value: empDetail?.nationality_country?.name },
      ].map((f, i) => (
        <Col key={i} lg md={4} sm={6}>
          <div className="ep-field-label">{f.label}</div>
          {empDetailLoading
            ? <Shimmer height={16} width="70%" />
            : <div className={`ep-field-value${f.monospace ? ' font-monospace' : ''}`}>{(f.value && String(f.value).trim()) ? f.value : '—'}</div>}
        </Col>
      ))}
    </Row>
  </div>
</div>

          {/* Contact Information — 4 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-blue">
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-blue"
            >
              <span className="ep-section-icon ep-icon-blue">
                <i className="ri-phone-line" />
              </span>
              <h6 className="mb-0 fw-bold ep-fs-13">Contact Information</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Work Email</div><div className="ep-field-value">{empDetail?.email || employee?.email || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile</div><div className="ep-field-value font-monospace">{empDetail?.mobile || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Work Country</div><div className="ep-field-value">{empDetail?.work_country?.name || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{(() => {
                  const mgr = empDetail?.reporting_manager;
                  if (mgr) {
                    return mgr.display_name
                      || [mgr.first_name, mgr.middle_name, mgr.last_name].filter(Boolean).join(' ')
                      || '—';
                  }
                  return employee?.manager || '—';
                })()}</div></Col>
              </Row>
            </div>
          </div>

          {/* Address Details — Current + Permanent side-by-side. Gradient
              tint is restricted to the header strip; the body sits on plain
              white so the field rows stay readable. */}
          <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-emerald">
            <div
              className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-emerald"
            >
              <span className="ep-section-icon ep-icon-emerald">
                <i className="ri-map-pin-line" />
              </span>
              <h6 className="mb-0 fw-bold ep-fs-13">Address Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={6}>
                  <div className="ep-addr-marker pft-addr-marker">
                    <span className="dot pft-addr-dot" /> Current Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">{[empDetail?.address_line1, empDetail?.address_line2].filter(Boolean).join(', ') || '—'}</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">{empDetail?.city || '—'}</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">{empDetail?.state?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">{empDetail?.country?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">{empDetail?.pincode || '—'}</div></Col>
                  </Row>
                </Col>
                <Col md={6}>
                  <div className="ep-addr-marker pft-addr-marker">
                    <span className="dot pft-addr-dot" /> Permanent Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">{[empDetail?.perm_address_line1, empDetail?.perm_address_line2].filter(Boolean).join(', ') || '—'}</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">{empDetail?.perm_city || '—'}</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">{empDetail?.perm_state?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">{empDetail?.perm_country?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">{empDetail?.perm_pincode || '—'}</div></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          </div>

          {/* Bottom row: Work Experience | Profile Completion | KYC Documents */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-amber">
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-amber"
                >
                  <span className="ep-section-icon ep-icon-amber">
                    <i className="ri-briefcase-line" />
                  </span>
                  <h6 className="mb-0 fw-bold ep-fs-13">Work Experience</h6>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {/* REAL work experience (was hardcoded sample data). Sourced
                      from the employee's previous_employments + the
                      has_prior_experience flag — shows "Fresher" / "Not
                      Provided" when no experience was entered. */}
                  {(() => {
                    const prev: any[] = Array.isArray(empDetail?.previous_employments) ? empDetail.previous_employments : [];
                    const hasExp = empDetail?.has_prior_experience === true || prev.length > 0;

                    /* Total experience is measured in DAYS, not by subtracting
                       calendar months. The old math was
                         (yearDiff * 12) + monthDiff
                       which reported 0 for any stint inside a single calendar
                       month — so a real 01-May → 28-May job fell into the
                       `months > 0 ? … : '—'` branch and rendered as a dash.
                       That is the "experience is not calculated" bug: the rows
                       were saved and returned fine, the arithmetic threw them
                       away. The same formula also called 31-May → 01-Jun a
                       full month, and counted two concurrently-held jobs twice. */
                    const DAY = 86_400_000;
                    const spans: [number, number][] = [];
                    prev.forEach((p) => {
                      if (!p?.start_date) return;
                      const s = new Date(p.start_date).getTime();
                      // No end_date means the row is open-ended — measure to today.
                      const e = (p.end_date ? new Date(p.end_date) : new Date()).getTime();
                      if (Number.isNaN(s) || Number.isNaN(e) || e < s) return;
                      // +1 day because the last working day itself counts.
                      spans.push([s, e + DAY]);
                    });
                    // Merge overlaps so two jobs held at the same time are not
                    // added together into more experience than time elapsed.
                    spans.sort((a, b) => a[0] - b[0]);
                    const merged: [number, number][] = [];
                    spans.forEach(([s, e]) => {
                      const tail = merged[merged.length - 1];
                      if (tail && s <= tail[1]) tail[1] = Math.max(tail[1], e);
                      else merged.push([s, e]);
                    });

                    const totalDays = Math.round(merged.reduce((sum, [s, e]) => sum + (e - s), 0) / DAY);
                    const expYears  = Math.floor(totalDays / 365);
                    const expMonths = Math.floor((totalDays - expYears * 365) / 30);
                    const expDays   = totalDays - expYears * 365 - expMonths * 30;
                    const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

                    const totalExp = !hasExp
                      ? 'Fresher'
                      // Flagged as experienced but every row is missing or has an
                      // unusable date range — say nothing rather than "0 days".
                      : totalDays <= 0 ? '—'
                      : expYears  > 0  ? `${plural(expYears, 'yr')} ${plural(expMonths, 'mo')}`
                      : expMonths > 0  ? `${plural(expMonths, 'mo')}${expDays ? ` ${plural(expDays, 'day')}` : ''}`
                      : plural(totalDays, 'day');

                    /* Most recent employer by start_date. This used to be prev[0]
                       on the assumption the API sorted newest-first; the relation
                       had no ordering at all, so it was really "whichever row was
                       inserted first". Derived here so the card is right even
                       against an older API build. */
                    const last = prev.reduce((best: any, p: any) => {
                      if (!p?.start_date) return best;
                      if (!best) return p;
                      return new Date(p.start_date) > new Date(best.start_date) ? p : best;
                    }, null) || prev[0] || null;
                    const notProvided = <span className="text-muted fst-italic">Not Provided</span>;
                    return (
                      <Row className="g-3">
                        <Col xs={6} md={3} xl>
                          <div className="ep-field-label">Status</div>
                          <div className="ep-field-value">{hasExp ? 'Experienced' : 'Fresher'}</div>
                        </Col>
                        <Col xs={6} md={3} xl>
                          <div className="ep-field-label">Total Experience</div>
                          <div className="ep-field-value">{totalExp}</div>
                        </Col>
                        <Col xs={6} md={3} xl>
                          <div className="ep-field-label">Last Company</div>
                          <div className="ep-field-value">{last?.company_name || notProvided}</div>
                        </Col>
                        <Col xs={6} md={3} xl>
                          <div className="ep-field-label">Last Designation</div>
                          <div className="ep-field-value">{last?.job_title || notProvided}</div>
                        </Col>
                      </Row>
                    );
                  })()}
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column pft-prof-card">
                <div className="px-3 pt-3 pb-2 d-flex align-items-center gap-3">
                  <div
                    className="d-inline-flex align-items-center justify-content-center pft-ring"
                    style={{ ['--pft-ring-pct' as any]: `${profilePct}%` }}
                  >
                    <span
                      className="ep-prof-ring-inner pft-ring-inner"
                    >
                      {profilePct}<span className="pft-ring-pct-unit">%</span>
                    </span>
                  </div>
                  <div className="flex-grow-1">
                    <h6 className="ep-prof-heading mb-1 fw-bold pft-prof-heading">Profile Completion</h6>
                    <small className="text-muted ep-fs-12">
                      In Progress · {profilePct}% done
                    </small>
                  </div>
                </div>
                {/* Full-width striped progress bar with floating circular
                    badge above the fill end. Locked to the card's violet
                    theme so it reads as a continuation of the gradient
                    background instead of a separate tier-colored band. */}
                <div className="px-3 pb-2">
                  {(() => {
                    const p = profilePct;
                    const badgeLeft = Math.max(8, Math.min(92, p));
                    return (
                      <div className="pft-progress-wrap" title={`Profile ${p}% complete`}>
                        {/* Floating badge + downward pointer */}
                        <div
                          className="pft-progress-badge-anchor"
                          style={{ ['--pft-badge-left' as any]: `${badgeLeft}%` }}
                        >
                          <div
                            className="d-flex align-items-center justify-content-center fw-bold pft-progress-badge"
                          >
                            {p}%
                          </div>
                          <div
                            className="pft-progress-pointer"
                          />
                        </div>

                        {/* Track + striped fill */}
                        <div
                          className="pft-progress-track"
                        >
                          <div
                            className="pft-progress-fill"
                            style={{ ['--pft-fill-width' as any]: `${p}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* 4 mini-tiles */}
                <div className="px-3 pb-3 flex-grow-1">
                  <Row className="g-2">
                    <Col xs={6}>
                      <div className="px-3 py-2 h-100 pft-mini-green">
                        <div className="ep-field-label pft-mini-label-green">Status</div>
                        <div className="ep-field-value d-inline-flex align-items-center gap-1 pft-mini-value-green">
                          <span className="pft-mini-dot" />
                          {employee?.enabled === false ? 'Disabled' : 'Active'}
                        </div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2 h-100 pft-mini-indigo">
                        <div className="ep-field-label pft-mini-label-indigo">Emp Type</div>
                        <div className="ep-field-value pft-mini-value-indigo">{empDetail?.worker_type || empDetail?.work_type || empDetail?.time_type || '—'}</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2 h-100 pft-mini-amber">
                        <div className="ep-field-label pft-mini-label-amber">Joined</div>
                        <div className="ep-field-value font-monospace pft-mini-value-amber">{empDetail?.date_of_joining ? fmtDate(empDetail.date_of_joining) : '—'}</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2 h-100 pft-mini-teal">
                        <div className="ep-field-label pft-mini-label-teal">Department</div>
                        <div className="ep-field-value pft-mini-value-teal" title={employee?.department || ''}>{employee?.department || '—'}</div>
                      </div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-indigo">
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-indigo"
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="ep-section-icon ep-icon-indigo">
                      <i className="ri-shield-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold ep-fs-13">KYC Documents</h6>
                  </div>
                  <span className="badge rounded-pill fw-semibold px-2 py-1 pft-kyc-badge">3 / 3</span>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  <Row className="g-2">
                    {[
                      { label: 'Aadhaar Card',   status: 'Uploaded' },
                      { label: 'PAN Card',       status: 'Uploaded' },
                      { label: 'Passport Photo', status: 'Uploaded' },
                    ].map(d => {
                      const uploaded = d.status === 'Uploaded';
                      return (
                        <Col xs={4} key={d.label}>
                          <div
                            className="h-100 d-flex flex-column align-items-center text-center gap-1 px-2 py-2 pft-kyc-tile"
                            style={{
                              ['--pft-kyc-pill-bg' as any]: uploaded ? 'rgba(59,130,246,0.10)' : 'rgba(245,158,11,0.12)',
                              ['--pft-kyc-pill-color' as any]: uploaded ? '#1d4ed8' : '#a16207',
                              ['--pft-kyc-pill-border' as any]: uploaded ? 'rgba(59,130,246,0.25)' : 'rgba(245,158,11,0.25)',
                            }}
                          >
                            <span
                              className="d-inline-flex align-items-center justify-content-center pft-kyc-status-icon"
                              style={{ ['--pft-kyc-icon-bg' as any]: uploaded ? '#3b82f6' : '#f59e0b' }}
                            >
                              <i className={uploaded ? 'ri-check-line' : 'ri-time-line'} />
                            </span>
                            <div className="pft-kyc-doc-label">{d.label}</div>
                            <span className="d-inline-flex align-items-center fw-semibold pft-kyc-status-pill">
                              {d.status}
                            </span>
                          </div>
                        </Col>
                      );
                    })}
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

        </>
  );
}
