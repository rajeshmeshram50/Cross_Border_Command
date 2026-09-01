import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, Spinner } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { MasterDatePicker, MasterFormStyles } from '../pages/master/masterFormKit';
import { pfDeduction } from '../utils/salaryBreakup';

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
  /** A live exit case is open for this employee (status stays 'Active' until
   *  the exit is finalised, so it cannot be read off `status`). */
  exit_in_progress?: boolean;
  exit_last_working_day?: string | null;
  /** Seeds Effective From, and floors the picker — a salary cannot take effect
   *  before the employee joined. */
  date_of_joining?: string | null;
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
  /* PF Type decides the base PF is charged on — Statutory caps the basic at the
     ₹15,000 EPF ceiling, Standard uses the full basic. The Employee form has
     always offered it; Revise Salary only ever displayed its effect, so HR
     revising a salary here could not correct a wrong PF Type without leaving
     for the employee record. Same two values, same lowercase storage. (#127) */
  const [pfType, setPfType] = useState<'Statutory' | 'Standard'>('Statutory');
  const [esiApplicable, setEsiApplicable] = useState(false);
  const [ptApplicable, setPtApplicable] = useState(true);
  const [note, setNote] = useState('');
  /* Annual CTC this revision agrees (#101). Held as a STRING so the field can be
     cleared while typing — a number state would snap an empty box back to 0 and
     re-seed the whole breakup from zero on every keystroke. */
  const [annualCtc, setAnnualCtc] = useState('');

  const grossSeed = useMemo(() => {
    if (!employee) return 0;
    return employee.monthly_gross || (employee.annual_salary ? Math.round(employee.annual_salary / 12) : 0);
  }, [employee]);

  // (Re)initialise the form whenever the modal opens for an employee.
  useEffect(() => {
    if (!open || !employee) return;
    /* Seeded from the joining date, not today (#87). A salary runs from the
       day the employee joined — the Add/Edit Employee wizard already enforces
       exactly that ("Salary effective date must be the same as the joining
       date"), and this screen was the one place that ignored it and opened on
       whatever today happened to be. Falls back to today only when the record
       carries no joining date. */
    setEffectiveFrom(employee.date_of_joining || todayISO());
    setNote('');
    /* Seed the CTC from whatever the employee is on today, so opening the modal
       and saving without touching it is a no-op rather than a silent change.
       Falls back to the structure's own annualised gross when the employee
       record carries no salary (source: 'structure'). */
    setAnnualCtc(String(
      employee.annual_salary
        ? Math.round(employee.annual_salary)
        : (employee.monthly_gross ? Math.round(employee.monthly_gross * 12) : ''),
    ));
    // PF / ESI applicability mirror the employee record (set on the Employee
    // form); they're locked here. PT defaults on (no employee-level flag).
    setPfApplicable(!!employee.pf_eligible);
    setEsiApplicable(!!employee.esi_applicable);
    setPtApplicable(true);
    // Anything but an explicit 'standard' is statutory — matches PayrollService.
    setPfType(String(employee.pf_type ?? '').toLowerCase() === 'standard' ? 'Standard' : 'Statutory');

    if (employee.structure_id) {
      // Revising — load the current active structure to prefill.
      setLoading(true);
      api.get(`/salary-structures/${employee.structure_id}`)
        .then(res => {
          const d = res.data?.data ?? {};
          setEarnings((d.earnings ?? []).map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 })));
          setDeductions((d.deductions ?? []).map((c: any) => ({ code: c.code, label: c.label, amount: Number(c.amount) || 0 })));
          /* The EMPLOYEE record is the master for applicability, so a stale
             structure flag must not hide a deduction the employee is entitled
             to. Seeding from the structure alone produced an impossible state:
             pf_eligible on the employee disabled the box, while pf_applicable
             false on the structure left it unticked — so PF was missing from
             Salary Setup with no way to add it (#89). */
          /* Show the date the structure ACTUALLY carries. (#124)
             The field was seeded from the joining date above and nothing here
             ever overwrote it, so a saved Effective From was never displayed
             back: change the date, save, reopen — and the joining date was on
             screen again. The value had persisted correctly all along; the
             screen simply never read it, which is indistinguishable from the
             save having failed. Falls back to the roster's copy, then to the
             joining date, so a structure without one still opens sensibly. */
          setEffectiveFrom(d.effective_from || employee.effective_from || employee.date_of_joining || todayISO());
          setPfApplicable(!!d.pf_applicable || !!employee.pf_eligible);
          setEsiApplicable(!!d.esi_applicable || !!employee.esi_applicable);
          /* Read the saved flag as it is. `d.pt_applicable !== false` treated a
             MISSING field as ticked, which is the state the ticket names — the
             box reads "Professional Tax applies" on the strength of a value the
             response never carried. The API always sends a boolean, so this is
             the same answer whenever there is one, and an honest "no" when
             there is not. (#117) */
          setPtApplicable(!!d.pt_applicable);
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

  /* Live PF estimate — 12% of BASIC on the statutory basis, mirroring
     PayrollService::computeForEmployee(): `pf_type` Statutory (or unset) caps
     the basic at the ₹15,000 EPF ceiling, Standard uses the full basic.
     Shares pfDeduction() with the employee form and the onboarding wizard so
     all three quote the one figure payroll will deduct. */
  const basicAmt = useMemo(() => Number(earnings.find(c => c.code === 'basic')?.amount) || 0, [earnings]);
  const pfAmt = useMemo(
    // Quotes the type SELECTED here, not the one on record, so the estimate
    // tracks the dropdown as HR changes it. (#127)
    () => pfDeduction(basicAmt, pfType, pfApplicable),
    [basicAmt, pfType, pfApplicable],
  );

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
    /* `deductions` is a dependency, and that is the whole fix for #117.
     *
     * Opening an existing structure runs this effect on mount (adding the PT /
     * ESI rows for the ticked boxes), and THEN the async fetch replaces the
     * whole deductions array with the saved one. Keyed only on the checkboxes,
     * this effect did not re-run for that — the flags had not changed — so the
     * rows it had just added were silently discarded. Professional Tax then sat
     * ticked with no PT row underneath it: the box said the deduction applied
     * and there was no field to enter it in, on every structure in the system
     * (all 44 carry pt_applicable = true and none carries a saved PT row).
     *
     * Re-running when the rows change re-asserts the invariant "a ticked box
     * has its row, an unticked one does not" whatever replaced the array. It
     * cannot loop: the updater returns the SAME reference when nothing needs
     * changing, which React treats as a no-op and does not re-render for. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esiApplicable, ptApplicable, pfApplicable, pfAmt, deductions]);

  if (!open || !employee) return null;

  // Net = Gross − PF − fixed deductions. Salary comparison: breakup annualised
  // (gross × 12) vs the employee's annual salary — red over, green at/under.
  const netMonthly = Math.max(0, grossTotal - dedTotal); // PF is now a Fixed Deduction row
  /* The target the breakup is measured against is now the Annual CTC FIELD, not
     the employee record (#101). Previously this read employee.annual_salary,
     which the modal had no way to change — so the screen could re-split a CTC
     but never revise it, and an increment was rejected with "raise the salary on
     the employee record first". A blank / unparseable box means no target, which
     is the same "nothing to validate against" state the server allows. */
  const ctcParsed = Number(annualCtc);
  const salaryAnnual = annualCtc.trim() !== '' && Number.isFinite(ctcParsed) && ctcParsed > 0
    ? Math.round(ctcParsed)
    : 0;
  /* Typed something, but not a usable number (blank, 0, negative, or text the
     number input let through). Blocks the save with a specific message instead
     of silently falling back to "no CTC configured". */
  const ctcInvalid = annualCtc.trim() === '' || !Number.isFinite(ctcParsed) || ctcParsed <= 0;
  // decimal(14,2) ceiling — the same bound EmployeeController puts on the column.
  const CTC_MAX = 999999999999.99;
  const ctcTooLarge = Number.isFinite(ctcParsed) && ctcParsed > CTC_MAX;
  const breakupAnnual = Math.round(grossTotal * 12);
  const salaryDiff = salaryAnnual > 0 ? breakupAnnual - salaryAnnual : 0; // + over, − under
  /* Rounding slack, matching SalaryStructureController::SALARY_ROUNDING_SLACK.
     The default split is seeded from annual ÷ 12 rounded to the rupee, so a
     legitimate breakup can annualise a few rupees high (₹5,00,000 →
     ₹41,667/mo → ₹5,00,004/yr). Without this the form would flag — and the
     server would reject — its own seeded values. */
  const SALARY_SLACK = 12;
  const overSalary = salaryDiff > SALARY_SLACK;
  const underSalary = salaryDiff < -SALARY_SLACK;

  /* All three boxes are editable (#88).
   *
   * PF and ESI used to be locked whenever the employee record already had them
   * applicable, while Professional Tax was always editable — because PT has no
   * employee-level field to lock against. That left one row greyed out and the
   * next one beside it live, with no visible reason for the difference.
   *
   * Locking was also what produced #89: a locked box seeded false from the
   * structure could be neither shown as applicable nor switched on.
   *
   * Nothing is lost by unlocking. The two records are kept in step both ways —
   * saving here writes the flags back to the employee
   * (SalaryStructureController::store), and editing the employee mirrors them
   * onto the active structure (EmployeeController::update, #90) — so whichever
   * screen is used, the pair stays consistent. */

  /**
   * Re-split the earnings 50/30/20 for a newly-typed Annual CTC (#101).
   *
   * Typing a CTC alone would only move the target and leave the components
   * where they were, so the form would immediately report itself as over or
   * short and refuse to save — the user would have to hand-adjust three rows to
   * match a figure they just typed. Re-seeding keeps the two sides in step by
   * default; the rows stay editable afterwards for a non-standard split.
   *
   * Only the three DEFAULT components are rewritten. A custom earning HR added
   * (a fixed allowance, say) is preserved and its amount is honoured — the
   * remainder after Basic + HRA is what Special absorbs, so the gross still
   * lands on the CTC exactly. Deductions are untouched: PF re-derives from the
   * new basic through the existing effect, and ESI / PT are HR's own figures.
   */
  const applyCtc = (raw: string) => {
    setAnnualCtc(raw);
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n <= 0 || n > CTC_MAX) return;

    const monthly = Math.round(n / 12);
    const basic = Math.round(monthly * 0.5);
    const hra = Math.round(monthly * 0.3);
    setEarnings(prev => {
      // Nothing to preserve — seed a clean default split.
      if (!prev.length) return splitFromGross(monthly);

      const isDefault = (c: SalaryComponent) => ['basic', 'hra', 'special'].includes(c.code);
      const customs = prev.filter(c => !isDefault(c));
      const customTotal = customs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      /* Custom components alone already exceed the CTC — re-splitting would
         have to make Basic negative. Leave the rows alone and let the
         over-salary banner report it, which is the honest outcome: the user has
         to lower a component or raise the CTC, and silently clamping to zero
         would hide that. */
      if (customTotal > monthly) return prev;

      const special = Math.max(0, monthly - customTotal - basic - hra);
      const next = prev.map(c => {
        if (c.code === 'basic') return { ...c, amount: basic };
        if (c.code === 'hra') return { ...c, amount: hra };
        if (c.code === 'special') return { ...c, amount: special };
        return c;
      });
      /* A structure with no 'special' row cannot absorb the remainder, so the
         gross would fall short of the CTC by exactly that amount. Add the row
         back rather than leaving the form in a state it reports as invalid. */
      if (special > 0 && !next.some(c => c.code === 'special')) {
        next.push({ code: 'special', label: 'Special Allowance', amount: special });
      }
      return next;
    });
  };

  /**
   * Keep the earnings adding up to the Annual CTC by moving the difference into
   * the BALANCE component. (#125)
   *
   * The breakup is a split of an agreed figure, not a list that happens to have
   * a total — the panel above says as much: "Special Allowance — the remaining
   * balance after Basic + HRA". Nothing enforced it once the rows were edited,
   * so replacing a component meant deleting one (its amount folds into Basic,
   * gross preserved) and then adding another — whose amount landed ON TOP.
   * A ₹5,00,000 CTC came out at ₹5,28,084 a year and the form refused to save,
   * leaving the user to hand-balance three rows to a figure the form already
   * knew.
   *
   * Special absorbs it, falling back to Basic when a structure has no Special
   * row. Editing the balance row ITSELF is left alone — that is someone stating
   * the figure deliberately, and quietly moving it back would fight them; the
   * over/short banner and "Balance to Basic" still cover that case.
   *
   * Nothing is forced negative: if the other rows already exceed the CTC there
   * is no split to find, so the rows stay as typed and the banner reports it,
   * which is the honest outcome.
   */
  const rebalanceEarnings = (rows: SalaryComponent[], editedIdx: number): SalaryComponent[] => {
    if (salaryAnnual <= 0) return rows;                       // no target to balance against
    if (rows[editedIdx]?.code === 'special') return rows;     // explicit edit of the balance head

    const monthly = Math.round(salaryAnnual / 12);
    let idx = rows.findIndex((c, k) => k !== editedIdx && c.code === 'special');
    if (idx === -1) idx = rows.findIndex((c, k) => k !== editedIdx && c.code === 'basic');
    if (idx === -1) return rows;

    const others = rows.reduce((s, c, k) => k === idx ? s : s + (Number(c.amount) || 0), 0);
    const balance = Math.round(monthly - others);
    if (balance < 0) return rows;

    return rows.map((c, k) => (k === idx ? { ...c, amount: balance } : c));
  };

  const updateRow = (
    list: SalaryComponent[],
    setList: (v: SalaryComponent[]) => void,
    i: number,
    field: keyof SalaryComponent,
    value: string,
    kind: 'earn' | 'ded' = 'earn',
  ) => {
    const next = [...list];
    next[i] = { ...next[i], [field]: field === 'amount' ? (Number(value) || 0) : value };
    // Only earnings are a split of the CTC — a deduction is its own figure.
    setList(kind === 'earn' && field === 'amount' ? rebalanceEarnings(next, i) : next);
  };

  const addRow = (list: SalaryComponent[], setList: (v: SalaryComponent[]) => void) =>
    setList([...list, { code: `comp_${list.length + 1}`, label: '', amount: 0 }]);

  /**
   * Removing an EARNING keeps the monthly gross where it was: the deleted
   * amount is folded into Basic Salary rather than vanishing.
   *
   * The gross is the employee's agreed pay — restructuring how it is split
   * between Basic / HRA / Special is not meant to change what they earn.
   * Deleting a row used to just drop its amount, so a ₹33,333 gross split
   * 16,667 / 10,000 / 6,666 collapsed to ₹16,667 the moment HRA and Special
   * were removed, silently halving the salary.
   *
   * Basic is the target because it is the component every structure has and
   * the one statutory heads are priced off. If Basic itself is the row being
   * removed (or there is no Basic), the amount goes to the first remaining
   * earning so the total still holds. Deductions are NOT merged — one
   * deduction is not a substitute for another.
   */
  const removeRow = async (
    list: SalaryComponent[],
    setList: (v: SalaryComponent[]) => void,
    i: number,
    kind: 'earn' | 'ded' = 'earn',
  ) => {
    const comp = list[i];
    const amount = Number(comp?.amount) || 0;

    let mergeIdx = -1;
    if (kind === 'earn' && amount > 0) {
      mergeIdx = list.findIndex((c, idx) => idx !== i && c.code === 'basic');
      if (mergeIdx === -1) mergeIdx = list.findIndex((_, idx) => idx !== i);
    }
    const mergeLabel = mergeIdx !== -1 ? (list[mergeIdx].label.trim() || 'the first earning') : null;

    const ok = await confirm({
      title: 'Remove component?',
      message: (
        <>
          {comp?.label?.trim()
            ? <>Remove <strong>{comp.label.trim()}</strong> from the salary structure?</>
            : <>Remove this component from the salary structure?</>}
          {mergeLabel && (
            <> Its ₹{fmtINR(amount)} will be added to <strong>{mergeLabel}</strong>, so the monthly gross stays ₹{fmtINR(grossTotal)}.</>
          )}
        </>
      ),
      tone: 'danger',
      confirmLabel: 'Remove',
      icon: 'delete-bin-line',
    });
    if (!ok) return;

    // Credit the target first, then drop the row — doing it in this order
    // keeps the indexes valid regardless of which side the target sits on.
    setList(
      list
        .map((c, idx) => (idx === mergeIdx ? { ...c, amount: (Number(c.amount) || 0) + amount } : c))
        .filter((_, idx) => idx !== i),
    );
  };

  /**
   * Put the whole difference between the breakup and the configured salary
   * into Basic Salary, so a mismatch can be corrected in one click instead of
   * the user having to work out the arithmetic themselves.
   *
   * The monthly delta is rounded to the rupee, which can leave the annualised
   * total a few rupees off — that is exactly what SALARY_SLACK exists to
   * absorb, so the result always saves.
   */
  const balanceToBasic = () => {
    const deltaMonthly = Math.round((salaryAnnual - breakupAnnual) / 12); // + add, − remove
    if (!deltaMonthly) return;
    setEarnings(prev => {
      if (!prev.length) {
        return [{ code: 'basic', label: 'Basic Salary', amount: Math.max(0, deltaMonthly) }];
      }
      const idx = prev.findIndex(c => c.code === 'basic');
      const target = idx !== -1 ? idx : 0;
      return prev.map((c, i) =>
        i === target ? { ...c, amount: Math.max(0, (Number(c.amount) || 0) + deltaMonthly) } : c);
    });
  };

  const save = async () => {
    const clean = earnings.filter(c => c.label.trim() && c.amount >= 0);
    if (!clean.length) { toast.error('Add earnings', 'Add at least one earning component.'); return; }
    if (grossTotal <= 0) { toast.error('Invalid salary', 'Total earnings must be greater than zero.'); return; }
    /* Annual CTC is required and must be a positive number within the column's
       range (#101). The number input stops most bad entries, but it does not
       stop an empty box, a pasted negative, or a figure past decimal(14,2) —
       and the endpoint is callable without the form at all, so the API enforces
       the identical bounds. */
    if (ctcInvalid) {
      toast.error('Annual CTC required', 'Enter the Annual CTC for this revision — it must be greater than 0.');
      return;
    }
    if (ctcTooLarge) {
      toast.error('Annual CTC too large', 'Annual CTC must be ₹999,999,999,999.99 or less. Check the figure.');
      return;
    }
    /* The breakup has to ADD UP to the salary on the employee record — not more
       (#70) and not less (#74). Both were shown in red but neither was
       enforced, so an over-figure saved and got paid, and an under-figure
       (components typed down to ₹1) silently reduced the agreed salary. The
       server refuses both; this reports it without a round trip. */
    if (overSalary || underSalary) {
      toast.error(
        overSalary ? 'Salary exceeds the configured amount' : 'Salary is short of the configured amount',
        `The breakup comes to ₹${fmtINR(breakupAnnual)} a year — ₹${fmtINR(Math.abs(salaryDiff))} `
        + `${overSalary ? 'more than' : 'short of'} the Annual CTC of ₹${fmtINR(salaryAnnual)}. `
        // Both remedies are now on THIS form — the CTC field is here, so the old
        // "change the employee record first" advice no longer applies (#101).
        + (overSalary
            ? 'Reduce the components, or raise the Annual CTC above.'
            : 'Use "Balance to Basic" to put the difference back, or lower the Annual CTC above.'),
      );
      return;
    }
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
        // Lowercase to match the employee column's storage; null when PF is
        // off, mirroring the Employee form's payload exactly. (#127)
        pf_type: pfApplicable ? pfType.toLowerCase() : null,
        esi_applicable: esiApplicable,
        pt_applicable: ptApplicable,
        revision_note: note.trim() || undefined,
        // The CTC this revision agrees — the server validates the breakup
        // against THIS, then writes it to the employee record (#101).
        annual_ctc: salaryAnnual,
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
    <div className="ssm-panel" data-kind={kind}>
      <div className="ssm-panel-head">
        <span className="ssm-panel-title">
          <span className="ssm-dot" style={{ background: accent }} />
          {label}
        </span>
        <span className="ssm-panel-tools">
          <span className="ssm-panel-count">{list.length}</span>
          <button type="button" className="ssm-add" onClick={() => addRow(list, setList)}>
            <i className="ri-add-line" /> Add
          </button>
        </span>
      </div>

      <div className="ssm-rows">
        {list.length === 0 && (
          <div className="ssm-empty">
            <i className="ri-inbox-line" />
            <span>{kind === 'ded' ? 'No fixed deductions' : 'No components yet'}</span>
          </div>
        )}
        {list.map((c, i) => {
          // ESI / PT / PF rows are tied to their checkbox: the name is fixed and
          // the row can't be deleted directly (untick to remove). ESI / PT
          // amounts are editable; PF's amount is auto (12%) and read-only.
          const locked = kind === 'ded' && (c.code === 'esi' || c.code === 'pt' || c.code === 'pf');
          const amountLocked = kind === 'ded' && c.code === 'pf';
          return (
            <div className="ssm-row" key={i} data-locked={locked ? '1' : undefined}>
              <input
                className="ssm-input ssm-input--name"
                placeholder="Component name"
                value={c.label}
                readOnly={locked}
                onChange={e => updateRow(list, setList, i, 'label', e.target.value, kind)}
              />
              <div className="ssm-amount">
                <span className="ssm-rupee">₹</span>
                <input
                  type="number"
                  min={0}
                  className="ssm-input ssm-input--amount"
                  value={c.amount}
                  readOnly={amountLocked}
                  title={amountLocked ? 'Auto — 12% of Basic Salary (capped at the ₹15,000 EPF ceiling unless PF Type is Standard)' : undefined}
                  onChange={e => updateRow(list, setList, i, 'amount', e.target.value, kind)}
                />
              </div>
              {locked ? (
                <span className="ssm-row-lock" title="Untick the statutory toggle above to remove">
                  <i className="ri-lock-2-line" />
                </span>
              ) : (
                <button
                  type="button"
                  className="ssm-row-del"
                  onClick={() => removeRow(list, setList, i, kind)}
                  title="Remove component"
                >
                  <i className="ri-delete-bin-line" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* What a ZERO on a statutory row means, because it does not mean "no
          deduction". PayrollService uses a manual amount only when it is
          greater than zero; at zero it falls back to the state PT slab / the
          statutory 0.75% ESI. Without this, a ticked box showing ₹0 reads as
          the deduction having failed — which is half of what #117 reported. */}
      {/* Which row takes up the slack, so the auto-adjustment is expected
          rather than surprising. (#125) */}
      {kind === 'earn' && salaryAnnual > 0 && list.some(c => c.code === 'special' || c.code === 'basic') && (
        <div className="ssm-panel-foot">
          <i className="ri-scales-3-line" />
          <span>
            {list.some(c => c.code === 'special') ? 'Special Allowance' : 'Basic Salary'} balances
            automatically so the breakup always totals the Annual CTC. Edit it directly to override.
          </span>
        </div>
      )}
      {kind === 'ded' && list.some(c => c.code === 'pt' || c.code === 'esi') && (
        <div className="ssm-panel-foot">
          <i className="ri-information-line" />
          <span>Leave at ₹0 to let payroll compute it — PT from the state slab, ESI at 0.75% of gross. Enter an amount only to override with a flat figure.</span>
        </div>
      )}
    </div>
  );

  const initials = (employee.name || '?')
    .split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <Modal
      isOpen={open}
      toggle={onClose}
      centered
      size="lg"
      backdrop="static"
      className="ssm-modal"
      contentClassName="ssm-card"
    >
      <MasterFormStyles />
      <SalaryModalStyles />
      <ModalBody className="p-0 ssm-shell">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="ssm-hero">
          <div className="ssm-hero-glow" />
          <div className="ssm-hero-main">
            <span className="ssm-avatar">{initials}</span>
            <div className="ssm-hero-text">
              <h5 className="ssm-title">
                {employee.has_structure ? 'Revise Salary' : 'Set Salary'}
                <span className="ssm-title-sep">—</span>
                <span className="ssm-title-emp">{employee.name}</span>
              </h5>
              <div className="ssm-chips">
                {employee.emp_code && <span className="ssm-chip">{employee.emp_code}</span>}
                {employee.designation && <span className="ssm-chip">{employee.designation}</span>}
                <span className="ssm-chip ssm-chip--solid">
                  {employee.has_structure
                    ? `Revising${employee.version ? ` v${employee.version}` : ''}`
                    : 'New structure'}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="ssm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {loading ? (
          <div className="ssm-loading">
            <Spinner style={{ width: 26, height: 26, color: '#5a3fd1' }} />
            <span>Loading the current structure…</span>
          </div>
        ) : (
          <div className="ssm-body">
            <div className="ssm-section">
              <div className="ssm-section-head">
                <span className="ssm-section-title">Package</span>
                <span className="ssm-section-sub">What this revision agrees, and when it starts</span>
              </div>

              <div className="ssm-grid">
              {/* Annual CTC (#101). Absent from this modal until now, while the
                  Edit Employee → Compensation step had it — so the two screens
                  that write the same column disagreed about whether it was
                  editable, and this one silently required the breakup to match a
                  figure it would not show. */}
              <div className="ssm-field">
                <label className="ssm-label">
                  Annual CTC <span className="ssm-req">*</span>
                </label>
                <div className={`ssm-money${(ctcInvalid || ctcTooLarge) ? ' is-invalid' : ''}`}>
                  <span className="ssm-rupee">₹</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="ssm-input ssm-input--money"
                    placeholder="e.g. 450000"
                    value={annualCtc}
                    onChange={e => applyCtc(e.target.value)}
                  />
                </div>
                {ctcTooLarge ? (
                  <span className="ssm-hint ssm-hint--err">Too large — max ₹999,999,999,999.99.</span>
                ) : ctcInvalid ? (
                  <span className="ssm-hint ssm-hint--err">Required — must be greater than 0.</span>
                ) : (
                  <span className="ssm-hint">
                    ≈ ₹{fmtINR(Math.round(salaryAnnual / 12))}/month · editing this re-splits the breakup below.
                  </span>
                )}
              </div>
              {/* Effective From is editable again (#124) — it was locked for
                  #118, which reported that it accepted FUTURE dates. Freezing
                  it fixed that by removing the control altogether, and took a
                  legitimate edit with it: a revision agreed from the 1st of a
                  past month could no longer be dated.

                  Both tickets are satisfied by bounding the picker instead of
                  removing it:
                    · floor  = joining date — a salary cannot start before the
                      employee existed (#87), and the field still SEEDS there.
                    · ceiling = today — no forward dating from this screen,
                      which is what #118 actually objected to.
                  The API keeps its own wider bound, so a forward-dated revision
                  remains possible programmatically for the payroll features
                  that rely on it; it is just not offered here. */}
              <div className="ssm-field">
                <label className="ssm-label">Effective From</label>
                <MasterDatePicker
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  minDate={employee.date_of_joining || undefined}
                  maxDate={todayISO()}
                  placeholder="Select date"
                />
                <span className="ssm-hint">
                  {employee.date_of_joining
                    ? `Defaults to the joining date (${new Date(employee.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}). Cannot be earlier than that, or in the future.`
                    : 'No joining date on the employee record, so today is used.'}
                </span>
              </div>
              {/* All three behave the same way: tick to apply, untick to
                  remove, and the choice is written back to the employee
                  record on save. Rendered as selectable cards rather than bare
                  checkboxes: they sit on the same row as two text inputs, and
                  as raw ticks they read as stray marks floating beside the
                  fields instead of a control group of their own. */}
              <div className="ssm-field ssm-field--wide">
                <label className="ssm-label">Statutory Components</label>
                <div className="ssm-toggles">
                  {([
                    { on: pfApplicable,  set: setPfApplicable,  label: 'PF', meta: '12% of basic' },
                    { on: esiApplicable, set: setEsiApplicable, label: 'ESI', meta: 'Gross ≤ ₹21k' },
                    { on: ptApplicable,  set: setPtApplicable,  label: 'Professional Tax', meta: 'State slab' },
                  ] as const).map(t => (
                    <label key={t.label} className={`ssm-toggle${t.on ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={t.on} onChange={e => t.set(e.target.checked)} />
                      <span className="ssm-toggle-box"><i className="ri-check-line" /></span>
                      <span className="ssm-toggle-text">
                        <span className="ssm-toggle-label">{t.label}</span>
                        <span className="ssm-toggle-meta">{t.meta}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {/* Only meaningful while PF is applied — hidden otherwise, the
                    same way the Employee form nests it under "PF Applicable".
                    (#127) */}
                {pfApplicable && (
                  <div className="ssm-pf-type">
                    <label className="ssm-label" htmlFor="ssm-pf-type">PF Type</label>
                    <select
                      id="ssm-pf-type"
                      className="form-select"
                      value={pfType}
                      onChange={e => setPfType(e.target.value === 'Standard' ? 'Standard' : 'Statutory')}
                    >
                      <option value="Statutory">Statutory (₹15k cap)</option>
                      <option value="Standard">Standard (full basic)</option>
                    </select>
                  </div>
                )}
                <span className="ssm-hint">Changing any of these here updates the Employee &amp; onboarding forms too, so the two stay in step.</span>
              </div>
              </div>
            </div>

            <div className="ssm-section">
              <div className="ssm-section-head">
                <span className="ssm-section-title">Breakup</span>
                <span className="ssm-section-sub">Earnings must total the Annual CTC before this can be saved</span>
              </div>

              {/* How the split + PF are derived, so anyone reading the breakup
                  understands the figures (same statements as the Employee form).
                  Was a four-line grey bullet list sitting between the fields and
                  the editor — the densest text on the screen, in the lowest
                  contrast, in the place the eye passes through most often. Same
                  words, folded away behind a summary so they are there when
                  wanted and silent when not. */}
              <details className="ssm-rules">
                <summary>
                  <i className="ri-information-line" />
                  How the split and PF are calculated
                  <i className="ri-arrow-down-s-line ssm-rules-caret" />
                </summary>
                <div className="ssm-rules-body">
                  <div className="ssm-rule"><b>Basic Salary</b><span>50% of monthly gross (statutory minimum, Code on Wages 2019).</span></div>
                  <div className="ssm-rule"><b>House Rent Allowance</b><span>30% of monthly gross.</span></div>
                  <div className="ssm-rule"><b>Special Allowance</b><span>The remaining balance after Basic + HRA.</span></div>
                  <div className="ssm-rule">
                    <b>PF Deduction</b>
                    <span>
                      12% of Basic Salary. <em>Statutory</em> caps the basic at the ₹15,000 EPF ceiling
                      (max ₹1,800/mo); <em>Standard</em> uses the full basic. ESI / PT are the fixed-deduction
                      rows you enter, and they are deducted <b>in full</b> each cycle — never scaled down for a
                      part-month or loss of pay.
                    </span>
                  </div>
                </div>
              </details>

              <div className="ssm-panels">
                {compTable(earnings, setEarnings, '#108548', 'Earnings')}
                {compTable(deductions, setDeductions, '#b91c1c', 'Fixed Deductions', 'ded')}
              </div>
            </div>

            {/* Totals — three tiles rather than stacked strips. The gross, the
                annualised figure and the net were previously crammed into one
                right-aligned column along with the CTC verdict and its fix
                button, so the single most important number on the screen (the
                gross) sat in the same visual weight as an error message. */}
            <div className="ssm-totals">
              <div className="ssm-tile ssm-tile--gross">
                <span className="ssm-tile-label">Monthly Gross</span>
                <span className="ssm-tile-value">₹{fmtINR(grossTotal)}</span>
                <span className="ssm-tile-meta">≈ ₹{fmtINR(breakupAnnual)} / year</span>
              </div>
              <div className="ssm-tile">
                <span className="ssm-tile-label">Fixed Deductions</span>
                <span className="ssm-tile-value ssm-tile-value--ded">
                  {dedTotal > 0 ? <>− ₹{fmtINR(dedTotal)}</> : '₹0'}
                </span>
                <span className="ssm-tile-meta">{dedTotal > 0 ? 'incl. PF, per month' : 'none configured'}</span>
              </div>
              <div className="ssm-tile ssm-tile--net">
                <span className="ssm-tile-label">Net (Monthly)</span>
                <span className="ssm-tile-value ssm-tile-value--net">₹{fmtINR(netMonthly)}</span>
                <span className="ssm-tile-meta">estimate — ESI / PT / LOP apply at run-time</span>
              </div>
            </div>

            {/* The CTC verdict, as a banner of its own. Either direction blocks
                the save, so both read the same way and both offer the one-click
                correction. */}
            {salaryAnnual > 0 && (overSalary || underSalary) && (
              <div className="ssm-verdict ssm-verdict--err">
                <i className="ri-error-warning-line" />
                <span className="ssm-verdict-text">
                  <b>₹{fmtINR(Math.abs(salaryDiff))} {overSalary ? 'over' : 'short of'}</b> the Annual CTC
                  {' '}(₹{fmtINR(salaryAnnual)}) — this cannot be saved until the breakup matches.
                </span>
                <button type="button" className="ssm-verdict-fix" onClick={balanceToBasic}>
                  <i className="ri-scales-3-line" /> Balance to Basic
                </button>
              </div>
            )}
            {/* Within the rounding slack counts as matching, so the seeded
                split does not read as "₹4 over". */}
            {salaryAnnual > 0 && !overSalary && !underSalary && (
              <div className="ssm-verdict ssm-verdict--ok">
                <i className="ri-checkbox-circle-line" />
                <span className="ssm-verdict-text">Breakup matches the Annual CTC.</span>
              </div>
            )}

            <div className="ssm-field ssm-field--note">
              <label className="ssm-label">Revision note <span className="ssm-optional">optional</span></label>
              <input
                className="ssm-input ssm-input--note"
                placeholder="e.g. Annual increment April 2026"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        {!loading && (
          <div className="ssm-footer">
            <span className="ssm-footer-note">
              <i className="ri-history-line" />
              Saving supersedes the active structure and starts a new version.
            </span>
            <div className="ssm-footer-actions">
              <button type="button" className="ssm-btn ssm-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="ssm-btn ssm-btn--primary" onClick={save} disabled={saving}>
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

/* ── Styles ──────────────────────────────────────────────────────────────
 * Scoped to .ssm-* so nothing here can reach the pages behind the modal, and
 * written against the Velzon CSS variables so it follows the app's light/dark
 * theme rather than pinning its own colours. Same house style as the payroll
 * run dialog (.prm-*) and the payslip viewer (.ep-pay-*).
 * ──────────────────────────────────────────────────────────────────────── */
function SalaryModalStyles() {
  return (
    <style>{`
      .ssm-modal { max-width: 980px; }
      .ssm-card {
        border: none;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.30);
        /* The card owns the height and the BODY is the only scrolling region,
           so the dialog never grows past the viewport and the footer stays
           reachable at any content length. */
        max-height: calc(100vh - 3rem);
      }
      .ssm-shell { display: flex; flex-direction: column; min-height: 0; max-height: calc(100vh - 3rem); }

      /* ── Hero ── */
      .ssm-hero {
        position: relative;
        flex-shrink: 0;
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        padding: 18px 22px;
        background: linear-gradient(135deg, #4c2fbe 0%, #5a3fd1 45%, #7c5cfc 100%);
        color: #fff;
        overflow: hidden;
      }
      .ssm-hero-glow {
        position: absolute; top: -70px; right: -40px;
        width: 220px; height: 220px; border-radius: 50%;
        background: rgba(255,255,255,0.08); pointer-events: none;
      }
      .ssm-hero-main { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; min-width: 0; }
      .ssm-avatar {
        width: 44px; height: 44px; border-radius: 13px; flex-shrink: 0;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.18);
        border: 1px solid rgba(255,255,255,0.28);
        font-size: 15px; font-weight: 800; letter-spacing: .02em;
      }
      .ssm-hero-text { min-width: 0; }
      .ssm-title {
        margin: 0 0 5px; font-size: 16.5px; font-weight: 700; letter-spacing: -0.01em;
        color: #fff; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
      }
      .ssm-title-sep { opacity: .55; font-weight: 400; }
      .ssm-title-emp { font-weight: 600; color: rgba(255,255,255,0.92); }
      .ssm-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .ssm-chip {
        font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
        padding: 2px 9px; border-radius: 999px;
        background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.90);
        border: 1px solid rgba(255,255,255,0.16);
      }
      .ssm-chip--solid { background: rgba(255,255,255,0.94); color: #4c2fbe; border-color: transparent; }
      .ssm-close {
        position: relative; z-index: 1; flex-shrink: 0;
        width: 30px; height: 30px; border-radius: 9px;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18);
        color: #fff; font-size: 17px; cursor: pointer;
        transition: background .15s ease;
      }
      .ssm-close:hover { background: rgba(255,255,255,0.24); }

      /* ── Body: the single scroll region ── */
      .ssm-body {
        flex: 1 1 auto; min-height: 0; overflow-y: auto;
        overscroll-behavior: contain;
        padding: 18px 22px 20px;
        background: var(--vz-secondary-bg);
      }
      .ssm-loading {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 10px; padding: 56px 0; color: var(--vz-secondary-color); font-size: 12.5px;
        background: var(--vz-secondary-bg);
      }

      /* ── Section ── */
      .ssm-section {
        background: var(--vz-card-bg);
        border: 1px solid var(--vz-border-color);
        border-radius: 14px;
        padding: 14px 16px 16px;
        margin-bottom: 14px;
      }
      .ssm-section-head { margin-bottom: 12px; }
      .ssm-section-title {
        display: block; font-size: 11px; font-weight: 800;
        letter-spacing: .10em; text-transform: uppercase; color: #5a3fd1;
      }
      .ssm-section-sub { display: block; font-size: 11.5px; color: var(--vz-secondary-color); margin-top: 2px; }

      /* ── Fields ── */
      .ssm-grid {
        display: grid; gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
      .ssm-field--wide { grid-column: 1 / -1; }
      @media (max-width: 700px) { .ssm-grid { grid-template-columns: 1fr; } }
      .ssm-field { display: flex; flex-direction: column; min-width: 0; }
      .ssm-field--note { margin-top: 2px; }
      .ssm-label {
        font-size: 11.5px; font-weight: 700; margin-bottom: 5px;
        color: var(--vz-heading-color, var(--vz-body-color));
      }
      .ssm-req { color: #dc2626; }
      .ssm-optional { font-weight: 500; color: var(--vz-secondary-color); font-size: 10.5px; }
      .ssm-hint { font-size: 10.5px; color: var(--vz-secondary-color); margin-top: 4px; line-height: 1.5; }
      .ssm-hint--err { color: #dc2626; font-weight: 600; }

      .ssm-input {
        width: 100%; height: 36px;
        padding: 0 11px;
        font-size: 13px;
        color: var(--vz-body-color);
        background: var(--vz-card-bg);
        border: 1px solid var(--vz-border-color);
        border-radius: 9px;
        outline: none;
        transition: border-color .15s ease, box-shadow .15s ease;
      }
      .ssm-input:focus { border-color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
      .ssm-input[readonly] { background: var(--vz-light); color: var(--vz-secondary-color); cursor: not-allowed; }
      .ssm-input--note { height: 38px; }
      .ssm-money { position: relative; display: flex; align-items: center; }
      .ssm-money .ssm-input--money { padding-left: 24px; font-weight: 600; }
      .ssm-money.is-invalid .ssm-input { border-color: #dc2626; }
      .ssm-money.is-invalid .ssm-input:focus { box-shadow: 0 0 0 3px rgba(220,38,38,0.15); }
      .ssm-rupee {
        position: absolute; left: 10px; z-index: 1;
        font-size: 12.5px; color: var(--vz-secondary-color); pointer-events: none;
      }

      /* ── Statutory toggles ── */
      .ssm-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
      /* PF Type sits under the toggles it belongs to, narrow enough that it
         reads as a detail of the PF tick rather than a fourth component. */
      .ssm-pf-type { margin-top: 10px; max-width: 260px; }
      .ssm-pf-type .ssm-label { margin-bottom: 4px; }
      .ssm-toggle {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px 8px 10px;
        border: 1px solid var(--vz-border-color);
        border-radius: 10px;
        background: var(--vz-card-bg);
        cursor: pointer; user-select: none;
        transition: border-color .15s ease, background .15s ease;
      }
      .ssm-toggle:hover { border-color: #a78bfa; }
      .ssm-toggle input { position: absolute; opacity: 0; pointer-events: none; }
      .ssm-toggle-box {
        width: 17px; height: 17px; border-radius: 5px; flex-shrink: 0;
        border: 1.5px solid var(--vz-border-color);
        display: inline-flex; align-items: center; justify-content: center;
        color: transparent; font-size: 12px;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      .ssm-toggle.is-on { border-color: #7c5cfc; background: rgba(124,92,252,0.07); }
      .ssm-toggle.is-on .ssm-toggle-box { background: #7c5cfc; border-color: #7c5cfc; color: #fff; }
      .ssm-toggle-text { display: flex; flex-direction: column; line-height: 1.25; }
      .ssm-toggle-label { font-size: 12.5px; font-weight: 600; color: var(--vz-body-color); }
      .ssm-toggle-meta { font-size: 10px; color: var(--vz-secondary-color); }

      /* ── Rules disclosure ── */
      .ssm-rules {
        border: 1px solid var(--vz-border-color);
        border-radius: 10px;
        background: var(--vz-secondary-bg);
        margin-bottom: 14px;
      }
      .ssm-rules > summary {
        list-style: none; cursor: pointer;
        display: flex; align-items: center; gap: 7px;
        padding: 9px 12px;
        font-size: 11.5px; font-weight: 600; color: var(--vz-secondary-color);
      }
      .ssm-rules > summary::-webkit-details-marker { display: none; }
      .ssm-rules > summary:hover { color: #5a3fd1; }
      .ssm-rules-caret { margin-left: auto; transition: transform .15s ease; }
      .ssm-rules[open] .ssm-rules-caret { transform: rotate(180deg); }
      .ssm-rules-body { padding: 2px 12px 12px; display: flex; flex-direction: column; gap: 7px; }
      .ssm-rule { font-size: 11px; line-height: 1.55; color: var(--vz-secondary-color); }
      .ssm-rule b { display: block; color: var(--vz-body-color); font-size: 11px; font-weight: 700; }

      /* ── Component panels ── */
      .ssm-panels { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      @media (max-width: 700px) { .ssm-panels { grid-template-columns: 1fr; } }
      .ssm-panel {
        border: 1px solid var(--vz-border-color);
        border-radius: 12px;
        background: var(--vz-secondary-bg);
        padding: 11px 12px 12px;
        min-width: 0;
      }
      .ssm-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
      .ssm-panel-title {
        display: inline-flex; align-items: center; gap: 7px;
        font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
        color: var(--vz-body-color);
      }
      .ssm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .ssm-panel-tools { display: inline-flex; align-items: center; gap: 7px; }
      .ssm-panel-count {
        font-size: 10px; font-weight: 700; min-width: 18px; text-align: center;
        padding: 1px 6px; border-radius: 999px;
        background: var(--vz-light); color: var(--vz-secondary-color);
      }
      .ssm-add {
        display: inline-flex; align-items: center; gap: 3px;
        font-size: 10.5px; font-weight: 700;
        padding: 3px 9px; border-radius: 8px;
        background: var(--vz-card-bg);
        border: 1px solid var(--vz-border-color);
        color: var(--vz-body-color); cursor: pointer;
        transition: border-color .15s ease, color .15s ease;
      }
      .ssm-add:hover { border-color: #7c5cfc; color: #5a3fd1; }

      .ssm-rows { display: flex; flex-direction: column; gap: 7px; }
      .ssm-row { display: flex; align-items: center; gap: 7px; }
      .ssm-row .ssm-input--name { flex: 1 1 auto; min-width: 0; height: 34px; font-size: 12.5px; }
      .ssm-row .ssm-amount { position: relative; display: flex; align-items: center; width: 118px; flex-shrink: 0; }
      .ssm-row .ssm-input--amount {
        height: 34px; font-size: 12.5px; font-weight: 600;
        padding-left: 22px; text-align: right;
      }
      .ssm-row-del, .ssm-row-lock {
        width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 14px; background: transparent; border: none;
      }
      .ssm-row-del { color: #b91c1c; cursor: pointer; transition: background .15s ease; }
      .ssm-row-del:hover { background: rgba(185,28,28,0.10); }
      .ssm-row-lock { color: var(--vz-secondary-color); opacity: .7; }
      .ssm-empty {
        display: flex; align-items: center; gap: 7px;
        padding: 12px 4px; font-size: 11.5px; color: var(--vz-secondary-color);
      }
      .ssm-empty i { font-size: 15px; opacity: .6; }
      .ssm-panel-foot {
        display: flex; align-items: flex-start; gap: 6px;
        margin-top: 9px; padding-top: 9px;
        border-top: 1px dashed var(--vz-border-color);
        font-size: 10.5px; line-height: 1.5; color: var(--vz-secondary-color);
      }
      .ssm-panel-foot i { font-size: 12px; flex-shrink: 0; margin-top: 1px; }

      /* (.ssm-locked* removed with the frozen Effective From field — #124.) */

      /* ── Totals ── */
      .ssm-totals { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 12px; }
      @media (max-width: 700px) { .ssm-totals { grid-template-columns: 1fr; } }
      .ssm-tile {
        display: flex; flex-direction: column; gap: 2px;
        padding: 12px 14px;
        border: 1px solid var(--vz-border-color);
        border-radius: 12px;
        background: var(--vz-card-bg);
      }
      .ssm-tile--gross { border-color: rgba(124,92,252,0.35); background: rgba(124,92,252,0.06); }
      .ssm-tile--net   { border-color: rgba(10,135,84,0.30);  background: rgba(10,135,84,0.06); }
      .ssm-tile-label {
        font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
        color: var(--vz-secondary-color);
      }
      .ssm-tile-value { font-size: 20px; font-weight: 800; line-height: 1.15; color: #5a3fd1; }
      .ssm-tile-value--ded { color: #b91c1c; }
      .ssm-tile-value--net { color: #0a8754; }
      .ssm-tile-meta { font-size: 10.5px; color: var(--vz-secondary-color); }

      /* ── Verdict banner ── */
      .ssm-verdict {
        display: flex; align-items: center; gap: 9px;
        padding: 10px 13px; border-radius: 11px;
        font-size: 12px; margin-bottom: 12px;
        border: 1px solid transparent;
      }
      .ssm-verdict i { font-size: 16px; flex-shrink: 0; }
      .ssm-verdict-text { flex: 1 1 auto; line-height: 1.45; }
      .ssm-verdict--err { background: #fdecea; border-color: #f5c0b5; color: #b1401d; }
      .ssm-verdict--ok  { background: #e7f6ef; border-color: #b6e2ce; color: #0a6f47; }
      [data-bs-theme="dark"] .ssm-verdict--err { background: rgba(177,64,29,0.16); border-color: rgba(240,101,72,0.34); color: #fda192; }
      [data-bs-theme="dark"] .ssm-verdict--ok  { background: rgba(10,135,84,0.16);  border-color: rgba(10,179,156,0.34); color: #7ddfbf; }
      .ssm-verdict-fix {
        flex-shrink: 0;
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; font-weight: 700;
        padding: 5px 11px; border-radius: 999px;
        background: #b1401d; color: #fff; border: none; cursor: pointer;
        transition: filter .15s ease;
      }
      .ssm-verdict-fix:hover { filter: brightness(1.08); }

      /* ── Footer ── */
      .ssm-footer {
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 22px;
        background: var(--vz-card-bg);
        border-top: 1px solid var(--vz-border-color);
        flex-wrap: wrap;
      }
      .ssm-footer-note {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10.5px; color: var(--vz-secondary-color);
      }
      .ssm-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      .ssm-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 8px 16px; border-radius: 9px;
        font-size: 12.5px; font-weight: 600; cursor: pointer;
        border: 1px solid transparent;
        transition: filter .15s ease, background .15s ease;
      }
      .ssm-btn:disabled { opacity: .6; cursor: not-allowed; }
      .ssm-btn--ghost {
        background: var(--vz-card-bg); color: var(--vz-body-color);
        border-color: var(--vz-border-color);
      }
      .ssm-btn--ghost:hover:not(:disabled) { background: var(--vz-light); }
      .ssm-btn--primary {
        background: linear-gradient(135deg, #5a3fd1, #7c5cfc);
        color: #fff; box-shadow: 0 4px 12px rgba(90,63,209,0.28);
      }
      .ssm-btn--primary:hover:not(:disabled) { filter: brightness(1.06); }
    `}</style>
  );
}
