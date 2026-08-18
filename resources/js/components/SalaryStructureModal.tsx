import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, Spinner } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { MasterDatePicker, MasterFormStyles } from '../pages/master/masterFormKit';

export interface SalaryComponent { code: string; label: string; amount: number }

export interface SalaryEmployeeLite {
  employee_id: number;
  name: string;
  emp_code?: string | null;
  department?: string | null;
  designation?: string | null;
  pf_eligible?: boolean;
  pf_type?: string | null; // 'statutory' | 'standard'
  esi_applicable?: boolean;
  annual_salary?: number | null;
  has_structure?: boolean;
  structure_id?: number | null;
  monthly_gross?: number;
  version?: number | null;
  effective_from?: string | null;
  source?: 'structure' | 'annual_salary' | 'none';
}

interface Props {
  open: boolean;
  onClose: () => void;
  employee: SalaryEmployeeLite | null;
  onSaved: () => void;
}

const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
const todayISO = () => new Date().toISOString().slice(0, 10);

// A standard 50 / 30 / 20 split derived from a monthly gross.
const splitFromGross = (gross: number): SalaryComponent[] => {
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(gross * 0.3);
  const special = Math.max(0, gross - basic - hra);
  return [
    { code: 'basic', label: 'Basic Salary', amount: basic },
    { code: 'hra', label: 'House Rent Allowance', amount: hra },
    { code: 'special', label: 'Special Allowance', amount: special },
  ];
};

/**
 * Create / revise an employee's salary structure (Rule 5 + Rule 19). Saving
 * supersedes any active structure and inserts a new version, so payroll picks
 * up the new figures on the next run.
 */
