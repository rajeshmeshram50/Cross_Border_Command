// Payroll tab — compensation summary, salary-revision timeline and payslip
// access. Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { Card, Col, Row } from 'reactstrap';
import { useEmployeeProfile } from '../EmployeeProfileContext';

export default function PayrollTab() {
  const {
    employee, fmtRupee, fmtDate, empDetail, payrollTab, setPayrollTab,
    salaryStruct, realMonthlyGross, realAnnualCtc, realTimeline,
    openLatestPayslip, setSalaryModalOpen, setBreakdownOpen, setBreakdownRowId,
  } = useEmployeeProfile();

  // Mask a sensitive number, keeping the last `visible` characters.
  const mask = (val: any, visible = 4): string => {
    const s = String(val ?? '').replace(/\s+/g, '');
    if (!s) return '—';
    if (s.length <= visible) return s;
    return 'X'.repeat(Math.max(4, s.length - visible)) + s.slice(-visible);
  };
  const fullAddress = [empDetail?.address_line1, empDetail?.address_line2, empDetail?.city]
    .filter(Boolean).join(', ') || '—';
  const paymentMode = empDetail?.salary_payment_mode === 'bank' ? 'Bank Transfer'
    : empDetail?.salary_payment_mode ? String(empDetail.salary_payment_mode) : '—';

  return (
        <>
          {/* Sub-tab pill — Payroll Summary (indigo) | Payment Details (green).
              Same compact strap shape as the Evidence Vault subtabs. */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex pyt-subtab-strap"
              >
                {[
                  { key: 'summary' as const, label: 'Payroll Summary',  icon: 'ri-calendar-line',            activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'details' as const, label: 'Payment Details',  icon: 'ri-money-dollar-circle-line', activeBg: 'linear-gradient(135deg,#064e3b,#047857)', shadow: 'rgba(4,120,87,0.22)' },
                ].map(t => {
                  const on = payrollTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setPayrollTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold pyt-subtab-btn"
                      style={{
                        ['--pyt-tab-bg' as any]: on ? t.activeBg : 'transparent',
                        ['--pyt-tab-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        ['--pyt-tab-shadow' as any]: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={`${t.icon} pyt-icon-12`} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {payrollTab === 'summary' && (
            <>
              {/* Hero strip — only on the Payroll Summary tab. */}
              <Card className="mb-3 border-0 pyt-hero-card">
                <div
                  className="pyt-hero-banner"
                >
                  <div className="ep-hero-blob" />
                  <Row className="align-items-center g-2 pyt-relative">
                    <Col xs="auto">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-3 pyt-hero-iconbox">
                        <i className="ri-money-dollar-circle-line pyt-icon-17-white" />
                      </span>
                    </Col>
                    <Col className="min-w-0">
                      <p className="mb-0 text-uppercase fw-semibold pyt-hero-eyebrow">Payroll Summary</p>
                      <div className="text-white pyt-hero-lastprocessed">
                        Last Processed: <span className="pyt-hero-month">Mar 2026</span> (01 Mar – 31 Mar)
                      </div>
                      <small className="pyt-hero-nextcycle">Next cycle: Apr 2026 · Monthly payroll</small>
                    </Col>
                    <Col xs="12" lg="auto">
                      <div className="d-flex gap-1 flex-wrap justify-content-lg-end align-items-center">
                        {[
                          { label: 'Working Days', value: '31',     color: '#fff' },
                          { label: 'Loss of Pay',  value: '0',      color: '#fcd34d' },
                          { label: 'Status',       value: 'Active', color: '#86efac' },
                        ].map(c => (
                          <div
                            key={c.label}
                            className="text-center pyt-hero-stat"
                          >
                            <p className="mb-0 text-uppercase fw-semibold pyt-hero-stat-label">{c.label}</p>
                            <div className="fw-bold lh-1 pyt-hero-stat-value" style={{ ['--pyt-stat-color' as any]: c.color }}>{c.value}</div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={openLatestPayslip}
                          className="d-inline-flex align-items-center gap-1 fw-semibold lh-1 pyt-hero-payslip-btn"
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; }}
                        >
                          <i className="ri-download-2-line pyt-icon-13" /> View Payslip
                        </button>
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-blue">
                    <div
                      className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-blue"
                    >
                      <div className="d-flex align-items-center gap-2">
                        <span className="ep-section-icon ep-icon-blue">
                          <i className="ri-bank-card-line" />
                        </span>
                        <h6 className="mb-0 fw-bold pyt-section-title">Payment Information</h6>
                      </div>
                      <span className="d-inline-flex align-items-center gap-1 fw-semibold pyt-pill-amber">
                        <span className="pyt-dot-amber" /> Not Initiated
                      </span>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <p className="mb-3 pyt-text-12-5">
                        Salary Payment Mode: <strong className="pyt-strong-heading">{paymentMode}</strong>
                      </p>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">Bank Name</div><div className="ep-field-value">{empDetail?.bank_name || '—'}</div></Col>
                        <Col md={6}>
                          <div className="ep-field-label">Account Number</div>
                          <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.bank_account_number)}</span>
                        </Col>
                        <Col md={6}>
                          <div className="ep-field-label">IFSC Code</div>
                          <span className="font-monospace fw-semibold pyt-mono-chip">{empDetail?.ifsc_code || '—'}</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Name on Account</div><div className="ep-field-value">{empDetail?.account_holder_name || employee?.name || '—'}</div></Col>
                        <Col md={6}><div className="ep-field-label">Branch</div><div className="ep-field-value">{empDetail?.bank_branch || '—'}</div></Col>
                        <Col md={6}><div className="ep-field-label">Account Type</div><div className="ep-field-value">{empDetail?.bank_account_type || '—'}</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-purple">
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-purple"
                    >
                      <span className="ep-section-icon ep-icon-purple">
                        <i className="ri-user-2-line" />
                      </span>
                      <h6 className="mb-0 fw-bold pyt-section-title">Identity Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      {/* PAN Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2 pyt-subhead-purple">
                        <span className="fw-bold pyt-subhead-title-purple">PAN Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold pyt-pill-green">
                          <span className="pyt-dot-green" /> Verified
                        </span>
                      </div>
                      <Row className="g-3 mb-3">
                        <Col md={3}>
                          <div className="ep-field-label">PAN Number</div>
                          <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.pan_number)}</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Name</div><div className="ep-field-value">{empDetail?.account_holder_name || employee?.name || '—'}</div></Col>
                        <Col md={3}><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">{fmtDate(empDetail?.date_of_birth)}</div></Col>
                        <Col md={3}><div className="ep-field-label">PAN Holder Name</div><div className="ep-field-value">{empDetail?.account_holder_name || '—'}</div></Col>
                      </Row>

                      {/* Aadhaar Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2 pyt-subhead-teal">
                        <span className="fw-bold pyt-subhead-title-teal">Aadhaar Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold pyt-pill-green">
                          <span className="pyt-dot-green" /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={3}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.aadhaar_number)}</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Nationality</div><div className="ep-field-value">{empDetail?.nationality_country?.name || '—'}</div></Col>
                        <Col md={3}><div className="ep-field-label">Address</div><div className="ep-field-value">{fullAddress}</div></Col>
                        <Col md={3}><div className="ep-field-label">Gender</div><div className="ep-field-value">{empDetail?.gender || '—'}</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-emerald">
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-emerald"
                    >
                      <span className="ep-section-icon ep-icon-emerald">
                        <i className="ri-map-pin-line" />
                      </span>
                      <h6 className="mb-0 fw-bold pyt-section-title">Address Proof</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-3 pyt-subhead-teal">
                        <span className="fw-bold pyt-subhead-title-teal">Aadhaar Card (Address Proof)</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold pyt-pill-green">
                          <span className="pyt-dot-green" /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={6}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.aadhaar_number)}</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Pincode</div><div className="ep-field-value">{empDetail?.pincode || '—'}</div></Col>
                        <Col md={6}><div className="ep-field-label">Address</div><div className="ep-field-value">{fullAddress}</div></Col>
                        <Col md={6}><div className="ep-field-label">City</div><div className="ep-field-value">{empDetail?.city || '—'}</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-amber">
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-amber"
                    >
                      <span className="ep-section-icon ep-icon-amber">
                        <i className="ri-shield-line" />
                      </span>
                      <h6 className="mb-0 fw-bold pyt-section-title">Statutory Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <span className="d-inline-flex align-items-center fw-semibold mb-3 pyt-pill-amber-pt">
                        Statutory IDs
                      </span>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">PAN Number</div><div className="ep-field-value font-monospace">{mask(empDetail?.pan_number)}</div></Col>
                        <Col md={6}><div className="ep-field-label">UAN Number</div><div className="ep-field-value font-monospace">{empDetail?.uan_number || '—'}</div></Col>
                        <Col md={6}><div className="ep-field-label">PF Eligible</div><div className="ep-field-value">{empDetail?.pf_eligible ? 'Yes' : 'No'}</div></Col>
                        <Col md={6}><div className="ep-field-label">ESI Applicable</div><div className="ep-field-value">{empDetail?.esi_applicable || '—'}</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>
            </>
          )}

          {payrollTab === 'details' && (
            <>
              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={5}>
                  <div
                    className="ep-section-card-flat ep-section-card h-100 d-flex flex-column pyt-comp-card"
                  >
                    <div className="pyt-comp-blob" />
                    <div className="pyt-comp-inner">
                      <div>
                        <p className="mb-1 pyt-comp-eyebrow">Current Compensation</p>
                        <h2 className="mb-0 fw-bold text-white pyt-comp-amount">
                          {realAnnualCtc > 0 ? `₹${fmtRupee(realAnnualCtc)}` : '— Not set'}
                        </h2>
                        <p className="mb-0 mt-1 pyt-comp-perannum">
                          Per Annum{salaryStruct ? '' : (realAnnualCtc > 0 ? ' (from annual salary)' : '')}
                        </p>
                      </div>
                      <div className="d-flex gap-3 mt-3 pt-2 pyt-comp-divider-top">
                        <div>
                          <p className="mb-1 pyt-comp-sublabel">Monthly</p>
                          <h6 className="mb-0 text-white fw-bold pyt-comp-subvalue">₹{fmtRupee(realMonthlyGross)}</h6>
                        </div>
                        <div className="ps-3 pyt-comp-divider-left">
                          <p className="mb-1 pyt-comp-sublabel">{salaryStruct ? `Structure v${salaryStruct.version ?? 1}` : 'Source'}</p>
                          <h6 className="mb-0 text-white fw-bold pyt-comp-subvalue">{salaryStruct ? 'Active' : (realAnnualCtc > 0 ? 'Annual' : 'None')}</h6>
                        </div>
                      </div>
                    </div>
                  </div>
                </Col>
                <Col xl={7}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-indigo">
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2 ep-hd-indigo"
                    >
                      <span className="ep-section-icon ep-icon-indigo">
                        <i className="ri-briefcase-line" />
                      </span>
                      <h6 className="mb-0 fw-bold pyt-section-title">Payroll Info</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <Row className="g-3">
                        <Col md={4}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">{empDetail?.legal_entity?.entity_name || '—'}</div></Col>
                        <Col md={4}><div className="ep-field-label">Remuneration Type</div><div className="ep-field-value">{empDetail?.salary_frequency || '—'}</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Cycle</div><div className="ep-field-value">Monthly</div></Col>
                        <Col md={4}><div className="ep-field-label">Payroll Status</div><div className="ep-field-value">{empDetail?.enable_payroll ? 'Active' : 'Inactive'}</div></Col>
                        <Col md={4}><div className="ep-field-label">Tax Regime</div><div className="ep-field-value">{empDetail?.tax_regime || '—'}</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Group</div><div className="ep-field-value">{empDetail?.pay_group || '—'}</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <div
                className="d-flex align-items-center gap-2 mb-3 pyt-tax-banner"
              >
                <i className="ri-information-line pyt-icon-16" />
                <span>Income and tax liability is being computed as per <strong>New Tax Regime</strong>. To switch to Old Tax Regime, contact your HR admin.</span>
              </div>

              <div
                className="ep-section-card-flat ep-section-card mb-3 ep-ct-emerald"
              >
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-emerald"
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon ep-icon-emerald">
                      <i className="ri-line-chart-line" />
                    </span>
                    <h6 className="mb-0 fw-bold pyt-section-title">Salary Timeline</h6>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSalaryModalOpen(true)}
                    className="d-inline-flex align-items-center gap-1 fw-semibold pyt-revise-btn"
                  >
                    <i className="ri-edit-line pyt-icon-13" /> Revise Salary
                  </button>
                </div>
                <div className="px-3 py-2 position-relative">
                  {/* Vertical guide line connecting the timeline dots */}
                  <span className="pyt-timeline-guide" />
                  {realTimeline.length === 0 && (
                    <div className="text-muted text-center py-3 pyt-timeline-empty">
                      No salary revisions recorded yet — use <strong>Revise Salary</strong> to set one.
                    </div>
                  )}
                  {realTimeline.map((row, idx) => (
                    <div
                      key={row.id}
                      className="d-flex align-items-center gap-3 py-2 flex-wrap position-relative"
                    >
                      {/* Timeline dot */}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0 pyt-timeline-dot"
                        style={{
                          ['--pyt-dot-bg' as any]: row.current ? '#0ab39c' : 'var(--vz-card-bg)',
                          ['--pyt-dot-border' as any]: row.current ? '3px solid #fff' : '2px solid var(--vz-border-color)',
                          ['--pyt-dot-shadow' as any]: row.current ? '0 0 0 3px #0ab39c, 0 0 0 6px rgba(10,179,156,0.18)' : 'none',
                        }}
                      >
                        {!row.current && <span className="pyt-timeline-dot-inner" />}
                      </span>

                      {/* Row body — current row gets the soft green → white gradient */}
                      <div
                        className="d-flex align-items-center gap-3 flex-grow-1 flex-wrap pyt-timeline-row"
                        style={{
                          ['--pyt-row-bg' as any]: row.current
                            ? 'linear-gradient(90deg, rgba(10,179,156,0.10) 0%, rgba(10,179,156,0.02) 60%, transparent 100%)'
                            : 'transparent',
                          ['--pyt-row-border' as any]: row.current ? '1px solid rgba(10,179,156,0.30)' : '1px solid transparent',
                        }}
                      >
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <p className="mb-0 text-uppercase fw-semibold pyt-timeline-revlabel">SALARY REVISION</p>
                            {row.current && (
                              <span
                                className="d-inline-flex align-items-center fw-bold text-uppercase pyt-timeline-current-badge"
                              >
                                CURRENT
                              </span>
                            )}
                          </div>
                          <small className="pyt-timeline-effective">
                            Effective <span className="fw-semibold pyt-timeline-effective-date">{row.dateShort}</span>
                          </small>
                        </div>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold pyt-timeline-colhead">Regular Salary</p>
                          <div className="fw-bold pyt-timeline-regular">₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <span className="pyt-timeline-equals">=</span>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold pyt-timeline-colhead">Total</p>
                          <div className="fw-bold pyt-timeline-total">₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <button
                          type="button"
                          className="d-inline-flex align-items-center fw-semibold pyt-timeline-breakdown-btn"
                          onClick={() => { setBreakdownRowId(row.id); setBreakdownOpen(true); }}
                        >
                          View Breakdown
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
  );
}
