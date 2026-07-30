// Payroll tab — compensation summary, salary-revision timeline and payslip
// access. Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { useState } from 'react';
import {
  Card, Col, FormGroup, Input, Label, Modal, ModalBody, ModalFooter, Row,
} from 'reactstrap';
import { useEmployeeProfile } from '../EmployeeProfileContext';
import { useToast } from '../../../contexts/ToastContext';
import api from '../../../api';

export default function PayrollTab() {
  const {
    employee, fmtRupee, fmtDate, empDetail, setEmpDetail, payrollTab, setPayrollTab,
    salaryStruct, realMonthlyGross, realAnnualCtc, realTimeline,
    openLatestPayslip, setBreakdownOpen, setBreakdownRowId,
  } = useEmployeeProfile();
  const toast = useToast();

  // ── Bank / payment-details edit ────────────────────────────────────────
  // Bank details were previously captured only at onboarding with no way to
  // correct them afterwards (#35). This modal writes the bank columns via the
  // dedicated PUT /employees/{id}/bank-details endpoint (self-or-can_edit).
  const [bankOpen, setBankOpen] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [bankForm, setBankForm] = useState<Record<string, string>>({});

  const openBankModal = () => {
    setBankForm({
      salary_payment_mode: empDetail?.salary_payment_mode || 'bank',
      bank_name: empDetail?.bank_name || '',
      bank_account_number: empDetail?.bank_account_number || '',
      ifsc_code: empDetail?.ifsc_code || '',
      account_holder_name: empDetail?.account_holder_name || employee?.name || '',
      bank_branch: empDetail?.bank_branch || '',
      bank_account_type: empDetail?.bank_account_type || '',
    });
    setBankOpen(true);
  };

  const setBankField = (k: string, v: string) => setBankForm(p => ({ ...p, [k]: v }));

  const saveBank = async () => {
    const f = bankForm;
    // Mirror the server-side IFSC rule so the user gets instant feedback.
    if (f.ifsc_code && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.ifsc_code.trim())) {
      toast.error('Invalid IFSC', 'Enter a valid IFSC code (e.g. HDFC0001234).');
      return;
    }
    if (!empDetail?.id) return;
    setSavingBank(true);
    try {
      const payload: Record<string, string | null> = {
        salary_payment_mode: f.salary_payment_mode || null,
        bank_name: f.bank_name?.trim() || null,
        bank_account_number: f.bank_account_number?.trim() || null,
        ifsc_code: f.ifsc_code ? f.ifsc_code.trim().toUpperCase() : null,
        account_holder_name: f.account_holder_name?.trim() || null,
        bank_branch: f.bank_branch?.trim() || null,
        bank_account_type: f.bank_account_type?.trim() || null,
      };
      await api.put(`/employees/${empDetail.id}/bank-details`, payload);
      // Merge locally so the read-only cards reflect the change without a refetch.
      setEmpDetail((prev: any) => (prev ? { ...prev, ...payload } : prev));
      toast.success('Bank details updated', 'Payout account has been saved.');
      setBankOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message
        || (Object.values(err?.response?.data?.errors || {})[0] as any)?.[0]
        || 'Could not update bank details.';
      toast.error('Update failed', String(msg));
    } finally {
      setSavingBank(false);
    }
  };

  // Mask a sensitive number, keeping the last `visible` characters.
  const mask = (val: any, visible = 4): string => {
    const s = String(val ?? '').replace(/\s+/g, '');
    if (!s) return '—';
    if (s.length <= visible) return s;
    return 'X'.repeat(Math.max(4, s.length - visible)) + s.slice(-visible);
  };
  // Aadhaar is optional on the employee record. When it is missing the field is
  // dropped entirely instead of rendering a dash — a labelled "Aadhaar Number —"
  // reads as missing/broken data rather than as "not applicable".
  const hasAadhaar = String(empDetail?.aadhaar_number ?? '').replace(/\s+/g, '') !== '';
  const fullAddress = [empDetail?.address_line1, empDetail?.address_line2, empDetail?.city]
    .filter(Boolean).join(', ') || '—';
  const paymentMode = empDetail?.salary_payment_mode === 'bank' ? 'Bank Transfer'
    : empDetail?.salary_payment_mode ? String(empDetail.salary_payment_mode) : '—';

  return (
        <div className="ep-tab-fill">
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
            <div className="ep-tab-pane">
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
                      <div className="d-flex align-items-center gap-2">
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold pyt-pill-amber">
                          <span className="pyt-dot-amber" /> Not Initiated
                        </span>
                        <button
                          type="button"
                          onClick={openBankModal}
                          className="d-inline-flex align-items-center gap-1 fw-semibold pyt-revise-btn"
                          title="Edit bank / payment details"
                        >
                          <i className="ri-edit-line pyt-icon-13" /> Edit
                        </button>
                      </div>
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
                        {hasAadhaar && (
                          <Col md={3}>
                            <div className="ep-field-label">Aadhaar Number</div>
                            <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.aadhaar_number)}</span>
                          </Col>
                        )}
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
                        {hasAadhaar && (
                          <Col md={6}>
                            <div className="ep-field-label">Aadhaar Number</div>
                            <span className="font-monospace fw-semibold pyt-mono-chip">{mask(empDetail?.aadhaar_number)}</span>
                          </Col>
                        )}
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
            </div>
          )}

          {payrollTab === 'details' && (
            <div className="ep-tab-pane">
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
                        <Col md={4}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">{empDetail?.legal_entity?.name || '—'}</div></Col>
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
                </div>
                <div className="px-3 py-2 position-relative">
                  {/* Vertical guide line connecting the timeline dots */}
                  <span className="pyt-timeline-guide" />
                  {realTimeline.length === 0 && (
                    <div className="text-muted text-center py-3 pyt-timeline-empty">
                      No salary revisions recorded yet.
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
            </div>
          )}

          {/* Bank / payment-details editor — fixes #35 (details were write-once
              at onboarding). Saves via PUT /employees/{id}/bank-details. */}
          <Modal
            isOpen={bankOpen}
            toggle={() => !savingBank && setBankOpen(false)}
            centered
            size="lg"
            zIndex={2100}
            modalClassName="ep-bd-modal"
            backdropClassName="ep-bd-backdrop"
            contentClassName="ep-bd-content"
          >
            {/* Standard app modal chrome — same gradient header (indigo →
                violet → purple), rounded corners, white close button and
                gradient primary action used by the Leave modals, so this form
                matches the rest of the app. */}
            <style>{`
              .ep-bd-content {
                border-radius: 16px !important;
                overflow: hidden;
                border: 0;
                box-shadow: 0 25px 60px rgba(15,23,42,0.25);
              }
              .ep-bd-head {
                padding: 18px 22px;
                background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%);
              }
              .ep-bd-head-title { color: #fff !important; letter-spacing: 0.01em; font-size: 16px; }
              .ep-bd-head-sub   { color: rgba(255,255,255,0.85) !important; font-size: 12px; }
              .ep-bd-head-icon {
                display: inline-flex; align-items: center; justify-content: center;
                width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
                background: rgba(255,255,255,0.20); color: #fff;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
              }
              .ep-bd-head-icon i { font-size: 18px; line-height: 1; }
              .ep-bd-head-close {
                width: 30px; height: 30px; border-radius: 8px; border: 0;
                background: rgba(255,255,255,0.18); color: #fff; cursor: pointer;
                flex-shrink: 0; display: inline-flex; align-items: center;
                justify-content: center; transition: background 0.15s ease;
              }
              .ep-bd-head-close:hover:not(:disabled) { background: rgba(255,255,255,0.30); }
              .ep-bd-head-close:disabled { opacity: 0.6; cursor: default; }
              .ep-bd-head-close i { font-size: 16px; line-height: 1; }
              .ep-bd-foot { border-top: 1px solid var(--vz-border-color); }
              /* Footer buttons — ghost Cancel + gradient primary, matching the
                 header so the action colour reads as one system. */
              .ep-bd-btn-cancel {
                border: 1px solid var(--vz-border-color);
                background: transparent; color: var(--vz-secondary-color);
                font-weight: 600; font-size: 13px;
                padding: 8px 18px; border-radius: 8px; cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              }
              .ep-bd-btn-cancel:hover:not(:disabled) { background: var(--vz-light); }
              .ep-bd-btn-save {
                border: 0; color: #fff; font-weight: 700; font-size: 13px;
                padding: 8px 20px; border-radius: 8px; cursor: pointer;
                display: inline-flex; align-items: center; gap: 6px;
                background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%);
                box-shadow: 0 8px 18px rgba(124,92,252,0.30);
                transition: transform 0.15s ease, box-shadow 0.15s ease;
              }
              .ep-bd-btn-save:hover:not(:disabled) { transform: translateY(-1px); }
              .ep-bd-btn-cancel:disabled, .ep-bd-btn-save:disabled { opacity: 0.65; cursor: default; }
            `}</style>
            <div className="ep-bd-head">
              <div className="d-flex align-items-center justify-content-between gap-3">
                <div className="d-flex align-items-center gap-3 min-w-0">
                  <span className="ep-bd-head-icon"><i className="ri-bank-card-line" /></span>
                  <div className="min-w-0">
                    <h5 className="mb-0 fw-bold ep-bd-head-title">Edit Bank &amp; Payment Details</h5>
                    <small className="ep-bd-head-sub">Update your salary payout account</small>
                  </div>
                </div>
                <button
                  type="button"
                  className="ep-bd-head-close"
                  onClick={() => !savingBank && setBankOpen(false)}
                  disabled={savingBank}
                  aria-label="Close"
                >
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>
            <ModalBody>
              <Row className="g-3">
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Salary Payment Mode</Label>
                    <Input
                      type="select"
                      value={bankForm.salary_payment_mode || 'bank'}
                      onChange={e => setBankField('salary_payment_mode', e.target.value)}
                    >
                      <option value="bank">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="cash">Cash</option>
                    </Input>
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Bank Name</Label>
                    <Input
                      value={bankForm.bank_name || ''}
                      maxLength={150}
                      onChange={e => setBankField('bank_name', e.target.value)}
                      placeholder="e.g. HDFC Bank"
                    />
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Account Number</Label>
                    <Input
                      value={bankForm.bank_account_number || ''}
                      maxLength={30}
                      onChange={e => setBankField('bank_account_number', e.target.value)}
                      placeholder="Account number"
                    />
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">IFSC Code</Label>
                    <Input
                      value={bankForm.ifsc_code || ''}
                      maxLength={11}
                      onChange={e => setBankField('ifsc_code', e.target.value.toUpperCase())}
                      placeholder="e.g. HDFC0001234"
                    />
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Name on Account</Label>
                    <Input
                      value={bankForm.account_holder_name || ''}
                      maxLength={150}
                      onChange={e => setBankField('account_holder_name', e.target.value)}
                      placeholder="Account holder name"
                    />
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Branch</Label>
                    <Input
                      value={bankForm.bank_branch || ''}
                      maxLength={150}
                      onChange={e => setBankField('bank_branch', e.target.value)}
                      placeholder="Branch name"
                    />
                  </FormGroup>
                </Col>
                <Col md={6}>
                  <FormGroup className="mb-0">
                    <Label className="ep-field-label">Account Type</Label>
                    <Input
                      type="select"
                      value={bankForm.bank_account_type || ''}
                      onChange={e => setBankField('bank_account_type', e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="Savings">Savings</option>
                      <option value="Current">Current</option>
                      <option value="Salary">Salary</option>
                    </Input>
                  </FormGroup>
                </Col>
              </Row>
            </ModalBody>
            <ModalFooter className="ep-bd-foot">
              <button type="button" className="ep-bd-btn-cancel" onClick={() => setBankOpen(false)} disabled={savingBank}>
                Cancel
              </button>
              <button type="button" className="ep-bd-btn-save" onClick={saveBank} disabled={savingBank}>
                {savingBank ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  <><i className="ri-save-3-line" /> Save Changes</>
                )}
              </button>
            </ModalFooter>
          </Modal>
        </div>
  );
}