export default function SalaryStructureModal({ open, onClose, employee, onSaved }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [earnings, setEarnings] = useState<SalaryComponent[]>([]);
  const [deductions, setDeductions] = useState<SalaryComponent[]>([]);
  const [pfApplicable, setPfApplicable] = useState(false);
  const [esiApplicable, setEsiApplicable] = useState(false);
  const [ptApplicable, setPtApplicable] = useState(true);
  const [note, setNote] = useState('');

  const grossSeed = useMemo(() => {
    if (!employee) return 0;
    return employee.monthly_gross || (employee.annual_salary ? Math.round(employee.annual_salary / 12) : 0);
  }, [employee]);

  // (Re)initialise the form whenever the modal opens for an employee.
  useEffect(() => {
    if (!open || !employee) return;
    setEffectiveFrom(todayISO());
    setNote('');
    // PF / ESI applicability mirror the employee record (set on the Employee
    // form); they're locked here. PT defaults on (no employee-level flag).
    setPfApplicable(!!employee.pf_eligible);
    setEsiApplicable(!!employee.esi_applicable);
    setPtApplicable(true);

    if (employee.structure_id) {
      // Revising — load the current active structure to prefill.
      setLoading(true);
      api.get(`/salary-structures/${employee.structure_id}`)
        .then(res => {
          const d = res.data?.data ?? {};
          setEarnings((d.earnings ?? []).map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 })));
          setDeductions((d.deductions ?? []).map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 })));
          setPfApplicable(!!d.pf_applicable);
          setEsiApplicable(!!d.esi_applicable);
          setPtApplicable(d.pt_applicable !== false);
        })
        .catch(() => setEarnings(splitFromGross(grossSeed)))
        .finally(() => setLoading(false));
    } else {
      setEarnings(splitFromGross(grossSeed));
      setDeductions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee]);

  const grossTotal = useMemo(() => earnings.reduce((s, c) => s + (Number(c.amount) || 0), 0), [earnings]);
  const dedTotal = useMemo(() => deductions.reduce((s, c) => s + (Number(c.amount) || 0), 0), [deductions]);

  /* Live PF estimate — 12% of the monthly GROSS (business rule, Aug 2026),
     mirroring PayrollService::computeForEmployee(). It used to be 12% of the
     BASIC with the ₹15,000 statutory ceiling for `pf_type` Statutory; that
     branch no longer exists in the engine, so showing it here would quote a
     figure payroll does not deduct. */
  const basicAmt = useMemo(() => Number(earnings.find(c => c.code === 'basic')?.amount) || 0, [earnings]);
  const pfAmt = useMemo(() => {
    if (!pfApplicable) return 0;
    return Math.round(grossTotal * 0.12);
  }, [pfApplicable, grossTotal]);

  // Ticking PF / ESI / Professional Tax drops a labelled row into Fixed
  // Deductions; unticking removes it. PF's amount is auto (12% of basic, by
  // type) and read-only; ESI / PT amounts are entered by HR. None can be
  // deleted directly — untick the box to remove.
  useEffect(() => {
    setDeductions(prev => {
      let next = prev;
      const syncManual = (on: boolean, code: string, label: string) => {
        const has = next.some(d => d.code === code);
        if (on && !has) next = [...next, { code, label, amount: 0 }];
        else if (!on && has) next = next.filter(d => d.code !== code);
      };
      syncManual(esiApplicable, 'esi', 'ESI');
      syncManual(ptApplicable, 'pt', 'Professional Tax');
      // PF — auto amount, kept in sync with the 12% calc.
      const pfIdx = next.findIndex(d => d.code === 'pf');
      if (pfApplicable) {
        if (pfIdx === -1) next = [...next, { code: 'pf', label: 'Provident Fund (PF)', amount: pfAmt }];
        else if (next[pfIdx].amount !== pfAmt) { next = next.map(d => d.code === 'pf' ? { ...d, amount: pfAmt } : d); }
      } else if (pfIdx !== -1) {
        next = next.filter(d => d.code !== 'pf');
      }
      return next === prev ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esiApplicable, ptApplicable, pfApplicable, pfAmt]);

  if (!open || !employee) return null;

  // Net = Gross − PF − fixed deductions. Salary comparison: breakup annualised
  // (gross × 12) vs the employee's annual salary — red over, green at/under.
  const netMonthly = Math.max(0, grossTotal - dedTotal); // PF is now a Fixed Deduction row
  const salaryAnnual = employee.annual_salary ? Math.round(employee.annual_salary) : 0;
  const breakupAnnual = Math.round(grossTotal * 12);
  const salaryDiff = salaryAnnual > 0 ? breakupAnnual - salaryAnnual : 0; // + over, − under
  const overSalary = salaryDiff > 0;

  // A box is LOCKED only when the employee already has it applicable (set on the
  // Employee form) — you can't turn it off here. If it's NOT applicable yet, you
  // CAN enable it here; saving propagates the flag back to the employee record.
  const pfLocked = !!employee.pf_eligible;
  const esiLocked = !!employee.esi_applicable;

  const updateRow = (
    list: SalaryComponent[],
    setList: (v: SalaryComponent[]) => void,
    i: number,
    field: keyof SalaryComponent,
    value: string,
  ) => {
    const next = [...list];
    next[i] = { ...next[i], [field]: field === 'amount' ? (Number(value) || 0) : value };
    setList(next);
  };

  const addRow = (list: SalaryComponent[], setList: (v: SalaryComponent[]) => void) =>
    setList([...list, { code: `comp_${list.length + 1}`, label: '', amount: 0 }]);

  const removeRow = async (list: SalaryComponent[], setList: (v: SalaryComponent[]) => void, i: number) => {
    const comp = list[i];
    const ok = await confirm({
      title: 'Remove component?',
      message: comp?.label?.trim()
        ? <>Remove <strong>{comp.label.trim()}</strong> from the salary structure?</>
        : <>Remove this component from the salary structure?</>,
      tone: 'danger',
      confirmLabel: 'Remove',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    setList(list.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    const clean = earnings.filter(c => c.label.trim() && c.amount >= 0);
    if (!clean.length) { toast.error('Add earnings', 'Add at least one earning component.'); return; }
    if (grossTotal <= 0) { toast.error('Invalid salary', 'Total earnings must be greater than zero.'); return; }
    setSaving(true);
    try {
      const res = await api.post('/salary-structures', {
        employee_id: employee.employee_id,
        effective_from: effectiveFrom,
        earnings: clean.map((c, i) => ({ code: c.code || `comp_${i + 1}`, label: c.label.trim(), amount: c.amount })),
        // Exclude the auto PF row — payroll recomputes PF from pf_applicable
        // + the employee's PF Type, so it's display-only here. ESI / PT rows
        // are saved (payroll honours their manual amounts).
        deductions: deductions.filter(c => c.label.trim() && c.code !== 'pf').map((c, i) => ({ code: c.code || `ded_${i + 1}`, label: c.label.trim(), amount: c.amount })),
        pf_applicable: pfApplicable,
        esi_applicable: esiApplicable,
        pt_applicable: ptApplicable,
        revision_note: note.trim() || undefined,
      });
      toast.success('Salary saved', res.data?.message || `Structure saved for ${employee.name}.`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error('Save failed', err?.response?.data?.message || 'Could not save the salary structure.');
    } finally {
      setSaving(false);
    }
  };

  const compTable = (
    list: SalaryComponent[],
    setList: (v: SalaryComponent[]) => void,
    accent: string,
    label: string,
    kind: 'earn' | 'ded' = 'earn',
  ) => (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.06em', color: accent }}>{label}</span>
        <button type="button" className="btn btn-sm" style={{ fontSize: 11, color: accent, border: `1px solid ${accent}40`, borderRadius: 8, padding: '2px 10px' }}
          onClick={() => addRow(list, setList)}>
          <i className="ri-add-line" /> Add
        </button>
      </div>
      {list.length === 0 && <div className="text-muted mb-2" style={{ fontSize: 12 }}>No components.</div>}
      {list.map((c, i) => {
        // ESI / PT / PF rows are tied to their checkbox: the name is fixed and
        // the row can't be deleted directly (untick to remove). ESI / PT
        // amounts are editable; PF's amount is auto (12%) and read-only.
        const locked = kind === 'ded' && (c.code === 'esi' || c.code === 'pt' || c.code === 'pf');
        const amountLocked = kind === 'ded' && c.code === 'pf';
        return (
        <div key={i} className="d-flex align-items-center gap-2 mb-2">
          <input className="form-control form-control-sm" style={{ flex: 2, background: locked ? 'var(--vz-light, #f3f3f9)' : undefined }} placeholder="Component name"
            value={c.label} readOnly={locked} onChange={e => updateRow(list, setList, i, 'label', e.target.value)} />
          <div className="d-flex align-items-center" style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, fontSize: 12, color: 'var(--vz-secondary-color)' }}>₹</span>
            <input type="number" min={0} className="form-control form-control-sm" style={{ paddingLeft: 18, textAlign: 'right', background: amountLocked ? 'var(--vz-light, #f3f3f9)' : undefined }}
              value={c.amount} readOnly={amountLocked} title={amountLocked ? 'Auto — 12% of the monthly gross' : undefined}
              onChange={e => updateRow(list, setList, i, 'amount', e.target.value)} />
          </div>
          {locked ? (
            <span title="Untick the box above to remove" style={{ width: 28, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}><i className="ri-lock-line" /></span>
          ) : (
            <button type="button" className="btn btn-sm" style={{ color: '#dc2626', padding: '2px 6px' }}
              onClick={() => removeRow(list, setList, i)} title="Remove">
              <i className="ri-delete-bin-line" />
            </button>
          )}
        </div>
        );
      })}
    </div>
  );

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static">
      <MasterFormStyles />
      <ModalBody className="p-0">
        {/* Header */}
        <div style={{ padding: '16px 22px', background: 'linear-gradient(135deg, #5a3fd1, #7c5cfc)', borderTopLeftRadius: 6, borderTopRightRadius: 6 }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2 text-white">
              <i className="ri-money-rupee-circle-line" style={{ fontSize: 22 }} />
              <div>
                <h5 className="mb-0 fw-bold text-white" style={{ fontSize: 16 }}>
                  {employee.has_structure ? 'Revise Salary' : 'Set Salary'} — {employee.name}
                </h5>
                <small style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11.5 }}>
                  {employee.emp_code}{employee.has_structure ? ` · revising v${''}` : ' · new structure'}
                </small>
              </div>
            </div>
            <button type="button" className="btn btn-sm" style={{ color: '#fff' }} onClick={onClose}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5"><Spinner /></div>
        ) : (
          <div style={{ padding: '18px 22px' }}>
            <div className="row g-3 mb-3">
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 12 }}>Effective From</label>
                <MasterDatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Select date" />
              </div>
              <div className="col-md-8">
                {/* Locked (✓ from the Employee form) → can't turn off, edit amount
                    only. Unlocked → you can enable it here; it updates the
                    employee + onboarding forms on save. */}
                <div className="d-flex align-items-end gap-3 flex-wrap">
                  <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5, color: pfLocked ? 'var(--vz-secondary-color)' : undefined, cursor: pfLocked ? 'not-allowed' : 'pointer' }} title={pfLocked ? 'Set on the Employee form' : ''}>
                    <input type="checkbox" checked={pfApplicable} disabled={pfLocked} onChange={e => { if (!pfLocked) setPfApplicable(e.target.checked); }} /> PF (12%){pfLocked && <i className="ri-lock-line" style={{ fontSize: 11, color: '#9ca3af' }} />}
                  </label>
                  <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5, color: esiLocked ? 'var(--vz-secondary-color)' : undefined, cursor: esiLocked ? 'not-allowed' : 'pointer' }} title={esiLocked ? 'Set on the Employee form' : ''}>
                    <input type="checkbox" checked={esiApplicable} disabled={esiLocked} onChange={e => { if (!esiLocked) setEsiApplicable(e.target.checked); }} /> ESI{esiLocked && <i className="ri-lock-line" style={{ fontSize: 11, color: '#9ca3af' }} />}
                  </label>
                  <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ptApplicable} onChange={e => setPtApplicable(e.target.checked)} /> Professional Tax
                  </label>
                </div>
                <small className="text-muted" style={{ fontSize: 10.5 }}>🔒 = already set on the Employee form (locked). Enable an unlocked one here and it updates the Employee &amp; onboarding forms too.</small>
              </div>
            </div>

            {/* How the split + PF are derived, so anyone reading the breakup
                understands the figures (same statements as the Employee form). */}
            <ul style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7, paddingLeft: 16, marginBottom: 12 }}>
              <li><strong>Basic Salary</strong> — 50% of monthly gross (statutory minimum, Code on Wages 2019).</li>
              <li><strong>House Rent Allowance (HRA)</strong> — 30% of monthly gross.</li>
              <li><strong>Special Allowance</strong> — the remaining balance after Basic + HRA.</li>
              <li><strong>PF Deduction</strong> — <strong>12% of the monthly gross</strong>. ESI / PT are the fixed-deduction rows you enter, and they are deducted <strong>in full</strong> each cycle (never scaled down for a part-month or loss of pay).</li>
            </ul>

            <div className="row g-4">
              <div className="col-md-6">{compTable(earnings, setEarnings, '#108548', 'Earnings')}</div>
              <div className="col-md-6">{compTable(deductions, setDeductions, '#b91c1c', 'Fixed Deductions (optional)', 'ded')}</div>
            </div>

            {/* Totals + live PF / Net — mirrors the Employee form breakup. */}
            <div className="d-flex align-items-center justify-content-between mt-3 p-2 px-3" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
              <span className="fw-semibold" style={{ fontSize: 13 }}>Monthly Gross</span>
              <div className="text-end">
                <div className="fw-bold" style={{ fontSize: 18, color: '#5a3fd1' }}>₹{fmtINR(grossTotal)}</div>
                {/* Annualised gross vs the employee's salary — red over, green at/under. */}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: salaryAnnual <= 0 ? 'var(--vz-secondary-color)' : (overSalary ? '#dc2626' : '#0a8754') }}>
                  ≈ ₹{fmtINR(breakupAnnual)} / year
                </div>
                {salaryAnnual > 0 && salaryDiff !== 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: overSalary ? '#dc2626' : '#0a8754' }}>
                    {overSalary
                      ? `₹${fmtINR(salaryDiff)} over the salary (₹${fmtINR(salaryAnnual)})`
                      : `₹${fmtINR(Math.abs(salaryDiff))} under the salary (₹${fmtINR(salaryAnnual)})`}
                  </div>
                )}
                {salaryAnnual > 0 && salaryDiff === 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#0a8754' }}>Matches the salary amount</div>
                )}
              </div>
            </div>
            {dedTotal > 0 && (
              <div className="d-flex align-items-center justify-content-between mt-2 px-3" style={{ fontSize: 12.5 }}>
                <span className="text-muted">Fixed Deductions (incl. PF)</span>
                <span className="fw-semibold" style={{ color: '#b91c1c' }}>− ₹{fmtINR(dedTotal)}/mo</span>
              </div>
            )}
            {dedTotal > 0 && (
              <div className="d-flex align-items-center justify-content-between mt-2 p-2 px-3" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
                <span className="fw-semibold" style={{ fontSize: 13 }}>Net (Monthly)</span>
                <div className="text-end">
                  <div className="fw-bold" style={{ fontSize: 18, color: '#0a8754' }}>₹{fmtINR(netMonthly)}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>Gross ₹{fmtINR(grossTotal)} − Deductions ₹{fmtINR(dedTotal)}</div>
                </div>
              </div>
            )}
            <div className="text-muted mt-2" style={{ fontSize: 11 }}>Net shown is an estimate (PF + fixed deductions); ESI / PT / LOP further apply at payroll run-time.</div>

            <div className="mt-3">
              <label className="form-label fw-semibold" style={{ fontSize: 12 }}>Revision note <span className="text-muted">(optional)</span></label>
              <input className="form-control form-control-sm" placeholder="e.g. Annual increment April 2026" value={note} onChange={e => setNote(e.target.value)} />
            </div>

            <div className="d-flex justify-content-end gap-2 mt-4">
              <button type="button" className="master-modal-cancel" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="master-modal-save" onClick={save} disabled={saving}>
                {saving ? <Spinner size="sm" /> : <i className="ri-save-line" />}
                {employee.has_structure ? 'Save Revision' : 'Save Salary'}
              </button>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
