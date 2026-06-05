import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, Spinner } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

export interface SalaryComponent { code: string; label: string; amount: number }

export interface SalaryEmployeeLite {
  employee_id: number;
  name: string;
  emp_code?: string | null;
  department?: string | null;
  designation?: string | null;
  pf_eligible?: boolean;
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
    setPfApplicable(!!employee.pf_eligible);
    setPtApplicable(true);
    setEsiApplicable(false);

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

  if (!open || !employee) return null;

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

  const removeRow = (list: SalaryComponent[], setList: (v: SalaryComponent[]) => void, i: number) =>
    setList(list.filter((_, idx) => idx !== i));

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
        deductions: deductions.filter(c => c.label.trim()).map((c, i) => ({ code: c.code || `ded_${i + 1}`, label: c.label.trim(), amount: c.amount })),
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
      {list.map((c, i) => (
        <div key={i} className="d-flex align-items-center gap-2 mb-2">
          <input className="form-control form-control-sm" style={{ flex: 2 }} placeholder="Component name"
            value={c.label} onChange={e => updateRow(list, setList, i, 'label', e.target.value)} />
          <div className="d-flex align-items-center" style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, fontSize: 12, color: 'var(--vz-secondary-color)' }}>₹</span>
            <input type="number" min={0} className="form-control form-control-sm" style={{ paddingLeft: 18, textAlign: 'right' }}
              value={c.amount} onChange={e => updateRow(list, setList, i, 'amount', e.target.value)} />
          </div>
          <button type="button" className="btn btn-sm" style={{ color: '#dc2626', padding: '2px 6px' }}
            onClick={() => removeRow(list, setList, i)} title="Remove">
            <i className="ri-delete-bin-line" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static">
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
                <input type="date" className="form-control form-control-sm" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="col-md-8 d-flex align-items-end gap-3 flex-wrap">
                <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5 }}>
                  <input type="checkbox" checked={pfApplicable} onChange={e => setPfApplicable(e.target.checked)} /> PF (12%)
                </label>
                <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5 }}>
                  <input type="checkbox" checked={esiApplicable} onChange={e => setEsiApplicable(e.target.checked)} /> ESI
                </label>
                <label className="d-flex align-items-center gap-1" style={{ fontSize: 12.5 }}>
                  <input type="checkbox" checked={ptApplicable} onChange={e => setPtApplicable(e.target.checked)} /> Professional Tax
                </label>
              </div>
            </div>

            <div className="row g-4">
              <div className="col-md-6">{compTable(earnings, setEarnings, '#108548', 'Earnings')}</div>
              <div className="col-md-6">{compTable(deductions, setDeductions, '#b91c1c', 'Fixed Deductions (optional)')}</div>
            </div>

            {/* Totals */}
            <div className="d-flex align-items-center justify-content-between mt-3 p-2 px-3" style={{ background: 'var(--vz-secondary-bg)', borderRadius: 10, border: '1px solid var(--vz-border-color)' }}>
              <span className="fw-semibold" style={{ fontSize: 13 }}>Monthly Gross (CTC)</span>
              <span className="fw-bold" style={{ fontSize: 18, color: '#5a3fd1' }}>₹{fmtINR(grossTotal)}</span>
            </div>
            {dedTotal > 0 && (
              <div className="text-muted text-end mt-1" style={{ fontSize: 11.5 }}>Fixed deductions: ₹{fmtINR(dedTotal)} · PF/ESI/PT/LOP are computed at payroll run-time.</div>
            )}

            <div className="mt-3">
              <label className="form-label fw-semibold" style={{ fontSize: 12 }}>Revision note <span className="text-muted">(optional)</span></label>
              <input className="form-control form-control-sm" placeholder="e.g. Annual increment April 2026" value={note} onChange={e => setNote(e.target.value)} />
            </div>

            <div className="d-flex justify-content-end gap-2 mt-4">
              <button type="button" className="btn btn-light" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="btn fw-semibold text-white d-inline-flex align-items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)', border: 'none', opacity: saving ? 0.7 : 1 }}
                onClick={save} disabled={saving}>
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
